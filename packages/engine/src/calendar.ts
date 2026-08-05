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
