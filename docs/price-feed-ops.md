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
| `ops/price-feed/run-daily-fetch.sh` | Wrapper the scheduler calls. Sets a PATH that can find `pnpm`, sources tokens, runs `pnpm prices:fetch`; on a clean fetch: (2) `pnpm spine` then (3) an auto-commit of any new data-repo changes scoped to `$NUMISMA_DATA_DIR` — idempotent if no new marks, never pushes — then (4) a post-check that **fails the job** if the durable event log is still uncommitted (lenient warn for the `head-digest.json` breadcrumb). Only once the log is verified does it touch anything derived, local before networked: (5) `pnpm gap-report -- --write` to rewrite `gap-report.json` beside the log and (6) `pnpm backfill` to refresh the hosted projection. Preserves the non-zero exit code so the scheduler notices a failure or rejection. |
| `ops/price-feed/com.numisma.pricefeed.daily.plist` | launchd definition firing the wrapper **hourly from 18:00 to 23:00 local** (six intervals; 18:00 is the default mark time), **every day** — plus `RunAtLoad` true. The first fire on an awake machine marks the day; later fires add 0 new marks (though they still spend credits and time). See "Why the window is hourly, not a single 18:00 fire" and "Why the schedule fires 7 days/week" below. |

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
  # then edit; the two keys the fetch reads (see apps/price-feed/src/config.ts):
  #   TWELVEDATA_API_KEY=...   # Twelve Data free key, US equities
  #   BANXICO_TOKEN=...        # Banxico SIE free token, USD/MXN FIX series SF43718
  ```

- **The projection write credential lives here too, and it is not like the other
  two.** Step 5's `pnpm backfill` throws immediately without
  `PROJECTION_WRITE_DATABASE_URL`, so the scheduled run needs it in this same file:

  ```sh
  #   PROJECTION_WRITE_DATABASE_URL=postgres://numisma_push:…  # ADR-007 writer cred
  ```

  It is the **same value** as `apps/web/.env.push.local` (the hand-run push's
  source, `docs/hosted-cutover-runbook.md` step 8), duplicated rather than sourced
  as a second file so the wrapper keeps exactly one `source` line. **Say the
  consequence plainly: this file now holds a database WRITE credential alongside
  two read-only market-data keys, so "the blast radius is someone reading public
  prices on your quota" below no longer covers all of it.** The `numisma_push`
  role holds SELECT/INSERT/UPDATE and **no DELETE** (`docs/projection-provisioning.md`),
  so the worst case is a corrupted derived read surface that a `pnpm backfill` from
  the durable log rebuilds — the event log itself is out of its reach. Rotate it
  through the projection provisioning path, not the provider dashboards.

  The wrapper `source`s it if present. If a key is absent, only that provider's
  instruments fail (loud, per-symbol) — crypto still runs keyless. The file is never
  committed and never printed (only its path is logged). This mirrors the
  ledger-privacy posture: the durable store lives in the private sibling `accumulus`
  repo (`~/Dev/accumulus/data` by default, or wherever `NUMISMA_DATA_DIR` points),
  never inside the numisma checkout; secrets likewise are a machine-local artifact
  beside the repo, not in it.

  **Credentials only — do not put `NUMISMA_DATA_DIR` in this file.** The wrapper
  resolves `DATA_DIR` in its configuration block at the top, *before* it sources
  this file, because the heartbeat trap must know where to write before the
  exit-127 checks run. A `NUMISMA_DATA_DIR` set here would therefore reach every
  node command but not the wrapper's own git steps: the commit and post-check would
  guard `~/Dev/accumulus/data` while `spine` wrote somewhere else, and the job would
  stay green over an unverified log. Set it in the launchd plist's
  `EnvironmentVariables` (or the shell environment) instead, where both halves see
  it.

### Twelve Data free tier: why the run pauses ~1 minute

The Twelve Data **Basic (free)** plan allows **8 API credits/minute** (800/day), and
a batched `time_series` request costs **1 credit per symbol**. The registry has **9**
Twelve Data symbols (3 US equities + 6 `*-mxn` USD legs), so fetching all 9 at once
is 9 credits > 8 ⇒ **HTTP 429**. The fetch therefore paces equities in chunks of
`twelveDataMaxSymbolsPerMinute` (default **8**), sleeping `twelveDataPauseMs`
(default **60 s**) between chunks — you'll see `pausing 60s for the Twelve Data
per-minute credit quota to reset…` in the output. **A daily run consequently takes
~1 minute, not seconds; that pause is expected, not a hang.** (Both knobs live in
`apps/price-feed/src/config.ts`; a paid tier with a higher per-minute cap can
raise `twelveDataMaxSymbolsPerMinute` ≥ 9 to fetch every symbol in one window and
skip the pause.)

### Why plaintext-at-rest is the right posture here (and when to upgrade)

Two of the three are **free, read-only, revocable market-data keys** — not
exchange/trading keys. They carry no write access, move no money, and expose no
PII. The blast radius of a leak is "someone reads public prices on your quota
until you regenerate the key."

The third, `PROJECTION_WRITE_DATABASE_URL`, **does** carry write access, and the
posture holds anyway rather than by omission: the `numisma_push` role can
SELECT/INSERT/UPDATE the projection and **cannot DELETE**, the projection is a
**derived** read surface, and the durable event log it derives from lives in a
different place under a different credential the role does not have. So a leak
buys an attacker the ability to corrupt a dashboard that `pnpm backfill` rebuilds
from the log — not to touch the source of truth, and not to move money. That is a
real step up from "reads public prices," and still short of the trigger below.

Against that threat, a `chmod 600` file outside the repo is proportionate, and it
keeps the hands-off evening launchd run dead-simple: no interactive keychain/vault
unlock that could block a scheduled, non-login job.

**Your real defense is fast revocation, not encryption-at-rest.** If a key ever
leaks (committed by mistake, copied into a shared backup, pasted somewhere):

- **Twelve Data:** sign in → API dashboard → regenerate/roll the API key, then
  update `TWELVEDATA_API_KEY` in the env file.
- **Banxico SIE:** the token is tied to your SIE account — request a new token
  (email signup flow) and replace `BANXICO_TOKEN`. The old token stops working
  once reissued.
- **Binance:** nothing to revoke — the daily fetch uses keyless public REST.
- **Projection writer:** not a dashboard rotation — change the `numisma_push`
  role's password at the database and update **both** copies
  (`~/.config/numisma/price-feed.env` and `apps/web/.env.push.local`). Two copies
  is the price of the single `source` line; a rotation that updates only one
  leaves either the hand-run push or the scheduled evening job failing.

After rotating, re-run the manual dry run to confirm the new credential works.

**Upgrade the posture (to macOS Keychain or 1Password/Bitwarden CLI) only when a
real trigger appears** — do not pre-build it:

- a key that **moves money or writes the durable log** enters the picture (the
  projection writer is write-capable but does neither — see above), or
- a **second machine or operator** needs the same secret, or
- a **hosted surface** ships (then use the platform's secret store / Vercel env,
  not a machine-local file at all).

Until then, the friction of a non-interactive vault unlock buys encryption the
threat model does not need.

## Install the daily schedule (macOS launchd)

1. Set the Mac's timezone to America/Mexico_City (or shift **all six** of the plist's
   `Hour` entries to the local clock equal to 18:00–23:00 CDMX — they must stay
   at/after the mark time and inside the same CDMX day).
2. Edit both placeholders in `run-daily-fetch.sh` (`REPO_DIR`) and the plist
   (`__REPO_DIR__`, `__HOME__`).
3. Set the durable-data home in the plist. The wrapper forwards `NUMISMA_DATA_DIR`
   to every `pnpm` invocation; it is the **single machine-specific override** that
   points the ledger at the sibling private `accumulus` repo. launchd **cannot expand
   `~`**, so the plist's `NUMISMA_DATA_DIR` must be an **absolute** path (e.g.
   `/Users/you/Dev/accumulus/data`) — unlike the code default, which derives
   `~/Dev/accumulus/data` from `os.homedir()`. If left unset the wrapper's step-3
   auto-commit and step-4 post-check both fall back to that **same** `~/Dev/accumulus/data`
   default — the exact tree the in-process capture writes to — so an unset var is still
   committed and still post-checked (no silent "log left uncommitted" gap). Setting it
   explicitly is only required when your `accumulus` checkout lives somewhere else.
   (On a fresh box with no `accumulus` checkout at all, the default path is not a git
   repo, so step 3 degrades gracefully — a logged warning and skip, never a FATAL.)
4. Install and load:

   ```sh
   cp ops/price-feed/com.numisma.pricefeed.daily.plist \
      ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   launchctl load ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   ```

   **The installed copy is a RESOLVED COPY, so a change to the template in this repo
   does nothing until you reinstall by hand.** `cp` expands nothing — you edit
   `__REPO_DIR__` / `__HOME__` in the installed file, so the two files diverge by
   design and no automation reconciles them. After pulling a change to the plist
   (e.g. the hourly window), redo the copy, re-edit the placeholders, then:

   ```sh
   launchctl unload ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   launchctl load   ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   # verify the six intervals are what launchd now holds, not what the repo holds:
   launchctl print gui/$(id -u)/com.numisma.pricefeed.daily | grep -A20 'start interval\|periodic'
   ```

   **`RunAtLoad` is true, so that `load` runs the job immediately** — intended (it is
   the belt-and-braces half of the recovery), safe at any hour, but it means the
   reinstall is itself a live run. Watch `~/Library/Logs/numisma/price-feed-*.log`
   rather than assuming it waited for the next hour.

### PATH: the scheduler must be able to find `pnpm` **and** `node`

launchd and cron start the job with a **bare, non-login PATH**
(`/usr/bin:/bin:/usr/sbin:/sbin`), which does **not** include the directory holding
`pnpm` (typically `~/Library/pnpm` or a Homebrew prefix like `/opt/homebrew/bin`).
Without a fix every scheduled run dies immediately with `pnpm: command not found` (exit
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
# m h     dom mon dow  command
  0 18-23  *   *   *   /bin/bash /ABSOLUTE/PATH/numisma/ops/price-feed/run-daily-fetch.sh
```

