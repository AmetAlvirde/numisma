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
| `ops/price-feed/run-daily-fetch.sh` | Wrapper the scheduler calls. Sets a PATH that can find `pnpm`, sources tokens, runs `pnpm prices:fetch`, and — only on a clean fetch — `pnpm spine`. Preserves the non-zero exit code so the scheduler notices a failure or rejection. |
| `ops/price-feed/com.numisma.pricefeed.daily.plist` | launchd definition firing the wrapper at 18:00 local (the default mark time), **every day** (see "Why the schedule fires 7 days/week" below). |

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
  ledger-privacy posture: the durable store lives in the private sibling `accumulus`
  repo (`~/Dev/accumulus/data` by default, or wherever `NUMISMA_DATA_DIR` points),
  never inside the numisma checkout; secrets likewise are a machine-local artifact
  beside the repo, not in it.

### Twelve Data free tier: why the run pauses ~1 minute

The Twelve Data **Basic (free)** plan allows **8 API credits/minute** (800/day), and
a batched `time_series` request costs **1 credit per symbol**. The registry has **9**
Twelve Data symbols (3 US equities + 6 `*-mxn` USD legs), so fetching all 9 at once
is 9 credits > 8 ⇒ **HTTP 429**. The fetch therefore paces equities in chunks of
`twelveDataMaxSymbolsPerMinute` (default **8**), sleeping `twelveDataPauseMs`
(default **60 s**) between chunks — you'll see `pausing 60s for the Twelve Data
per-minute credit quota to reset…` in the output. **A daily run consequently takes
~1 minute, not seconds; that pause is expected, not a hang.** (Both knobs live in
`packages/price-feed/src/config.ts`; a paid tier with a higher per-minute cap can
raise `twelveDataMaxSymbolsPerMinute` ≥ 9 to fetch every symbol in one window and
skip the pause.)

### Why plaintext-at-rest is the right posture here (and when to upgrade)

These are **free, read-only, revocable market-data keys** — not exchange/trading
keys. They carry no write access, move no money, and expose no PII. The blast
radius of a leak is "someone reads public prices on your quota until you
regenerate the key." Against that thin threat, a `chmod 600` file outside the repo
is proportionate, and it keeps the hands-off 18:00 launchd run dead-simple: no
interactive keychain/vault unlock that could block a scheduled, non-login job.

**Your real defense is fast revocation, not encryption-at-rest.** If a key ever
leaks (committed by mistake, copied into a shared backup, pasted somewhere):

- **Twelve Data:** sign in → API dashboard → regenerate/roll the API key, then
  update `TWELVEDATA_API_KEY` in the env file.
- **Banxico SIE:** the token is tied to your SIE account — request a new token
  (email signup flow) and replace `BANXICO_TOKEN`. The old token stops working
  once reissued.
- **Binance:** nothing to revoke — the daily fetch uses keyless public REST.

After rotating, re-run the manual dry run to confirm the new credential works.

**Upgrade the posture (to macOS Keychain or 1Password/Bitwarden CLI) only when a
real trigger appears** — do not pre-build it:

- a **write-capable or trading** key enters the picture (real money at risk), or
- a **second machine or operator** needs the same secret, or
- a **hosted surface** ships (then use the platform's secret store / Vercel env,
  not a machine-local file at all).

Until then, the friction of a non-interactive vault unlock buys encryption the
threat model does not need.

## Install the daily schedule (macOS launchd)

1. Set the Mac's timezone to America/Mexico_City (or adjust the plist `Hour`/`Minute`
   to the local clock equal to 18:00 CDMX).
2. Edit both placeholders in `run-daily-fetch.sh` (`REPO_DIR`) and the plist
   (`__REPO_DIR__`, `__HOME__`).
3. Set the durable-data home in the plist. The wrapper forwards `NUMISMA_DATA_DIR`
   to every `pnpm` invocation; it is the **single machine-specific override** that
   points the ledger at the sibling private `accumulus` repo. launchd **cannot expand
   `~`**, so the plist's `NUMISMA_DATA_DIR` must be an **absolute** path (e.g.
   `/Users/you/Dev/accumulus/data`) — unlike the code default, which derives
   `~/Dev/accumulus/data` from `os.homedir()`. Leave it unset only if this machine
   should use that default.
4. Install and load:

   ```sh
   cp ops/price-feed/com.numisma.pricefeed.daily.plist \
      ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   launchctl load ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   ```

### PATH: the scheduler must be able to find `pnpm` **and** `node`

launchd and cron start the job with a **bare, non-login PATH**
(`/usr/bin:/bin:/usr/sbin:/sbin`), which does **not** include the directory holding
`pnpm` (typically `~/Library/pnpm` or a Homebrew prefix like `/opt/homebrew/bin`).
Without a fix the 18:00 run dies immediately with `pnpm: command not found` (exit
127), even though a manual dry run in your interactive shell passes (it inherits
your login PATH).

There is a **second, subtler hazard on a fresh install**: if `node` is managed by
**asdf**, the real `node` lives behind `~/.asdf/shims`. Even once `pnpm` resolves,
pnpm's own `node` lookup then fails with the **same exit-127 node-not-found** unless
`~/.asdf/shims` is on PATH — and **first**, so its shim wins. This is why the wrapper's
default `NUMISMA_PATH_PREPEND` puts `~/.asdf/shims` ahead of the pnpm/Homebrew
locations:

```sh
$HOME/.asdf/shims:$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin
```

The wrapper is **self-sufficient** with that default. If `pnpm` or `node` live
somewhere else on your machine, find them and point the override at those
directories (drop the asdf entry if you do not use asdf):

```sh
dirname "$(command -v node)"          # e.g. /Users/you/.asdf/shims  (asdf-managed)
dirname "$(command -v pnpm)"          # e.g. /Users/you/Library/pnpm
# then either export the combined list for the wrapper (shims FIRST)…
export NUMISMA_PATH_PREPEND="$HOME/.asdf/shims:$HOME/Library/pnpm:/opt/homebrew/bin:/usr/local/bin"
# …or add a PATH entry to the plist's EnvironmentVariables dict (optional, belt-and-suspenders).
```

If `pnpm` or `node` is still unresolvable the wrapper fails LOUD with a named error
(not a bare 127), telling you exactly which override to set.

### cron alternative

If you prefer cron over launchd (again assuming the box is on CDMX time):

```cron
# m h  dom mon dow  command
  0 18  *   *   *   /bin/bash /ABSOLUTE/PATH/numisma/ops/price-feed/run-daily-fetch.sh
