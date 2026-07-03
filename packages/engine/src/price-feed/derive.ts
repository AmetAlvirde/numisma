/**
 * The pure MXN derivation (ADR-005 MXN-derivation honesty). MXN-listed SIC
 * instruments are not quoted directly in MXN by any free provider we use; their
 * mark is DERIVED as `USD close × FIX` — an explicit, recorded modeling
 * approximation (arbitrage keeps SIC ≈ US × FX at daily granularity), with the
 * `usdMxn` FIX snapshot attached to the real `PriceMarkedEvent`. The derived
 * value is NEVER presented as a provider quote: it exists only on the mark,
 * flagged by the presence of `usdMxn`.
 *
 * Everything here is pure and IO-free (R1): the Banxico fetch/parse lives in the
 * price-feed shell; this module only validates freshness and does the arithmetic.
 * There is NO rounding — the provider close and the FIX rate are multiplied as-is
 * so the mark preserves full precision (the v1 no-rounding decision).
 */
import type { PriceMarkedEvent } from "../events/types.js";
import { priceMarkId, type Quote } from "./mark.js";

/**
 * One Banxico SF43718 (USD/MXN FIX) observation: the `rate` (MXN per USD) and the
 * `date` (`YYYY-MM-DD`) Banxico published it for. Parsed from the SIE payload by
 * the shell; consumed pure here.
 */
export interface FixObservation {
  /** MXN per USD, the Banxico SF43718 FIX. */
  rate: number;
  /** The FIX observation date (`YYYY-MM-DD`) reported by Banxico. */
  date: string;
}

/**
 * Return the FIX only if it is present and fresh enough to mark `asOf`, else throw
 * LOUD. A missing FIX (undefined) or one older than `maxStaleDays` calendar days
 * before the mark date must FAIL the `*-mxn` derivation — never silently reuse an
 * old rate, never emit an underived mark (ADR-005 / slice-2 reliability note). A
 * FIX dated in the future relative to the mark is also rejected as incoherent.
 */
export function requireFreshFix(
  fix: FixObservation | undefined,
  asOf: string,
  maxStaleDays: number,
): FixObservation {
  if (fix === undefined) {
    throw new Error(
      `USD/MXN FIX (Banxico SF43718) is unavailable — refusing to derive an MXN ` +
        `mark for ${asOf}. Not reusing a stale rate and not emitting an underived mark.`,
    );
  }
  if (!Number.isFinite(fix.rate) || fix.rate <= 0) {
    throw new Error(
      `USD/MXN FIX for ${asOf} is not a positive rate (${String(fix.rate)}) — ` +
        `refusing to derive an MXN mark.`,
    );
  }
  const ageDays = calendarDaysBetween(fix.date, asOf);
  if (ageDays < 0) {
    throw new Error(
      `USD/MXN FIX date ${fix.date} is AFTER the mark date ${asOf} — refusing to ` +
        `derive an MXN mark from an incoherent FIX.`,
    );
  }
  if (ageDays > maxStaleDays) {
    throw new Error(
      `USD/MXN FIX is stale: the latest Banxico SF43718 observation is dated ` +
        `${fix.date}, ${ageDays} day(s) before the mark date ${asOf}, beyond the ` +
        `${maxStaleDays}-day freshness window — refusing to reuse a stale rate.`,
    );
  }
  return fix;
}

/**
 * Derive the MXN mark for a `*-mxn` instrument from its USD leg quote and a fresh
 * FIX: `price = usdClose × fix.rate`, with `usdMxn = fix.rate` attached. The id is
 * the same frozen `pm-<instrumentId>-<asOf>` contract; the presence of `usdMxn`
 * records the mark as derived. No rounding is applied.
 */
export function deriveMxnMark(usdLeg: Quote, fix: FixObservation): PriceMarkedEvent {
  return {
    id: priceMarkId(usdLeg.instrumentId, usdLeg.asOf),
    asOf: usdLeg.asOf,
    type: "PriceMarked",
    instrumentId: usdLeg.instrumentId,
    price: usdLeg.price * fix.rate,
    usdMxn: fix.rate,
  };
}

/**
 * Whole calendar days from `fromDate` to `toDate` (both `YYYY-MM-DD`), positive
 * when `toDate` is later. Anchored at UTC midnight so it counts pure calendar days
 * with no timezone drift — the FIX date and the mark `asOf` are already
 * timezone-resolved dates, not instants.
 */
function calendarDaysBetween(fromDate: string, toDate: string): number {
  const from = parseIsoDateUtc(fromDate);
  const to = parseIsoDateUtc(toDate);
  const MS_PER_DAY = 86_400_000;
  return Math.round((to - from) / MS_PER_DAY);
}

function parseIsoDateUtc(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`Invalid date '${date}': expected YYYY-MM-DD.`);
  }
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
