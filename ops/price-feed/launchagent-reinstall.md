# Reinstalling the price-feed LaunchAgent

Procedure for pushing a change to `com.numisma.pricefeed.daily.plist` into the job
launchd actually runs. The *why* behind the schedule lives in
`docs/price-feed-ops.md` (hourly window, `RunAtLoad`, credit budget, triage) — this
file is only the mechanics, the traps, and the verification.

**Reach for this whenever a PR touches the plist template.** Nothing else in the
repo makes that PR take effect.

## Why merging the PR changed nothing

The two halves of this job install by completely different routes, and that
asymmetry is the single most confusing thing about it:

| Half | How it installs | Live after `git pull`? |
| --- | --- | --- |
| `run-daily-fetch.sh` | The plist's `ProgramArguments` points at the **repo path**, so launchd executes the wrapper **in place**. `git pull` *is* its install. | **Yes** |
| `com.numisma.pricefeed.daily.plist` | The installed file at `~/Library/LaunchAgents/` is a hand-resolved **copy** (`__REPO_DIR__` / `__HOME__` expanded). No automation reconciles it. | **No** |

So the normal post-merge state is a **new wrapper on an old schedule**. That is
benign — the wrapper is correct standalone — but it means the schedule silently
stays whatever it was until someone runs this procedure.

## Before you start: timing

`launchctl load` with `RunAtLoad true` **is a live run**. Two consequences:

- **Do it at or after 18:00 CDMX**, so the run it fires lands inside the mark
  window and actually marks the day. A load at 09:00 spends 9 Twelve Data credits
  and ~2 minutes to emit **zero** marks.
- **Never follow it with `launchctl start`.** That is two runs inside one minute
  against Twelve Data's 8-credit/minute cap, and the equities will 429.

Confirm no run is in flight before unloading, or you will kill it mid-flight:

```sh
launchctl print gui/$(id -u)/com.numisma.pricefeed.daily | grep -E "state = |last exit code|runs"
```

Wait for `state = not running`. (The nested `state = active` lines are the event
channel and resource coalition, not the job. `runs` resets to 0 on unload, so it
counts runs *since load*, not lifetime.)

## The sequence

```sh
# 1. The wrapper's install. Also confirms the template you are about to render.
cd /Users/amet/Dev/numisma && git checkout main && git pull

# 2. The rollback anchor. Silent on success.
cp ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist \
   ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist.bak

# 3. Detach from launchd. Silent on success; it reports failures explicitly.
launchctl unload ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
#    modern equivalent if it refuses:
#    launchctl bootout gui/$(id -u)/com.numisma.pricefeed.daily

# 4. Render the template over the installed copy.
sed -e "s|__REPO_DIR__|/Users/amet/Dev/numisma|g" \
    -e "s|__HOME__|/Users/amet|g" \
    /Users/amet/Dev/numisma/ops/price-feed/com.numisma.pricefeed.daily.plist \
    > ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist

# 5. RE-ADD NUMISMA_PATH_PREPEND BY HAND — see the trap below. This is an EDIT.

# 6. Validate, then diff the PARSED structures (not the raw text).
plutil -lint ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
diff <(plutil -p ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist.bak) \
     <(plutil -p ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist)

# 7. Load. THIS FIRES A RUN. Do not add `launchctl start`.
launchctl load ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
```

Then verify (next section). A safe place to keep the `.bak`: leave it where it is
for a few days. launchd only loads `*.plist`, so a `.bak` sibling is never picked
up.

### Trap 1 — the template does not carry `NUMISMA_PATH_PREPEND`

Step 4 **destroys** it, because the installed plist carries a key the repo
template deliberately does not. Without it the job dies exit 127
(`node: not found`) on an asdf-managed machine — pnpm resolves, then pnpm's own
`node` lookup fails. Re-add it inside `EnvironmentVariables`:

```xml
<key>NUMISMA_PATH_PREPEND</key>
<string>/Users/amet/.asdf/shims:/Users/amet/Library/pnpm:/opt/homebrew/bin:/usr/local/bin</string>
```

It is byte-identical to the wrapper's own default, so it is strictly redundant —
but it is the combination *proven working* on this machine, and the cost of
dropping it is a silent red job. Preserve it. If node moves, re-derive with
`dirname "$(command -v node)"` (shims dir **first**).

### Trap 2 — `diff` the parsed plists, not the files

A raw `diff` here is ~80 lines of header-comment prose against the old file's 6,
so the two functional hunks drown. `plutil -p` ignores comments entirely, which
turns the check into a one-screen read. The **only** hunks you should see:

- `RunAtLoad` → `true`
- `StartCalendarInterval` from a single dict to a **6-element array**, Hours 18–23

Two specific things to hunt for:

- **A `Minute` missing from any dict.** An omitted field is a launchd **wildcard**,
  so `Hour 18` alone fires every minute of that hour — 360 runs/day, 3240 credits
  against an 800/day cap. (`apps/price-feed/src/schedule-window.test.ts` fails on
  this in the template; it cannot see your installed copy.)
- **`NUMISMA_PATH_PREPEND` on the left side only**, which means step 5 did not land.

Anything appearing beyond those two hunks — `ProgramArguments`, `NUMISMA_DATA_DIR`,
the log paths — means step 4 or 5 went wrong. Stop and restore the `.bak`.

## Verification

**Wait for the load-run to finish first** (~80 s; the 60 s Twelve Data pacing sleep
runs regardless):

