#!/usr/bin/env bash
#
# Hands-off daily price run (slice #108). The launchd/cron job calls THIS wrapper,
# never `pnpm` directly, so the scheduled environment gets a real login PATH, a
# private token file, per-run logs, and — critically — the #106 exit-code contract
# observed end-to-end (R4): a non-zero `prices:fetch` (a provider failure OR a
# fetched mark the spine guard would reject) HALTS the run before `pnpm spine`, so
# a doomed mark is never appended and never silently lost.
#
# Idempotency is free (ADR-005 / #106): the deterministic id `pm-<id>-<asOf>` means
# a missed run catches up on the next fire and a doubled run adds 0 new marks — so
# this wrapper needs no locking of its own.
#
# Edit the two placeholders below (or export them from the launchd plist), install
# per docs/price-feed-ops.md, then verify with the documented manual dry run.
set -euo pipefail

# --- configuration (edit for this machine) ----------------------------------
# Absolute path to the numisma repo checkout.
REPO_DIR="${NUMISMA_REPO_DIR:-__REPO_DIR__}"
# Private, OUTSIDE-THE-REPO env file holding provider tokens (see ops notes). It is
# sourced if present; crypto-only (this slice) is keyless, so it may not exist yet.
ENV_FILE="${NUMISMA_PRICEFEED_ENV:-$HOME/.config/numisma/price-feed.env}"
# Where per-run logs land (outside the repo; never committed).
LOG_DIR="${NUMISMA_PRICEFEED_LOG_DIR:-$HOME/Library/Logs/numisma}"
# Directories to PREPEND to PATH so `pnpm` — AND the `node` it shells out to —
# resolve under the scheduler. launchd/cron start this job with a bare, non-login
# PATH (/usr/bin:/bin:/usr/sbin:/sbin), so `pnpm` (installed under ~/Library/pnpm or
# Homebrew) is invisible and the run would die with a bare `pnpm: command not found`
# (exit 127). There is a SECOND, subtler hazard: if node is managed by asdf, `node`
# lives behind `~/.asdf/shims`, so even once pnpm resolves, pnpm's `node` lookup
# fails with the SAME exit-127 node-not-found unless the shims dir is on PATH FIRST.
# The default therefore puts `~/.asdf/shims` first, then the common pnpm/Homebrew
# locations. Override it if pnpm or node live elsewhere on this machine (drop the
# asdf entry if you do not use asdf). The manual dry run passes without this only
# because it inherits your interactive PATH.
PATH_PREPEND="${NUMISMA_PATH_PREPEND:-$HOME/.asdf/shims:$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin}"
# ----------------------------------------------------------------------------

# Give the scheduled (non-login) job a deterministic PATH that can find pnpm. This
# is the self-sufficient fix; the plist's EnvironmentVariables PATH is an optional
# additional belt-and-suspenders (see the plist / docs/price-feed-ops.md).
export PATH="$PATH_PREPEND:$PATH"

mkdir -p "$LOG_DIR"
STAMP="$(date +%Y-%m-%dT%H-%M-%S%z)"
LOG_FILE="$LOG_DIR/price-feed-$STAMP.log"

# Everything from here is tee'd to the per-run log AND the scheduler's stdout.
exec > >(tee -a "$LOG_FILE") 2>&1

echo "[$STAMP] price-feed daily run starting (repo=$REPO_DIR)"

# Load provider tokens from the private file if it exists. Nothing secret lives in
# the repo (transaction-data-is-private); the file is machine-local, chmod 600.
if [[ -f "$ENV_FILE" ]]; then
  echo "[$STAMP] sourcing provider tokens from $ENV_FILE"
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
else
  echo "[$STAMP] no token file at $ENV_FILE (fine: crypto-only Binance is keyless)"
fi

cd "$REPO_DIR"

# Fail LOUD if pnpm — or the node it drives — is still unresolvable. A clear, named
# error beats dying as a bare exit 127 mid-run. This is exactly the scheduled-
# environment PATH problem, so say so and point at the override.
if ! command -v pnpm >/dev/null 2>&1; then
  echo "[$STAMP] FATAL: 'pnpm' not found on PATH after prepending '$PATH_PREPEND'."
  echo "[$STAMP] The scheduler runs with a bare PATH and pnpm is not in it. Point"
  echo "[$STAMP] NUMISMA_PATH_PREPEND (or the plist EnvironmentVariables PATH) at the"
  echo "[$STAMP] directory holding pnpm (e.g. \`dirname \"\$(command -v pnpm)\"\` in your"
  echo "[$STAMP] interactive shell). See docs/price-feed-ops.md (install section)."
  exit 127
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[$STAMP] FATAL: 'node' not found on PATH after prepending '$PATH_PREPEND'."
  echo "[$STAMP] pnpm resolved but its 'node' did not — with asdf-managed node, 'node'"
  echo "[$STAMP] lives behind ~/.asdf/shims, which must be on PATH FIRST. Add the shims"
  echo "[$STAMP] dir to NUMISMA_PATH_PREPEND (e.g. \`dirname \"\$(command -v node)\"\` in"
  echo "[$STAMP] your interactive shell). See docs/price-feed-ops.md (install section)."
  exit 127
