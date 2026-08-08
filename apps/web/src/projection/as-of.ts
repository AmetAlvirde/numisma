/**
 * The projection's AS-OF VOCABULARY: every operation on the `as_of` calendar-date
 * key, in one place — the ordering key, the wall-clock reading, and the day
 * arithmetic the engine owns. Pure, and with no `pg` import anywhere in its reach.
 *
 * WHY IT IS ITS OWN FILE. Not for the reason it was originally split out: back then
 * `contract.ts` imported the `pg` driver, and this file was the escape hatch that
 * let the browser-side verdict module reach {@link asOfSortKey} without dragging
 * the driver into the client bundle. Audit finding 8 removed that pressure — the
 * driver now lives in `./snapshot-reader.ts` and `contract.ts` is pg-free — so this
 * module survives on the reason that actually holds: `asOfSortKey`,
 * {@link calendarDateOf} and the re-exported `addDays`/`daysBetween` are ONE
 * vocabulary with one rationale (UTC throughout, typed ordering never lexical), and
 * splitting them across the contract and the engine would leave that rationale
 * nowhere to live.
 *
 * `asOfSortKey` is re-exported from `contract.ts` because ordering is part of the
 * stored contract's surface. This file is where it is IMPLEMENTED and explained.
 */

/**
 * Chronologically-comparable sort key for an `as_of` calendar date.
 *
 * `as_of` is stored as TEXT (schema.sql), so a SQL `ORDER BY as_of` is a *lexical*
 * TEXT sort — correct ONLY while every value is strict zero-padded ISO
 * (`YYYY-MM-DD`). It silently picks the wrong "latest" the moment a value is not
 * zero-padded: lexically `"2026-10-01" < "2026-9-1"` (because `'1' < '9'` at the
 * fifth character), yet October is chronologically *after* September. We therefore
 * arbitrate "latest" on a *typed* numeric key (year*10000 + month*100 + day)
 * rather than trusting TEXT order.
 *
 * Throwing on an unparseable `as_of` keeps the contract honest: a value we cannot
 * order chronologically must not silently win or lose under a lexical fallback.
 */
export function asOfSortKey(asOf: string): number {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(asOf);
  if (!match) {
    throw new Error(
      `getSnapshotHistory: as_of ${JSON.stringify(asOf)} is not a sortable ISO calendar date`,
    );
  }
  const [, year, month, day] = match;
  return Number(year) * 10000 + Number(month) * 100 + Number(day);
}

/**
 * `addDays` / `daysBetween` moved to `@numisma/engine`'s calendar module — the ONE
 * home for this arithmetic, next to the `asOf` convention `tradingDayAsOf` owns.
 * They were born here and the push glance builder had copied them privately; a
 * package cannot import from an app, so a third consumer would have written a
 * third copy. Re-exported so this module still reads as the projection's whole
 * as-of vocabulary, and so the UTC-throughout rationale has exactly one place to
 * live. Guarded by `apps/web/src/calendar-contract.test.ts`.
 *
 * The subpath, not the engine root: `glance/verdict.ts` reaches this module from
 * the BROWSER, and the root pulls `node:os`/`node:path` (data-dir) into its reach.
 */
export { addDays, daysBetween } from "@numisma/engine/calendar";

/** The UTC calendar date a wall clock is currently on. */
export function calendarDateOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}