```

## Why the schedule fires 7 days/week (crypto vs. equities)

The `dow` field is `*` — **every day** — on purpose, and it is safe:

- **Crypto (Binance) trades 24/7**, so it *should* produce a fresh mark every day,
  weekends and holidays included.
- **Equities (Twelve Data, incl. the `*-mxn` USD legs) do not trade** weekends or
  market holidays. On a market-closed day the provider returns the **last trading
  day's** bar. Emitting that under today's `asOf` would append a **misdated, stale**
  mark (a fresh deterministic id the dedup can't catch, 0% move so the magnitude
  guard passes) — it would silently pile up every weekend.

The fetch prevents that with **per-provider bar-date validation**: an equity mark is
emitted only when the provider bar's date equals the run's trading-day `asOf`. When
it doesn't (weekend/holiday), that instrument is **skipped as INFO** — you'll see
`equity mark skipped — no fresh close for <asOf>` in the fetch output — **not** a
failure. The run stays clean (exit 0), the crypto marks still ingest, and the
`*-mxn` derived marks naturally skip too (their USD leg is stale). A weekday-only
schedule was rejected: it would starve crypto AND still misfire on weekday holidays.

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
4. **On a weekend/holiday**, the equity lines read
   `equity mark skipped — no fresh close for <asOf>` (one per equity, incl. the
   `*-mxn` legs), the crypto marks still emit, and the wrapper exit stays `0` — a
   market-closed skip is expected INFO, not a failure. If you install on a weekday,
   the equity marks emit normally; re-check this on the first weekend run.

### Dry-run record

> Recorded from the installed launchd job's production runs (America/Mexico_City,
> 18:00) plus one manual fetch-only dry run. The schedule has run hands-off daily
> since 2026-07-03.

| Date | Machine / TZ | Fetch result | Spine result | Re-run idempotent? | Wrapper exit |
| --- | --- | --- | --- | --- | --- |
| 2026-07-06 (Mon) | operator Mac / America/Mexico_City | 13/13 stored — crypto + equities + all 6 `*-mxn` (Banxico FIX × USD) | all 13 `PriceMarked` appended to `events.jsonl` | not separately re-run | 0 (log: "daily run complete") |
| 2026-07-04–05 (Sat/Sun) | same | crypto-only; 9 equities skipped as INFO (`no fresh close` — market closed) | 4 crypto marks appended | — | 0 |
| 2026-07-03 (Fri) | same | first hands-off run — clean | marks appended | — | 0 |
| 2026-07-07 (Tue), manual 15:02 | same | 13/13 quotes stored, **pre-18:00** (store upserted, no mark emitted) | n/a — fetch-only dry run, `spine` deliberately not run | — | 0 |

Notes: weekend equity-skip (checklist item 4) is confirmed by the 07-04/05
crypto-only runs. Same-day re-run idempotency (item 2) has not been separately
exercised; the deterministic mark id (#106) is the dedup that guarantees it.
Banxico end-to-end is confirmed by the MXN-derived marks in the 07-06 run, not by
the pre-mark-time manual fetch (which stores the raw USD leg only).

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
     mark from `<dataDir>/inbox/transactions.json` (the `accumulus` data root,
     `~/Dev/accumulus/data` by default or `$NUMISMA_DATA_DIR`) and let the next run
     re-fetch.
  2. If the move is **real** (a genuine >50% day, or a long gap since the last
     mark), keep the mark and re-run the spine with the magnitude guard raised for
     that ONE run — the guard is a sanity check on automation, not a veto on
     reality. Pick a band that clears the real deviation but still catches a unit
     slip, and pass it as a relative threshold (`0.5` is the default ±50%):

         pnpm spine --magnitude-threshold=1.5

     or equivalently `SPINE_MAGNITUDE_THRESHOLD=1.5 pnpm spine` for a ±150% band.
     The override is OFF by default and applies to that single run only — it never
     changes the standing ±50% guard, and it relaxes ONLY the magnitude check, not
     the structural / existence / Reserve-sufficiency validation. The run announces
     the relaxed band loudly on stderr (`WARNING: magnitude guard RELAXED to ±150%
     for this ingest …`) so it is never silent, and a malformed value fails loud
     before anything is ingested. Choose the smallest band that admits the real
     move.
  3. Do not leave a doomed mark in the inbox unless you are about to run the
     override: `pnpm spine` ingest is all-or-nothing, so one guard-tripping mark
     blocks the whole batch (including hand-authored events) until it is removed,
     replaced, or admitted via `--magnitude-threshold`.

### `equity mark skipped — no fresh close for <asOf>` — NOT a failure

- Info, not an error. It means the market was closed (weekend/holiday) so the Twelve
  Data provider had no fresh close dated `asOf`; that equity (and, if it is a `*-mxn`
  leg, its derived MXN mark) is skipped for the day rather than re-marked stale.
- **Action: none.** The run still exits `0`, crypto still marks, and the equity marks
  resume on the next trading day. Only investigate if you see it on a **trading day**
  (would suggest provider bar-date drift or a stuck symbol).

### Where to look

- Per-run logs: `~/Library/Logs/numisma/price-feed-*.log` (wrapper) and
  `launchd.price-feed.*.log` (launchd's own capture).
- The queued marks awaiting ingest: `<dataDir>/inbox/transactions.json`.
- The disposable quotes (always upserted, even pre-mark-time): `<dataDir>/prices/`.

`<dataDir>` is the durable-data root resolved by `NUMISMA_DATA_DIR` — the sibling
private `accumulus` repo, `~/Dev/accumulus/data` by default. The `inbox/` and
`prices/` subtrees are the disposable cache: `accumulus`'s allowlist `.gitignore`
keeps them (and `ingested/`, `*.tmp`, `*.quarantine`) out of the versioned history.