fi

# 1) Fetch + store + queue marks. Non-zero here = a provider failure OR a mark the
#    spine would reject (the CLI's fetch-time pre-check). Either way, STOP: do not
#    run spine on a run the operator has not looked at.
set +e
pnpm prices:fetch
FETCH_STATUS=$?
set -e

if [[ $FETCH_STATUS -ne 0 ]]; then
  echo "[$STAMP] prices:fetch exited $FETCH_STATUS — NOT running spine."
  echo "[$STAMP] Triage: FETCH FAILED = provider issue (retry/next run is harmless);"
  echo "[$STAMP]         SPINE WOULD REJECT = review the move, hand-author if real."
  echo "[$STAMP] See docs/price-feed-ops.md. Marks stay queued in the inbox for review."
  exit $FETCH_STATUS
fi

# 2) Clean fetch: land the day's marks through the unchanged spine ingest (the
#    ±50% guard still owns the authoritative append). Its own non-zero exit is
#    surfaced to the scheduler too.
echo "[$STAMP] prices:fetch clean — ingesting marks via pnpm spine"
pnpm spine

# 3) Persist the appended marks to the private data repo. `pnpm spine` appends the
#    day's marks to events.jsonl but leaves that change UNCOMMITTED — a stray
#    reset/checkout would silently lose real fund data (exactly how a multi-day
#    backlog once piled up in the working tree). Commit the tracked data changes so
#    the durable log is actually durable. Scoped to the data dir (never sweeps
#    unrelated repo edits), idempotent (a no-new-marks run commits nothing), and it
#    NEVER pushes — pushing to the remote stays a manual, reviewed step.
DATA_DIR="${NUMISMA_DATA_DIR:-}"
if [[ -z "$DATA_DIR" ]]; then
  echo "[$STAMP] NUMISMA_DATA_DIR unset — skipping data-repo commit (durable log left uncommitted)."
elif ! git -C "$DATA_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo "[$STAMP] WARNING: $DATA_DIR is not inside a git repo — skipping commit (durable log left uncommitted)."
else
  git -C "$DATA_DIR" add -u -- .
  if git -C "$DATA_DIR" diff --cached --quiet -- .; then
    echo "[$STAMP] no tracked data changes to commit (idempotent no-op run)."
  else
    git -C "$DATA_DIR" commit -q \
      -m "data: daily price marks $STAMP" \
      -m "Auto-committed by run-daily-fetch.sh after spine ingest. Not pushed (push is a manual, reviewed step)." \
      -- .
    echo "[$STAMP] committed durable-log changes (not pushed)."
  fi
fi

# 4) Post-check: assert the durable log actually landed. The 17-day silent miss
#    (the in-process capture skipping every run, issue #132) was invisible because a
#    launchd job's stderr goes to an UNREAD log — a "loud warning" reaches no one;
#    only a FAILED job reaches the operator. So after the in-process capture AND the
#    step-3 backstop have both run, verify the data-dir working tree is clean and
#    turn the job RED if it is not. Split by ADR stance: the event log is the
#    source-of-truth (STRICT — dirty ⇒ non-zero exit), head-digest.json is a forensic
#    breadcrumb (LENIENT — warn only). Paths are relative to $DATA_DIR, which is the
#    accumulus `data/` subdir holding the durable files directly.
if [[ -n "$DATA_DIR" ]] && git -C "$DATA_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  DIGEST_DIRTY="$(git -C "$DATA_DIR" status --porcelain -- head-digest.json)"
  if [[ -n "$DIGEST_DIRTY" ]]; then
    echo "[$STAMP] WARNING: head-digest.json uncaptured after ingest (forensic breadcrumb lagging, not fatal):"
    echo "$DIGEST_DIRTY"
  fi
  LOG_DIRTY="$(git -C "$DATA_DIR" status --porcelain -- events.jsonl genesis.json preferences.jsonl)"
  if [[ -n "$LOG_DIRTY" ]]; then
    echo "[$STAMP] FATAL: durable LOG uncaptured after ingest + backstop — real fund data at risk:"
    echo "$LOG_DIRTY"
    echo "[$STAMP] The source-of-truth log is dirty/uncommitted in $DATA_DIR. Investigate the"
    echo "[$STAMP] in-process capture (apps/tui/src/ingest-commit.ts) and the accumulus allowlist"
    echo "[$STAMP] (.gitignore). See issue #132 and docs/durable-log-ops.md."
    exit 1
  fi
  echo "[$STAMP] post-check OK: durable log committed clean in $DATA_DIR."
fi

echo "[$STAMP] price-feed daily run complete."
