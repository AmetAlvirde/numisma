import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MARK_HOUR, TRADING_DAY_TIME_ZONE, instrumentsForSource } from "@numisma/engine";
import { DEFAULT_CONFIG } from "./config.js";
import { caseEnv, makeCaseDir, type CaseDirs, type CaseOptions } from "./wrapper-harness/case-dir.testkit.js";
import { assertIsolated } from "./wrapper-harness/isolation.testkit.js";
import { CONTRACT_MARK_CONFIG } from "./wrapper-harness/mark-window.testkit.js";
import { WRAPPER_PNPM_COMMANDS, sentinelNameFor } from "./wrapper-harness/fake-bin.testkit.js";

/**
 * The launchd schedule template is CONFIG, not code, so most of what could be
 * asserted about it would only restate its own bytes ("the file says Hour 18, so
 * assert Hour 18") and would fail for no reason other than someone editing it on
 * purpose. This file deliberately asserts only the properties that have an
 * ORACLE SOMEWHERE ELSE — the ones a future edit to the plist, to `DEFAULT_CONFIG`,
 * to the wrapper, or to the instrument registry could silently falsify.
 *
 * `RunAtLoad` is deliberately NOT asserted: it is a belt-and-braces half with no
 * second source of truth, so a test for it would only echo the file. Its real
 * consequences are tested where they land — in the heartbeat reader
 * (`packages/event-store/src/heartbeat.test.ts`), because a run at an arbitrary
 * hour is a thing the READER has to get right.
 */

const REPO_ROOT = new URL("../../../", import.meta.url);
const PLIST_PATH = fileURLToPath(
  new URL("ops/price-feed/com.numisma.pricefeed.daily.plist", REPO_ROOT),
);
const WRAPPER_PATH = fileURLToPath(new URL("ops/price-feed/run-daily-fetch.sh", REPO_ROOT));

/** Twelve Data Basic (free): 8 credits/minute, 800/day. A batched `time_series` costs 1 credit per symbol. */
const TWELVE_DATA_DAILY_CREDIT_CAP = 800;

/** `plutil` is macOS-only. Only the lint needs it — everything else reads the XML directly. */
const onMac = process.platform === "darwin";

/**
 * ONE `StartCalendarInterval` ENTRY — AND THE WILDCARD THAT MAKES COUNTING THEM
 * DANGEROUS. From `man 5 launchd.plist`: *"Missing arguments are considered to be
 * wildcard."* So a dict carrying `Hour` and no `Minute` does not fire once an hour,
 * it fires SIXTY times — and deleting one `<key>Minute</key>` line is a plausible
 * edit that turns 6 fires/day into 360.
 */
interface CalendarInterval {
  Hour?: number;
  Minute?: number;
}

/**
 * A deliberately small plist reader, because the useful assertions must run on CI
 * (ubuntu) where `plutil` does not exist.
 *
 * It understands exactly the shape this ONE template uses — integer-valued keys in
 * a dict, or an array of such dicts — and THROWS rather than returning empty if it
 * cannot find what it is looking for. Failing closed matters: a silent `[]` would
 * make the interval-count and credit assertions vacuously pass on a file this
 * parser could not read. General plist well-formedness is `plutil -lint`'s job
 * below; on macOS the two are cross-checked against each other.
 */
