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
#
# THE MISSING COLON IS THE POINT. This read used `${NUMISMA_DATA_DIR:-...}`, and the
# colon form substitutes the default when the variable is unset OR EMPTY — so it
# collapsed two cases the TS side (#348) deliberately holds apart. `NUMISMA_DATA_DIR=""`
# in the plist is not "I did not configure this", it is "I configured this and my
# expansion produced nothing" — `NUMISMA_DATA_DIR="${SCRATCH}"` with `SCRATCH` unset is
# exactly how it happens — and the colon form answered that by pointing the whole run,
# heartbeat, commit and all, at the operator's REAL accumulus ledger without a word.
#
# The colon form is also wrong in the OTHER direction, and worse: it does not
# substitute for whitespace. `NUMISMA_DATA_DIR="   "` is non-empty to bash, so it
# survived verbatim as a LITERAL relative path, and `HEARTBEAT_FILE` (below) and the
# `git -C "$DATA_DIR"` at the commit step then resolved it against whatever directory
# the job happened to start in — the split-brain arm ADR-006 exists to forbid.
#
# So: `${VAR-default}` (no colon) substitutes for UNSET ONLY, and blank in either
# spelling is refused outright below. Unset → the default, deliberately. Set-but-blank
# → a loud non-zero exit. Anything else → verbatim. Byte-identical to what
# `resolveDataDir` does in TS, which is the only way this wrapper and the code it
# drives can be said to agree.
DATA_DIR="${NUMISMA_DATA_DIR-$HOME/Dev/accumulus/data}"
# A blank `DATA_DIR` can ONLY mean a set-but-blank env var: the default above is never
# blank. Stripping every space/tab/newline and testing what is left catches `""` and
# `"   "` with one predicate.
#
# WHERE THIS REFUSAL SURFACES, AND WHY IT IS NOT THE PER-RUN LOG. It lands on the
# INHERITED stderr, which under launchd is the plist's StandardErrorPath —
# `~/Library/Logs/numisma/launchd.price-feed.err.log`. That is the file to open when a
# scheduled run appears to have done nothing at all. It is NOT `price-feed-<stamp>.log`,
# because that file does not exist yet: `mkdir -p "$LOG_DIR"`, the `LOG_FILE=`
# assignment and the `exec … tee` redirect all sit far below this block, and this check
# cannot move down to join them, because it must run BEFORE the
# `HEARTBEAT_FILE="$DATA_DIR/job-heartbeat.json"` assignment — which is itself above all
# three. (Named rather than pinned to line numbers on purpose: this file is edited often
# enough that a cited line is a lie waiting to happen, and #348 is a PR about exactly
# that class of rot. `LOG_DIR` is read from its OWN env var near the top and does not
# depend on `DATA_DIR`, so a blank data dir does not blind the logging; the per-run log
# is simply not open yet.)
#
# There is therefore NO HEARTBEAT for this failure, and that is deliberate, not an
# oversight in a wrapper whose heartbeat exists precisely to record failures. The
# heartbeat is written INTO `$DATA_DIR`, and the whole finding here is that we do not
# have a trustworthy one. Guessing a fallback location so that something gets written
# is the exact defect #348 kills: inventing a path for a knob the operator got wrong.
# A future edit that "helpfully" relocates this check to get a breadcrumb out of it
# would reintroduce the bug — the run must die before it can name a directory.
#
# Exit 78 is sysexits.h's EX_CONFIG. It is picked to NOT collide with the codes this
# wrapper already speaks — 1 (a step failed), 124 (watchdog), 127 (pnpm/node missing),
# 143 (someone else's SIGTERM) — so a reader of the launchd error log can tell "the
# environment handed me a broken knob" apart from "the run tried and failed".
if [[ -z "${DATA_DIR//[[:space:]]/}" ]]; then
  echo "FATAL: NUMISMA_DATA_DIR is set to a blank value (got '$NUMISMA_DATA_DIR')." >&2
  echo "A blank value is not 'unset': using it would silently send this run's marks," >&2
  echo "heartbeat and git commit either to the REAL default ledger or to whatever" >&2
  echo "directory the scheduler happened to start in. Unset NUMISMA_DATA_DIR to choose" >&2
  echo "the default deliberately, or give it an absolute path." >&2
  echo "No heartbeat was written: it lives under NUMISMA_DATA_DIR, which is what is broken." >&2
  exit 78
fi
# Wall-clock ceiling on the WHOLE run, enforced by the watchdog below. Must stay
# comfortably under the 3600s gap between scheduled fires; the reasoning and the
# guard are at the watchdog itself. 0 disables it (manual debugging only).
MAX_RUN_SECONDS="${NUMISMA_PRICEFEED_MAX_RUN_SECONDS:-2700}"
# How long the watchdog waits after SIGTERM before escalating to SIGKILL.
WATCHDOG_GRACE_SECONDS="${NUMISMA_PRICEFEED_WATCHDOG_GRACE_SECONDS:-30}"
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
# Whether the WATCHDOG is what ended this run, carried as a SEPARATE FACT rather
# than by rewriting `LAST_STEP`. An earlier version did rewrite it in place
# ("timeout:backfill"), and that quietly broke the `MARKS_LANDED_STEPS` predicate
# below: it is an exact-string match, so a decorated name matches nothing and a run
# that HAD appended, committed and verified the day's marks recorded itself as not
# having landed them — producing the "nothing recorded for today" cry-wolf the
# comment at MARKS_LANDED_STEPS is written to prevent, standing right beside a true
# exit-124 line. The step name now stays a bare step name everywhere; the timeout is
# a flag, and the decoration happens once, at print time.
TIMED_OUT=false
HEARTBEAT_FILE="$DATA_DIR/job-heartbeat.json"
# THE DELIVERY CHANNEL'S ONE FILE, named ONCE here beside the breadcrumb it is derived
# from. Step 0 below writes it in bash and step 5b rewrites it through
# `pnpm operator-notice`, and the two MUST agree on the path. There is deliberately no
# notice-specific `NUMISMA_*` override and there must never be one: the TS half resolves
# the same name from the same data dir through ADR-006's single rule
# (`operator-notice-io.ts`, `OPERATOR_NOTICE_FILENAME`), so a second knob here would be a
# second way for the writer and the reader to end up in different directories. For a
# channel whose healthy state is an empty file, that failure is not a missing message: it
# is silence that reads as health.
#
# WHAT THAT DOES *NOT* BUY, STATED PLAINLY BECAUSE AN EARLIER VERSION OF THIS COMMENT
# CLAIMED IT DID. Having no override of its own does not make the two halves agree, because
# the DATA DIR they hang off can still diverge inside one run. `DATA_DIR` is resolved at the
# top of this file (line 59), and `$ENV_FILE` is sourced much later under `set -a`, which
# EXPORTS every assignment in it. So a `NUMISMA_DATA_DIR=` line in the private token file
# splits the run in two: bash `$DATA_DIR` — and therefore this variable, `$HEARTBEAT_FILE`,
# and the `git -C "$DATA_DIR"` in steps 3 and 4 — keeps the PRE-SOURCE value, while step
# 5b's `resolveDataDirDefault()` sees the exported one and writes `operator-notice.txt`
# into the POST-SOURCE directory. Two writers, two directories, one `cat` in the profile.
# The resolution order is not this channel's to change (`job-heartbeat.json` and
# `gap-report.json` have had the same exposure since before this file grew a notice), so
# what is recorded here is the true shape of it: THE ONE SUPPORTED CONFIGURATION IS THAT
# `NUMISMA_DATA_DIR` IS NOT SET IN `$ENV_FILE`. That file is for provider tokens; put the
# data dir in the LaunchAgent plist's `EnvironmentVariables`, which is in the environment
# before line 59 runs and therefore cannot split anything.
OPERATOR_NOTICE_FILE="$DATA_DIR/operator-notice.txt"

