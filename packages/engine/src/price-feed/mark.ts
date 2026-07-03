/**
 * The pure mark-instant contract (ADR-005): everything that turns a raw provider
 * observation into a fund-history `PriceMarked` valuation mark WITHOUT any IO.
 *
 * Two decoupled planes, one clock. The disposable market-data plane stores a
 * {@link Quote} every fetch; the fund-history plane emits at most one
 * `PriceMarkedEvent` per instrument per mark period. Both derive their `asOf`
 * from the SAME configured-timezone trading day, and the deterministic id
 * `pm-<instrumentId>-<asOf>` makes one-mark-per-period self-enforcing: a repeated
 * fetch re-computes the identical id, which both the inbox merge and the ingest
 * dedup skip. The prototype's private `PriceMarkedCandidate` is gone — a mark is
 * now the engine's real {@link PriceMarkedEvent}, so contract drift is a compile
 * error, not an ingest-time surprise.
 */
import type { PriceMarkedEvent } from "../events/types.js";
import type { PriceSource } from "./registry.js";

/**
 * One row of the disposable price store (`data/prices/<instrumentId>.jsonl`).
 * `asOf` is the trading-day date in the CONFIGURED timezone (never the provider's
 * raw UTC candle day); `price` is the provider close as-is (the v1 no-rounding
 * decision); `fetchedAt` is the ISO instant of the run that observed it.
 */
export interface Quote {
  instrumentId: string;
  symbol: string;
  asOf: string;
  price: number;
  source: PriceSource;
  fetchedAt: string;
}

/**
 * The two configurable knobs of the mark-instant contract. The DEFAULTS
 * (`America/Mexico_City`, `18:00`) live in `@numisma/price-feed`'s config module;
 * the INVARIANT enforced here — a timezone-anchored `asOf` and one mark per period
 * — is not configurable.
 */
export interface MarkClock {
  /** IANA timezone the trading day is anchored to (e.g. `America/Mexico_City`). */
  timeZone: string;
  /** Daily mark time as `HH:MM` local; a fetch before it emits no mark. */
  markTime: string;
}

/**
 * The trading-day date (`YYYY-MM-DD`) of `instant` in `timeZone`. This is the
 * ADR-005 fix for the prototype bug: a CDMX-evening fetch of a UTC-dated daily
 * candle must be labeled with the LOCAL trading day, never the provider's UTC
 * "tomorrow." Pure and deterministic — `Intl` reads no clock of its own.
 */
export function tradingDayAsOf(instant: Date, timeZone: string): string {
  const parts = localDateParts(instant, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Whether `instant`, viewed in the clock's timezone, is at or after the daily
 * mark time. A pre-mark-time fetch upserts the store only and emits no mark
 * (R2); the first fetch at/after the mark time produces the period's one mark.
 */
export function isAtOrAfterMarkTime(instant: Date, clock: MarkClock): boolean {
  const { hour, minute } = localDateParts(instant, clock.timeZone);
  const { markHour, markMinute } = parseMarkTime(clock.markTime);
  return hour * 60 + minute >= markHour * 60 + markMinute;
}

/** The frozen deterministic mark id — a test-pinned contract (C2). */
export function priceMarkId(instrumentId: string, asOf: string): string {
  return `pm-${instrumentId}-${asOf}`;
}

/**
 * Construct the fund-history mark from a stored quote. It is the engine's real
 * {@link PriceMarkedEvent} (it satisfies `parsePriceMarked` and clears the ingest
 * gates unchanged), carrying the provider close as-is with no `usdMxn` — the FX
 * snapshot is a slice-2 concern.
 */
export function markFromQuote(quote: Quote): PriceMarkedEvent {
  return {
    id: priceMarkId(quote.instrumentId, quote.asOf),
    asOf: quote.asOf,
    type: "PriceMarked",
    instrumentId: quote.instrumentId,
    price: quote.price,
  };
}

interface LocalParts {
  year: string;
  month: string;
  day: string;
  hour: number;
  minute: number;
}

/** Decompose an instant into its wall-clock parts in `timeZone` via `Intl`. */
function localDateParts(instant: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const fields: Record<string, string> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== "literal") {
      fields[part.type] = part.value;
    }
  }
  const year = fields.year;
  const month = fields.month;
  const day = fields.day;
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`Unable to resolve trading day for timezone '${timeZone}'.`);
  }
  return {
    year,
    month,
    day,
    hour: Number(fields.hour ?? "0"),
    minute: Number(fields.minute ?? "0"),
  };
}

function parseMarkTime(markTime: string): { markHour: number; markMinute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(markTime);
  if (!match) {
    throw new Error(`Invalid mark time '${markTime}': expected HH:MM (e.g. 18:00).`);
  }
  const markHour = Number(match[1]);
  const markMinute = Number(match[2]);
  if (markHour > 23 || markMinute > 59) {
    throw new Error(`Invalid mark time '${markTime}': hour must be 00-23, minute 00-59.`);
  }
  return { markHour, markMinute };
}