function parseIntervals(): CalendarInterval[] {
  // Comments first: the header discusses hours in prose, and none of that is data.
  const xml = readFileSync(PLIST_PATH, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const keyIndex = xml.indexOf("<key>StartCalendarInterval</key>");
  if (keyIndex === -1) {
    throw new Error("no StartCalendarInterval in the plist — the job has no schedule at all");
  }
  const rest = xml.slice(keyIndex + "<key>StartCalendarInterval</key>".length);
  const openArray = rest.indexOf("<array>");
  const openDict = rest.indexOf("<dict>");
  if (openDict === -1 && openArray === -1) {
    throw new Error("StartCalendarInterval has neither a <dict> nor an <array> value");
  }
  // An array of dicts, or a single bare dict — launchd accepts both.
  const isArray = openArray !== -1 && (openDict === -1 || openArray < openDict);
  const body = isArray ? rest.slice(openArray, rest.indexOf("</array>")) : rest.slice(openDict);
  const blocks = isArray
    ? [...body.matchAll(/<dict>([\s\S]*?)<\/dict>/g)].map((m) => m[1] ?? "")
    : [body.slice(0, body.indexOf("</dict>"))];
  if (blocks.length === 0) {
    throw new Error("StartCalendarInterval is an empty array — the job has no schedule at all");
  }
  return blocks.map((block) => {
    const interval: CalendarInterval = {};
    for (const [, key, value] of block.matchAll(
      /<key>(\w+)<\/key>\s*<integer>(-?\d+)<\/integer>/g,
    )) {
      if (key === "Hour" || key === "Minute") {
        interval[key] = Number(value);
      }
    }
    return interval;
  });
}

/**
 * How many times the job actually fires per day — wildcards EXPANDED, not counted
 * as one. This is the number the credit budget has to be measured against; counting
 * dicts instead is what let a missing `Minute` slip past an assertion whose whole
 * purpose is to catch a quota breach.
 */
function firesPerDay(intervals: CalendarInterval[]): number {
  return intervals.reduce((total, { Hour, Minute }) => {
    const hours = Hour === undefined ? 24 : 1;
    const minutes = Minute === undefined ? 60 : 1;
    return total + hours * minutes;
  }, 0);
}

/** A short ceiling and grace: these runs refuse before the watchdog is ever armed. */
const REFUSAL_CASE_OPTIONS: CaseOptions = {
  maxRunSeconds: 5,
  watchdogGraceSeconds: 1,
  mark: CONTRACT_MARK_CONFIG,
};

/**
 * A hard cap on the blocking call. `spawnSync` cannot be preempted by a vitest timer, so
 * without this a run that ever blocked — a credential prompt, a stalled socket — would
 * WEDGE THE WORKER rather than fail. Expiry is a named failure below, never a pass.
 */
const REFUSAL_RUN_TIMEOUT_MS = 60_000;

/**
 * Run the real wrapper under the real `/bin/bash`, for the config-refusal paths ONLY.
 *
 * SAFE BECAUSE THE REAL DEFAULTS ARE STRUCTURALLY UNREACHABLE, NOT BECAUSE THE CALLERS
 * ARE CAREFUL. There is no `...process.env` here: the environment is built fresh by
 * {@link caseEnv}, every one of the nine `NUMISMA_*` overrides points inside a per-run
 * temp dir, and {@link assertIsolated} refuses the launch otherwise — the same contract
 * the wrapper harness's launcher enforces, imported rather than re-stated. That matters
 * for a reason a docstring cannot cover: with `NUMISMA_PRICEFEED_ENV` inherited the
 * wrapper would `source` the operator's real chmod-600 token file under `set -a`, and
 * with `NUMISMA_PATH_PREPEND` inherited it would resolve the REAL `pnpm` and `node`. A
 * guard that is only offered can be walked past by any later edit that moves it; a
 * refusal taken before the spawn cannot.
 *
 * The fake bin the case dir installs is the second layer: if a refusal ever stopped
 * refusing, the run would reach a fake `pnpm` that writes a sentinel — which the callers
 * assert is absent — rather than a real one.
 *
 * `/bin/bash` explicitly, never the shebang's `env bash`: launchd runs 3.2.57, and a
 * Homebrew bash 5 would silently accept shapes 3.2 rejects.
 */
function runWrapper(overrides: Record<string, string>): {
  status: number | null;
  output: string;
  dirs: CaseDirs;
} {
  const dirs = makeCaseDir(REFUSAL_CASE_OPTIONS);
  const env = { ...caseEnv(dirs, REFUSAL_CASE_OPTIONS), ...overrides };
  assertIsolated(env, dirs.caseDir);

  const result = spawnSync("/bin/bash", [WRAPPER_PATH], {
    encoding: "utf8",
    env,
    cwd: dirs.caseDir,
    timeout: REFUSAL_RUN_TIMEOUT_MS,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  // A timeout kill arrives as a SIGNAL with a null status, which is indistinguishable
  // from a real refusal if only `status` is read. Name it: a wrapper that hung on a
  // path whose whole claim is that it exits immediately is a failure of this test.
  if (result.signal !== null) {
    throw new Error(
      `the wrapper was killed by ${result.signal} rather than exiting — it did not refuse ` +
        `within ${REFUSAL_RUN_TIMEOUT_MS}ms. That is a failure of this case, never a pass.`,
    );
  }
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}`, dirs };
}

/** It refused before it ran anything: no fake `pnpm` was ever invoked. */
function expectReachedNoStep(dirs: CaseDirs): void {
  for (const command of WRAPPER_PNPM_COMMANDS) {
    expect(
      existsSync(join(dirs.caseDir, "sentinels", sentinelNameFor(command))),
      `the wrapper reached \`${command}\` despite refusing its own configuration`,
    ).toBe(false);
  }
}

