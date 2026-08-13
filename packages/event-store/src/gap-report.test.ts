/**
 * The gap report's rule, tested the ONLY way that could have caught `M1`.
 *
 * EVERY CASE IS BUILT FROM REAL `PortfolioEvent` ARRAYS AND LETS
 * `computeGapReport` DO THE COUNTING. Nothing here injects a count, stubs a
 * per-date number, or hands the function a synthetic `arrived`. That is not a
 * style preference — it is the property whose absence hid the bug this slice
 * exists to fix. The prototype's nine tests each injected a synthetic
 * arrived-count through a `{anchors, arrivedOn}` source pair, so all nine
 * exercised the RULE and never the NUMBER THE RULE WAS APPLIED TO. Every one of
 * them passed while the detector was structurally incapable of firing on a
 * weekend.
 *
 * `arrivedUnderOldRule` below is the counterpart of that discipline: a faithful,
 * test-only re-implementation of the rejected `feedGap.arrived > 0` rule over the
 * SAME event array. It lets the Saturday case assert the disagreement as a fact
 * rather than as a comment — the old rule reads 9-arrived and calls a
 * zero-mark Saturday clean; the new rule calls it lost. If a future edit reverts
 * the rule, that assertion is what fails.
 *
 * All events are synthetic: every amount and every price is invented for the shape
 * of the fixture and corresponds to no real position. The instrument IDS are the
 * registry's own, and that is required rather than incidental — the venue-dark
 * derivation attributes each mark through `instrumentsForSource`, so a fixture of
 * made-up ids would exercise only the UNATTRIBUTABLE path and never the rule. The
 * registry is code-owned reference data, not trade data.
 */
import type { PortfolioEvent } from "@numisma/engine";
import { describe, expect, it } from "vitest";
import {
  LAUNCHD_ERA_START,
  computeGapReport,
  dueThrough,
  formatGapReport,
  formatGapSummary,
} from "./gap-report.js";

// ── The venue split ─────────────────────────────────────────────────────────
// Nine weekday-venue (`twelvedata`) instruments and four daily (`binance`) ones —
// the real registry's 9/4 shape, spelled out here rather than derived from
// `instrumentsForSource` so a registry edit that changes the split fails these
// cases loudly instead of quietly re-shaping them. The counts are what make the
// Saturday case bite: under the old rule the nine self-skip onto Friday's marks,
// so a Saturday that produced NOTHING still reads 9-arrived.
const WEEKDAY_VENUE = [
  "aapl",
  "googl",
  "tsla",
  "eww-mxn",
  "intc-mxn",
  "nke-mxn",
  "nu-mxn",
  "rivn-mxn",
  "sbux-mxn",
];
const DAILY_VENUE = ["btc", "eth", "render", "gram"];
const ALL_INSTRUMENTS = [...WEEKDAY_VENUE, ...DAILY_VENUE];

/** Real `PriceMarked` events — one per instrument, all carrying `asOf == date`. */
function marks(date: string, instrumentIds: readonly string[]): PortfolioEvent[] {
  return instrumentIds.map((instrumentId, index) => ({
    id: `pm-${instrumentId}-${date}`,
    asOf: date,
    type: "PriceMarked",
    instrumentId,
    price: 100 + index,
  }));
}

/** A full healthy day: every instrument marked. */
function healthyDay(date: string): PortfolioEvent[] {
  return marks(date, ALL_INSTRUMENTS);
}

/** A non-mark event, so a date can be ANCHORED while carrying zero marks. */
function deposit(date: string, id = `dep-${date}`): PortfolioEvent {
  return { id, asOf: date, type: "Deposit", reserveId: "cash-core", amount: 500, tier: "c1" };
}

function positionClosed(date: string, positionId: string): PortfolioEvent {
  return {
    id: `close-${positionId}-${date}`,
    asOf: date,
    type: "PositionClosed",
    positionId,
    settlement: { reserveId: "cash-core", proceeds: 250 },
  };
}

// ── The rejected rule, kept executable ───────────────────────────────────────
//
// DO NOT COLLAPSE THE NEXT TWO HELPERS ONTO `@numisma/engine`'s `isWeekend` /
// `lastExpectedMarkDate`, even though the engine now exports both (#266 D4). They
// are hand-copied ON PURPOSE. Their whole job is to hold the REJECTED rule still
// while the shipped rule moves, so the Saturday case below can assert the
// disagreement as a fact. Importing the shared definition would make the two sides
// of that assertion the same code, and a future edit to the shared rule would drag
// the "old rule" along with it — the pin would go green while measuring nothing.

