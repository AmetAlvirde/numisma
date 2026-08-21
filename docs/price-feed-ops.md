# Price-feed operations (scheduling, tokens, triage)

The daily price run (ADR-005 two-plane price model, PRD #105, slice #108) makes
prices arrive with zero typing: a scheduled job fetches quotes into the disposable
price store and queues one `PriceMarked` per instrument per trading day in the
inbox, then `pnpm spine` validates and appends them through the unchanged ±50%
magnitude guard. Manual `pnpm prices:fetch` and hand-authored marks keep working
alongside the schedule — the schedule is an addition, never a replacement (C5).

Everything here is machine-local. Nothing secret or trade-derived enters the repo
(transaction-data-is-private): tokens and logs live outside the checkout.

Throughout this page, `<fund>` stands for your own private data repository — the same
convention as `<dataDir>` — so substitute your actual repo name/path before running
any command below.

## Components

| File | Role |
| --- | --- |
| `ops/price-feed/run-daily-fetch.sh` | Wrapper the scheduler calls. Sets a PATH that can find `pnpm`, sources tokens, runs `pnpm prices:fetch`; on a clean fetch: (2) `pnpm spine` then (3) an auto-commit of any new data-repo changes scoped to `$NUMISMA_DATA_DIR` — idempotent if no new marks, never pushes — then (4) a post-check that **fails the job** if the durable event log is still uncommitted (lenient warn for the `head-digest.json` breadcrumb). Only once the log is verified does it touch anything derived, local before networked: (5) `pnpm gap-report -- --write` to rewrite `gap-report.json` beside the log, (5b) `pnpm operator-notice` to rewrite `operator-notice.txt` beside it, and (6) `pnpm backfill` to refresh the hosted projection. A step-0 heartbeat read and an `EXIT` trap bracket the whole thing. Preserves the non-zero exit code so the scheduler notices a failure or rejection. |
| `ops/price-feed/com.numisma.pricefeed.daily.plist` | launchd definition firing the wrapper **hourly from 18:00 to 23:00 local** (six intervals; 18:00 is the default mark time), **every day** — plus `RunAtLoad` true. The first fire on an awake machine marks the day; later fires add 0 new marks (though they still spend credits and time). See "Why the window is hourly, not a single 18:00 fire" and "Why the schedule fires 7 days/week" below. |
| `ops/price-feed/launchagent-reinstall.md` | Runbook for pushing a plist change into the job launchd actually runs. Not executed by anything — it exists because the wrapper installs via `git pull` (launchd runs it in place) while the plist is a resolved copy, so merging a plist change does nothing on its own. |

Both `.plist` / `.sh` files are templates: replace `__REPO_DIR__`, `__HOME__` and
`__DATA_DIR__` before installing. `__DATA_DIR__` used to be a committed absolute
path rather than a placeholder (#399), on the argument that launchd cannot expand
`~`. That is true of the *installed* file and says nothing about the template, so
it renders like the other two now. The rendered value must still be absolute: the
wrapper refuses a relative one at startup with exit 78.

The wrapper reads nine `NUMISMA_*` variables in all. Three are lower-traffic
overrides, each with a sensible default so most installs never need them:
`NUMISMA_REPO_DIR` (repo checkout path, else `__REPO_DIR__`/the plist's
`EnvironmentVariables`), `NUMISMA_PRICEFEED_ENV` (the token env file, else
`~/.config/numisma/price-feed.env`), and `NUMISMA_PRICEFEED_LOG_DIR` (per-run
log directory, else `~/Library/Logs/numisma`). Two more bound the run's wall
clock: `NUMISMA_PRICEFEED_MAX_RUN_SECONDS` (default **2700**, comfortably under
the 3600 s gap between fires; `0` disables the watchdog, for manual debugging
only) and `NUMISMA_PRICEFEED_WATCHDOG_GRACE_SECONDS` (default **30**, how long
the watchdog waits after `SIGTERM` before `SIGKILL`). A run the watchdog ends
exits **124**, and its heartbeat records the step it died at with a
`timeout:` prefix, as in `lastStep: "timeout:backfill"`, so a wedged network call
is distinguishable from a step that failed on its own terms.

Two more let a caller put a run on either side of the mark window without
waiting on the machine clock: `NUMISMA_MARK_TZ` and `NUMISMA_MARK_HOUR`, each
defaulting to the contract the engine authors once — `TRADING_DAY_TIME_ZONE`
/ `MARK_HOUR` in `packages/engine/src/price-feed/mark.ts` (America/Mexico_City,
18). Unlike the overrides above, a bad value here is **fatal, not silently
substituted**: the wrapper rejects an unresolvable `NUMISMA_MARK_TZ` (checked
against `${TZDIR:-/usr/share/zoneinfo}`) or a non-numeric `NUMISMA_MARK_HOUR`
before computing the mark window, with a named error, rather than letting
bash's own silent UTC fallback flip every run's in/out-of-window judgment
while the runs themselves kept marking fine. **The refusal is loud on both
channels**: it writes the `FATAL` line to the per-run log and leaves a
heartbeat reading `exit 1` at step `startup` with `markWindow: false`, so a
typo that kills every fire of an evening shows up as a failed run rather than
as `job-heartbeat.json` still describing the last good one.

**A set-but-blank `NUMISMA_DATA_DIR` kills the run before anything else, and it
is the one failure with no heartbeat.** The wrapper reads
`${NUMISMA_DATA_DIR-…}` without the colon, so *unset* takes the default while
`""` or `"   "` is a knob the operator got wrong: the run prints a named `FATAL`
and exits **78** (`EX_CONFIG`, chosen not to collide with 1, 124, 127 or 143).
No heartbeat is written, deliberately: the heartbeat lives *inside*
`NUMISMA_DATA_DIR`, which is the broken thing, and guessing a fallback location
is the defect the refusal exists to prevent. The message lands on inherited
stderr, which under launchd is
`~/Library/Logs/numisma/launchd.price-feed.err.log`, **not** the per-run
`price-feed-<stamp>.log` (that file is not open yet). Open the launchd error log
when a scheduled run looks like it did nothing at all. The `prices:fetch` CLI
refuses the same value for the same reason, one layer down
(`normalizeDataDirOverride`, ADR-006).

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
  two.** Step 6's `pnpm backfill` throws immediately without
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
  ledger-privacy posture: the durable store lives in the private sibling `<fund>`
  repo (`~/Dev/<fund>/data` by default, or wherever `NUMISMA_DATA_DIR` points),
  never inside the numisma checkout; secrets likewise are a machine-local artifact
  beside the repo, not in it.

  **Credentials only — do not put `NUMISMA_DATA_DIR` in this file.** The wrapper
  resolves `DATA_DIR` in its configuration block at the top, *before* it sources
  this file, because the heartbeat trap must know where to write before the
  exit-127 checks run. A `NUMISMA_DATA_DIR` set here would therefore reach every
  node command but not the wrapper's own git steps: the commit and post-check would
  guard `~/Dev/<fund>/data` while `spine` wrote somewhere else, and the job would
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
2. Edit the placeholders in `run-daily-fetch.sh` (`REPO_DIR`) and the plist
   (`__REPO_DIR__`, `__HOME__`, `__DATA_DIR__`).
3. Set the durable-data home in the plist by rendering `__DATA_DIR__`. The wrapper
   forwards `NUMISMA_DATA_DIR` to every `pnpm` invocation; it is the **single
   machine-specific override** that points the ledger at the sibling private
   `<fund>` repo. launchd **cannot expand `~`**, so the rendered value must be an
   **absolute** path (e.g. `/Users/you/Dev/<fund>/data`) — unlike the code default,
   which derives `~/Dev/<fund>/data` from `os.homedir()`. A value that is not
   absolute, an unrendered `__DATA_DIR__` included, is refused at startup with exit
   78 rather than resolved against the scheduler's working directory. If left unset
   the wrapper's step-3 auto-commit and step-4 post-check both fall back to that
   **same** `~/Dev/<fund>/data` default — the exact tree the in-process capture writes
   to — so an unset var is still committed and still post-checked (no silent "log left
   uncommitted" gap). Setting it explicitly is only required when your `<fund>`
   checkout lives somewhere else.
   (On a fresh box with no `<fund>` checkout at all, the default path is not a git
   repo, so step 3 degrades gracefully — a logged warning and skip, never a FATAL.)
4. Install and load:

   ```sh
   cp ops/price-feed/com.numisma.pricefeed.daily.plist \
      ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   launchctl load ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   ```

   **The installed copy is a RESOLVED COPY, so a change to the template in this repo
   does nothing until you reinstall by hand.** `cp` expands nothing — you render
   the placeholders in the installed file, so the two files diverge by
   design and no automation reconciles them. After pulling a change to the plist
   (e.g. the hourly window), redo the copy, re-edit the placeholders, then:

   ```sh
   launchctl unload ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   launchctl load   ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
   # verify the six intervals are what launchd now holds, not what the repo holds:
   launchctl print gui/$(id -u)/com.numisma.pricefeed.daily | grep -A14 -iE 'calendar|runatload'
   ```

   **`ops/price-feed/launchagent-reinstall.md` is the full reinstall runbook** —
   the ordered sequence, the two traps that make a reinstall fail silently (the
   installed plist carries a `NUMISMA_PATH_PREPEND` key this repo's template does
   not, and a raw `diff` buries the functional change under header prose), the
   verification checklist, and rollback. Follow it rather than the two lines above
   whenever the plist template changes.

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
  permanently. No *rerun of the daily job* can reach the missed day; only an
  explicit `pnpm prices:fetch --as-of=<date>` can, and only because it asks the
  providers for that day's bars rather than today's (see "Lost-day recovery"
  below). That is an operator's deliberate act, never something the schedule
  does for you.

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

Neither half of the schedule recovers a day the machine was off for the whole
window: nothing fires, so nothing marks. Naming that day after the fact is the
gap report's job (#186), and repairing it by hand is `--as-of`'s. The loss is
permanent only for as long as nobody runs the recovery. What no command brings
back is a day whose provider has since dropped the bar.

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

The fetch prevents that with **bar-date validation applied uniformly to every
instrument** — one rule, no per-source special case (`fetch-prices.ts`): a mark
is emitted only when the provider bar's date equals the run's trading-day
`asOf`. When it doesn't, that instrument is **skipped as INFO** — you'll see
`mark skipped — no fresh close for <asOf>: <instrumentId> <symbol> (latest bar
<observationDate>)` in the fetch output — **not** a failure. The run stays
clean (exit 0). A weekday-only schedule was rejected: it would starve crypto
AND still misfire on weekday holidays.

The uniform rule means the same skip fires for any instrument whose bar is
stale, but its **meaning differs by source**: for equities (and the `*-mxn`
derived legs), a skip on a weekend or market holiday is expected and requires
no action. For **crypto (Binance, 24/7)**, there is no closed day — a crypto
skip on any date, including a weekend, is not "market closed, ignore"; it
signals a late-firing provider or a stuck symbol and is worth investigating
the same day it appears, not deferred to the next morning's gap report.

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
   `mark skipped — no fresh close for <asOf>: …` (one per equity, incl. the
   `*-mxn` legs), the crypto marks still emit, and the wrapper exit stays `0` — a
   market-closed skip on an equity is expected INFO, not a failure. If you install
   on a weekday, the equity marks emit normally; re-check this on the first weekend
   run. The same skip line on a **crypto** symbol is never expected (see "Why the
   schedule fires 7 days/week" above) and should be treated as a live problem, not
   waited out.
5. **Auto-commit (step 3):** after a run that appended new marks, the log reads
   `committed durable-log changes (not pushed)` and `git -C "$NUMISMA_DATA_DIR" log
   -1` (or the `~/Dev/<fund>/data` default when the var is unset) shows a commit
   from this run. A same-day re-run reads `no tracked data changes to commit
   (idempotent no-op run)`. A first-time **untracked** source-of-truth file (e.g. an
   initial `genesis.json`) is staged and committed too — the backstop is not limited
   to tracked modifications. If instead it reads `WARNING: … is not inside a git repo
   — skipping`, the resolved data dir has no `<fund>` checkout: create/clone it, or
   point `NUMISMA_DATA_DIR` at the right path (see install step 3 above), and re-run.
6. **Post-check (step 4):** a clean run ends with `post-check OK: durable log
   committed clean`. If the source-of-truth log is somehow left uncommitted after
   both the in-process capture and the step-3 backstop, the run logs `FATAL: durable
   LOG uncaptured …` and **exits non-zero so launchd surfaces a red job** — the miss
   is never silent (issue #132). The post-check targets the same resolved data dir as
   step 3 (`NUMISMA_DATA_DIR`, else the `~/Dev/<fund>/data` default the in-process
   capture writes to), so an unset var no longer disables it. A lagging
   `head-digest.json` warns but does not fail the run (it is a forensic breadcrumb,
   not the source of truth); the warning uses `git status --ignored` so it fires even
   when the breadcrumb is only-ignored-and-present, the actual #132 shape.
7. **Gap report (step 5):** the report's own lines appear and `gap-report.json` in
   the data dir carries a `generatedAt` from **this** run. Before this step existed
   the file was written only by hand, so it was a day stale every morning — and
   stale precisely on the morning after a miss, the one morning anybody reads it.
8. **Operator notice (step 5b):** the log reads `[operator-notice] wrote
   <path>`, and that path is `operator-notice.txt` in the same data dir as
   `gap-report.json`. On a healthy store the file is present and **empty**.
   The step can never fail the run: the command exits 0 unconditionally, so a
   broken notice writer cannot abort the pipeline before `backfill`. A disk
   failure is the one thing it cannot write into the file, and that goes to
   this log as `[operator-notice] could NOT write the notice: …`.
9. **Backfill (step 6):** the log reads `[backfill] N anchor(s) upserted: <first>
   … <last>`, one line per anchored date. `[backfill] failed:
   PROJECTION_WRITE_DATABASE_URL is not set` means the key is missing from the env
   file — the run goes red here, deliberately, rather than leaving the dashboard to
   rot quietly. Note the exit is non-zero but the durable log is already committed
   and verified: this failure costs a stale projection, never fund data. If any
   anchor's fold read an event it could not apply (an absent target — the Discard
   Channel, ADR-020), a single extra `[backfill] fold: N event(s) were read from
   the durable log and could not be applied, …` line appears, deduped once per run
   regardless of how many anchors re-discovered it; this line never sets the exit
   code — a fold discard is a standing fact about already-committed history, not a
   failure of this run (`unattendedFoldVerdict`, `pnpm report` shows each dropped
   event's id/index/verb/reason).

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
is a trailing 400-day window rather than the whole era. A lost day more than 400
days old is one nobody is going to recover by hand, so aging it out of the
zero-argument report is right; `--since` still reaches it.

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
  **After midnight no scheduled fire catches it up**: `asOf` is the calendar
  date, so the daily job can only ever mark today. The missed day is then a job
  for `pnpm prices:fetch --as-of=<date>` (see "Lost-day recovery" below), and the
  gap report and the operator notice are what tell you it is owed.
  Investigate only if a symbol fails repeatedly (registry/symbol drift, provider
  outage). The failing symbol is named in the message.

### `SPINE WOULD REJECT  <id> <asOf>  price ... — <reason>` — a fetched mark trips the guard

- The fetch succeeded and stored the quote, but the queued mark deviates > ±50%
  from the instrument's last close, so the spine's magnitude guard would reject it.
  This is a **legitimate-move-or-unit-slip** case, surfaced at fetch time instead
  of as a silent gap.
- **Action:**
  1. Look at the price. If it is a data error (unit slip, bad payload), delete that
     mark from `<dataDir>/inbox/transactions.json` (the `<fund>` data root,
     `~/Dev/<fund>/data` by default or `$NUMISMA_DATA_DIR`) and let the next run
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

### `mark skipped — no fresh close for <asOf>: …` — usually NOT a failure, source-dependent

- The bar-date check is uniform — one rule for every instrument, no per-source
  special case — so this line can appear for an equity, its `*-mxn` derived leg,
  or crypto alike.
- **Equity (incl. `*-mxn`): Action: none** on a weekend or market holiday. The
  Twelve Data provider had no fresh close dated `asOf`; that instrument is
  skipped for the day rather than re-marked stale, the run still exits `0`, and
  the mark resumes on the next trading day. Only investigate an equity skip on a
  **trading day** (would suggest provider bar-date drift or a stuck symbol).
- **Crypto: Action: investigate the same day.** Binance trades 24/7, so there is
  no "market closed" excuse — a crypto skip on any date (weekday or weekend)
  means the provider fired late or a symbol is stuck. Do not wait for the gap
  report: it only backstops the *next* morning, and only if every instrument for
  that day was skipped, not one.

### Where to look

- Per-run logs: `~/Library/Logs/numisma/price-feed-*.log` (wrapper) and
  `launchd.price-feed.*.log` (launchd's own capture).
- The queued marks awaiting ingest: `<dataDir>/inbox/transactions.json`.
- The disposable quotes (always upserted, even pre-mark-time): `<dataDir>/prices/`.

`<dataDir>` is the durable-data root resolved by `NUMISMA_DATA_DIR` — the sibling
private `<fund>` repo, `~/Dev/<fund>/data` by default. The `inbox/` and
`prices/` subtrees are the disposable cache: `<fund>`'s allowlist `.gitignore`
keeps them (and `ingested/`, `*.tmp`, `*.quarantine`) out of the versioned history.

## Lost-day recovery: `--as-of`

If a scheduled run never happened — the laptop was closed, the wrapper never
fired — the missed day does not repair itself. `pnpm prices:fetch --as-of=<date>`
recovers exactly one past trading day: it fetches that day's bars from the
providers (not today's), stores the quotes, and queues marks dated that day. It
is a flag on the existing command, not a new pipeline.

**Vocabulary note (retiring "backfill" for this meaning).** `pnpm backfill` is
already a real, different thing — the wrapper's step 6, which refreshes the
hosted Neon projection from the durable log. Older issues and hand-off notes
that call recovering a missed price day "backfill" are using the term loosely;
that usage is retired as of this section. The recovery flag is named `--as-of`
rather than something like `--backfill` on purpose: it names the *parameter*
(which day), not an operation, and it does not collide with the wrapper step
that already owns the word.

### The procedure — four steps, all of them already familiar

1. **Recover the day:** `pnpm prices:fetch --as-of=2026-08-14`
2. **Inspect the output** — the run reports owed / marked / absent counts and
   exits non-zero if anything owed came back absent (see below). Do not proceed
   to step 3 on a non-zero exit without reading why.
3. **Fold it in:** `pnpm spine` — the same validate-and-append step the daily
   schedule runs, unchanged. Its ±50% magnitude guard applies exactly as it
   does to a same-day mark (see Triage above for what to do if it rejects one).
4. **Commit the new marks to the `<fund>` data repo** — the same auto-commit
   the wrapper performs on the schedule (step 3 in the Components table above),
   done by hand here since recovery is never run through the wrapper (below).

Recovering several missed days is the same procedure repeated, not a new one:

```sh
for d in 2026-08-14 2026-08-15; do
  pnpm prices:fetch --as-of=$d
done
pnpm spine
# commit the new marks to <fund>
```

**There is no range flag, and it is not an oversight.** The unit of correctness
for a price mark is the *day*, everywhere in this system: the freshness rule
compares one `asOf` string, the inbox id is `pm-<instrumentId>-<asOf>`, and the
venue calendar (`owesMarkOn`) answers per day. A shell loop over single-day
calls is that same unit repeated, and it is provably safe to repeat — the inbox
merges by id, so re-running an already-recovered date queues nothing new. A
range parameter would additionally have to reproduce that day-by-day logic
*and* it walks into a real trap on the Banxico leg: the FIX range endpoint
returns its dates in ascending order and the parser reads the newest one, so a
multi-day window would silently attribute the wrong day's FIX to every date but
the last in the range. One call, one day, keeps that trap permanently out of
reach.

### A weekday recovery and a weekend recovery, side by side

The registry holds 13 instruments: 4 crypto (`btc` `eth` `render` `gram`,
Binance, daily cadence — Binance trades every day) and 9 Twelve Data symbols
(`aapl` `googl` `tsla` plus the six `*-mxn` derived rows, weekdays only). A
Friday owes all 13. A Saturday owes only the 4 crypto — the 9 equity-sourced
rows are **not owed** that day, not missing. Read the two reports below side by
side: **the 4/4 Saturday report is a complete, successful recovery**, not a
partial one, and it must never be mistaken for 9 silent failures.

The output below is authored to match the CLI's real format strings — it is
**illustrative, not a captured run** (no real recovery has been executed to
produce it):

Friday, 2026-08-14 — 13 of 13 owed:

```
prices:fetch — recovering 2026-08-14: marks are dated 2026-08-14, while
  fetchedAt records this run, because that is what a late measurement is.

  fetched btc     BTCUSDT     2026-08-14  <price>
  fetched eth     ETHUSDT     2026-08-14  <price>
  fetched render  RENDERUSDT  2026-08-14  <price>
  fetched gram    GRAMUSDT    2026-08-14  <price>
  fetched aapl    AAPL        2026-08-14  <price>
  fetched googl   GOOGL       2026-08-14  <price>
  fetched tsla    TSLA        2026-08-14  <price>
  fetched eww-mxn EWW         2026-08-14  <price>
  ...             (remaining 5 of 13 instruments omitted for brevity)

prices:fetch — 13/13 quotes stored in <dataDir>/prices
  13 new PriceMarked candidate(s) written to <dataDir>/inbox/transactions.json
  0 already pending (same id) — skipped

  recovery of 2026-08-14 — 13 owed, 13 marked, 0 absent; 0 not owed by their venue

Next: run `pnpm spine` to validate + append the marks to the event log.
```

Exit code **0**.

Saturday, 2026-08-15 — 4 of 4 owed (not 9 of 13 — the other 9 were never owed):

```
prices:fetch — recovering 2026-08-15: marks are dated 2026-08-15, while
  fetchedAt records this run, because that is what a late measurement is.

  fetched btc     BTCUSDT     2026-08-15  <price>
  fetched eth     ETHUSDT     2026-08-15  <price>
  fetched render  RENDERUSDT  2026-08-15  <price>
  fetched gram    GRAMUSDT    2026-08-15  <price>

prices:fetch — 4/4 quotes stored in <dataDir>/prices
  4 new PriceMarked candidate(s) written to <dataDir>/inbox/transactions.json
  0 already pending (same id) — skipped

  recovery of 2026-08-15 — 4 owed, 4 marked, 0 absent; 9 not owed by their venue
  not owed (never attempted): aapl, googl, tsla, eww-mxn, intc-mxn, nke-mxn, nu-mxn, rivn-mxn, sbux-mxn

Next: run `pnpm spine` to validate + append the marks to the event log.
```

Exit code **0**. The 9 Twelve Data symbols in `not owed` were never requested —
the run computes the owed set from the venue calendar before building any
provider request, so there is no ambiguous "no data" response to explain away.

### The exit contract

Under `--as-of`, every registered instrument for the recovered day lands in
exactly one of three states: **not owed** (the venue owed nothing that day —
never attempted), **owed and marked** (a mark was built and queued), or **owed
and absent** (owed, but no mark came out — a provider failure, or a bar dated
something other than the target day). A recovery in which every owed instrument
marked exits **0**. The run exits **1** if the absent set is non-empty — and,
exactly as on the daily path, also if any fetch failed outright or the spine
pre-check would reject a queued mark.

A refused argument never reaches the providers, and exits **1** with a single
readable sentence and **no stack trace**: `--as-of=<today>` (recovering today is
just running the daily job), a future date, a date that is not a real calendar
day (`2026-02-30` is refused, never quietly read as March 2), a missing value,
or an unknown argument — including the `--asof=` near-miss, which is rejected
rather than ignored precisely so a typo cannot silently run the daily job and
look like a finished recovery.

**In one sentence: the exit code cannot tell a market holiday apart from a
provider failure — it only says the day did not come back, so read the
`ABSENT`/`suspected` lines it prints before deciding what to do.** A holiday
needs no action; a provider fault needs a re-run.

### What recovery does *not* do (and why it is never run through the wrapper)

A recovery run writes exactly two things: stored quotes in `<dataDir>/prices`
and queued marks in `<dataDir>/inbox/transactions.json`. It never:

- **Writes the heartbeat.** `job-heartbeat.json` records whether the daily job
  ran that evening; its only writer is the wrapper's `EXIT` trap. Stamping it
  for a recovered past date would assert an evening run that never happened —
  manufacturing exactly the clean-looking surface a lost day hides behind.
- **Runs the spine.** `--as-of` is a flag on the fetch step, not a new
  pipeline; folding the recovered marks into the event log is still step 3 of
  the procedure above, run by hand.
- **Commits to the `<fund>` data repo, or refreshes the hosted projection.**
  Both stay the operator's: the commit is step 4 of the procedure above (the
  wrapper's step 3), and refreshing the projection is `pnpm backfill` (the
  wrapper's step 6).

This is also why recovery is **never** routed through
`ops/price-feed/run-daily-fetch.sh`: the wrapper's `EXIT` trap is the sole
writer of `job-heartbeat.json`, so pushing a recovery run through it would
stamp that false evening-ran signal regardless of intent. The wrapper also
derives its mark-time window from the live wall clock, which answers nothing
useful about a date that already passed. Run `pnpm prices:fetch --as-of=<date>`
directly, on its own, every time.

## Wire the operator notice into your shell profile

Every surface this repo has is **pull-only**. The TUI banner derives the lost days
live and correctly, and says so only to someone who opens the TUI; the dashboard
only to someone who opens the dashboard; `gap-report.json` only to someone who
opens the file. On 2026-08-14/15 all three were right the whole time and nobody
looked for three days, at the machine. The wrapper closes that by writing one
well-known plain-text file that your shell prints unasked. This section is the
other half: getting your shell to read it. It adds no detection; it is a
transport.

**Three writers, one file, and each speaks for a different failure** (#376):

| Writer | When | What it says |
| --- | --- | --- |
| Step 5b (`pnpm operator-notice`) | every run that reaches it | the **data** findings only — lost days and the venue-dark count. Rewritten in full, so a healthy run truncates it to empty |
| The wrapper's `EXIT` trap | any run that exits **non-zero** | this run **FAILED**, with its exit code and the step it died at. Replaces whatever stood there |
| Step 0 | at the start of a run, when the **previous** heartbeat says that run did not finish clean | the same FAILED sentence, about the previous run |

The two bash writers share one function and one wording (`write_operator_failure_notice`
in `ops/price-feed/run-daily-fetch.sh`), so there is exactly one phrasing of "the job
failed" to learn. They differ in one clause — which run will replace the file. The trap
is what stops an all-clear standing over a known-failed run overnight: a run whose data
was clean writes an *empty* notice at 5b and may still die at `backfill` minutes later.
Step 0 remains as the backstop for the one death the trap cannot report — a `SIGKILL`,
an OOM kill, a power loss — where no trap runs at all.

**On a run that exits 0 the trap touches the file not at all**, which is what lets
step 5b's findings (or an untouched previous notice) stand.

**The file.** `operator-notice.txt`, in the resolved data dir beside the durable
log, next to `gap-report.json` and `job-heartbeat.json`
(`OPERATOR_NOTICE_FILENAME` in `packages/event-store/src/operator-notice-io.ts`).
Plain `.txt` and not `.json` on purpose: the intended consumer is `cat`, and a
reader that needs `jq` is a dependency an operator's shell profile should not
carry.

### The snippet

Append this to `~/.zshrc` (or `~/.bashrc`/`~/.profile` — it is POSIX and safe on
the bash 3.2 macOS ships):

```sh
# Numisma: print the daily price run's operator notice on every new shell.
# The path MUST match the wrapper's DATA_DIR — see the three-readers warning below.
numisma_notice="${NUMISMA_DATA_DIR:-$HOME/Dev/accumulus/data}/operator-notice.txt"
[ -s "$numisma_notice" ] && cat "$numisma_notice"
unset numisma_notice
```

**This section writes the data-dir path literally, where the rest of this page
uses `<fund>`** — deliberately, and it should stay that way: a placeholder left
unsubstituted here would fail *silently* (a profile reading a non-existent path
prints nothing, exactly like a healthy machine) rather than loudly in front of the
operator, and a hole cannot be the third reader of a shared default. The literal
discloses nothing the committed `DATA_DIR=` line in
`ops/price-feed/run-daily-fetch.sh` does not
already write. If your store lives elsewhere, change it in all three places named
below, not just here.

Three further details are load-bearing and each is one character wide:

- `-s`, not `-f`: a healthy run leaves the file **present and empty**, and `-s`
  is what makes that print nothing.
- The trailing `unset` is not tidiness — it is what keeps the block's exit status
  at `0`. Ending a profile on a `[ … ] && …` that took the false branch leaves
  `$?` non-zero, which some prompts render as a failure the operator did not
  cause.
- If you set `NUMISMA_DATA_DIR`, **set it before this block runs**. The expansion
  reads the environment at the moment the profile executes, so a value set after it
  silently leaves the snippet reading the default directory. Note what this does
  *not* buy you: it gets the **reader** onto the right path and nothing else.
  Exporting the variable from your profile does not put it in front of the
  scheduled run, which is the **writer** — see the environment-scope divergence
  below, which is the one that actually fires.

### ⚠️ This snippet is the THIRD reader of the data-dir default

The same default is now written down in four places, in four languages:

| Reader | Where | Form |
| --- | --- | --- |
| The engine (authority) | `packages/engine/src/data-dir.ts` — ADR-006's rule, reached from `resolveDataDirDefault` | `NUMISMA_DATA_DIR` else `homedir()/Dev/accumulus/data`, absolute and homedir-derived |
| The wrapper | `DATA_DIR=` in `ops/price-feed/run-daily-fetch.sh` | `${NUMISMA_DATA_DIR:-$HOME/Dev/accumulus/data}` |
| **This snippet** | your shell profile | the same expansion again |
| The LaunchAgent | `EnvironmentVariables` in `ops/price-feed/com.numisma.pricefeed.daily.plist` | a literal absolute path, or absent — launchd cannot expand `~` and inherits nothing from your profile |

(Four places, then — the plist is the environment the wrapper's expansion actually
runs in, so it decides which branch of `${NUMISMA_DATA_DIR:-…}` the writer takes.)

The writer (the wrapper, through the engine) and the reader (your profile) resolve
that path **independently**. If they ever disagree, the notice is written to
one directory and `cat`-ed from another — and for a delivery channel that failure
does not look like a failure. It looks like a clean machine. **Silence that looks
like health is the exact condition this whole increment exists to remove**, so
treat a change to any one of them as a change to all of them.

**Three ways they actually diverge today**, and in all three the failure is the
same one: the writer lands in one directory, the reader looks in another, and
**the channel goes quiet while looking healthy**. The first is a divergence of
*scope* — which process sees the variable at all — and it is the one that fires in
practice, because it is produced by following this page's own instructions. The
other two are divergences of *value format*.

- **A value your shell exports and launchd never sees.** The snippet expands
  `${NUMISMA_DATA_DIR:-…}` in an **interactive login shell**. The wrapper runs
  under **launchd**, which starts the job with a bare, non-login environment —
  this page's install section and the wrapper's `PATH_PREPEND=` block exist entirely
  because of that fact, for `PATH`. `NUMISMA_DATA_DIR` is no different: a value
  exported from `~/.zshrc` — the very file this section tells you to edit, and the
  natural place to put it — is **invisible to the scheduled run**. So the wrapper
  writes `operator-notice.txt` into `$HOME/Dev/<fund>/data` while your profile
  `cat`s `/Volumes/ledger/data/operator-notice.txt`, which never exists. `[ -s … ]`
  is false on every new terminal, forever, and the machine reads as clean. Note
  that the wrapper's `DATA_DIR` is resolved in its configuration block, **before**
  the private token file is sourced under `set -a`, so putting `NUMISMA_DATA_DIR`
  in `~/.config/numisma/price-feed.env` does not fix this either — it splits the
  run instead (bash writes the notice in the pre-source dir, step 5b's
  `pnpm operator-notice` writes it in the post-source one). The token file is for
  provider tokens; the data dir belongs in the plist.
- **A `~/`-prefixed value.** The engine expands a leading `~/` itself
  (the tilde arm of `normalizeDataDirOverride` in
  `packages/engine/src/data-dir.ts`). Bash does **not** expand a tilde that arrives inside a
  variable's value, so the snippet reads a directory literally named `~`. The
  wrapper writes the real notice; your shell reads an empty path and prints
  nothing, forever.
- **A relative value.** The engine *refuses* it outright with a named error — "a
  relative value resolves differently depending on the working directory, so it is
  rejected to prevent a split-brain ledger" (the relative arm of the same
  function). The snippet has
  no such guard: it resolves the value against whatever directory the shell
  happened to start in, which differs between terminals.

**The mitigation is one rule, and it has both halves:** either leave
`NUMISMA_DATA_DIR` unset **everywhere** and take the default all four readers agree
on, or set it to an absolute, already-expanded path (`$HOME/...` in your profile, a
literal `/Users/you/...` in the plist — never a `~/...`) **in the LaunchAgent plist's
`EnvironmentVariables` as well as in your profile**, and not in
`~/.config/numisma/price-feed.env`. Setting it in only one of those two is the
scope divergence above, and it is silent.

### Empty means healthy

A clean machine prints nothing on a new shell. That is the whole contract, and it
is why there is nothing to configure and nothing to maintain:

- The file is **rewritten in full on every run**, including the healthy case,
  where step 5b truncates it to empty. The channel self-clears. A failing run is
  rewritten in full too, by the `EXIT` trap — never appended to.
- **No rotation and no history.** It is a notice, not a log. One fixed name, one
  current state.
- **No dismissal state anywhere in the design** — so there is none to get wrong,
  and nothing to clear by hand. You silence a line by fixing what it reports.

### What it means when it does print

You are reading **either a job report or a data report, never both mixed** — the
file has one writer at a time and the last one to write wins.

**A job report** is two lines from bash, and it is the whole file when it is
there:

```text
Numisma: the previous daily price job run FAILED — exit 124 at step 'timeout:backfill'. Nothing pushed this to you; that is why it is here.
Numisma: written by the wrapper in pure bash, so it says nothing about lost days yet — the next run replaces this file wholesale if it reaches its own notice step.
```

The exit code and the step are the triage — `exit 127 at step 'resolve-tools'` is
a `PATH` problem on this machine, `exit 124 at step 'timeout:backfill'` is a wedged
call the watchdog ended — and the sections above are where to take them. The second
line is the bound: a job report says **nothing** about lost days, so read it as
"the run failed", never as "and the data is fine". Run `pnpm gap-report` for that.
The next run's step 5b replaces this file with the data report below.

Note what a job report *never* carries any more (#376): the future-dated
breadcrumb and the "has not completed since" staleness line. Both live on in the
TUI banner, which reads the same heartbeat live; neither is actionable on the one
channel that arrives unasked, because the run printing it has usually just fixed
the thing it names.

**A data report** is what step 5b writes, and it is everything below.

**Lost days are ENUMERATED, one per day, each followed by its own recovery
command**:

```text
Numisma: 2026-03-02 — NO MARKS. The day is anchored but no price mark landed on it; the day is lost.
Numisma: 2026-03-02 — recover with: pnpm prices:fetch --as-of=2026-03-02
```

A lost day is **remediable and self-extinguishing**: run the command it names,
and on the next run the row is gone. That standing debt on every new shell is the
pressure the channel exists to apply. The date is repeated inside the command line
on purpose, so a line that reaches you alone — grepped, quoted into a standup,
wrapped by a narrow terminal — still says which day it recovers.

**The enumeration is capped at `MAX_NOTICE_LOST_DAYS` days** (ten, in
`packages/event-store/src/operator-notice.ts`), which is a width ceiling on the
notice, never a narrowing of the derivation. Past ten the **most recent** days
are the ones kept, because a lost day never clears itself and the tail of the
window is where the still-actionable damage sits. One tail line names the rest:

```text
Numisma: 4 earlier lost day(s) withheld — enumerate them with pnpm gap-report.
```

That pointer works because the notice and a bare `pnpm gap-report` open the same
window (`defaultGapReportSince`), so the command really does enumerate the days
the cap held back. The line appears only when days were actually withheld.

**Venue-dark days are COUNTED on one line, never enumerated, and only the RECENT
ones are counted at all**:

```text
Numisma: 3 venue-day(s) dark in the last 7 days — not lost days: the feed ran and the days are anchored, and the venue was silent or the market was closed for a holiday. Enumerate them with pnpm gap-report.
```

The asymmetry is deliberate and it is the decision this channel lives or dies on.
A venue-dark day is **permanent and it accumulates** — roughly ten a year are US
market holidays, and no command will ever clear one. Enumerated on a surface that
prints on *every new terminal*, they would grow without bound until the operator
learned to scroll past the whole block: cry-wolf channel death, arriving on a
schedule, inside the fix. So the notice carries the number and names
`pnpm gap-report`, which enumerates them on demand. (The TUI banner *does*
enumerate them, correctly — a pulled surface has a different noise budget. The
two renderings differ on purpose and must not be unified.)

**The count is not your running total — it is bounded to the last
`MAX_NOTICE_VENUE_DARK_DAYS` days** (seven, in
`packages/event-store/src/operator-notice.ts`), which is why the line names the
window out loud. Counting *all* of them would have re-created, in one line, the
permanence the enumeration was refused for: the store's oldest venue-dark day is
a holiday no command can clear, so an unbounded count is a line that prints
forever and an "empty means healthy" notice that can never be empty again. Under
the bound the count **self-extinguishes by age** instead: a market holiday is
counted for a week and then goes quiet, and a recent venue outage's day drops off
the same way once the marks land or the week passes. Seven keeps the channel
empty roughly four days in five on a healthy store; the docstring on the constant
carries the arithmetic and the recorded flip trigger (three, if ~70 noisy days a
year still proves too many).

Two consequences worth holding on to when you read the line:

- **An empty notice does not mean every venue-dark day you ever had was
  cleared.** It means none fell in the last seven days. Nothing was cleared —
  venue-dark days are still permanent, and the derivation still knows all of
  them.
- **`pnpm gap-report` will usually enumerate MORE than the notice counted**, and
  that is the design, not a disagreement: the report walks the whole window, the
  notice only admits the recent tail. The bound is presentation-only and applied
  at the leaf — the derivation window is never narrowed to achieve it, because
  that would age out **lost** days too, which is the one outcome this channel
  exists to prevent.

**A `lost days were NOT checked (…)` line** means the **derivation itself broke** —
the checker, not the data:

```text
Numisma: lost days were NOT checked (ENOENT: no such file or directory, open '…/events.jsonl').
```

Nothing is being claimed about your days here, in either direction. Read the
parenthesised detail, then run `pnpm gap-report` by hand to see the same failure
with its full output. A checker that said nothing while broken would be
indistinguishable from one saying "all clear", which is why this arrives as a line
rather than as silence.

### Verify the wiring once

```sh
# 1. Write the notice now, without waiting for the schedule.
pnpm operator-notice          # logs: [operator-notice] wrote <path>

# 2. The path it printed is the one your profile resolves.
echo "${NUMISMA_DATA_DIR:-$HOME/Dev/accumulus/data}/operator-notice.txt"

# 3. Open a new terminal. On a healthy machine it prints nothing — that is a pass,
#    provided steps 1 and 2 printed the same path.
```

To prove the channel actually speaks rather than merely staying quiet, put one
authored line in the file by hand and open a new terminal:

```sh
printf 'Numisma: wiring check — delete this line.\n' \
  > "${NUMISMA_DATA_DIR:-$HOME/Dev/accumulus/data}/operator-notice.txt"
```

The next run overwrites it, so there is nothing to undo.

**To remove the wiring:** delete the block from your profile. Nothing else is
installed — no launch agent, no state file, no dotfile of its own. The wrapper
keeps writing `operator-notice.txt`; the other surfaces (the TUI banner,
`pnpm gap-report`) are unaffected.

### Known limit: a run that never fires at all is not covered

The check **rides the existing wrapper**, so it speaks only when a run runs. If
launchd stays silent — the machine on, the job never invoked — no run reaches step
5b, nothing rewrites the file, and a new shell prints whatever the last run left,
which on a healthy last run is nothing. The heartbeat's "has not completed since"
line covers a job that ran and then stopped running; it cannot cover a channel
whose writer is the thing that stopped.

Catching that case needs an independent clock — a second LaunchAgent whose only
job is to notice the first one's absence. That was weighed and rejected on cost:
a second scheduled job is a second thing to install, resolve a PATH for, keep in
sync, and debug when *it* stops firing. This is a bounded, recorded limit of the
channel, not a defect in it. The gap report remains the backstop that names a loss
whenever anything does eventually run.

## The committed wrapper test harness (and why a green CI check says nothing about it)

`apps/price-feed/src/wrapper-harness/` drives `ops/price-feed/run-daily-fetch.sh`
as a real process — launched the way launchd launches it (`/bin/bash <wrapper>`,
in its own session), against an authored fake `pnpm`, inside a temp directory.

**⚠️ It can never run in CI as CI exists today. A green CI run does not mean this
harness passed — it means it was not attempted.** CI is a single `ubuntu-latest`
job; this suite targets macOS `/bin/bash` 3.2.57, BSD `ps`/`pgrep` and a watchdog
that is hand-rolled *because* macOS ships no `timeout(1)`. The suite's platform
gate skips it on Linux and prints the reason, so the CI log says so out loud —
but the check itself is green either way.

Where it runs, and when:

- **Automatically, on a macOS `pnpm test`, when its own subject changed.** The
  trigger compares `git merge-base HEAD origin/main` (on `main` itself, `HEAD~1`)
  against `ops/price-feed/**`, the harness's own directory, and
  `packages/event-store/src/heartbeat.ts` — committed history *and* the dirty
  tree, because an uncommitted wrapper edit is exactly when you most want it.
- **On demand:** `pnpm test:wrapper`. Runs it regardless of the trigger; the
  platform gate still applies.
- **It never skips silently.** One always-running test prints the decision, the
  reason, the base SHA it compared against and the path set — on every `pnpm
  test`, armed or not.

Overrides: `NUMISMA_WRAPPER_TEST` = `auto` (default) · `always` · `never` (which
still prints its reason — a mute button on this channel announces itself).
`NUMISMA_WRAPPER_TEST_RUNS` raises the per-case repetition above its committed
floor of 12; it is refused, not clamped, below it.

**Nothing it runs touches anything real.** All nine `NUMISMA_*` overrides the
wrapper reads are pointed inside a per-run temp directory and the launcher
*refuses to start* if any is unset or resolves outside it — because an
unisolated run is not a flaky test, it is a real `prices:fetch`, a real `spine`
append, a real commit against the durable event log and a real `backfill`
against the hosted projection, passing green while it happens.