# --- THE ONE FAILED-NOTICE WRITER, SHARED BY BOTH BASH SITES (#376) ----------
# TWO SITES WRITE "the job failed" INTO THIS FILE and there is exactly one wording for it.
# Step 0 speaks about the run that ENDED before this one; the EXIT trap speaks about the
# run that is ending right now. Left as two `printf`s they would drift into two dialects of
# one sentence on the one channel the operator reads in two seconds — which is the
# vocabulary split this codebase refuses everywhere else (step 0's own comment already
# borrows `formatHeartbeatWarning`'s voice for exactly this reason). So: one function, one
# wording, and the only thing a caller may vary is named below.
#
# THE FAILED LINE IS VERBATIM FROM BOTH SITES, INCLUDING "the previous … run". That reads
# correctly from the trap too, and not by luck: nothing `cat`s this file during the run
# that wrote it. The operator meets it at the next shell prompt, by which time the run the
# trap described is, in fact, the previous one.
#
# WHAT DIFFERS IS THE SCOPE LINE'S TAIL — WHICH RUN WILL REPLACE THIS FILE. From step 0
# that is "the run now starting"; from the trap the starting run is already over, so it is
# "the next run". That is the whole of the argument, and it is an argument rather than a
# whole line so the two cannot drift.
#
# `$1` exit code · `$2` step name · `$3` the tail above.
#
# IT CANNOT FAIL ITS CALLER. Both call sites are places where an error would cost more than
# the notice: step 0 runs under `set -euo pipefail` before the toolchain is even resolved,
# and the trap must never replace the exit code it was installed to record. Every command
# is guarded and the function returns 0 unconditionally.
#
# DEFINED HERE, BESIDE THE PATH IT WRITES, AND THAT PLACEMENT IS LOAD-BEARING: it must
# exist before step 0 runs and before `trap write_heartbeat EXIT` is installed, and both of
# those are further down. It reads `$OPERATOR_NOTICE_FILE`, assigned one line above, so the
# `set -u`-inside-a-trap hazard this file documents for `MARK_WINDOW` cannot reach it —
# there is no path on which the trap can fire before line 175 has run.
write_operator_failure_notice() {
  notice_exit_code="$1"
  notice_last_step="$2"
  notice_replacing_run="$3"
  # `formatHeartbeatWarning`'s voice and its closing clause, deliberately — the operator
  # must not have to learn two vocabularies for one job. What is dropped is the DATE it ran
  # on, because that is a clock read neither caller makes; what is added is line two, which
  # bounds the claim so a reader never mistakes this for a lost-day report.
  notice_failed_line="Numisma: the previous daily price job run FAILED — exit"
  notice_failed_line="$notice_failed_line $notice_exit_code at step '$notice_last_step'."
  notice_failed_line="$notice_failed_line Nothing pushed this to you; that is why it is here."
  notice_scope_line="Numisma: written by the wrapper in pure bash, so it says nothing about"
  notice_scope_line="$notice_scope_line lost days yet — $notice_replacing_run replaces this file"
  notice_scope_line="$notice_scope_line wholesale if it reaches its own notice step."
  # OVERWRITE, NEVER APPEND, and one `printf` for both lines so it stays that way: the
  # notice has exactly one well-known name and no history, and a file that accumulated
  # would be a log nobody reads. Guarded because a full or read-only data dir must cost a
  # notice, never the run.
  printf '%s\n%s\n' "$notice_failed_line" "$notice_scope_line" \
    > "$OPERATOR_NOTICE_FILE" 2>/dev/null || true
  return 0
}
# ----------------------------------------------------------------------------

# --- was this run even CAPABLE of marking? (#185 S2) -------------------------
# `RunAtLoad true` means this script now fires at ANY hour — a 09:00 login is an
# ordinary trigger. Such a run stores quotes and emits ZERO marks (the mark-instant
# contract gates on 18:00 CDMX), then exits 0. To the heartbeat reader that looked
# identical to a healthy evening, which SILENCED the staleness warning on exactly
# the morning after a lost day. So record the distinction instead of guessing at it.
#
# THE ZONE IS PART OF THE CONTRACT, NOT THE MACHINE'S BUSINESS. The real gate is
# `isAtOrAfterMarkTime(instant, { timeZone: <the contract zone> })`, which resolves
# through Intl in that zone explicitly. Reading the bare local hour would agree with it
# only by coincidence of the OS setting — and docs/price-feed-ops.md offers the
# divergent setup as SUPPORTED ("or shift all six of the plist's Hour entries to the
# local clock equal to 18:00-23:00 CDMX"). Take that option on a UTC box and every
# scheduled fire computes out-of-window, so nothing ever stamps and the staleness
# trigger is permanently, silently dead — while the runs themselves mark fine.
#
# `10#` forces base 10 ON BOTH OPERANDS: bare `08`/`09` are invalid OCTAL, and `[[ ]]`
# arithmetic-evaluates the right-hand side too. Unguarded, a mark hour in the 08/09
# band would not abort — it is an `if` condition, so `set -e` never fires — it would
# silently classify EVERY run as out-of-window. Moot at 18, latent the moment the
# contract moves, which is precisely what the guard below exists to survive.
#
# CONFIGURED, NOT LITERAL — AND STILL GUARDED. The defaults below are the engine's
# `TRADING_DAY_TIME_ZONE` / `MARK_HOUR` (packages/engine/src/price-feed/mark.ts),
# which `DEFAULT_CONFIG` also derives from. Duplicating them into bash remains
# deliberate: this is a shell script and cannot import the contract. The duplication
# is the COST; the guards in apps/price-feed/src/schedule-window.test.ts are what it
# buys — they pin these two DEFAULTS (the `:-` halves, matched as shape, so a leading
# zero cannot creep into the hour) against `DEFAULT_CONFIG`, so a change to the
# contract fails a test rather than rotting here silently.
#
# The overrides exist so a CALLER can put a run on either side of the mark window by
# setting a value, instead of hoping the machine clock cooperates — which is what the
# wrapper's own test harness needs and what a manual out-of-window dry run wants.
MARK_TZ="${NUMISMA_MARK_TZ:-America/Mexico_City}"
MARK_HOUR="${NUMISMA_MARK_HOUR:-18}"

# PROVISIONAL UNTIL THE RUN IS CLASSIFIED, BECAUSE THE EXIT TRAP BELOW READS IT. The
# two guards that refuse an unusable zone or hour, and the classification itself, run
# AFTER the heartbeat trap and the per-run log are installed — see "the mark window,
# classified" further down for why that ordering is the point rather than an accident.
# The trap can therefore fire before the window has been computed, and under `set -u`
# an unset variable inside an EXIT trap would replace the very exit code the heartbeat
# exists to record.
#
# `false` IS THE HONEST VALUE ON THAT PATH, not a convenient one. `markWindow` records
# whether the run was CAPABLE of marking the day; a run that died in its own startup
# guards marked nothing, and `MARKS_LANDED_STEPS` withholds a stamp from it for that
# same reason. It claims no side of a window it could not compute — it declines one.
MARK_WINDOW=false