/** Is this `YYYY-MM-DD` a Saturday or Sunday, read in UTC? */
function isWeekend(date: string): boolean {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
}

/**
 * The old rule's carry-back: a weekday venue's last EXPECTED mark date walks back
 * over the weekend, so on a Saturday the nine equities are still measured against
 * FRIDAY. This is `glance.ts`'s `lastExpectedMarkDate`, reduced to its essence.
 */
function lastExpectedMarkDate(instrumentId: string, asOf: string): string {
  if (DAILY_VENUE.includes(instrumentId)) {
    return asOf;
  }
  let cursor = asOf;
  for (let guard = 0; guard < 10 && isWeekend(cursor); guard += 1) {
    cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  }
  return cursor;
}

/**
 * `feedGap.arrived` as the prototype computed it: how many instruments are FRESH
 * against their last expected mark date. Not "how many marks landed on D" — which
 * is precisely the confusion that made `M1` invisible.
 */
function arrivedUnderOldRule(events: readonly PortfolioEvent[], asOf: string): number {
  const newestMark = new Map<string, string>();
  for (const event of events) {
    if (event.type === "PriceMarked" && event.asOf <= asOf) {
      const seen = newestMark.get(event.instrumentId);
      if (seen === undefined || event.asOf > seen) {
        newestMark.set(event.instrumentId, event.asOf);
      }
    }
  }
  return ALL_INSTRUMENTS.filter((instrumentId) => {
    const newest = newestMark.get(instrumentId);
    return newest !== undefined && newest >= lastExpectedMarkDate(instrumentId, asOf);
  }).length;
}

// ── Calendar landmarks (verified weekdays) ───────────────────────────────────
const FRIDAY = "2026-07-10";
const SATURDAY = "2026-07-11";
const SUNDAY = "2026-07-12";
/** Late enough that no window below is clamped by the yesterday ceiling. */
const LATER = new Date("2026-08-05T12:00:00Z");