```sh
while launchctl print gui/$(id -u)/com.numisma.pricefeed.daily 2>/dev/null \
  | grep -q "state = running"; do sleep 5; done
launchctl print gui/$(id -u)/com.numisma.pricefeed.daily | grep -E "state = |last exit code|runs"
```

Want `state = not running`, `last exit code = 0`, `runs = 1` — one run, so
`RunAtLoad` fired exactly once and nothing double-ran.

**1. What launchd now holds** — this is the check that catches the desync this
whole procedure exists to fix, so do not skip it in favour of re-reading the file:

```sh
launchctl print gui/$(id -u)/com.numisma.pricefeed.daily | grep -A14 -iE "calendar|runatload"
```

Expect six `com.apple.launchd.calendarinterval` descriptors — Hours 18, 19, 20, 21,
22, 23, each with `"Minute" => 0` — and `properties = runatload | inferred program`.
The descriptors print in **arbitrary order**; that is launchd's dictionary, not a
fault. If only one interval appears, the array did not register despite a correct
file on disk.

**2. The heartbeat** (`$NUMISMA_DATA_DIR/job-heartbeat.json`):

```json
{
  "schemaVersion": 2,
  "exitCode": 0,
  "lastStep": "complete",
  "markWindow": true,
  "lastMarkWindowFinishedAt": "…"
}
```

`markWindow: false` on an at-or-after-18:00-CDMX load means the mark-hour gate is
misreading the clock (it reads `TZ="$MARK_TZ" date +%H`, not machine-local time).
`lastMarkWindowFinishedAt` should equal this run's own `finishedAt` — if it still
carries an older value, the stamp did not update.

**3. Idempotency** in the newest wrapper log. Note `ls` may be aliased to something
that colorizes and breaks the pipe; use `/bin/ls`:

```sh
tail -25 "$(/bin/ls -t ~/Library/Logs/numisma/price-feed-*.log | head -1)"
```

On a second run of the same evening, want: `0 new transactions found, N duplicates
skipped` at `spine`, `no tracked data changes to commit (idempotent no-op run)` at
`commit`, `post-check OK`, `[backfill] N anchor(s) upserted`, and
`price-feed daily run complete.`

## Rollback

```sh
launchctl unload ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
mv ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist{.bak,}
launchctl load   ~/Library/LaunchAgents/com.numisma.pricefeed.daily.plist
```

Doing the reinstall early in the window leaves room to roll back and still mark the
day — another reason not to attempt this at 23:30.

## Known risk: a cold boot that beats wifi association

**`RunAtLoad` can cry wolf, and this is the one predicted failure of the current
schedule that has not yet been observed.** It was flagged in review of #185 S2 and
accepted rather than fixed, on the grounds that it is cheap to watch and expensive
to pre-solve.

The mechanism: `RunAtLoad` fires the job at boot/login, which is exactly when the
network stack may not be up yet. The agent loads, the wrapper runs, and
`prices:fetch` fails against every provider because there is no route. The wrapper
preserves the non-zero exit, so the heartbeat is written with
`exitCode != 0` and `lastStep: "prices-fetch"` — and the TUI surfaces that as a
**red job for the whole working day**, until the 18:00 fire overwrites it with a
healthy run.

Two things keep this bounded, and they are worth knowing before anyone "fixes" it:

- **It does not corrupt the staleness signal.** `prices-fetch` is not in the
  wrapper's `MARKS_LANDED_STEPS` (`commit post-check gap-report backfill complete`,
  `run-daily-fetch.sh:121`), so a run that dies there does **not** stamp
  `lastMarkWindowFinishedAt`. The carried value survives, and staleness is still
  judged against the last run that genuinely marked. The failure is a false alarm
  about *health*, never a false reassurance about *marks* — which is the direction
  that matters, and the opposite of the #185 bug.
- **It self-heals the same day.** The 18:00–23:00 window overwrites the heartbeat
  with a real result. Nothing needs doing.

**Watch, don't pre-fix.** If it turns out to be a recurring morning annoyance, the
options in increasing cost:

1. **Drop `RunAtLoad`.** The hourly window is the half that does the work;
   `RunAtLoad` only covers the powered-off/logged-out case, where no coalesced
   catch-up exists. Cheapest fix, and it forfeits the least.
2. **Gate the wrapper on reachability** — a bounded wait for a route before
   `prices:fetch`, exiting quietly (not red) if it never arrives. More code on the
   path that must never silently pass.

Do not reach for (2) on the strength of the prediction alone; the whole point of
the heartbeat is that a real occurrence will be visible.

## Execution record

| Date | Change | Result |
| --- | --- | --- |
| 2026-08-07 18:14 CDMX | Single 18:00 dict + `RunAtLoad false` → six-dict array (18–23) + `RunAtLoad true`, per #185 S2 (PR #225). | Clean. `plutil -p` diff showed only the two expected hunks; six intervals confirmed live in `launchctl print`; `exitCode 0`, `lastStep complete`, `markWindow true`. Second run of the evening appended **0** marks (13 duplicates skipped), committed nothing, and upserted 39 anchors — first production confirmation of both the `schemaVersion: 2` heartbeat writer and same-evening idempotency. |

Note on that entry: the 18:00 fire earlier the same evening had already run the
**new wrapper on the old schedule** and written the first v2 heartbeat, which is
the asymmetry at the top of this file behaving exactly as described.
