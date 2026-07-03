# Price-feed operations (scheduling, tokens, triage)

The daily price run (ADR-005 two-plane price model, PRD #105, slice #108) makes
prices arrive with zero typing: a scheduled job fetches quotes into the disposable
price store and queues one `PriceMarked` per instrument per trading day in the
inbox, then `pnpm spine` validates and appends them through the unchanged ±50%
magnitude guard. Manual `pnpm prices:fetch` and hand-authored marks keep working
alongside the schedule — the schedule is an addition, never a replacement (C5).

Everything here is machine-local. Nothing secret or trade-derived enters the repo
(transaction-data-is-private): tokens and logs live outside the checkout.

## Components

| File | Role |
| --- | --- |
| `ops/price-feed/run-daily-fetch.sh` | Wrapper the scheduler calls. Sources tokens, runs `pnpm prices:fetch`, and — only on a clean fetch — `pnpm spine`. Preserves the non-zero exit code so the scheduler notices a failure or rejection. |
| `ops/price-feed/com.numisma.pricefeed.daily.plist` | launchd definition firing the wrapper at 18:00 local (the default mark time). |

Both files are templates: replace `__REPO_DIR__` / `__HOME__` before installing.

## Where provider tokens live (scheduled environment)

- **Crypto needs no token.** Binance public REST is keyless, so a crypto-only run
  works with no secret at all.
- **US equities (Twelve Data) and the Banxico USD/MXN FIX (slice #107) each need a
  free key.** They are read from a private env file **outside the repo**, default
  `~/.config/numisma/price-feed.env`, sourced by the wrapper. Create it `chmod 600`,
  one `KEY=value` per line:

  ```sh
  install -m 600 /dev/null ~/.config/numisma/price-feed.env
  # then edit; the two keys the fetch reads (see packages/price-feed/src/config.ts):
  #   TWELVEDATA_API_KEY=...   # Twelve Data free key, US equities
  #   BANXICO_TOKEN=...        # Banxico SIE free token, USD/MXN FIX series SF43718
  ```

  The wrapper `source`s it if present. If a key is absent, only that provider's
  instruments fail (loud, per-symbol) — crypto still runs keyless. The file is never
  committed and never printed (only its path is logged). This mirrors the
  `data/`-is-private posture: secrets are a machine-local artifact beside the repo,
  not in it.

## Install the daily schedule (macOS launchd)

1. Set the Mac's timezone to America/Mexico_City (or adjust the plist `Hour`/`Minute`
   to the local clock equal to 18:00 CDMX).
2. Edit both placeholders in `run-daily-fetch.sh` (`REPO_DIR`) and the plist
   (`__REPO_DIR__`, `__HOME__`).
3. Install and load:

   ```sh
   cp ops/price-feed/com.numisma.pricefeed.daily.plist \
      ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   launchctl load ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   ```

### cron alternative

If you prefer cron over launchd (again assuming the box is on CDMX time):

```cron
# m h  dom mon dow  command
  0 18  *   *   *   /bin/bash /ABSOLUTE/PATH/numisma/ops/price-feed/run-daily-fetch.sh
```

## Manual dry run (the schedule's only verification)

The wrapper and the launchd/cron definition are verified by a MANUAL dry run, not
by unit tests (there is nothing meaningful to unit-test in a plist). Run it after
install and record the result below.

```sh
# Exercise the wrapper exactly as the scheduler will (does not wait for 18:00):
/bin/bash ops/price-feed/run-daily-fetch.sh ; echo "wrapper exit: $?"

# Or drive it through launchd itself:
launchctl start com.numisma.pricefeed.daily
tail -n 40 ~/Library/Logs/numisma/price-feed-*.log
```

Confirm, in order:

1. The run logs `prices:fetch — N/N quotes stored` and, at/after 18:00 CDMX,
   `N new PriceMarked candidate(s)`.
2. Running it **again the same day** logs `0 new ... already pending — skipped`
   and `pnpm spine` reports `0 new` (idempotency — the deterministic id, #106).
3. The wrapper exit code is `0` on a clean run, non-zero if any symbol failed or a
   mark was rejected.

### Dry-run record

> Fill in when the schedule is installed on the operator machine.

| Date | Machine / TZ | Fetch result | Spine result | Re-run idempotent? | Wrapper exit |
| --- | --- | --- | --- | --- | --- |
| _pending_ | | | | | |

## Triage: a failed OR rejected scheduled run

The scheduled run halts before `pnpm spine` on any non-zero `prices:fetch`, so a
bad day never appends a bad mark. The console/log distinguishes the two cases —
**different problems, different fixes**:

### `FETCH FAILED  <id> <symbol> <message>` — provider failure

- The provider returned an error, a malformed payload, or timed out. Partial
  progress is kept (other symbols still stored/queued) and the run exits non-zero.
- **Action:** usually none. A missed or partial fetch is harmless under the
  idempotent id — the next daily run (or a manual `pnpm prices:fetch`) catches up.
  Investigate only if a symbol fails repeatedly (registry/symbol drift, provider
  outage). The failing symbol is named in the message.

### `SPINE WOULD REJECT  <id> <asOf>  price ... — <reason>` — a fetched mark trips the guard

- The fetch succeeded and stored the quote, but the queued mark deviates > ±50%
  from the instrument's last close, so the spine's magnitude guard would reject it.
  This is a **legitimate-move-or-unit-slip** case, surfaced at fetch time instead
  of as a silent gap.
- **Action:**
  1. Look at the price. If it is a data error (unit slip, bad payload), delete that
     mark from `data/inbox/transactions.json` and let the next run re-fetch.
  2. If the move is **real** (a genuine >50% day, or a long gap since the last
     mark), hand-author the mark through the inbox — the permanent manual fallback
     — then re-run `pnpm spine`. The guard is a sanity check on automation, not a
     veto on reality.
  3. Do not leave a doomed mark in the inbox: `pnpm spine` ingest is
     all-or-nothing, so one guard-tripping mark blocks the whole batch (including
     hand-authored events) until it is removed or replaced.

### Where to look

- Per-run logs: `~/Library/Logs/numisma/price-feed-*.log` (wrapper) and
  `launchd.price-feed.*.log` (launchd's own capture).
- The queued marks awaiting ingest: `data/inbox/transactions.json`.
- The disposable quotes (always upserted, even pre-mark-time): `data/prices/`.