describe("computeGapReport — the rule: did a mark land on day D", () => {
  it("reports 2026-06-30 — a Tuesday anchored by a deposit and two closes, zero marks", () => {
    // The regression HEAD, #185 and the grill all missed. The day is anchored, so
    // every `max(as_of)` freshness test calls it present; not one instrument was
    // marked, so the day is lost.
    const events: PortfolioEvent[] = [
      deposit("2026-06-30"),
      positionClosed("2026-06-30", "pos-one"),
      positionClosed("2026-06-30", "pos-two"),
    ];
    const report = computeGapReport(events, {
      since: "2026-06-30",
      until: "2026-06-30",
      now: LATER,
    });
    expect(report.lost).toEqual([{ date: "2026-06-30", reason: "no-marks" }]);
    expect(report.anchorsChecked).toBe(1);
  });

  it("reports a Saturday that is anchored and carries zero marks — the case the old rule calls clean", () => {
    // M1. Friday is fully healthy; Saturday carries a deposit and NOT ONE
    // `PriceMarked`. The fetch produced nothing that day.
    const events: PortfolioEvent[] = [...healthyDay(FRIDAY), deposit(SATURDAY)];

    // The old rule, run over these very events: the nine weekday-venue
    // instruments carry back to Friday, find Friday's marks, and count as
    // ARRIVED. 9 > 0, so `arrived > 0` returns CLEAN on a day that produced
    // nothing. This is why a test written on `arrived` cannot fire on a weekend.
    expect(arrivedUnderOldRule(events, SATURDAY)).toBe(9);

    // The rule this slice ships counts marks LANDING ON the day, so it fires.
    const report = computeGapReport(events, { since: FRIDAY, until: SATURDAY, now: LATER });
    expect(report.lost).toEqual([{ date: SATURDAY, reason: "no-marks" }]);
  });

  it("leaves a Saturday with crypto marks only (4) clean — the weekend must not cry wolf", () => {
    // 4 is COMPLETE for a Saturday, not degraded: the nine weekday-venue
    // instruments legitimately do not mark. `marksOn(D) < 13` is not a finding.
    const events: PortfolioEvent[] = [...healthyDay(FRIDAY), ...marks(SATURDAY, DAILY_VENUE)];
    const report = computeGapReport(events, { since: FRIDAY, until: SATURDAY, now: LATER });
    expect(report.lost).toEqual([]);
    expect(report.anchorsChecked).toBe(2);
  });

  it("reports a day with no event of any kind as no-anchor", () => {
    const events: PortfolioEvent[] = [...healthyDay(FRIDAY), ...healthyDay(SUNDAY)];
    const report = computeGapReport(events, { since: FRIDAY, until: SUNDAY, now: LATER });
    expect(report.lost).toEqual([{ date: SATURDAY, reason: "no-anchor" }]);
    // The unanchored day was never an anchor, so it is not counted as one.
    expect(report.anchorsChecked).toBe(2);
  });

  it("reports an INTERIOR gap sitting behind a healthy trailing day", () => {
    // The shape a trailing `max(as_of)` check cannot see — and the one that let
    // 07-18…07-26 hide for nine days.
    const events: PortfolioEvent[] = [
      ...healthyDay("2026-07-13"),
      deposit("2026-07-14"), // anchored, zero marks
      // 2026-07-15 carries no event at all
      ...healthyDay("2026-07-16"),
    ];
    const report = computeGapReport(events, {
      since: "2026-07-13",
      until: "2026-07-16",
      now: LATER,
    });
    expect(report.lost).toEqual([
      { date: "2026-07-14", reason: "no-marks" },
      { date: "2026-07-15", reason: "no-anchor" },
    ]);
    // Ascending, and the healthy trailing day is not itself reported.
    expect(report.lost.map((day) => day.date)).toEqual([...report.lost.map((d) => d.date)].sort());
  });

  it("does not report a day whose marks are incomplete but non-zero, at any severity", () => {
    // One Twelve Data symbol failed: twelve of thirteen marks landed. That is one
    // blank cell, which the existing feed-gap trigger already speaks to — not a
    // lost day.
    const events: PortfolioEvent[] = marks(FRIDAY, ALL_INSTRUMENTS.slice(0, 12));
    const report = computeGapReport(events, { since: FRIDAY, until: FRIDAY, now: LATER });
    expect(report.lost).toEqual([]);
  });

  it("returns the window it actually used, and the calendar days in it", () => {
    const report = computeGapReport(healthyDay(FRIDAY), {
      since: FRIDAY,
      until: SUNDAY,
      now: LATER,
    });
    expect(report.since).toBe(FRIDAY);
    expect(report.until).toBe(SUNDAY);
    expect(report.calendarDays).toBe(3);
  });

  it("defaults the floor to LAUNCHD_ERA_START", () => {
    expect(LAUNCHD_ERA_START).toBe("2026-07-03");
    const report = computeGapReport(healthyDay(LAUNCHD_ERA_START), {
      until: LAUNCHD_ERA_START,
      now: LATER,
    });
    expect(report.since).toBe(LAUNCHD_ERA_START);
  });

  it("is pure: it does not mutate the events it is given, and repeats itself", () => {
    const events: PortfolioEvent[] = [...healthyDay(FRIDAY), deposit(SATURDAY)];
    const snapshot = JSON.stringify(events);
    const window = { since: FRIDAY, until: SATURDAY, now: LATER } as const;
    expect(computeGapReport(events, window)).toEqual(computeGapReport(events, window));
    expect(JSON.stringify(events)).toBe(snapshot);
  });

  it("returns an empty report for an inverted window, and does not throw", () => {
    const report = computeGapReport(healthyDay(FRIDAY), {
      since: "2026-07-20",
      until: "2026-07-05",
      now: LATER,
    });
    expect(report.lost).toEqual([]);
    expect(report.calendarDays).toBe(0);
    expect(report.anchorsChecked).toBe(0);
  });
});

