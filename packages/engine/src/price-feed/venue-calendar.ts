/**
 * THE VENUE CALENDAR — how often each price source is expected to produce a mark,
 * and the most recent date on which it owed one.
 *
 * WHY IT SITS BESIDE THE REGISTRY AND NOT IN `calendar.ts`. Everything here is
 * keyed on `PriceSource`, a type DEFINED in `registry.ts`; `calendar.ts` is the
 * `YYYY-MM-DD` arithmetic that knows nothing about venues and imports nothing at
 * all, which is what keeps it reachable from a render surface through the
 * `@numisma/engine/calendar` subpath. Venue cadence is price-feed reference data
 * — the same class as the registry rows next door — so it lives next door. It is
 * its own file rather than more of `registry.ts` because `registry.ts` maps ids to
 * provider reference data and declares no date math; this does nothing else.
 *
 * WHY IT IS DOWN HERE AT ALL (issue #266, D4). It was module-private in
 * `apps/web/src/push/glance.ts`, and a package cannot import from an app — so the
 * second consumer (`computeGapReport` in `@numisma/event-store`) would have
 * written a second copy. The `satisfies Record<PriceSource, VenueCadence>` latch
 * below guarantees only EXHAUSTIVENESS, not AGREEMENT: two copies compile happily
 * while disagreeing about whether a venue marks on weekends, and the visible
 * result is two health surfaces contradicting each other about the same day.
 *
 * ADR-001 is not in the way: it keeps FILE IO out of the engine, and this is pure
 * data and pure date math.
 *
 * NAMED BLIND SPOT — NO HOLIDAY AWARENESS (#266 D7). `lastExpectedMarkDate` walks
 * back over weekends and nothing else, so a US market holiday falling on a weekday
 * is still a day a weekday venue is expected to mark on. That is accepted, in both
 * consumers, because the failure direction is the safe one: a false *yes* costs a
 * glance, and a false *no* is the one failure a triage surface cannot have. Every
 * surface that renders this expectation is required to say so in its own message,
 * so a holiday reads as a holiday.
 */
import { addDays, isWeekend } from "../calendar.js";
import type { PriceSource } from "./registry.js";

/** How often a venue is expected to produce a mark. */
export type VenueCadence = "daily" | "weekdays";

/**
 * THE VENUE CALENDAR — keyed on the registry's OWN `source` property, which is the
 * only reason this covers all thirteen instruments.
 *
 * READ THIS BEFORE EDITING: the non-crypto instruments are TWO registry groups, not
 * one. `EQUITY_ENTRIES` (3 US equities) and `MXN_DERIVED_ENTRIES` (6 SIC entries
 * priced off a US-listed underlying) are BOTH `source: "twelvedata"`. Keying on
 * `source` unions them for free; hand-listing "the equities" instead would
 * under-count the expectation by six and go silent on a real outage — a false *no*.
 *
 * `satisfies Record<PriceSource, VenueCadence>` is the compile-time latch: the day
 * the engine adds a third price source, this object stops compiling and somebody has
 * to state that venue's cadence rather than have it default to "never expected".
 */
export const VENUE_CADENCE = {
  binance: "daily",
  twelvedata: "weekdays",
} as const satisfies Record<PriceSource, VenueCadence>;

/**
 * Every price source, in a stable order — the keys of {@link VENUE_CADENCE}, so a
 * venue cannot be enumerated without also having declared its cadence.
 */
export const PRICE_SOURCES = Object.keys(VENUE_CADENCE) as readonly PriceSource[];

/**
 * The most recent date <= `asOf` on which this venue was expected to mark.
 *
 * CARRY-FORWARD, AND WHY IT REPLACED A SAME-DATE TEST. The original glance builder
 * asked "is a mark expected TODAY, and did one arrive TODAY" — so an obligation that
 * went unfilled on its due day simply EVAPORATED the next morning. Against the real
 * log the equity feed marked on 2026-06-26 and went dark until 07-06; on Sat 07-04
 * and Sun 07-05 nothing is expected of a weekday venue, so the builder emitted
 * `{expected: 4, arrived: 4, missing: []}` with nothing suppressed and rendered a
 * full NAV whose nine of thirteen legs were priced eight days earlier. That is a
 * false *no* — the one failure a triage surface cannot have.
 *
 * An unfilled expectation now PERSISTS UNTIL IT IS FILLED. The question asked of each
 * instrument is not "did you quote today" but "is your newest mark at least as recent
 * as the last mark you owed me". The weekend walk is bounded by a guard rather than
 * unbounded, so a malformed anchor cannot spin.
 */
export function lastExpectedMarkDate(source: PriceSource, asOf: string): string {
  if (VENUE_CADENCE[source] === "daily") {
    return asOf;
  }
  let cursor = asOf;
  for (let guard = 0; guard < 10 && isWeekend(cursor); guard += 1) {
    cursor = addDays(cursor, -1);
  }
  return cursor;
}

/**
 * Did `source` owe a mark ON `asOf` itself?
 *
 * The same question {@link lastExpectedMarkDate} answers, asked the other way
 * round, and DERIVED from it rather than re-deciding it — a second `isWeekend`
 * test here is exactly the divergence this module exists to prevent. A daily venue
 * owes every day; a weekday venue owes a day it does not carry back off.
 */
export function owesMarkOn(source: PriceSource, asOf: string): boolean {
  return lastExpectedMarkDate(source, asOf) === asOf;
}
