/**
 * D6's DELIVERY SEAM (#266) — the venue-dark verdict, narrowed for the wire.
 *
 * Part 1 put the verdict in the durable log's gap report, where it reaches stdout,
 * `gap-report.json` and the TUI's startup line — three surfaces that only speak when
 * the operator is already at the desk. This is the half that reaches the phone.
 *
 * EVERY EVENT HERE IS AUTHORED. The amounts, the dates and the ordering are invented
 * for the shape of the case and correspond to no real day. The instrument IDs are the
 * registry's own, and that is required rather than incidental: the derivation
 * attributes each mark through `instrumentsForSource`, so a fixture of made-up ids
 * would exercise only the unattributable path and never the rule. The registry is
 * code-owned reference data, not trade data.
 */
import type { PortfolioEvent } from "@numisma/engine";
// The engine's one declaring home for calendar arithmetic — never a private copy,
// which `calendar-contract.test.ts` enforces repo-wide, test files included.
import { addDays } from "@numisma/engine";
import { LAUNCHD_ERA_START } from "@numisma/event-store";
import { describe, expect, it } from "vitest";
import {
  VENUE_DARK_WINDOW_DAYS,
  summarizeVenueDark,
  venueDarkOrOmit,
} from "./glance.ts";

/** The real registry's 9/4 split, spelled out so a registry edit fails loudly. */
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

/** Authored `PriceMarked` events — one per instrument, all carrying `asOf == date`. */
function marks(date: string, instrumentIds: readonly string[]): PortfolioEvent[] {
  return instrumentIds.map((instrumentId, index) => ({
    id: `mark-${date}-${instrumentId}`,
    asOf: date,
    type: "PriceMarked",
    instrumentId,
    // Invented, and deliberately not round: nothing here reads a price, and a
    // magnitude that looked plausible would invite someone to read one.
    price: 100 + index,
  })) as PortfolioEvent[];
}

/** Every instrument marked on `date` — a day with nothing to report. */
function healthyDay(date: string): PortfolioEvent[] {
  return marks(date, ALL_INSTRUMENTS);
}

// Verified calendar facts, authored: 2026-07-16 is a Thursday, 07-15 a Wednesday,
// 07-17 a Friday, 07-18 a Saturday.
const WEDNESDAY = "2026-07-15";
const THURSDAY = "2026-07-16";
const FRIDAY = "2026-07-17";

