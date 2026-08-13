import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { instrumentsForSource } from "@numisma/engine";
import { DEFAULT_CONFIG } from "./config.js";

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

  it("keeps the wrapper's own mark hour equal to the contract's, with no leading zero", () => {
    // The wrapper duplicates the mark hour in bash to decide whether a run could
    // mark at all (the heartbeat's `markWindow`). It cannot import `DEFAULT_CONFIG`,
    // so this is the join: change the contract and a test fails rather than the
    // breadcrumb quietly mis-classifying every run.
    //
    // THE REGEX REFUSES A LEADING ZERO ON PURPOSE. `[[ x -ge $MARK_HOUR ]]`
    // arithmetic-evaluates its right operand, and `08`/`09` are invalid octal. That
    // does not abort — it is an `if` condition, so `set -e` never fires — it silently
    // classifies EVERY run as out-of-window. `Number("08") === 8` would let a guard
    // written the obvious way sail straight past it, so the SHAPE is asserted, not
    // just the value. (The wrapper also wraps both operands in `10#`; this is the
    // second lock on the same door, because either alone is enough to be forgotten.)
    const markHour = Number(DEFAULT_CONFIG.markTime.split(":")[0]);
    const declared = /^MARK_HOUR=([1-9]?[0-9])$/m.exec(readFileSync(WRAPPER_PATH, "utf8"));
    expect(declared?.[1]).toBeDefined();
    expect(Number(declared?.[1])).toBe(markHour);
  });

  it("keeps the wrapper's own mark timezone equal to the contract's", () => {
    // The hour is meaningless without the zone. The real gate resolves the mark
    // instant through Intl in CDMX explicitly, so a wrapper reading the bare local
    // hour would agree only by coincidence of the OS setting — and the install docs
    // offer the divergent setup (CDMX-equivalent plist hours on a non-CDMX box) as
    // supported. Under that config every scheduled fire would classify itself
    // out-of-window, nothing would ever stamp, and the staleness trigger would be
    // permanently and silently dead while the runs themselves marked correctly.
    const declared = /^MARK_TZ="([^"]+)"$/m.exec(readFileSync(WRAPPER_PATH, "utf8"));
    expect(declared?.[1]).toBe(DEFAULT_CONFIG.timeZone);
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
  });
});
