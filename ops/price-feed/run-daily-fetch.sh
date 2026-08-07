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
# a doubled run adds 0 new marks, so the schedule can fire this script repeatedly.
#
# IT DOES NOT MEAN A MISSED RUN CATCHES UP (an earlier version of this comment said
# it did). Idempotency makes a REPEATED run harmless; it does nothing for a run that
# never happened. `asOf` is the CDMX calendar date, so once midnight passes,
# `isFreshBar` refuses yesterday's bar permanently and the day is unrecoverable.
# launchd DOES start a slept-through job at the next wake (coalescing several
# intervals into one), but that catch-up lands under the new date and so recovers
# nothing. What actually recovers a missed evening is the SCHEDULE: the plist fires
# this script hourly from 18:00 to 23:00 (#185 S2), so any hour the machine is awake
# within the CDMX day still marks it. Past midnight, only the gap report (#186) can
# name the loss.
#
# WHY THERE IS NO LOCK, stated accurately — the mark id is NOT the reason. It covers
# marks only, and says nothing about `atomicWrite`'s fixed `${filePath}.tmp` or the
# accumulus git `index.lock`, both of which two concurrent runs would collide over.
# What actually makes the repeated schedule safe is launchd's PER-LABEL SINGLETON:
# it will not start a second instance of a job already running. That leaves only
# schedule-vs-human collisions (a manual run during a scheduled one), which fail
# loud under `set -e` and self-heal on the next hour — cheaper than a lock.
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
# The durable data root. RESOLVED HERE, not at step 3 where it is used for the
# commit, because the heartbeat trap below must know where to write BEFORE the
# exit-127 checks — which are the very failures the heartbeat exists to record.
DATA_DIR="${NUMISMA_DATA_DIR:-$HOME/Dev/accumulus/data}"
# ----------------------------------------------------------------------------

# Give the scheduled (non-login) job a deterministic PATH that can find pnpm. This
# is the self-sufficient fix; the plist's EnvironmentVariables PATH is an optional
# additional belt-and-suspenders (see the plist / docs/price-feed-ops.md).
export PATH="$PATH_PREPEND:$PATH"

STAMP="$(date +%Y-%m-%dT%H-%M-%S%z)"
# A real ISO-8601 instant for the heartbeat (STAMP's dashed time is filename-safe,
# not machine-parseable). UTC so the reader never has to guess a zone.
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
# How far the run got. MAINTAINED, not guessed: each step below advances it, so a
# heartbeat can say WHERE a run died and not merely that it did.
LAST_STEP="startup"
HEARTBEAT_FILE="$DATA_DIR/job-heartbeat.json"

