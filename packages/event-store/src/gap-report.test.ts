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
 * All events are synthetic. Instrument ids, amounts and prices are invented for
 * the shape of the fixture and correspond to no real position.
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

// ── The synthetic venue split ────────────────────────────────────────────────
// Nine weekday-venue instruments and four daily ones, mirroring the real feed's
// 9-equity / 4-crypto shape. The counts are what make the Saturday case bite:
// under the old rule the nine self-skip onto Friday's marks, so a Saturday that
// produced NOTHING still reads 9-arrived.
const WEEKDAY_VENUE = ["eq-a", "eq-b", "eq-c", "eq-d", "eq-e", "eq-f", "eq-g", "eq-h", "eq-i"];
const DAILY_VENUE = ["cx-a", "cx-b", "cx-c", "cx-d"];
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
});
