// Price-journey concern: weekly Close history ({@link buildPriceJourneys}), the
// latest-Close index used as a display-only coherence anchor
// ({@link latestCloseByInstrument}), and the markPrice/Close coherence tolerance.
// Cross-concern helpers are imported from the internal kernel, never re-copied.
import type {
  Close,
  FundReviewData,
  PriceJourney,
  PriceJourneyPoint,
  Warning,
} from "./contracts.js";
import {
  indexById,
  isIsoDate,
  isNonNegativeNumber,
  pushWarning,
  roundNumber,
} from "./internal.js";

/**
 * `markPrice` (the authoritative P&L input) and an instrument's latest Close
 * (display-only) are reconciled with the same hybrid shape as reserves:
 * `max(absolute floor, relative fraction × latestClose)`. The floor absorbs
 * sub-cent drift on small-priced instruments; the relative term scales the
 * forgiveness with the price so routine intraday slippage between a mark and the
 * weekly Close does not trip the warning, while a real divergence (beyond the
 * band) emits `markprice-close-mismatch`. The warning never alters valuation —
 * `markPrice` stays authoritative and Close stays display-only. Both terms are
 * named and tunable here.
 */
const MARKPRICE_CLOSE_ABS_TOLERANCE = 0.01;
const MARKPRICE_CLOSE_REL_TOLERANCE = 0.005; // 0.5% of the latest Close

/** Hybrid coherence tolerance for a markPrice against the given latest Close. */
export function markPriceCloseTolerance(latestClose: number): number {
  return Math.max(
    MARKPRICE_CLOSE_ABS_TOLERANCE,
    MARKPRICE_CLOSE_REL_TOLERANCE * Math.abs(latestClose),
  );
}

export function buildPriceJourneys(
  data: FundReviewData,
  warnings: Warning[],
): PriceJourney[] {
  if (!Array.isArray(data.closes) || data.closes.length === 0) {
    return [];
  }

  const instruments = indexById(data.instruments, "instrument");
  const byInstrument = new Map<string, PriceJourneyPoint[]>();
  for (const close of data.closes) {
    // A Close referencing an unknown Instrument or carrying an invalid scalar is
    // dropped from its journey, but the drop is surfaced via `skipped-close`
    // rather than silently swallowed — and a bad anchor never blocks its valid
    // siblings, which still render the journey for that instrument.
    const instrument = instruments.get(close.instrumentId);
    if (!instrument) {
      pushWarning(
        warnings,
        "skipped-close",
        `Close for unknown Instrument ${close.instrumentId} (as of ${String(close.asOf)}) was skipped; valid anchors still render.`,
        close.instrumentId,
      );
      continue;
    }
    if (!isIsoDate(close.asOf) || !isNonNegativeNumber(close.price)) {
      pushWarning(
        warnings,
        "skipped-close",
        `Close for Instrument ${close.instrumentId} (as of ${String(close.asOf)}) has an invalid date or price and was skipped; valid anchors still render.`,
        close.instrumentId,
      );
      continue;
    }
    const points = byInstrument.get(close.instrumentId) ?? [];
    points.push({ asOf: close.asOf, price: close.price });
    byInstrument.set(close.instrumentId, points);
  }

  const journeys: PriceJourney[] = [];
  for (const [instrumentId, points] of byInstrument) {
    if (points.length < 2) continue; // a single anchor is not a journey
    const sorted = [...points].sort((a, b) => a.asOf.localeCompare(b.asOf));
    const firstPrice = sorted[0]!.price;
    const latestPrice = sorted[sorted.length - 1]!.price;
    const instrument = instruments.get(instrumentId)!;
    journeys.push({
      instrumentId,
      label: `${instrument.symbol} (${instrument.name})`,
      currency: instrument.currency,
      points: sorted,
      firstPrice,
      latestPrice,
      changeAbs: latestPrice - firstPrice,
      changePct:
        firstPrice === 0
          ? 0
          : roundNumber(((latestPrice - firstPrice) / firstPrice) * 100, 12),
    });
  }

  return journeys.sort(
    (a, b) => b.points.length - a.points.length || a.label.localeCompare(b.label),
  );
}

/**
 * Latest valid Close per instrument, keyed by instrumentId. Only Closes with a
 * valid date and scalar are considered (an invalid scalar is surfaced as
 * `skipped-close` in {@link buildPriceJourneys}, not used as a coherence anchor).
 * "Latest" is the lexicographically greatest ISO `asOf`. Display-only: the result
 * feeds the non-blocking `markprice-close-mismatch` check and never valuation.
 */
export function latestCloseByInstrument(
  closes: Close[] | undefined,
): Map<string, Close> {
  const latest = new Map<string, Close>();
  if (!Array.isArray(closes)) return latest;
  for (const close of closes) {
    if (!isIsoDate(close.asOf) || !isNonNegativeNumber(close.price)) continue;
    const existing = latest.get(close.instrumentId);
    if (!existing || close.asOf.localeCompare(existing.asOf) > 0) {
      latest.set(close.instrumentId, close);
    }
  }
  return latest;
}