describe("computeGapReport — the second question: did a whole venue go dark", () => {
  // Verified weekdays. THURSDAY is the day a weekday venue owes a mark on.
  const THURSDAY = "2026-07-16";
  const WEDNESDAY = "2026-07-15";

  it("reports a weekday on which one venue produced nothing and the other was healthy", () => {
    // The silent-dark case: the crypto marks land, the run exits 0, every
    // freshness test reads fine, and nine instruments were never quoted.
    const events: PortfolioEvent[] = marks(THURSDAY, DAILY_VENUE);
    const report = computeGapReport(events, { since: THURSDAY, until: THURSDAY, now: LATER });

    // STRICTLY ADDITIVE: the day is anchored and carries marks, so neither
    // existing verdict changes. `lost.length` is what three surfaces render.
    expect(report.lost).toEqual([]);
    expect(report.venueDark).toEqual([
      { date: THURSDAY, source: "twelvedata", expected: 9 },
    ]);
  });

  it("stays silent on a Saturday the weekday venue owed nothing on", () => {
    // The exact false positive that would make this detector unreadable: four
    // crypto marks on a Saturday is COMPLETE, not degraded.
    const report = computeGapReport(marks(SATURDAY, DAILY_VENUE), {
      since: SATURDAY,
      until: SUNDAY,
      now: LATER,
    });
    expect(report.venueDark).toEqual([]);
  });

  it("reports the DAILY venue dark on a weekend, because it owes every day", () => {
    const events: PortfolioEvent[] = marks(SATURDAY, WEEKDAY_VENUE);
    const report = computeGapReport(events, { since: SATURDAY, until: SATURDAY, now: LATER });
    expect(report.venueDark).toEqual([{ date: SATURDAY, source: "binance", expected: 4 }]);
  });

  it("does NOT fire on a partial-venue shortfall — eight of nine is not dark (D3)", () => {
    const events: PortfolioEvent[] = [
      ...marks(THURSDAY, DAILY_VENUE),
      ...marks(THURSDAY, WEEKDAY_VENUE.slice(0, 8)),
    ];
    const report = computeGapReport(events, { since: THURSDAY, until: THURSDAY, now: LATER });
    expect(report.venueDark).toEqual([]);
    expect(report.lost).toEqual([]);
  });

  it("never doubles up on a day already reported lost", () => {
    // `no-marks` and `no-anchor` keep their exact meanings, and a day that is
    // already a LOST day is not additionally a venue-dark day — one day, one
    // verdict, or the counts on three surfaces stop adding up.
    const events: PortfolioEvent[] = [
      deposit(WEDNESDAY), // anchored, zero marks
      // THURSDAY carries no event at all
    ];
    const report = computeGapReport(events, { since: WEDNESDAY, until: THURSDAY, now: LATER });
    expect(report.lost).toEqual([
      { date: WEDNESDAY, reason: "no-marks" },
      { date: THURSDAY, reason: "no-anchor" },
    ]);
    expect(report.venueDark).toEqual([]);
  });

  it("reports BOTH venues when a day is anchored by a mark it cannot attribute", () => {
    // A since-retired instrument. It anchors the day and it counts as a mark, so
    // the day is not lost — but it belongs to no venue, so it fills nobody's
    // expectation. This is the case that would CRASH under `resolveInstrument`.
    const events: PortfolioEvent[] = marks(THURSDAY, ["retired-thing"]);
    const report = computeGapReport(events, { since: THURSDAY, until: THURSDAY, now: LATER });

    expect(report.lost).toEqual([]);
    expect(report.venueDark).toEqual([
      { date: THURSDAY, source: "binance", expected: 4 },
      { date: THURSDAY, source: "twelvedata", expected: 9 },
    ]);
  });

  it("buckets unattributable marks separately, and never lets them suppress a verdict", () => {
    const events: PortfolioEvent[] = [
      ...marks(THURSDAY, DAILY_VENUE),
      ...marks(THURSDAY, ["retired-thing", "another-ghost"]),
    ];
    const report = computeGapReport(events, { since: THURSDAY, until: THURSDAY, now: LATER });

    expect(report.unattributedMarks).toBe(2);
    // Two extra marks landed on the day; twelvedata is still dark.
    expect(report.venueDark).toEqual([
      { date: THURSDAY, source: "twelvedata", expected: 9 },
    ]);
  });

  it("is ascending by date, and repeats itself", () => {
    const events: PortfolioEvent[] = [
      ...marks(WEDNESDAY, DAILY_VENUE),
      ...marks(THURSDAY, DAILY_VENUE),
    ];
    const window = { since: WEDNESDAY, until: THURSDAY, now: LATER } as const;
    const report = computeGapReport(events, window);
    expect(report.venueDark.map((day) => day.date)).toEqual([WEDNESDAY, THURSDAY]);
    expect(computeGapReport(events, window)).toEqual(report);
  });

  it("leaves a fully healthy weekday with nothing to say", () => {
    const report = computeGapReport(healthyDay(THURSDAY), {
      since: THURSDAY,
      until: THURSDAY,
      now: LATER,
    });
    expect(report.venueDark).toEqual([]);
    expect(report.unattributedMarks).toBe(0);
  });
});