describe("the launchd fetch window", () => {
  it.skipIf(!onMac)("is a plist launchd can actually load", () => {
    // A malformed plist is silently ignored by launchd — no error, just no job.
    expect(() => execFileSync("plutil", ["-lint", PLIST_PATH], { encoding: "utf8" })).not.toThrow();
  });

  it.skipIf(!onMac)("is read by this file's own parser the same way Apple reads it", () => {
    // Keeps the hand parser above honest wherever the real one is available, so the
    // assertions that run on CI are not testing a private misreading of the file.
    const viaPlutil = JSON.parse(
      execFileSync("plutil", ["-convert", "json", "-o", "-", PLIST_PATH], { encoding: "utf8" }),
    ).StartCalendarInterval;
    expect(parseIntervals()).toEqual(Array.isArray(viaPlutil) ? viaPlutil : [viaPlutil]);
  });

  it("pins every interval to an explicit hour AND minute, since a missing one is a wildcard", () => {
    // `man 5 launchd.plist`: "Missing arguments are considered to be wildcard."
    // Dropping a <key>Minute</key> line therefore schedules 60 fires an hour, and
    // it looks like a tidy-up. Fail on the shape, not only on the consequence.
    for (const interval of parseIntervals()) {
      expect(interval.Hour).toBeTypeOf("number");
      expect(interval.Minute).toBeTypeOf("number");
    }
  });

  it("schedules no fire before the mark time, when a run can emit no marks at all", () => {
    // Not a fatal edit — a `RunAtLoad` run lands out of window routinely and is
    // handled (the heartbeat records it as non-marking). But a SCHEDULED pre-mark
    // fire is pure waste: it spends the same 9 credits and can never mark.
    const markHour = Number(DEFAULT_CONFIG.markTime.split(":")[0]);
    for (const { Hour } of parseIntervals()) {
      expect(Hour).toBeGreaterThanOrEqual(markHour);
    }
  });

  it("schedules no fire past the CDMX day, whose rollover makes the miss permanent", () => {
    for (const { Hour } of parseIntervals()) {
      expect(Hour).toBeLessThanOrEqual(23);
    }
  });

  it("fires more than once, which is the only thing that recovers a missed evening", () => {
    // launchd DOES run a slept-through interval at the next wake, coalescing several
    // into one — but that catch-up run lands under a NEW `asOf`, and `isFreshBar`
    // refuses yesterday's bar, so it recovers nothing. Only another fire INSIDE the
    // same CDMX day can. A single interval leaves none.
    expect(parseIntervals().length).toBeGreaterThan(1);
  });

  it("cannot exceed the Twelve Data daily credit cap even if every fire marks", () => {
    // A FLOOR ON THE SPEND, NOT A TOTAL: `RunAtLoad` adds an unbudgeted 9 credits per
    // boot, login and `launchctl load`. That is what leaves headroom for — roughly 82
    // extra loads a day before this bound is reached, so the schedule is what needs
    // bounding and the loads do not.
    const twelveDataSymbols = instrumentsForSource("twelvedata").length;
    expect(firesPerDay(parseIntervals()) * twelveDataSymbols).toBeLessThanOrEqual(
      TWELVE_DATA_DAILY_CREDIT_CAP,
    );
  });

  it("keeps the wrapper's own mark hour DEFAULT equal to the contract's, with no leading zero", () => {
    // The wrapper duplicates the mark hour in bash to decide whether a run could
    // mark at all (the heartbeat's `markWindow`). It cannot import `DEFAULT_CONFIG`,
    // so this is the join: change the contract and a test fails rather than the
    // breadcrumb quietly mis-classifying every run.
    //
    // THE HOUR IS NOW OVERRIDABLE, WHICH MOVES THIS GUARD BUT DOES NOT RETIRE IT.
    // What is pinned is the DEFAULT — the `:-` half of the expansion, the value every
    // scheduled fire actually uses. Matching the whole expansion rather than a bare
    // literal is deliberate: a wrapper that dropped the `NUMISMA_MARK_HOUR` override
    // and went back to `MARK_HOUR=18` would fail here, because a caller that can no
    // longer put a run on either side of the window is a silent loss of exactly the
    // capability this line exists to provide.
    //
    // THE REGEX STILL REFUSES A LEADING ZERO ON PURPOSE. `[[ x -ge $MARK_HOUR ]]`
    // arithmetic-evaluates its right operand, and `08`/`09` are invalid octal. That
    // does not abort — it is an `if` condition, so `set -e` never fires — it silently
    // classifies EVERY run as out-of-window. `Number("08") === 8` would let a guard
    // written the obvious way sail straight past it, so the SHAPE is asserted, not
    // just the value. (The wrapper also wraps both operands in `10#`, and the sibling
    // test below drives its actual comparison line to prove it: two locks on one
    // door, because either alone is enough to be forgotten.)
    const markHour = Number(DEFAULT_CONFIG.markTime.split(":")[0]);
    // The contract's own hour derives from the engine — assert that too, so
    // re-literalising `DEFAULT_CONFIG` cannot quietly reopen the second copy this
    // increment closed.
    expect(markHour).toBe(MARK_HOUR);
    const declared = /^MARK_HOUR="\$\{NUMISMA_MARK_HOUR:-([1-9]?[0-9])\}"$/m.exec(
      readFileSync(WRAPPER_PATH, "utf8"),
    );
    expect(declared?.[1]).toBeDefined();
    expect(Number(declared?.[1])).toBe(markHour);
  });

  it("keeps the wrapper's own mark timezone DEFAULT equal to the contract's", () => {
    // The hour is meaningless without the zone. The real gate resolves the mark
    // instant through Intl in CDMX explicitly, so a wrapper reading the bare local
    // hour would agree only by coincidence of the OS setting — and the install docs
    // offer the divergent setup (CDMX-equivalent plist hours on a non-CDMX box) as
    // supported. Under that config every scheduled fire would classify itself
    // out-of-window, nothing would ever stamp, and the staleness trigger would be
    // permanently and silently dead while the runs themselves marked correctly.
    //
    // Same move as the hour above: the OVERRIDE is what lets a caller drive the
    // window, and the DEFAULT is what every scheduled fire uses, so the default is
    // what has to equal the contract.
    expect(DEFAULT_CONFIG.timeZone).toBe(TRADING_DAY_TIME_ZONE);
    const declared = /^MARK_TZ="\$\{NUMISMA_MARK_TZ:-([^"}]+)\}"$/m.exec(
      readFileSync(WRAPPER_PATH, "utf8"),
    );
    expect(declared?.[1]).toBe(DEFAULT_CONFIG.timeZone);
  });

  it("classifies an 08/09 mark hour by base 10, using the wrapper's own comparison", () => {
    // THE OCTAL LOCK, EXERCISED RATHER THAN DESCRIBED. The hour became configurable,
    // so `08`/`09` stopped being hypothetical — and that band is the one where bash
    // fails in the worst possible way: `[[ 09 -ge 08 ]]` is invalid octal, prints an
    // error, does NOT abort (an `if` condition is exempt from `set -e`) and takes the
    // else branch. Every run then records itself as out-of-window, nothing ever
    // stamps, and the staleness channel dies silently while the marks land fine.
    //
    // THE CODE UNDER TEST IS LIFTED FROM THE WRAPPER, not re-typed here — that is the
    // whole point. Strip the `10#` from either operand in the wrapper and this goes
    // red (measured: the unguarded form answers `false` for 09 ≥ 08 and exits 0).
    const wrapper = readFileSync(WRAPPER_PATH, "utf8");
    const comparison = /^(if \[\[ .*MARK_NOW_HOUR.*MARK_HOUR.*\]\]; then)$/m.exec(wrapper)?.[1];
    expect(comparison).toBeDefined();

    // `/bin/bash` EXPLICITLY: that is what launchd runs (3.2.57 on macOS), and a
    // Homebrew bash 5 would let a bash-5-only shape pass here and die in production.
    const classify = (nowHour: string, markHour: string): string =>
      execFileSync(
        "/bin/bash",
        [
          "-c",
          [
            "set -euo pipefail",
            `MARK_NOW_HOUR=${nowHour}`,
            `MARK_HOUR=${markHour}`,
            comparison!,
            "  MARK_WINDOW=true",
            "else",
            "  MARK_WINDOW=false",
            "fi",
            'printf %s "$MARK_WINDOW"',
          ].join("\n"),
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );

    expect(classify("09", "08")).toBe("true");
    expect(classify("07", "08")).toBe("false");
    expect(classify("08", "08")).toBe("true");
    // And the shape the schedule actually runs, so the guard cannot pass by only
    // caring about the octal band.
    expect(classify("18", "18")).toBe("true");
    expect(classify("09", "18")).toBe("false");
  });

  it("refuses an unresolvable mark timezone on BOTH sides, instead of quietly becoming UTC", () => {
    // THE ASYMMETRY THIS CLOSES. TypeScript already fails loudly on a bad zone;
    // bash does not — `TZ=Not/AZone date +%H` prints the UTC hour with no error and a
    // zero exit (verified on this box). UTC is disjoint from the CDMX evening window,
    // so a typo'd override would flip the window wrong on every single run while the
    // runs kept marking correctly. Now that the zone is settable, that typo is a
    // thing a caller can actually make.
    const BAD_ZONE = "Not/AZone";
    expect(() => new Intl.DateTimeFormat("en-US", { timeZone: BAD_ZONE })).toThrow(RangeError);

    const result = runWrapper({ NUMISMA_MARK_TZ: BAD_ZONE });

    expect(result.status).not.toBe(0);
    // It NAMES THE VALUE. A bare "bad timezone" would leave an operator staring at a
    // plist and an env file trying to work out which one was read.
    expect(result.output).toContain(BAD_ZONE);
    expect(result.output).toContain("FATAL");
    // BEFORE the mark window, and before anything else happens at all: the run never
    // gets past its own startup, so it writes no per-run log and leaves no half-done
    // work to explain. A fallback to UTC would have reached all of it.
    expect(readdirSync(result.dirs.logDir)).toEqual([]);
    expectReachedNoStep(result.dirs);
  });

  it("refuses a mark hour that is not an hour, which would classify every run out-of-window", () => {
    // Same failure mode as the bad zone, through the other override: a non-numeric
    // hour makes the comparison's arithmetic fail, and that failure does not abort —
    // it just answers `false`, forever, on every run.
    const result = runWrapper({ NUMISMA_MARK_HOUR: "noon" });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain("noon");
    expect(result.output).toContain("FATAL");
    expect(readdirSync(result.dirs.logDir)).toEqual([]);
    expectReachedNoStep(result.dirs);
  });

  it("lists exactly the wrapper steps that follow the one appending marks", () => {
    // The heartbeat stamps a run as having marked the day only if it got past
    // `spine`, which is the step that appends. That predicate is a hardcoded list of
    // step names, and its oracle is the ORDER OF THE `LAST_STEP` ASSIGNMENTS in the
    // same file — so renaming a step, or inserting a new one after `spine` without
    // adding it, fails here instead of quietly narrowing what counts as a marked day.
    const wrapper = readFileSync(WRAPPER_PATH, "utf8");
    const steps = [...wrapper.matchAll(/^LAST_STEP="([^"]+)"$/gm)].map((m) => m[1]);
    const afterSpine = steps.slice(steps.indexOf("spine") + 1);
    expect(steps).toContain("spine");
    const declared = /^MARKS_LANDED_STEPS="([^"]+)"$/m.exec(wrapper)?.[1]?.split(" ");
    expect(declared).toEqual(afterSpine);
  });

  it("never rewrites LAST_STEP into a decorated value, which empties the landed-steps match", () => {
    // The sibling test above pins WHICH names count as "the marks landed". This one
    // pins that the variable those names are compared against still holds one of
    // them. The comparison is an exact string match, so any assignment that turns
    // `LAST_STEP` into a LABEL rather than a step name silently empties the whole
    // predicate — every branch of the loop falls through and the run records itself
    // as not having marked the day.
    //
    // That regression shipped once. The watchdog's TERM handler set
    // `LAST_STEP="timeout:$LAST_STEP"`, so a run killed at `backfill` — after it had
    // already appended, committed and VERIFIED the day's marks — stamped nothing,
    // and the next morning claimed "nothing recorded for today" standing beside a
    // true exit-124 line and a gap report that said the opposite. The `timeout:`
    // label is still emitted; it is built at print time from a separate flag, which
    // is what lets both facts be true at once.
    //
    // THE ANCHORED SCAN THE SIBLING USES CANNOT SEE THIS. That rewrite lived inside a
    // single-quoted `trap` body on a `trap` line, so the `/^LAST_STEP="…"$/gm` list
    // was still exactly the post-`spine` steps and the guard passed. This scan finds
    // every assignment wherever it sits, and requires the two to agree — an
    // assignment the anchored scan misses is itself the bug, because that scan is the
    // oracle for `MARKS_LANDED_STEPS`.
    const wrapper = readFileSync(WRAPPER_PATH, "utf8");
    const everywhere = [...wrapper.matchAll(/\bLAST_STEP="([^"]*)"/g)].map((m) => m[1]!);
    const anchored = [...wrapper.matchAll(/^LAST_STEP="([^"]+)"$/gm)].map((m) => m[1]!);
    expect(everywhere).toEqual(anchored);
    // A bare step name: no `$` (an expansion of itself), no `:` (a label prefix).
    for (const value of everywhere) {
      expect(value).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it("bounds a wedged run inside the gap between fires, so the next one is not skipped", () => {
    // THE ORACLE IS THE PLIST, WHICH IS WHY THIS LIVES HERE. The wrapper's watchdog
    // ceiling is only meaningful relative to how often launchd actually fires: the
    // whole point is that a hung run is dead and the job slot released BEFORE the
    // next fire, so the hourly schedule's own retry still works.
    //
    // This is a real, observed failure, not a hypothetical. On 2026-08-11 the 22:01
    // run wedged on a dead socket mid-backfill and was still alive twenty hours
    // later; because launchd is a per-label singleton, it would have eaten the
    // entire next evening's window too. Tightening the plist's intervals without
    // tightening the ceiling silently restores that, and nothing else would catch it
    // — the two files never reference each other.
    const wrapper = readFileSync(WRAPPER_PATH, "utf8");
    const ceiling = Number(
      /^MAX_RUN_SECONDS="\$\{NUMISMA_PRICEFEED_MAX_RUN_SECONDS:-(\d+)\}"$/m.exec(wrapper)?.[1],
    );
    const grace = Number(
      /^WATCHDOG_GRACE_SECONDS="\$\{NUMISMA_PRICEFEED_WATCHDOG_GRACE_SECONDS:-(\d+)\}"$/m.exec(
        wrapper,
      )?.[1],
    );
    expect(Number.isFinite(ceiling)).toBe(true);
    expect(Number.isFinite(grace)).toBe(true);

    // The SMALLEST gap between consecutive fires, not the nominal hour: if anyone
    // ever adds a half-past interval, the tightest pair is what the ceiling has to
    // clear. Sorted by minute-of-day; the day does not wrap because the schedule is
    // pinned to a single 18:00-23:00 block by the assertions above.
    const minutesOfDay = parseIntervals()
      .map(({ Hour, Minute }) => Hour! * 60 + Minute!)
      .sort((a, b) => a - b);
    const smallestGapSeconds =
      Math.min(...minutesOfDay.slice(1).map((m, i) => m - minutesOfDay[i]!)) * 60;

    expect(ceiling + grace).toBeLessThan(smallestGapSeconds);

    // AND THE FLOOR, because the bound is two-sided and only the ceiling had a test.
    // "Tighten it to be safe" is the single most plausible edit anyone will make to
    // this number, and it is the one edit with the worst consequence: a ceiling at or
    // below a healthy run's duration TERMs EVERY fire, not only the wedged ones. All
    // six fires of an evening then die identically, the CDMX date rolls, and the day
    // is unrecoverable — total loss, from an edit that looks like prudence and that
    // the assertion above waves through (600 passes it cleanly).
    //
    // THE ORACLE IS THE WRAPPER'S OWN MEASURED RUN LENGTH, stated at the watchdog:
    // "a healthy run takes ~15 minutes". Weaker than DEFAULT_CONFIG or the plist, and
    // named as such — but it is a real observation of the thing being bounded, and
    // 20 minutes is that figure with a third of itself as margin. This asserts the
    // ceiling leaves room for a healthy run; it does not pin 2700.
    expect(ceiling).toBeGreaterThan(20 * 60);
  });
});