describe("summarizeVenueDark — the wire narrowing", () => {
  it("names the venue and the WEEKDAY, and puts no date on the wire", () => {
    // A Thursday the crypto marks landed on and the equity venue did not: the
    // silent-dark case, which exits 0 with three health surfaces reading fine.
    const events = [...healthyDay(WEDNESDAY), ...marks(THURSDAY, DAILY_VENUE)];

    expect(summarizeVenueDark(events, FRIDAY)).toEqual([
      { source: "twelvedata", weekday: "Thursday" },
    ]);
  });

  it("carries no ISO-date-shaped value in any field (ADR-007's date invariant)", () => {
    const events = [...healthyDay(WEDNESDAY), ...marks(THURSDAY, DAILY_VENUE)];
    for (const day of summarizeVenueDark(events, FRIDAY)) {
      for (const value of Object.values(day)) {
        expect(value).not.toMatch(/\d{4}-\d{2}-\d{2}/);
      }
    }
  });

  it("dedupes to the MOST RECENT dark day per venue", () => {
    // Two consecutive dark days for one venue. Carrying both would put two
    // indistinguishable "Wednesday"/"Thursday" entries on the wire with no way to
    // tell which outage they belong to. Ship the conclusion, not the inputs.
    const events = [
      ...marks(WEDNESDAY, DAILY_VENUE),
      ...marks(THURSDAY, DAILY_VENUE),
    ];
    expect(summarizeVenueDark(events, FRIDAY)).toEqual([
      { source: "twelvedata", weekday: "Thursday" },
    ]);
  });

  it("reports both venues when both went dark, most recent day each", () => {
    // Wednesday: the equity venue is dark. Thursday: the crypto venue is.
    const events = [
      ...marks(WEDNESDAY, DAILY_VENUE),
      ...marks(THURSDAY, WEEKDAY_VENUE),
    ];
    expect(summarizeVenueDark(events, FRIDAY)).toEqual([
      { source: "binance", weekday: "Thursday" },
      { source: "twelvedata", weekday: "Wednesday" },
    ]);
  });

  it("returns an EMPTY array on a clean window — checked, nothing dark", () => {
    const events = [...healthyDay(WEDNESDAY), ...healthyDay(THURSDAY)];
    // Empty, never absent: absence is reserved for "this build could not answer".
    expect(summarizeVenueDark(events, FRIDAY)).toEqual([]);
  });

  it("stops at the day BEFORE the anchor (D2's accepted cost)", () => {
    // The anchor's own day is excluded: the ceiling is pinned to yesterday, so a
    // Thursday outage surfaces in Friday's push. Asked AS OF Thursday, the same log
    // reports nothing — the day is still in progress.
    const events = [...healthyDay(WEDNESDAY), ...marks(THURSDAY, DAILY_VENUE)];
    expect(summarizeVenueDark(events, THURSDAY)).toEqual([]);
    expect(summarizeVenueDark(events, FRIDAY)).toEqual([
      { source: "twelvedata", weekday: "Thursday" },
    ]);
  });

  it("is computed AS OF the anchor, so backfill resolves each anchor honestly", () => {
    // The same event array, two anchors, two different answers — which is the whole
    // property that keeps `pnpm backfill` from stamping today's verdict onto every
    // historical row.
    const events = [...marks(WEDNESDAY, DAILY_VENUE), ...healthyDay(THURSDAY)];
    expect(summarizeVenueDark(events, THURSDAY)).toEqual([
      { source: "twelvedata", weekday: "Wednesday" },
    ]);
    // Far enough past the window that the Wednesday outage has aged out.
    const later = "2026-08-01";
    expect(summarizeVenueDark(events, later)).toEqual([]);
  });

  it("never reaches below the launchd era, however early the anchor", () => {
    // The pre-scheduler week is HAND-RUN: `06-26, 06-28, 06-30, 07-03 …`, and whether
    // a venue OWED marks on a day no job existed to produce them is not a question the
    // log can answer. `computeGapReport` only DEFAULTS its floor, so a window walked
    // back from an early anchor would otherwise sit partly — or, for the earliest
    // anchors, wholly — below the era start and manufacture a dark venue out of the
    // absence of a scheduler. Live pushes never hit this; `pnpm backfill` does.
    //
    // Authored: the crypto venue marks on Fri 2026-06-26 and nothing else ever does.
    const events = marks("2026-06-26", DAILY_VENUE);
    // A window that straddles the floor …
    expect(summarizeVenueDark(events, "2026-06-28")).toEqual([]);
    // … and one that sits entirely below it, ceiling included.
    expect(summarizeVenueDark(events, LAUNCHD_ERA_START)).toEqual([]);
  });

  it("ages a dark day out of the window rather than carrying it forever", () => {
    // A most-recent-per-venue dedup over an unbounded window would report a venue
    // that recovered months ago as though it were dark now. The window is what makes
    // "most recent" mean "recent".
    const events = marks(WEDNESDAY, DAILY_VENUE);
    const insideWindow = addDays(WEDNESDAY, VENUE_DARK_WINDOW_DAYS);
    const outsideWindow = addDays(WEDNESDAY, VENUE_DARK_WINDOW_DAYS + 1);
    expect(summarizeVenueDark(events, insideWindow)).toEqual([
      { source: "twelvedata", weekday: "Wednesday" },
    ]);
    expect(summarizeVenueDark(events, outsideWindow)).toEqual([]);
  });
});

describe("venueDarkOrOmit — degrade the branch, never the anchor", () => {
  it("omits the field rather than throwing when the derivation cannot run", () => {
    // ADR-007's third amendment: an observability finding must not be able to cost
    // the phone its NAV. `summarizeVenueDark` throws on a malformed anchor date;
    // the push path must degrade to an absent field and keep going.
    expect(() => summarizeVenueDark([], "not-a-date")).toThrow();
    expect(venueDarkOrOmit([], "not-a-date")).toBeUndefined();
  });

  it("passes a real answer through unchanged", () => {
    const events = [...healthyDay(WEDNESDAY), ...marks(THURSDAY, DAILY_VENUE)];
    expect(venueDarkOrOmit(events, FRIDAY)).toEqual([
      { source: "twelvedata", weekday: "Thursday" },
    ]);
  });
});