# --- was this run even CAPABLE of marking? (#185 S2) -------------------------
# `RunAtLoad true` means this script now fires at ANY hour — a 09:00 login is an
# ordinary trigger. Such a run stores quotes and emits ZERO marks (the mark-instant
# contract gates on 18:00 CDMX), then exits 0. To the heartbeat reader that looked
# identical to a healthy evening, which SILENCED the staleness warning on exactly
# the morning after a lost day. So record the distinction instead of guessing at it.
#
# `10#` forces base 10: bare `08`/`09` from `date +%H` are invalid OCTAL and would
# abort the arithmetic — a boundary that only breaks during two hours of the morning.
#
# Duplicating the mark hour into bash is deliberate and guarded: the plist hardcodes
# it too, and apps/price-feed/src/schedule-window.test.ts pins BOTH against
# DEFAULT_CONFIG.markTime so a change to the contract fails a test rather than
# rotting here silently.
MARK_HOUR=18
if [[ $((10#$(date +%H))) -ge $MARK_HOUR ]]; then
  MARK_WINDOW=true
else
  MARK_WINDOW=false
fi

# The heartbeat has ONE slot, so an out-of-window run OVERWRITES the evening run's
# breadcrumb. Carrying the last in-window finish forward is what stops that erasing
# the evidence: without it the reader must choose between going silent after every
# login (the bug) and crying wolf after every healthy evening. Read BEFORE the trap
# can overwrite the file, and never inside the trap — pure bash, but `sed` is still
# more work than an EXIT path in the middle of a failure should be doing.
CARRIED_MARK_WINDOW_AT=""
if [[ "$MARK_WINDOW" == "false" && -f "$HEARTBEAT_FILE" ]]; then
  CARRIED_MARK_WINDOW_AT="$(sed -n \
    's/.*"lastMarkWindowFinishedAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$HEARTBEAT_FILE" 2>/dev/null | head -n1)" || CARRIED_MARK_WINDOW_AT=""
  # A schemaVersion-1 file predates this field, and every v1 run was treated as
  # in-window — so its `finishedAt` IS the last in-window finish. Only fall back
  # when the previous run did not explicitly declare itself out-of-window.
  if [[ -z "$CARRIED_MARK_WINDOW_AT" ]] && ! grep -q '"markWindow"[[:space:]]*:[[:space:]]*false' "$HEARTBEAT_FILE" 2>/dev/null; then
    CARRIED_MARK_WINDOW_AT="$(sed -n \
      's/.*"finishedAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      "$HEARTBEAT_FILE" 2>/dev/null | head -n1)" || CARRIED_MARK_WINDOW_AT=""
  fi
fi
# ----------------------------------------------------------------------------

# --- the heartbeat (#191) ---------------------------------------------------
# THE ONE FACT THE DURABLE LOG CANNOT CONTAIN IS WHETHER THIS JOB RAN. The gap
# report is a pure function of the log, deliberately — and the price of that purity
# is exact: a run that fired and died leaves the same evidence as a machine that was
# switched off, and a run that fetched cleanly then failed later leaves none at all.
#
# PURE BASH, ON PURPOSE. No node, no pnpm, no jq. The case that justifies the whole
# design is exit 127 — `pnpm` or `node` unresolvable, in which NOTHING that needs
# node can run — so the writer must have no dependency that could be the thing
# that is missing. A `printf` into a file has none.
#
# It writes to a FILE, never to stdout: by the time this fires, stdout is a pipe to
# a `tee` in a process substitution that may already be gone. And every command in
# it is guarded, because a failure inside an EXIT trap under `set -e` would replace
# the very exit code the heartbeat exists to record. `$?` is captured as the FIRST
# act for the same reason — anything before it clobbers the status.
#
# It lands beside gap-report.json in the data dir, so the outcome travels with the
# DATA rather than with the checkout. It is written after step 4's git checks have
# already run, so it can never dirty the tree it just verified.
write_heartbeat() {
  HEARTBEAT_STATUS=$?
  [[ -d "$DATA_DIR" ]] || return 0
  HEARTBEAT_FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" || HEARTBEAT_FINISHED_AT="$STARTED_AT"
  # An in-window run IS its own last in-window run; an out-of-window one re-emits
  # whatever it carried. The field is OMITTED rather than written empty when there is
  # nothing to carry: the reader validates it as an ISO instant and treats a bad one
  # as an unreadable FILE, so `""` here would blind the whole breadcrumb.
  if [[ "$MARK_WINDOW" == "true" ]]; then
    HEARTBEAT_MARK_WINDOW_AT="$HEARTBEAT_FINISHED_AT"
  else
    HEARTBEAT_MARK_WINDOW_AT="$CARRIED_MARK_WINDOW_AT"
  fi
  if [[ -n "$HEARTBEAT_MARK_WINDOW_AT" ]]; then
    printf '{\n  "schemaVersion": 2,\n  "startedAt": "%s",\n  "finishedAt": "%s",\n  "exitCode": %d,\n  "lastStep": "%s",\n  "markWindow": %s,\n  "lastMarkWindowFinishedAt": "%s"\n}\n' \
      "$STARTED_AT" "$HEARTBEAT_FINISHED_AT" "$HEARTBEAT_STATUS" "$LAST_STEP" \
      "$MARK_WINDOW" "$HEARTBEAT_MARK_WINDOW_AT" \
      > "$HEARTBEAT_FILE" 2>/dev/null || true
  else
    printf '{\n  "schemaVersion": 2,\n  "startedAt": "%s",\n  "finishedAt": "%s",\n  "exitCode": %d,\n  "lastStep": "%s",\n  "markWindow": %s\n}\n' \
      "$STARTED_AT" "$HEARTBEAT_FINISHED_AT" "$HEARTBEAT_STATUS" "$LAST_STEP" "$MARK_WINDOW" \
      > "$HEARTBEAT_FILE" 2>/dev/null || true
  fi
  return 0
}
# Installed BEFORE the log dir is even made, so every exit path below is covered —
# including the two `exit 127`s, which happen before anything node-shaped exists.
trap write_heartbeat EXIT
# ----------------------------------------------------------------------------

mkdir -p "$LOG_DIR"
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

LAST_STEP="resolve-tools"
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
LAST_STEP="prices-fetch"
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
LAST_STEP="spine"
echo "[$STAMP] prices:fetch clean — ingesting marks via pnpm spine"
pnpm spine

# 3) Persist the appended marks to the private data repo. `pnpm spine` appends the
#    day's marks to events.jsonl but leaves that change UNCOMMITTED — a stray
#    reset/checkout would silently lose real fund data (exactly how a multi-day
#    backlog once piled up in the working tree). Commit the tracked data changes so
#    the durable log is actually durable. Scoped to the data dir (never sweeps
#    unrelated repo edits), idempotent (a no-new-marks run commits nothing), and it
#    NEVER pushes — pushing to the remote stays a manual, reviewed step.
#
#    DATA_DIR defaults to the SAME tree the in-process capture writes to
#    (apps/tui/src/ingest-commit.ts derives ~/Dev/accumulus/data from os.homedir()
#    when NUMISMA_DATA_DIR is unset), so this backstop AND the step-4 post-check
#    always target the dir actually written to — never a no-op that leaves a failed
#    capture uncommitted while the job stays green. It is now RESOLVED IN THE
#    CONFIGURATION BLOCK at the top rather than here: the heartbeat trap needs it
#    before the exit-127 checks, which run long before this step.
#
#    `git add -u` restages tracked modifications only, so a FIRST-TIME untracked
#    source-of-truth file (e.g. an initial genesis.json) would slip past this
#    backstop and then FATAL the post-check. The source-of-truth files
#    (events.jsonl, genesis.json, preferences.jsonl, orders.jsonl) are NEVER
#    ignored — the accumulus allowlist names each one — so also add them
#    explicitly. head-digest.json is deliberately NOT added here — it may be intentionally ignored, and `git add` of an ignored
#    path aborts under `set -e`. Each explicit add is guarded on file existence so a
#    missing optional file doesn't trip `set -e`.
LAST_STEP="commit"
if ! git -C "$DATA_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo "[$STAMP] WARNING: $DATA_DIR is not inside a git repo — skipping commit (durable log left uncommitted)."
else
  git -C "$DATA_DIR" add -u -- .
  for f in events.jsonl genesis.json preferences.jsonl orders.jsonl; do
    if [[ -e "$DATA_DIR/$f" ]]; then
      git -C "$DATA_DIR" add -- "$f"
    fi
  done
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
#    launchd job's stderr goes to an UNREAD log — a "loud warning" reaches no one.
#    A FAILED JOB REACHES NO ONE EITHER. (An earlier version of this comment claimed
#    it did. Measured against the live agent: launchd RECORDS the exit code and
#    `launchctl print` will show it on request, but nothing is PUSHED — no
#    notification, no badge, no mail. The `exit 1` below is only as loud as someone
#    remembering to go and look, which is the same failure it was written to prevent.)
#    That is why this run now also writes job-heartbeat.json (#191): the exit code
#    becomes a breadcrumb the TUI reads on the next startup, which is what actually
#    delivers it. So after the in-process capture AND the
#    step-3 backstop have both run, verify the data-dir working tree is clean and
#    turn the job RED if it is not. Split by ADR stance: the event log is the
#    source-of-truth (STRICT — dirty ⇒ non-zero exit), head-digest.json is a forensic
#    breadcrumb (LENIENT — warn only). Paths are relative to $DATA_DIR, which is the
#    accumulus `data/` subdir holding the durable files directly.
LAST_STEP="post-check"
if git -C "$DATA_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  # --ignored is REQUIRED: head-digest.json in the #132 shape is only-ignored (an
  # allowlist .gitignore keeps it out of history), and plain `git status --porcelain`
  # shows nothing for an ignored path even when named explicitly — so the warning
  # would be dead in exactly the drift case it documents. With --ignored it fires for
  # both tracked-modified (` M`) and ignored-present (`!!`) states.
  DIGEST_DIRTY="$(git -C "$DATA_DIR" status --porcelain --ignored -- head-digest.json)"
  if [[ -n "$DIGEST_DIRTY" ]]; then
    echo "[$STAMP] WARNING: head-digest.json uncaptured after ingest (forensic breadcrumb lagging, not fatal):"
    echo "$DIGEST_DIRTY"
  fi
  # orders.jsonl belongs in THIS (strict, no --ignored) arm: it is a TRACKED durable
  # file per the accumulus allowlist, not an only-ignored breadcrumb like
  # head-digest.json. Naming it here is only honest because the allowlist landed
  # first — over an ignored path this arm would report clean while git discards it.
  LOG_DIRTY="$(git -C "$DATA_DIR" status --porcelain -- events.jsonl genesis.json preferences.jsonl orders.jsonl)"
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

# Steps 5 and 6 are the DERIVED surfaces, and they run in this order for a reason
# stated once here: THE LOCAL ONE FIRST, THE NETWORKED ONE SECOND. Under `set -e` a
# failing step aborts every step after it, so ordering decides what a partial run
# still delivers. `gap-report` needs no credential and no network — it is a pure
# read of the log this run just verified, so if it runs first it succeeds on every
# run that got past step 4, INCLUDING the runs where the database is unreachable.
# The other order would have let a 30-second Neon outage leave the standup reading
# a `generatedAt` from yesterday — which is the exact staleness these two steps were
# added to end.

# 5) Rewrite gap-report.json beside the durable log. Without this the file exists
#    only from manual runs, so the standup's data source is a day stale every
#    morning BY CONSTRUCTION — and stale precisely on the morning after a miss,
#    the only morning it exists for. (The TUI channel derives the same report
#    live and was never affected; this is the file half only.)
#
#    Needs no credential and no data-dir variable — it is a pure function of the
#    log. It writes into $DATA_DIR, the accumulus tree step 3 just committed, but
#    cannot dirty it: accumulus uses an allowlist .gitignore under which
#    gap-report.json falls through to /data/* (ignored, untracked), and step 4's
#    strict arm runs `git status --porcelain` WITHOUT `--ignored` over the FOUR
#    durable files it names, so the sidecar is invisible to it either way. (Four,
#    not five: the allowlist versions five files, but head-digest.json is handled
#    by the lenient `--ignored` arm above, and that arm reports rather than fails.)
#
#    ZERO-ARGUMENT, and it stays that way even as the log ages: the command floors
#    its own window at `boundedEraFloor` — the launchd era start, or 400 days back,
#    whichever is later — so the default window can never grow into the command's
#    own width cap. Before that clamp this line was a date-bomb: the era start is
#    fixed while the ceiling is yesterday, so on 2027-08-08 the window would have
#    hit 401 days and this step would have thrown every night from then on, after
#    every other step had already succeeded.
LAST_STEP="gap-report"
pnpm gap-report -- --write

# 6) Refresh the hosted projection. `backfill`, NOT `push`, and the difference is
#    the whole reason this step can be unattended: `push` writes ONE row — the
#    current fold's `asOf` — so a run that died yesterday leaves yesterday
#    permanently missing from the dashboard. `backfill` enumerates the log's own
#    anchored dates and upserts every one under `ON CONFLICT (fund_id, as_of) DO
#    UPDATE`, so a missed day heals on the next fire. It is zero-argument by
#    construction (it reads the dates off the log), which is what keeps a cron job
#    from eventually writing the wrong date.
#
#    IT NEEDS `PROJECTION_WRITE_DATABASE_URL` AND WILL THROW IMMEDIATELY WITHOUT IT.
#    That key comes from $ENV_FILE, sourced at the top — the same private,
#    chmod-600, outside-the-repo file as the provider tokens. If it is absent the
#    run goes red here (exit 1) rather than silently skipping, which is correct:
#    the projection going stale is exactly the thing this step exists to prevent.
#
#    WHY BOTH OF THESE RUN AFTER THE POST-CHECK, not before. This is a network call
#    that can fail on its own terms. Placed earlier it would abort the run after
#    step 3 committed the log but BEFORE step 4 verified it landed — muddying the
#    one check that guards real fund data with an unrelated database failure. The
#    durable log is the source of truth; the projection is a derived read surface,
#    so it is verified last and cannot pre-empt the log's own check.
LAST_STEP="backfill"
pnpm backfill

LAST_STEP="complete"
echo "[$STAMP] price-feed daily run complete."