# WHICH STEPS MEAN THE DAY'S MARKS ARE ACTUALLY IN THE LOG. `pnpm spine` (step 2) is
# what appends them, so every step AFTER it implies they landed. Being in the window
# is not enough on its own: a run that dies at `prices-fetch` is in-window and marked
# NOTHING, and stamping it would record the failure as evidence the day was covered.
#
# DELIBERATELY NOT "exit 0". The exit code covers the whole pipeline, but the marks
# land at step 2. A run that fails at `gap-report`, `operator-notice` or `backfill`
# (steps 5-6) has already appended and committed the day — gating on exit 0 would
# leave that evening unstamped, so the next morning would claim "nothing recorded"
# for a day the log plainly holds, and contradict the gap report standing next to it.
# Cry-wolf is the failure this channel was designed around; under-stamping trades one
# false negative for a false positive rather than fixing anything.
MARKS_LANDED_STEPS="commit post-check gap-report operator-notice backfill complete"

# The heartbeat has ONE slot, so an out-of-window run OVERWRITES the evening run's
# breadcrumb. Carrying the last in-window finish forward is what stops that erasing
# the evidence: without it the reader must choose between going silent after every
# login (the bug) and crying wolf after every healthy evening. Read BEFORE the trap
# can overwrite the file, and never inside the trap — pure bash, but `sed` is still
# more work than an EXIT path in the middle of a failure should be doing.
#
# READ UNCONDITIONALLY, not only when out of window: an IN-window run that dies
# before `spine` must also fall back to what it carried, so this value has to exist
# on every path. (`|| VAR=""` on the pipelines below READS as a safety net and is
# not one: under `pipefail`, if `head -n1` exits before `sed` finishes, `sed` takes
# SIGPIPE, the pipeline reports failure, and the `||` blanks a value that was read
# correctly. A heartbeat has one match, so this needs thousands of matching lines to
# reach — and it fails CLOSED, to an unset carry. Left as is, named rather than
# papered over.)
CARRIED_MARK_WINDOW_AT=""
if [[ -f "$HEARTBEAT_FILE" ]]; then
  CARRIED_MARK_WINDOW_AT="$(sed -n \
    's/.*"lastMarkWindowFinishedAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$HEARTBEAT_FILE" 2>/dev/null | head -n1)" || CARRIED_MARK_WINDOW_AT=""
  # A schemaVersion-1 file predates this field, and every v1 run was treated as
  # in-window — so its `finishedAt` IS the last in-window finish.
  #
  # GATED POSITIVELY ON v1, and the negative gate it replaces was a real bug. That
  # version fell back whenever the file did not say `"markWindow": false`, which is
  # true of a perfectly ordinary v2 file: an IN-WINDOW run that died before `spine`
  # correctly omits `lastMarkWindowFinishedAt` (it marked nothing) while carrying
  # `"markWindow": true`. The old condition read that omission as "v1" and promoted
  # the failure's own `finishedAt` into a marked-day stamp — manufacturing evidence
  # that the day was covered out of a run that covered nothing, and silencing the
  # staleness warning on exactly the morning it was needed. That is the same failure
  # the `MARKS_LANDED_STEPS` comment above is at pains to avoid, re-entered through
  # the compatibility path.
  #
  # LATENT BEFORE, REACHABLE NOW. It needed an in-window run that failed before
  # `spine` and left a v2 file — uncommon. The watchdog makes exactly that shape
  # routine (a timed-out run is in-window and unmarked by construction), so it is
  # fixed here rather than left for the fix to start tripping.
  #
  # Matching v1 EXPLICITLY rather than "not v2" keeps a future v3 on the correct
  # side by default: an unrecognised newer file declines the fallback, which fails
  # closed to an unset carry — the same direction every other guard here leans.
  if [[ -z "$CARRIED_MARK_WINDOW_AT" ]] && grep -q '"schemaVersion"[[:space:]]*:[[:space:]]*1[[:space:]]*,' "$HEARTBEAT_FILE" 2>/dev/null; then
    CARRIED_MARK_WINDOW_AT="$(sed -n \
      's/.*"finishedAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
      "$HEARTBEAT_FILE" 2>/dev/null | head -n1)" || CARRIED_MARK_WINDOW_AT=""
  fi
  # VALIDATE BEFORE RE-EMITTING. This value is copied verbatim into the next file, so
  # a corrupt one (a torn write, a hand-edit, an embedded quote or backslash) does not
  # merely travel — it can make the JSON unparseable, and the reader condemns the
  # WHOLE record on a bad field, losing the exit code and step name with it. Worse, it
  # is self-sustaining: every later out-of-window run re-reads and re-emits it, so only
  # an in-window run would ever heal it. Dropping an unreadable carry costs one
  # staleness date; keeping it costs the entire breadcrumb. Same ISO-instant shape the
  # reader enforces, so anything accepted here is accepted there.
  if [[ ! "$CARRIED_MARK_WINDOW_AT" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?(Z|[+-][0-9]{2}:[0-9]{2})$ ]]; then
    CARRIED_MARK_WINDOW_AT=""
  fi
fi
# ----------------------------------------------------------------------------

# --- 0) did the PREVIOUS run finish? (#357 slice 3) --------------------------
# THE ONE STEP THAT RUNS BEFORE THE TOOLCHAIN EXISTS, and that is its whole reason to be.
# Step 5b writes this same file through `pnpm operator-notice` and — since #376 — says only
# what the DATA says, on a run that gets there at all. The failures this channel was built
# for are exactly the runs that do not get there: an unresolvable `pnpm` or `node` (the two
# `exit 127`s further down) and a run that died partway. On either, every node-shaped
# writer in this repo is unreachable, so the one thing left that can speak must depend on
# nothing that could itself be the missing thing. `sed` and a `printf` into a file depend on
# nothing — the same argument, verbatim, that makes `write_heartbeat` above pure bash.
#
# WHAT THIS STEP IS *AFTER* #376, SAID PLAINLY BECAUSE AN EARLIER VERSION OF THIS COMMENT
# CLAIMED MORE. It is no longer the only bash channel for a partway death: the EXIT trap now
# calls `write_operator_failure_notice` too, on a non-zero exit, so a run that dies at step
# 3 reports itself the moment it dies rather than waiting for the NEXT fire to notice. That
# leaves step 0 as a BACKSTOP re-asserting a fact the trap has usually already written —
# and the residue it covers alone is real and unreachable from anywhere else: a death with
# no trap at all. SIGKILL to this shell, an OOM kill, a power loss. On those the heartbeat
# is the previous run's and nothing has spoken, so this step is the only thing that ever
# will. On every other path it writes the same sentence twice, one run apart, which is the
# cheapest possible form of that insurance.
#
# IT IS A PURE EQUALITY READ OF TWO FIELDS: NO DATE MATH, NO THRESHOLD, NO CLOCK. That is a
# decision, not an unfinished implementation. "Too long since the last good run" is
# `dueThrough`'s rule, it lives in TypeScript, and apps/price-feed/src/schedule-window.test.ts
# exists precisely because a second copy of a contract in bash has nothing forcing the two
# to agree. A staleness threshold here would be that second copy, on the one channel where
# a disagreement reads as an all-clear. A rule that needs a pin is a rule worth not
# creating: every instant comparison stays in step 5b, which has the whole contract.
#
# PLACED BESIDE THE CARRY READ ABOVE rather than down at `resolve-tools`, because both
# blocks want the same thing from the same file — the PREVIOUS run's breadcrumb, while it
# is still on disk unmodified by this run's EXIT trap. Two readers of one file belong
# together, and sitting here it is also, by construction, ahead of every step that needs a
# tool. Note what this costs: the per-run log does not exist yet (`exec > >(tee …)` is
# further down), so this block says nothing on stdout. The file IS the channel; an echo
# here would go only to the scheduler's unread stdout, which is the failure mode this
# whole increment exists to leave behind.
#
# IT CANNOT FAIL THE RUN. Under `set -euo pipefail` a delivery channel that aborted the
# pipeline it reports on would be worse than no channel; every command is guarded exactly
# the way the carry read's are, and both reads fail closed to an empty string.
PREVIOUS_EXIT_CODE=""
PREVIOUS_LAST_STEP=""
if [[ -f "$HEARTBEAT_FILE" ]]; then
  PREVIOUS_EXIT_CODE="$(sed -n \
    's/.*"exitCode"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' \
    "$HEARTBEAT_FILE" 2>/dev/null | head -n1)" || PREVIOUS_EXIT_CODE=""
  PREVIOUS_LAST_STEP="$(sed -n \
    's/.*"lastStep"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    "$HEARTBEAT_FILE" 2>/dev/null | head -n1)" || PREVIOUS_LAST_STEP=""
