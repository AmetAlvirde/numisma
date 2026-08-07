import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { instrumentsForSource } from "@numisma/engine";
import { DEFAULT_CONFIG } from "./config.js";

/**
 * The launchd schedule template is CONFIG, not code, so most of what could be
 * asserted about it would only restate its own bytes ("the file says Hour 18, so
 * assert Hour 18") and would fail for no reason other than someone editing it on
 * purpose. This file deliberately asserts only the properties that have an
 * ORACLE SOMEWHERE ELSE — the ones a future edit to the plist, to
 * `DEFAULT_CONFIG`, or to the instrument registry could silently falsify:
 *
 *  1. It parses as a plist at all (oracle: Apple's own parser). A malformed edit
 *     is the one failure launchd gives no feedback for — it just never runs.
 *  2. No fire is scheduled before the mark time (oracle: `DEFAULT_CONFIG.markTime`
 *     in config.ts). Marks are gated on being at/after the mark instant, so a fire
 *     before it stores quotes and emits ZERO marks — a scheduled no-op that looks
 *     like a run.
 *  3. No fire is scheduled past the CDMX day (hour ≤ 23). `asOf` is the calendar
 *     date, so an interval that lands after midnight fetches under the NEXT day's
 *     `asOf` and can never recover the day it was meant to recover.
 *  4. More than one fire per day — the whole recovery property of #185 S2. One
 *     interval is precisely the shape that lost 2026-06-27 and friends.
 *  5. The day's worst-case Twelve Data spend fits the free tier's DAILY credit cap
 *     (oracle: the instrument registry's row count). This is the gate that parked
 *     this slice, and it moves whenever an equity is added to the registry OR an
 *     interval is added here — neither edit is near this file.
 *
 * `RunAtLoad` is deliberately NOT asserted: it is a true belt-and-braces half with
 * no second source of truth, so a test for it would only echo the file.
 */

const PLIST_PATH = fileURLToPath(
  new URL("../../../ops/price-feed/com.numisma.pricefeed.daily.plist", import.meta.url),
);

/** Twelve Data Basic (free): 8 credits/minute, 800/day. A batched `time_series` costs 1 credit per symbol. */
const TWELVE_DATA_DAILY_CREDIT_CAP = 800;

/** `plutil` is macOS-only — and so is launchd, so there is nothing to guard elsewhere. */
const onMac = process.platform === "darwin";

interface CalendarInterval {
  Hour?: number;
  Minute?: number;
}

/** Parse the template through Apple's own parser, so "is it valid?" is not our opinion. */
function readPlist(): { StartCalendarInterval: CalendarInterval | CalendarInterval[] } {
  const json = execFileSync("plutil", ["-convert", "json", "-o", "-", PLIST_PATH], {
    encoding: "utf8",
  });
  return JSON.parse(json);
}

/** launchd accepts either ONE dict or an ARRAY of them; normalize so the assertions read the same. */
function fireHours(): number[] {
  const interval = readPlist().StartCalendarInterval;
  const dicts = Array.isArray(interval) ? interval : [interval];
  return dicts.map((d) => d.Hour ?? 0);
}

describe.skipIf(!onMac)("the launchd fetch window", () => {
  it("is a plist launchd can actually load", () => {
    // A malformed plist is silently ignored by launchd — no error, just no job.
    expect(() => execFileSync("plutil", ["-lint", PLIST_PATH], { encoding: "utf8" })).not.toThrow();
  });

  it("schedules no fire before the mark time, when a run can emit no marks at all", () => {
    const markHour = Number(DEFAULT_CONFIG.markTime.split(":")[0]);
    for (const hour of fireHours()) {
      expect(hour).toBeGreaterThanOrEqual(markHour);
    }
  });

  it("schedules no fire past the CDMX day, whose rollover makes the miss permanent", () => {
    for (const hour of fireHours()) {
      expect(hour).toBeLessThanOrEqual(23);
    }
  });

  it("fires more than once, which is the only thing that recovers a missed evening", () => {
    // launchd DROPS a missed calendar interval rather than backfilling it, so a
    // single daily interval means an asleep machine loses the day outright.
    expect(fireHours().length).toBeGreaterThan(1);
  });

  it("cannot exceed the Twelve Data daily credit cap even if every fire marks", () => {
    const twelveDataSymbols = instrumentsForSource("twelvedata").length;
    expect(fireHours().length * twelveDataSymbols).toBeLessThanOrEqual(TWELVE_DATA_DAILY_CREDIT_CAP);
  });
});
