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
# ----------------------------------------------------------------------------

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
echo "[$STAMP] price-feed daily run complete."