fi
# SPEAK ONLY ON A POSITIVE READ OF BOTH FIELDS. A heartbeat that is absent, truncated or
# unparseable says NOTHING and writes NOTHING. A machine that has never run this job would
# otherwise be told, on its first morning, that the last run failed — cry-wolf on day one,
# spent from the only account this channel has. Absence of evidence is not evidence here:
# the gap report and the heartbeat's own TUI reader both cover the "never ran" shape, and
# neither of them needs this file to invent a claim it cannot support.
if [[ -n "$PREVIOUS_EXIT_CODE" && -n "$PREVIOUS_LAST_STEP" ]]; then
  # CLEAN IS `exitCode` 0 *AND* `lastStep` complete, and nothing else is. `timeout:backfill`
  # is not clean: that run appended the day's marks and then wedged, and the wedge is the
  # part worth saying out loud — the heartbeat's own writer decorates the step name for
  # exactly that reason, so an equality against `complete` catches it for free.
  #
  # ON A CLEAN PREVIOUS RUN THIS TOUCHES THE FILE NOT AT ALL. Not a truncate, not a `:>`,
  # nothing — and that restraint is the correctness argument of the whole block. The file
  # standing here was written by the PREVIOUS run's step 5b and may name real lost days.
  # Clearing it at the START of a run, before this run has proved it can do anything, and
  # then dying at step 3 would leave an EMPTY notice standing over a real loss: `cat` prints
  # nothing, the operator reads silence as health, and the channel has manufactured the
  # exact false all-clear it was built to end. Self-clearing belongs to step 5b ALONE,
  # which runs only once the day's work is actually done.
  if [[ "$PREVIOUS_EXIT_CODE" != "0" || "$PREVIOUS_LAST_STEP" != "complete" ]]; then
    # THE TRADE THIS `>` MAKES, RECORDED BECAUSE IT CUTS AGAINST THE BLOCK ABOVE. The clean
    # branch refuses to touch the file precisely because the previous run's step 5b may have
    # named real lost days — and this branch then deletes those same lines. Across a
    # MULTI-DAY OUTAGE that inverts the standing-debt purpose in the exact case step 0 was
    # written for: run N-1 enumerates 08-14 and 08-15 with a `pnpm prices:fetch --as-of=`
    # line each, run N dies at step 3, and every run after it prints only "the previous run
    # FAILED" — no dated recovery command anywhere, for as long as the outage lasts, even
    # though those dates were still accurate the whole time. Lost days are permanent, so
    # what is discarded never went stale.
    #
    # IT IS STILL THE RIGHT CALL HERE, and the reason is that the alternative is worse than
    # it looks. Preserving them means READING the file back before the `>` and prepending —
    # pure bash, doable — but what would be prepended is unvalidated text of unknown age
    # from a file this step cannot date, carried forward run after run with nothing that can
    # ever retire it. Step 5b is the only writer that knows whether a lost-day line is still
    # true, and on the outage above step 5b is precisely what is not running. A stale
    # enumeration standing under a fresh FAILED line is a channel telling the operator two
    # things of different vintages in one voice, which is the credibility spend this whole
    # design refuses. So: one bounded, currently-true message, and the scope line in
    # `write_operator_failure_notice` (`notice_scope_line`, defined with the writer near the
    # top of this file) says out loud that lost days are not in it. The cost is real and it
    # is accepted.
    #
    # THE TAIL IS "the run now starting" BECAUSE THAT IS WHERE THIS CALLER STANDS — the run
    # this file is about is over, and the one that will replace this text has not reached
    # its notice step yet. The trap's call passes "the next run" for the mirror reason.
    write_operator_failure_notice "$PREVIOUS_EXIT_CODE" "$PREVIOUS_LAST_STEP" "the run now starting"
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
  # Never let a dead stdout kill the writer. The EXIT path reaches here from the
  # watchdog's TERM (where `tee` is already gone) as well as from a clean finish,
  # and a SIGPIPE partway through would lose the whole breadcrumb. Set here TOO, not
  # only in the TERM handler, because this trap also runs on paths that never passed
  # through it. Cheap, idempotent, and the failure it prevents is silent.
  trap '' PIPE
  # CANCEL THE WATCHDOG FIRST — before the early `return 0` below, and before any
  # work that could fail (except on the timeout path, where it is deliberately left
  # running; the last paragraph of this comment is that case). A watchdog left
  # sleeping on any OTHER path is not a harmless stray: it sits
  # in this run's process group, so launchd's per-label singleton still considers
  # the job RUNNING and skips the next fire. That is precisely the failure the
  # watchdog was added to prevent, re-created by the fix for it.
  #
  # SIGKILL, not SIGTERM, and it is not brutality: the watchdog holds `trap '' TERM`
  # so it can outlive the group-TERM it sends, which also makes it deaf to a polite
  # request from here. `:-` because the EXIT trap is installed BEFORE the watchdog is
  # armed and must survive the exit-127 paths, where this variable does not exist yet.
  #
  # KILL THE SUBSHELL *AND ITS `sleep`*, because killing the subshell alone does not
  # stop it. `sleep` is a separate child process, so a bare `kill $WATCHDOG_PID`
  # reaps the subshell and leaves the timer orphaned to init — and that orphan is
  # not inert. It stays in this run's process group (so launchd's per-label
  # singleton still counts the job as RUNNING and skips the next fire) and it still
  # holds the inherited write end of the log pipe (so `tee` never sees EOF and never
  # exits, keeping yet another group member alive). Observed exactly that way: a
  # HEALTHY run reported "complete", then sat there with a stray `sleep`, a live
  # `tee`, and a held job slot — the very failure this watchdog was added to end,
  # re-created by the watchdog itself.
  #
  # Children are enumerated BEFORE the parent dies, while `pgrep -P` can still see
  # them; once orphaned they reparent to init and that link is gone. The `pgrep`/
  # `kill` pair is still a race — the subshell can fork its next timer between the
  # two lines, and in the ARMING window it may not have forked one at all yet — but
  # it is now a BOUNDED one: the watchdog sleeps in poll-length increments, so the
  # worst a lost child costs is one poll interval of stray `sleep`, not the whole
  # 2700s ceiling it used to cost (a 45-minute held job slot).
  #
  # NOT ON THE TIMEOUT PATH, and this exclusion is the whole point of the watchdog's
  # second half. If the shell reacts to the group TERM it arrives here within
  # milliseconds and would SIGKILL the watchdog long before the grace expires — so
  # the SIGKILL escalation could never fire in the one case it exists for, and any
  # group member that IGNORED the TERM would survive the timeout. Reproduced exactly
  # that way: a TERM-deaf grandchild lived on in the run's process group, and because
  # it held the inherited write end of the log pipe, `tee` never saw EOF and stayed
  # alive too — both still holding launchd's per-label slot. On this path the
  # heartbeat below is already on disk by the time the shell leaves, so letting the
  # watchdog finish its own grace and group-SIGKILL costs nothing and reaps the deaf
  # descendant, `tee` and the watchdog's own timer in one signal.
  #
  # GATED ON THE FLAG, NOT ON `HEARTBEAT_STATUS -ne 124`: a step is free to exit 124
  # on its own terms, and treating that as a timeout would leave a live watchdog
  # sleeping out its full ceiling over an already-dead run — holding the slot for
  # exactly as long as the hang would have.
  if [[ -n "${WATCHDOG_PID:-}" && "$TIMED_OUT" != "true" ]]; then
    WATCHDOG_KIDS="$(pgrep -P "$WATCHDOG_PID" 2>/dev/null | tr '\n' ' ')"
    kill -KILL "$WATCHDOG_PID" 2>/dev/null || true
    # Unquoted ON PURPOSE: this is a space-separated PID list that must word-split,
    # and it is empty on the ordinary path where the subshell had no live child.
    # shellcheck disable=SC2086
    [[ -n "$WATCHDOG_KIDS" ]] && kill -KILL $WATCHDOG_KIDS 2>/dev/null
  fi
  true
  [[ -d "$DATA_DIR" ]] || return 0
  HEARTBEAT_FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)" || HEARTBEAT_FINISHED_AT="$STARTED_AT"
  # A run stamps itself as the last in-window run only if it was in the window AND
  # actually landed the day's marks. IN-WINDOW ALONE IS NOT ENOUGH, and the gap is
  # not hypothetical: a provider outage makes all six fires die at `prices-fetch`,
  # each one in-window with zero marks. Stamping those records the outage as proof
  # the day was covered — and the next morning's successful login run then carries
  # that stamp forward while overwriting the red exit code with 0, so the failure
  # disappears from every trigger at once. That is the same shape as the bug this
  # field was added to fix, just entered from the other side.
  #
  # Anything else re-emits what it carried, so a genuine earlier evening survives an
  # arbitrary number of later failures. The field is OMITTED rather than written
  # empty when there is nothing to carry: the reader validates it as an ISO instant
  # and treats a bad one as an unreadable FILE, so `""` here would blind the whole
  # breadcrumb.
  HEARTBEAT_MARK_WINDOW_AT="$CARRIED_MARK_WINDOW_AT"
  if [[ "$MARK_WINDOW" == "true" ]]; then
    for landed_step in $MARKS_LANDED_STEPS; do
      if [[ "$LAST_STEP" == "$landed_step" ]]; then
        HEARTBEAT_MARK_WINDOW_AT="$HEARTBEAT_FINISHED_AT"
        break
      fi
    done
  fi
  # DECORATE ONCE, HERE, AFTER THE PREDICATE ABOVE HAS ALREADY RUN. "timeout:backfill"
  # is the whole diagnosis in one field and is worth keeping — but it is a LABEL, not
  # a step name, and the loop above compares step names. Building it at print time is
  # what lets both be true at once: the predicate sees `backfill` and stamps the day
  # it really landed, the reader sees `timeout:backfill` and knows what killed it.
  HEARTBEAT_LAST_STEP="$LAST_STEP"
  if [[ "$TIMED_OUT" == "true" ]]; then
    HEARTBEAT_LAST_STEP="timeout:$LAST_STEP"
  fi
  if [[ -n "$HEARTBEAT_MARK_WINDOW_AT" ]]; then
    printf '{\n  "schemaVersion": 2,\n  "startedAt": "%s",\n  "finishedAt": "%s",\n  "exitCode": %d,\n  "lastStep": "%s",\n  "markWindow": %s,\n  "lastMarkWindowFinishedAt": "%s"\n}\n' \
      "$STARTED_AT" "$HEARTBEAT_FINISHED_AT" "$HEARTBEAT_STATUS" "$HEARTBEAT_LAST_STEP" \
      "$MARK_WINDOW" "$HEARTBEAT_MARK_WINDOW_AT" \
      > "$HEARTBEAT_FILE" 2>/dev/null || true
  else
    printf '{\n  "schemaVersion": 2,\n  "startedAt": "%s",\n  "finishedAt": "%s",\n  "exitCode": %d,\n  "lastStep": "%s",\n  "markWindow": %s\n}\n' \
      "$STARTED_AT" "$HEARTBEAT_FINISHED_AT" "$HEARTBEAT_STATUS" "$HEARTBEAT_LAST_STEP" "$MARK_WINDOW" \
      > "$HEARTBEAT_FILE" 2>/dev/null || true
  fi
  # --- and the OPERATOR NOTICE, on a non-zero exit only (#376) --------------
  # THE FALSE ALL-CLEAR THIS CLOSES. Since #376 took the job half off step 5b, the notice is
  # a pure data channel: a 23:00 fire whose data really is clean writes an EMPTY notice at
  # 23:04, then wedges at `backfill` at 23:49. The 08:00 terminal prints nothing at all, and
  # step 0 does not speak until 18:00 — nineteen hours of an all-clear standing over a run
  # that is known to have failed, on the channel built because a lost day reached no one.
  # The heartbeat above already holds the whole diagnosis by then; it is simply not the file
  # the operator's shell prints.
  #
  # ON A ZERO EXIT THIS TOUCHES THE FILE NOT AT ALL. Not a truncate, not a `:>`, nothing —
  # the same restraint as step 0's clean branch and for the same reason: step 5b has already
  # written the truth about this run's data, and clearing it here would delete a real
  # lost-day enumeration minutes after the only writer that could produce it.
  #
  # `$HEARTBEAT_LAST_STEP`, NOT `$LAST_STEP` — the DECORATED name the breadcrumb just
  # recorded. `timeout:backfill` is the whole diagnosis in one field, and the notice and the
  # heartbeat naming one failure two different ways is the same vocabulary split this
  # channel's shared writer exists to prevent.
  #
  # THE TRADE, INHERITED AND RESTATED SO IT IS NOT REDISCOVERED: on a run that dies AFTER
  # 5b, this `>` discards the lost-day enumeration 5b wrote minutes ago. That content is not
  # stale — but from here it is unmaintainable text of unknown vintage, exactly as step 0's
  # `>` comment above already ruled, and a bounded currently-true message beats a preserved
  # one nothing can retire. What changes is only WHEN the same content is discarded: here,
  # at the moment of failure, instead of at the next fire up to nineteen hours later. Same
  # loss, operator informed a day sooner. Appending under 5b's lines is rejected for the
  # reason that comment gives at length.
  #
  # Guarded like everything else in this trap, and reached only under the `[[ -d "$DATA_DIR"
  # ]]` return above: a failure here must never replace the exit code the trap exists to
  # record, and this runs on every exit path including both `exit 127`s, where
  # `write_operator_failure_notice` is reachable because it is defined beside
  # `$OPERATOR_NOTICE_FILE` far above either of them.
  if [[ "$HEARTBEAT_STATUS" -ne 0 ]]; then
    write_operator_failure_notice "$HEARTBEAT_STATUS" "$HEARTBEAT_LAST_STEP" "the next run" || true
  fi
  return 0
}
# Installed BEFORE the log dir is even made, so every exit path below is covered —
# including the two `exit 127`s, which happen before anything node-shaped exists.
trap write_heartbeat EXIT
# ----------------------------------------------------------------------------

mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/price-feed-$STAMP.log"
# The watchdog's calling card. It is touched by the watchdog immediately BEFORE it
# signals the group, and it is the only way the TERM handler can tell the watchdog's
# signal from anybody else's — `launchctl stop`/`unload` (the documented reinstall
# step), a logout, or a shutdown all deliver the same bare SIGTERM. Per-run name, so
# it can never be a stale flag from an earlier run.
WATCHDOG_FIRED_FILE="$LOG_FILE.watchdog-fired"

# Everything from here is tee'd to the per-run log AND the scheduler's stdout.
#
# THE `trap '' TERM PIPE` INSIDE THE SUBSTITUTION IS NOT DECORATION — it is what
# makes the watchdog's teardown survivable. This `tee` is an ordinary member of the
# run's process group, so the watchdog's group-TERM would otherwise kill it FIRST,
# leaving the shell writing into a dead pipe while it tries to run its EXIT trap.
# Measured, not feared: with `tee` killable, the heartbeat was lost on 3 of 5
# timeout runs (the shell died of SIGPIPE partway through `exit`, before the trap
# body was even entered) — losing the one breadcrumb the whole watchdog exists to
# leave. Deaf to TERM, `tee` outlives the group signal, the pipe stays open through
# teardown, and it then exits on its own when the shell closes the pipe at exit.
# PIPE is ignored for the same defensive reason on its far side.
#
# The SIGKILL escalation still takes it, which is correct: that path is the hard
# stop for a run that ignored TERM, and by then there is no orderly teardown left
# to protect.
exec > >(trap '' TERM PIPE; tee -a "$LOG_FILE") 2>&1

