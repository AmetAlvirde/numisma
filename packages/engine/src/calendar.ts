/**
 * Calendar-date arithmetic over the `asOf`-as-`YYYY-MM-DD`-string convention —
 * the ONE home, shared by every plane that speaks it.
 *
 * WHY IT IS ITS OWN MODULE IN THE ENGINE. These helpers were born in
 * `apps/web/src/projection/as-of.ts`, validated and documented, and were then
 * copied — private and undocumented, validation dropped — into
 * `apps/web/src/push/glance.ts`. A package cannot import from an app, so the
 * next consumer would have written a THIRD copy. They live here instead,
 * alongside `tradingDayAsOf`'s `asOf` convention (`price-feed/mark.ts`), which
 * these two speak. `apps/tui/src/format-contract.test.ts` guards the same class
 * of de-duplication for the shared formatters (ADR-001's *Realized* note);
 * `apps/web/src/calendar-contract.test.ts` guards this one.
 *
 * PURE, AND BROWSER-SAFE BY CONSTRUCTION — no imports at all, so it is reachable
 * from a render surface through the `@numisma/engine/calendar` subpath without
 * dragging the engine root's `node:os` / `node:path` reach into the client
 * bundle. That is the same reason `@numisma/engine/format` exists.
 */

/**
 * The `YYYY-MM-DD` date `delta` days from `asOf`, read and written in UTC.
 *
 * UTC THROUGHOUT, deliberately. `new Date("2026-07-26")` parses as UTC midnight and
 * then renders in LOCAL time, which west of Greenwich lands on the previous day —
 * enough to call a Monday a Sunday. Every caller — the projection's as-of module
 * and the push glance builder alike — makes the same choice for the same reason.
 */
export function addDays(asOf: string, delta: number): string {
  const date = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`addDays: ${JSON.stringify(asOf)} is not a calendar date`);
  }
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

/**
 * Is this `YYYY-MM-DD` a Saturday or a Sunday?
 *
 * UTC, for the reason {@link addDays} states: a local-time `new Date("2026-07-26")`
 * is parsed as UTC midnight and then rendered in local time, which west of
 * Greenwich lands on the PREVIOUS day — enough to call a Monday a Sunday and
 * silently expect nothing of a weekday venue.
 *
 * It lives HERE rather than beside the venue cadence that consumes it because it
 * knows nothing about venues: it is the same pure UTC weekday read `weekdayName`
 * is, over the same string convention every plane in this repo speaks.
 */
export function isWeekend(asOf: string): boolean {
  const weekday = utcWeekday(asOf, "isWeekend");
  return weekday === 0 || weekday === 6;
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * The English weekday name for this `YYYY-MM-DD`, read in UTC.
 *
 * A HARDCODED TABLE rather than `Intl.DateTimeFormat`: the name is read by a
 * human triaging a feed, and it must be byte-identical on every host regardless
 * of the machine's ICU locale — a report that says "jueves" on one box and
 * "Thursday" on another is a report whose assertions cannot be written.
 */
export function weekdayName(asOf: string): string {
  return WEEKDAY_NAMES[utcWeekday(asOf, "weekdayName")] as string;
}

function utcWeekday(asOf: string, caller: string): number {
  const date = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${caller}: ${JSON.stringify(asOf)} is not a calendar date`);
  }
  return date.getUTCDay();
}

/** Whole calendar days from `from` to `to`, in UTC. Negative when `to` precedes `from`. */
export function daysBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    throw new Error(
      `daysBetween: ${JSON.stringify(from)} → ${JSON.stringify(to)} is not a date range`,
    );
  }
  return Math.round((end - start) / 86_400_000);
}