describe("the ceiling — yesterday in CDMX, at every hour", () => {
  // CDMX is UTC-6 year-round. 2026-07-12 in CDMX runs 06:00Z that day to 05:59Z
  // the next; every instant inside it must yield the same ceiling.
  const CDMX_DAY = "2026-07-12";
  const YESTERDAY = "2026-07-11";
  const HOURS: ReadonlyArray<readonly [string, string]> = [
    ["00:01", "2026-07-12T06:01:00Z"],
    ["17:59", "2026-07-12T23:59:00Z"],
    ["18:00:00", "2026-07-13T00:00:00Z"],
    ["23:59", "2026-07-13T05:59:00Z"],
  ];

  for (const [label, instant] of HOURS) {
    it(`yields until = yesterday at ${label} CDMX`, () => {
      const now = new Date(instant);
      expect(dueThrough(now)).toBe(YESTERDAY);
      const report = computeGapReport(healthyDay(YESTERDAY), { since: YESTERDAY, now });
      expect(report.until).toBe(YESTERDAY);
    });
  }

  it("never names today, even when the caller explicitly asks for it", () => {
    // The prototype flipped the ceiling to TODAY once the clock passed 18:00 and
    // printed "today — NO DATA … the day is lost" — false until CDMX midnight, and
    // false during exactly the six-hour recovery window the design exists to use.
    const now = new Date("2026-07-13T00:30:00Z"); // 18:30 CDMX on 2026-07-12
    const report = computeGapReport(healthyDay(YESTERDAY), {
      since: YESTERDAY,
      until: CDMX_DAY,
      now,
    });
    expect(report.until).toBe(YESTERDAY);
    expect(report.lost.map((day) => day.date)).not.toContain(CDMX_DAY);
  });
});

describe("formatGapReport / formatGapSummary", () => {
  const window = { since: FRIDAY, until: SUNDAY, now: LATER } as const;

  it("renders nothing and reports no lost days when the window is clean", () => {
    const report = computeGapReport(
      [...healthyDay(FRIDAY), ...marks(SATURDAY, DAILY_VENUE), ...marks(SUNDAY, DAILY_VENUE)],
      window,
    );
    expect(formatGapReport(report)).toEqual([]);
    expect(formatGapSummary(report)).toBe(
      "Numisma: no lost days in 2026-07-10…2026-07-12 (3 day(s), 3 anchor(s) checked).",
    );
  });

  it("renders one line per lost day, distinguishing the two reasons", () => {
    // Saturday anchored with zero marks; Sunday carries no event at all.
    const report = computeGapReport([...healthyDay(FRIDAY), deposit(SATURDAY)], window);
    expect(formatGapReport(report)).toEqual([
      "Numisma: 2026-07-11 — NO MARKS. The day is anchored but no price mark landed on it; the day is lost.",
      "Numisma: 2026-07-12 — NO DATA. No event of any kind carries this date; the day is lost.",
    ]);
    expect(formatGapSummary(report)).toBe(
      "Numisma: 2 lost day(s) in 2026-07-10…2026-07-12 (3 day(s), 2 anchor(s) checked).",
    );
  });

  it("names the venue and the weekday on a venue-dark day, so a holiday reads as one", () => {
    // D7: there is no market-holiday calendar, so ~9-10 weekday holidays a year
    // fire. Naming the weekday is what lets the reader recognise one on sight.
    const thursday = "2026-07-16";
    const report = computeGapReport(marks(thursday, DAILY_VENUE), {
      since: thursday,
      until: thursday,
      now: LATER,
    });
    expect(formatGapReport(report)).toEqual([
      "Numisma: 2026-07-16 (Thursday) — VENUE DARK. twelvedata owed 9 mark(s) and produced none. " +
        "The day is not lost; the venue was silent, or the market was closed for a holiday.",
    ]);
    expect(formatGapSummary(report)).toBe(
      "Numisma: no lost days in 2026-07-16…2026-07-16 (1 day(s), 1 anchor(s) checked). " +
        "1 venue-day(s) dark — not lost days: the feed ran and the days are anchored.",
    );
  });

  it("prints lost days first, then venue-dark days", () => {
    // The lost-day lines keep their exact position and wording; the venue-dark
    // lines are appended. Nothing that reads `lost` changes.
    const thursday = "2026-07-16";
    const report = computeGapReport([deposit(FRIDAY), ...marks(thursday, DAILY_VENUE)], {
      since: FRIDAY,
      until: thursday,
      now: LATER,
    });
    const lines = formatGapReport(report);
    expect(lines[0]).toContain("2026-07-10 — NO MARKS");
    expect(lines.at(-1)).toContain("2026-07-16 (Thursday) — VENUE DARK");
    expect(lines.filter((line) => line.includes("VENUE DARK"))).toHaveLength(1);
  });
});