echo "[$STAMP] price-feed daily run starting (repo=$REPO_DIR)"

# --- the mark window, classified (#185 S2 / #315) ---------------------------
# DELIBERATELY HERE, AFTER THE EXIT TRAP AND THE LOG — AND STILL BEFORE ANY WORK.
# These two guards are the newest way for EVERY scheduled fire to die: a typo'd
# `NUMISMA_MARK_TZ` in the plist, or tzdata moving out from under the DEFAULT path,
# refuses all six fires of an evening. Run before the trap was installed, they would
# have refused them on the one channel that reaches nobody — no per-run log, no
# heartbeat, `job-heartbeat.json` still describing the last good run, and the TUI
# reading "healthy" for days. That is the same silent rot this block exists to
# prevent, re-entered through the guard for it, and this file's own argument at the
# `git commit` step (a launchd job's stdout reaches no one) says so explicitly.
#
# Placed after the log and trap, a refusal is now a FATAL line in the per-run log and
# a breadcrumb reading `exit 1 at step 'startup'`, with `markWindow: false` and the
# carried stamp re-emitted untouched — it invents no coverage and erases none. Still
# before the watchdog is armed, before the token file is sourced, before `cd` and
# before any `pnpm`, so the refusal remains a refusal: nothing with an effect runs
# on a run that cannot say which side of the window it is on.

# REFUSE AN UNRESOLVABLE ZONE, BEFORE ANY OF IT IS USED. Bash does not fail on a bad
# TZ the way `Intl` does: `TZ=Not/AZone date +%H` prints the UTC hour, with no error
# and a zero exit. UTC is DISJOINT from the CDMX evening window (12:00-17:59 CDMX vs
# the 18:00-23:59 fires), so one typo flips the window wrong on EVERY run while the
# runs themselves keep marking correctly — the silent rot this whole block exists to
# prevent, entered through the override that was just added. Falling back to UTC (or
# to local) would be the same bug with a friendlier name, so this exits instead.
# The shape check comes first so the path built below cannot be anything but a zone
# name. `TZDIR` is honoured because that is what the C library itself consults.
if [[ ! "$MARK_TZ" =~ ^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$ ]] ||
  [[ ! -f "${TZDIR:-/usr/share/zoneinfo}/$MARK_TZ" ]]; then
  echo "[$STAMP] FATAL: mark timezone '$MARK_TZ' is not a resolvable IANA zone."
  echo "[$STAMP] No entry under ${TZDIR:-/usr/share/zoneinfo}. Bash would silently report the UTC"
  echo "[$STAMP] hour for it, which is disjoint from the mark window, so every run would classify"
  echo "[$STAMP] itself out-of-window while marking fine. Refusing rather than degrading."
  echo "[$STAMP] Set NUMISMA_MARK_TZ to a real zone name, or leave it unset for the contract default."
  exit 1
fi
# And refuse a mark hour that is not one. Left unchecked it would not abort either —
# the comparison below is an `if` condition, so `set -e` never fires — it would just
# classify every run as out-of-window, exactly like the bad zone.
if [[ ! "$MARK_HOUR" =~ ^(0?[0-9]|1[0-9]|2[0-3])$ ]]; then
  echo "[$STAMP] FATAL: mark hour '$MARK_HOUR' is not an hour of the day (0-23)."
  echo "[$STAMP] Set NUMISMA_MARK_HOUR to a plain hour, or leave it unset for the contract default."
  exit 1
fi