The `18-23` hour range is the same window as the plist, and for the same reason
(below). cron has no `RunAtLoad` equivalent, so a cron install gets the working
half of the recovery but not the belt-and-braces half.

## Why the window is hourly, not a single 18:00 fire

**A missed fire is not recovered by idempotency.** These are two different
properties, and conflating them is what let 2026-06-27 and its siblings disappear
without a signal (issue #185):

- The deterministic mark id `pm-<id>-<asOf>` makes a **repeated** run harmless — it
  appends 0 new marks.
- It does nothing at all for a run that **never happened**, and `asOf` is the CDMX
  **calendar date** — so once midnight passes `isFreshBar` refuses yesterday's bar
  permanently. The day is then unrecoverable by any rerun.

**What launchd actually does with a slept-through interval**, since the intuitive
answer is wrong and #185 was filed on the wrong one. From `man 5 launchd.plist`:

> Unlike cron which skips job invocations when the computer is asleep, launchd will
> start the job the next time the computer wakes up. If multiple intervals transpire
> before the computer is woken, those events will be coalesced into one event upon
> wake from sleep.

So launchd does **not** drop the interval — it runs one catch-up at wake. That
changes the mechanism but not the conclusion: the catch-up executes under a **new**
`asOf`, so it marks *today* and cannot reach the day that was missed. Two things
follow that are easy to get backwards:

- **Six intervals coalesce into ONE event on wake, not six.** They are six chances
  at a machine that is *awake* during the evening, not six retries against a
  sleeping one.
- **The distinction that matters is asleep vs. powered-off/logged-out.** Asleep →
  a coalesced catch-up fires, uselessly. Powered off or logged out → the LaunchAgent
  was never loaded, so there is nothing to coalesce across the boot.

So recovery has to come from the schedule, and it does, in two halves:

- **The hourly 18:00–23:00 window is the half that does the work.** A laptop shut
  at 18:00 but open at any hour through 23:00 still marks the day, inside the same
  CDMX date. Every fire is at/after the 18:00 mark time on purpose: an earlier one
  would store quotes and emit **zero** marks.
- **`RunAtLoad` true is the belt-and-braces half**, and the boot/login case above is
  precisely what it covers — the one case where no coalesced catch-up exists.

Neither recovers a day the machine was off for the whole window. Nothing can — that
loss is permanent, and naming it after the fact is the gap report's job (#186).

**`RunAtLoad` has a cost on the reading side, and it is paid explicitly.** A load can
happen at any hour, and a pre-18:00 run stores quotes, emits **zero** marks and exits
`0`. That is indistinguishable from a healthy evening unless someone records the
difference — and read naively it *silenced* the heartbeat's staleness warning on
exactly the morning after a lost day. So the heartbeat now carries `markWindow`
(schema version 2) plus the last in-window finish, and staleness is judged against
the latter. See `packages/event-store/src/heartbeat.ts`.

Two refinements of that rule are worth knowing, because both are the difference
between a warning that fires and one that does not:

- **Being in the window is not evidence of marking.** A run only stamps itself as
  the last in-window run if it got past `pnpm spine`, the step that appends. A
  provider outage kills every fire at `prices-fetch` — six in-window runs, zero
  marks — and stamping those would record the outage as proof the day was covered.
  The predicate is deliberately *not* "exit 0": a failure at `gap-report` or
  `backfill` (steps 5–6) comes **after** the day was marked and committed, so
  gating on the exit code would under-stamp and cry wolf about a day the log holds.
- **The window is judged in CDMX, not in the machine's local time.** The wrapper
  reads `TZ="$MARK_TZ" date +%H`, matching the mark-instant contract. This is what
  makes the "shift the plist hours instead of the OS timezone" option above safe:
  on a UTC box with plist hours 00–05, a bare local-hour test would classify every
  scheduled fire as out-of-window and silently disable the staleness trigger.

**Why six fires fit the free tier.** Twelve Data Basic allows 8 credits/minute and
**800/day**; the registry holds **9** Twelve Data symbols at 1 credit each. Six
fires × 9 = **54 credits/day against 800** (6.75%), so the daily cap was never the
constraint it looked like — the *per-minute* cap is, and that is already handled in
code by `twelveDataMaxSymbolsPerMinute: 8` plus a 60 s pause, which costs each fire
about one extra minute and nothing else. This is why the 18/20/22 three-fire
fallback was not needed. Adding intervals here, or equities to the registry, spends
against that 800; `apps/price-feed/src/schedule-window.test.ts` fails if the product
ever exceeds it.

**Read 54 as a floor, not a total.** It is the *scheduled* spend. `RunAtLoad` adds an
unbudgeted 9 credits per boot, login and `launchctl load`, and none of that is
knowable in advance — so the guard bounds the schedule, which is the part that can be
bounded. The headroom is large (roughly 82 extra loads in one day before 800), so
this is a thing to state rather than a thing to fix. One practical note: the install
sequence below is itself a live run followed by a `start` dry run, i.e. two runs
inside a minute against the 8/min cap — the second's Twelve Data calls may pace or
fail, which is expected and self-heals on the next hour.

**Repeat fires are cheap, but not free**, which is worth stating precisely because a
`RunAtLoad` run can land at any hour: a second run of an evening appends 0 new marks,
commits nothing at step 3, passes step 4, and re-upserts at step 6 under
`ON CONFLICT … DO UPDATE`. What it still spends is 9 Twelve Data credits and about
two minutes of wall time (the 60 s pacing sleep runs regardless). "No new marks" and
"no cost" are different claims.

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

## Manual dry run (the schedule's main verification)

The wrapper and the launchd/cron definition are verified mainly by a MANUAL dry run.
Run it after install and record the result below.

Two narrow automated guards exist alongside it, and they are worth knowing the limits
of. `apps/price-feed/src/schedule-window.test.ts` checks only the properties of the
plist that have an oracle elsewhere — that it lints, that no fire precedes the mark
time or leaves the CDMX day, that every interval pins both `Hour` and `Minute` (a
missing field is a launchd wildcard), that the credit budget fits, and that the
wrapper's `MARK_HOUR` still matches `DEFAULT_CONFIG.markTime`. The last describe in
`packages/event-store/src/heartbeat.test.ts` runs the wrapper and feeds its heartbeat
to the real parser. **Neither tells you the installed job works** — they read the
repo's templates, and the installed LaunchAgent is a separately-resolved copy. That
is still what the dry run is for.

```sh
# Exercise the wrapper exactly as the scheduler will (does not wait for the window):
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
   This is no longer an edge case to check once: with the hourly window it is what
   the 19:00–23:00 fires do on every normal evening.
3. The wrapper exit code is `0` on a clean run, non-zero if any symbol failed or a
   mark was rejected.
4. **On a weekend/holiday**, the equity lines read
   `equity mark skipped — no fresh close for <asOf>` (one per equity, incl. the
   `*-mxn` legs), the crypto marks still emit, and the wrapper exit stays `0` — a
   market-closed skip is expected INFO, not a failure. If you install on a weekday,
   the equity marks emit normally; re-check this on the first weekend run.
5. **Auto-commit (step 3):** after a run that appended new marks, the log reads
   `committed durable-log changes (not pushed)` and `git -C "$NUMISMA_DATA_DIR" log
   -1` (or the `~/Dev/accumulus/data` default when the var is unset) shows a commit
   from this run. A same-day re-run reads `no tracked data changes to commit
   (idempotent no-op run)`. A first-time **untracked** source-of-truth file (e.g. an
   initial `genesis.json`) is staged and committed too — the backstop is not limited
   to tracked modifications. If instead it reads `WARNING: … is not inside a git repo
   — skipping`, the resolved data dir has no `accumulus` checkout: create/clone it, or
   point `NUMISMA_DATA_DIR` at the right path (see install step 3 above), and re-run.
6. **Post-check (step 4):** a clean run ends with `post-check OK: durable log
   committed clean`. If the source-of-truth log is somehow left uncommitted after
   both the in-process capture and the step-3 backstop, the run logs `FATAL: durable
   LOG uncaptured …` and **exits non-zero so launchd surfaces a red job** — the miss
   is never silent (issue #132). The post-check targets the same resolved data dir as
   step 3 (`NUMISMA_DATA_DIR`, else the `~/Dev/accumulus/data` default the in-process
   capture writes to), so an unset var no longer disables it. A lagging
   `head-digest.json` warns but does not fail the run (it is a forensic breadcrumb,
   not the source of truth); the warning uses `git status --ignored` so it fires even
   when the breadcrumb is only-ignored-and-present, the actual #132 shape.
7. **Gap report (step 5):** the report's own lines appear and `gap-report.json` in
   the data dir carries a `generatedAt` from **this** run. Before this step existed
   the file was written only by hand, so it was a day stale every morning — and
   stale precisely on the morning after a miss, the one morning anybody reads it.
8. **Backfill (step 6):** the log reads `[backfill] N anchor(s) upserted: <first>
   … <last>`, one line per anchored date. `[backfill] failed:
   PROJECTION_WRITE_DATABASE_URL is not set` means the key is missing from the env
   file — the run goes red here, deliberately, rather than leaving the dashboard to
   rot quietly. Note the exit is non-zero but the durable log is already committed
   and verified: this failure costs a stale projection, never fund data.

**Why the local step runs before the networked one.** Under `set -e` a failing step
aborts everything after it, so the order decides what a partial run still delivers.
`gap-report` needs no credential and no network — it is a pure read of the log the
post-check just verified — so putting it first means it succeeds on every run that
got past step 4, **including the runs where the database is unreachable**. The
other order would let a 30-second projection outage leave the standup reading
yesterday's `generatedAt`, which is the exact staleness these steps end.

**The failure mode these two steps create, and who catches it.** Fetch succeeds,
`backfill` fails: the durable log is clean and committed, the gap report is fresh,
and the projection is stale. The gap report cannot say so — it is **structurally
silent** here, deriving purely over the log, and the log is fine. Nothing in the
data says anything is wrong. Only `job-heartbeat.json` sees it, carrying `exitCode`
non-zero and `lastStep: "backfill"`, which the TUI surfaces on its next startup
(#191). That dependency is why these steps could not be added before the heartbeat
shipped.

**The gap report's window is bounded and self-flooring, so this step cannot age
into a failure.** `pnpm gap-report` refuses a window over 400 calendar days (it
would print one line per day), and its floor defaults to the launchd era start —
a *fixed* day against a ceiling that moves. Left alone those two would have
collided on **2027-08-08**, turning the last step of every night's run red forever,
after everything else had succeeded. The command now floors a zero-argument run at
the later of the era start and 400 days back (`boundedEraFloor`), so the scheduled
invocation stays zero-argument — no date for a cron job to get wrong — and can
never grow into its own cap. The trade, stated: from 2027-08-08 the default report
is a trailing 400-day window rather than the whole era. A lost day is permanent and
unfixable, so aging one out is right; `--since` still reaches it.

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
- **Action:** usually none *if there is still an hour left in the CDMX day* — one
  of the remaining fires in the 18:00–23:00 window re-fetches the symbol, and the
  idempotent id means the retry costs nothing (the marks that already landed are
  not duplicated). A manual `pnpm prices:fetch` does the same thing sooner.
  **After midnight it is not "caught up" by anything**: `asOf` is the calendar
  date, so the missed day stays missed and only the gap report will name it.
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