# Read once into a named variable so the comparison below is a self-contained
# expression over two hour-shaped strings — which is what lets a test drive the
# wrapper's OWN line with `08`/`09` and prove the base-10 forcing still holds.
MARK_NOW_HOUR="$(TZ="$MARK_TZ" date +%H)"
if [[ $((10#$MARK_NOW_HOUR)) -ge $((10#$MARK_HOUR)) ]]; then
  MARK_WINDOW=true
else
  MARK_WINDOW=false
fi
# ----------------------------------------------------------------------------

# --- the watchdog (#308 follow-up) ------------------------------------------
# A WEDGED RUN IS A WORSE FAILURE THAN A RED ONE, and until 2026-08-11 nothing here
# bounded it. That evening the 22:01 run reached step 6, opened a pool against Neon,
# upserted 11 of 43 anchors, and the laptop slept. The TCP connection died silently
# and node-postgres had no client-side deadline, so the query never settled. The run
# was still sitting there twenty hours later.
#
# THE COST IS NOT THE LOST RUN, IT IS EVERY RUN AFTER IT. Three separate mechanisms
# in this file assume a run ENDS:
#   - the EXIT trap never fires, so job-heartbeat.json still describes the PREVIOUS
#     run and reads perfectly healthy — the staleness channel goes quiet exactly
#     when it is needed;
#   - launchd is a per-label singleton (see this file's header, which relies on that
#     fact to justify having no lock), so the wedged process HOLDS THE JOB SLOT and
#     every remaining fire in the 18:00-23:00 window is skipped;
#   - and per the plist header, once the CDMX date rolls `isFreshBar` refuses
#     yesterday's bar, so each skipped evening is unrecoverable.
# One dead socket therefore costs an unbounded run of days, with no signal at all.
#
# The pool now gives up on its own (apps/web/src/push/projection-pool.ts), which
# covers the observed cause. THIS COVERS THE CATEGORY: any step that can block
# forever — a provider socket, a git credential prompt, an NFS stall — is bounded
# here without this file having to enumerate them.
#
# WHY THE CEILING IS 2700s. It has to beat the next fire, not the end of the window:
# the point is that launchd's slot is free at the top of the next hour, so the
# schedule's own hourly retry still works. Fires are 3600s apart, a healthy run
# takes ~15 minutes, and 2700 + 30s grace leaves ~14 minutes of margin.
# apps/price-feed/src/schedule-window.test.ts pins this against the plist's actual
# interval, so shortening the interval without shortening this fails a test.
#
# WHY A HAND-ROLLED WATCHDOG. macOS ships no `timeout(1)` (that is GNU coreutils),
# and this file's whole design principle is to depend on nothing that could itself
# be the missing thing. A subshell and `sleep` are always there.
#
# THE SELF-TERM IS THE SUBTLE PART. The watchdog signals the PROCESS GROUP, because
# the thing to kill is usually not this script — it is the node process three levels
# down holding the dead socket, and TERMing only the parent would orphan it and
# leave the slot held. But the watchdog is itself in that group, so it would kill
# itself before it could escalate to SIGKILL; `trap '' TERM` makes it immune to the
# signal it sends. The parent must therefore use SIGKILL to cancel it (below).
#
# GROUP-KILL ONLY WHEN WE ARE THE GROUP LEADER. Under launchd this script is its own
# process group leader, which is what makes `kill -- -$$` safe. Run some other way
# (sourced, or without job control) it may share its parent's group, and signalling
# that group would kill the caller's whole session. In that case the watchdog is
# DISABLED AND SAYS SO, rather than silently becoming a hazard: the unattended path
# is the one that needs it, and that path always qualifies.
RUN_PGID="$(ps -o pgid= -p $$ 2>/dev/null | tr -d '[:space:]')" || RUN_PGID=""
WATCHDOG_PID=""

# Turn a SIGTERM into an ordinary `exit`, so the EXIT trap still runs and the
# heartbeat records what happened instead of the run dying by signal with no
# breadcrumb at all. 124 is the exit code GNU `timeout` uses, borrowed so the number
# means something to a reader; the step that hung is named by the `timeout:` label
# the heartbeat writer builds from `TIMED_OUT`.
#
# IT ASKS WHO SENT THE SIGNAL, because this handler is installed unconditionally and
# a bare SIGTERM has more than one sender. `launchctl stop`, `launchctl unload` (the
# documented reinstall step in docs/launchagent-reinstall.md), a logout and a system
# shutdown all land here, and labelling those a timeout is a lie with a cost: the
# next TUI startup reports "FAILED — exit 124 at step 'timeout:prices-fetch'" for a
# run that was stopped by hand four minutes in with 2400s of ceiling left. This
# breadcrumb is the only channel that reaches a human, so a spurious FAILED line
# spends exactly the credibility it exists to hold. The watchdog leaves its calling
# card before it signals; anything without that card is an EXTERNAL stop and is
# recorded as one — plain step name, exit 143 (128+SIGTERM), which reads as "someone
# stopped this" rather than "this hung".
#
# THE HEARTBEAT IS STILL WRITTEN ON THAT PATH, unlike before the watchdog existed
# (where the shell died by signal and the EXIT trap never ran). That is deliberate:
# a run TERMed at shutdown AFTER `spine` really did land the day's marks, and only a
# heartbeat can say so. Going silent there would leave the next morning claiming
# nothing was recorded for a day the log plainly holds.
#
# `trap '' PIPE` FIRST, AND IT IS LOAD-BEARING. Stdout here is a pipe into the `tee`
# that writes the per-run log, and that `tee` is in the process group the watchdog
# signals — so by the time this handler runs, the far end of our own stdout is
# usually already dead. Without this, the next write earns SIGPIPE and the shell
# dies by signal 13 with the EXIT trap half-run, losing the heartbeat: the run
# vanishes exactly as silently as the hang it was killed for. Observed directly —
# two identical runs during development exited 124 and -13 respectively, on nothing
# but timing. Ignoring PIPE turns that write into a harmless EPIPE.
#
# Ignoring PIPE here is the SECOND half of a two-part fix and does not stand alone:
# the first half is the `trap '' TERM` inside the logging `tee` above, which is what
# actually keeps this shell's stdout alive through teardown. With `tee` killable,
# ignoring PIPE was measurably not enough — the shell still died partway through
# `exit`, before this trap's body ran, on 3 of 5 timeout runs. Keep both; this one
# costs nothing and covers any writer the group signal reaches first.
trap 'trap "" PIPE; if [[ -e "$WATCHDOG_FIRED_FILE" ]]; then TIMED_OUT=true; exit 124; fi; exit 143' TERM

if [[ "$MAX_RUN_SECONDS" -le 0 ]]; then
  echo "[$STAMP] watchdog DISABLED (NUMISMA_PRICEFEED_MAX_RUN_SECONDS=$MAX_RUN_SECONDS)"
elif [[ -z "$RUN_PGID" || "$RUN_PGID" != "$$" ]]; then
  echo "[$STAMP] watchdog DISABLED (not a process-group leader: pgid=${RUN_PGID:-unknown} pid=$$)"
else
  # HOW LONG A SINGLE `sleep` MAY BE, which is the same question as "how long can a
  # stray timer outlive the run". The parent cancels this watchdog by SIGKILLing the
  # subshell and whatever `pgrep -P` could see at that instant, and that pair is
  # inherently racy — the subshell can fork its next timer in between, and during the
  # ARMING window (between `$!` and the first fork) there is no child to find at all.
  # With one 2700s `sleep` that race orphaned a 45-MINUTE timer into the run's
  # process group, holding launchd's per-label slot through the next fire — the exact
  # failure the watchdog exists to prevent. Waiting in short hops does not close the
  # race, it makes losing it cheap: the stray exits within one hop. Clamped so a small
  # ceiling (manual debugging, tests) is still honoured rather than rounded up.
  WATCHDOG_POLL_SECONDS=5
  if [[ "$MAX_RUN_SECONDS" -lt "$WATCHDOG_POLL_SECONDS" ]]; then
    WATCHDOG_POLL_SECONDS="$MAX_RUN_SECONDS"
  fi
  (
    # TERM so it survives the group signal it is about to send (see above); PIPE so
    # its own progress lines cannot kill it. The second one is not cosmetic: these
    # echoes go to the same `tee` the group-TERM just killed, so without it the
    # watchdog dies of SIGPIPE on the "escalating" line and THE SIGKILL IS NEVER
    # SENT — the escalation path would be dead in precisely the case that needs it,
    # a child that ignored TERM.
    trap '' TERM PIPE
    # `SECONDS` is wall-clock since this assignment, so the ceiling stays honest no
    # matter how the hops round: the loop overshoots by less than one hop, never
    # accumulating drift the way counting iterations would.
    SECONDS=0
    while [[ $SECONDS -lt $MAX_RUN_SECONDS ]]; do
      sleep "$WATCHDOG_POLL_SECONDS"
    done
    echo "[$STAMP] WATCHDOG: run exceeded ${MAX_RUN_SECONDS}s — terminating process group $RUN_PGID"
    # Leave the calling card BEFORE the signal, so the TERM handler can tell this
    # signal from an operator's or the system's and does not report a `launchctl
    # unload` as a timeout. Guarded: a failure to write it costs a mislabel, never
    # the kill itself.
    : > "$WATCHDOG_FIRED_FILE" 2>/dev/null || true
    kill -TERM -- "-$RUN_PGID" 2>/dev/null || true
    sleep "$WATCHDOG_GRACE_SECONDS"
    echo "[$STAMP] WATCHDOG: escalating to SIGKILL after ${WATCHDOG_GRACE_SECONDS}s grace"
    kill -KILL -- "-$RUN_PGID" 2>/dev/null || true
  ) &
  WATCHDOG_PID=$!
  echo "[$STAMP] watchdog armed: ${MAX_RUN_SECONDS}s ceiling (pid $WATCHDOG_PID, pgid $RUN_PGID)"
fi
# ----------------------------------------------------------------------------

# Load provider tokens from the private file if it exists. Nothing secret lives in
# the repo (transaction-data-is-private); the file is machine-local, chmod 600.
if [[ -f "$ENV_FILE" ]]; then
  echo "[$STAMP] sourcing provider tokens from $ENV_FILE"
  set -a
  # ON ITS OWN LINE, because a `shellcheck disable` directive applies to the NEXT
  # COMMAND — and while these three shared one line it attached to `set -a`, leaving
  # the `source` it was written for still reported. The file did not pass shellcheck
  # at all until this moved; the suppression is unchanged, only aimed correctly.
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
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
#    (events.jsonl, genesis.json, preferences.jsonl, orders.jsonl, plans.jsonl) are NEVER
#    ignored — the accumulus allowlist names each one — so also add them
#    explicitly. head-digest.json is deliberately NOT added here — it may be intentionally ignored, and `git add` of an ignored
#    path aborts under `set -e`. Each explicit add is guarded on file existence so a
#    missing optional file doesn't trip `set -e`.
LAST_STEP="commit"
if ! git -C "$DATA_DIR" rev-parse --git-dir >/dev/null 2>&1; then
  echo "[$STAMP] WARNING: $DATA_DIR is not inside a git repo — skipping commit (durable log left uncommitted)."
else
  git -C "$DATA_DIR" add -u -- .
  for f in events.jsonl genesis.json preferences.jsonl orders.jsonl plans.jsonl; do
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
  # orders.jsonl and plans.jsonl belong in THIS (strict, no --ignored) arm: they are
  # TRACKED durable files per the accumulus allowlist, not only-ignored breadcrumbs
  # like head-digest.json. Naming them here is only honest because the allowlist landed
  # first — over an ignored path this arm would report clean while git discards it.
  LOG_DIRTY="$(git -C "$DATA_DIR" status --porcelain -- events.jsonl genesis.json preferences.jsonl orders.jsonl plans.jsonl)"
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

# Steps 5, 5b and 6 are the DERIVED surfaces, and they run in this order for a reason
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
#    strict arm runs `git status --porcelain` WITHOUT `--ignored` over the FIVE
#    durable files it names, so the sidecar is invisible to it either way. (Five,
#    not six: the allowlist versions six files, but head-digest.json is handled
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

# 5b) Rewrite operator-notice.txt beside gap-report.json — THE DELIVERY HALF.
#
#     NUMBERED 5b RATHER THAN 6 ON PURPOSE: this is the same derived-surface step
#     as 5, on the same local-first side of the boundary above, and the run's step
#     numbers are quoted by name in docs/price-feed-ops.md, launchagent-reinstall.md
#     and the plist. Renumbering `backfill` to 7 would silently rot four documents
#     to save one letter.
#
#     WHY THE NOTICE WRITES HERE. Step 5 fixed the standup's file; it did not fix
#     ARRIVAL. Every surface this repo has is PULL-ONLY — the TUI banner derives the
#     lost days live and correctly and says so only to someone who opens the TUI, the
#     dashboard only to someone who opens the dashboard, gap-report.json only to
#     someone who opens the file. On 2026-08-14/15 all three were right the whole
#     time and nobody looked for three days, at the machine. This step writes the
#     DATA findings into one well-known file the shell profile cats, so the next new
#     terminal is where the loss arrives. No new derivation: it composes primitives
#     `pnpm gap-report` already uses.
#
#     IT SAYS NOTHING ABOUT THE JOB, AND THAT IS #376's RULING. The notice composed
#     the heartbeat lines here until then, and this is the one moment they are
#     guaranteed to be misread: the EXIT trap is EXIT-ONLY, so at 5b the breadcrumb
#     still holds the PREVIOUS run's bytes — exactly what step 0 read at the top of
#     this same run. Not staler, identically sourced and DIFFERENTLY SCOPED: step 0
#     says the PREVIOUS run failed, `formatHeartbeatWarning` says "the daily price
#     job FAILED", present tense, about the job. On a recovery run — the previous
#     run died at `prices-fetch`, this run is landing the missed days right now —
#     the file is right and the sentence is wrong, and the run writing it is the run
#     that just fixed it. So the channels split by LANGUAGE: this notice is the DATA
#     half, and the job half is bash — two writers of this same file, reaching the two
#     paths this step never sees at all. The PRIMARY one is the EXIT trap, which calls
#     `write_operator_failure_notice` from inside the failing run and is therefore
#     scoped to THIS run at the moment it dies. Step 0 is the BACKSTOP: it reads the
#     previous run's breadcrumb, so it is deliberately scoped to the PREVIOUS run, and
#     what it covers alone is a death with no trap at all — SIGKILL, OOM, power loss —
#     plus a run that dies before the trap is installed. Step 0's own block above says
#     this in the same words. The TUI banner keeps all three heartbeat triggers; it
#     is a live PULL surface, read at the moment the operator looks. Writing an in-progress
#     heartbeat before this line instead was refused on `write_heartbeat`'s own cost:
#     its first act after capturing $? is a SIGKILL of the watchdog and a reap of its
#     sleep, so an early write would leave this step AND `backfill`, the longest one,
#     with no timeout at all.
#
#     AFTER step 5, and that placement is the whole reliability argument. By here the
#     toolchain has been resolved (step 1), the fetch, the ingest and the commit have
#     run, step 4 has verified the durable log landed clean, and step 5 has just
#     re-derived the report from that verified log. A notice written earlier would be
#     a notice written by a run that had not yet proven it could do anything.
#
#     IT REPLACES THE FILE WHOLESALE — never appends, never merges, and there is no
#     dismissal state anywhere in the design. A later step 0 writes this SAME file in
#     bash before `resolve-tools`, reporting the PREVIOUS run's failure; reaching this
#     line means steps 1-4 of THIS run were clean, so that report is stale news and
#     overwriting it is the correct outcome rather than a lost message. A clean window
#     truncates the file to EMPTY, which is how the channel self-clears: `cat` of an
#     empty file prints nothing, so a healthy machine has a silent shell.
#
#     IT CANNOT FAIL THE RUN. The command exits 0 unconditionally (see its header) —
#     under `set -e` a notice writer that went red would abort the run before
#     `backfill`, which is a delivery channel taking down the pipeline it reports on.
#     A derivation that breaks is written INTO the notice as a line rather than
#     swallowed; only a disk failure is left, and that goes to this log.
#
#     ZERO-ARGUMENT and no environment of its own: it resolves the same data dir as
#     step 5 through ADR-006's one rule, so the notice cannot land in a different
#     directory from the report it agrees with. Like gap-report.json it falls through
#     accumulus's allowlist .gitignore to /data/* (ignored, untracked) and is invisible
#     to step 4's strict arm, which names five durable files and does not pass
#     `--ignored`.
LAST_STEP="operator-notice"
pnpm operator-notice

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
