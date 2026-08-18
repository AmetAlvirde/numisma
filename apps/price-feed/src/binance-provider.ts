/**
 * The Binance public-REST provider (crypto, keyless). It performs network IO only
 * — no domain decisions: it fetches ONE settled daily-close observation and hands
 * the raw close back for the pure engine to turn into a quote/mark.
 *
 * It has two request shapes. On the LIVE path it requests the newest TWO daily
 * klines and takes the older, settled one — never the still-running current-day
 * candle (a live spot reading dressed as a close). Given a `targetDate` it instead
 * windows the request to that one past UTC day and takes the single row that comes
 * back. Every call is bounded by an `AbortController` timeout (R4) so a stalled
 * provider can never hang a scheduled run, and every failure carries the symbol so
 * it stays per-symbol attributable.
 */
import type { InstrumentRegistryEntry } from "@numisma/engine";
import { fetchJson, type FetchOptions, type ProviderObservation } from "./provider.js";

const BINANCE_KLINES = "https://api.binance.com/api/v3/klines";
const DAY_MS = 86_400_000;

/**
 * Binance's own fetch options: the shared envelope plus an optional target day.
 *
 * The field is `targetDate`, NOT `asOf`: this layer knows only about the provider's
 * own bar dates (see `ProviderObservation.observationDate`). The trading-day `asOf`
 * is timezone-anchored in the engine and never reaches a provider.
 */
export interface BinanceFetchOptions extends FetchOptions {
  /** `YYYY-MM-DD` — one past UTC day to window the request to. */
  targetDate?: string | undefined;
}

/**
 * Fetch one settled daily close for a registry entry from Binance.
 *
 * Without `targetDate` (the live 18:00 path) it asks for the newest two 1d klines
 * (`limit=2`) — Binance returns them ascending as `[completed D, running D+1]` — and
 * takes the settled candle `rows[0]`, never the still-running `rows[1]`.
 *
 * With `targetDate` it asks for `startTime`/`endTime` bounding that UTC day in epoch
 * milliseconds, which returns exactly ONE row, and takes it.
 *
 * Throws a symbol-attributable error on HTTP failure, an unexpected payload shape, a
 * row count that carries no settled candle, a non-positive close, or a timeout — the
 * orchestrator records it as a per-symbol failure and keeps going, never silently
 * falling back to a running mark.
 */
export async function fetchBinanceDailyClose(
  entry: InstrumentRegistryEntry,
  options: BinanceFetchOptions,
): Promise<ProviderObservation> {
  const now = options.now ?? (() => new Date());
  const targetDate = options.targetDate;
  const base = `${BINANCE_KLINES}?symbol=${encodeURIComponent(entry.symbol)}&interval=1d`;
  let url: string;
  if (targetDate === undefined) {
    url = `${base}&limit=2`;
  } else {
    // The target UTC day as a half-closed instant range in epoch ms. Binance treats
    // `endTime` as INCLUSIVE, so the end is the day's last millisecond — a bare
    // `start + DAY_MS` would also admit the next day's candle.
    const start = Date.parse(`${targetDate}T00:00:00.000Z`);
    if (!Number.isFinite(start)) {
      throw new Error(`Binance ${entry.symbol} -> invalid target date ${targetDate}`);
    }
    url = `${base}&startTime=${start}&endTime=${start + DAY_MS - 1}`;
  }
  const r = await fetchJson(url, {
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  if (!r.ok) {
    throw new Error(`Binance ${entry.symbol} -> ${r.reason}`);
  }
  const rows = r.body;
  if (!Array.isArray(rows)) {
    throw new Error(`Binance ${entry.symbol} -> unexpected payload shape`);
  }
  if (targetDate === undefined) {
    // LIVE PATH ONLY. This `>= 2` rule is not payload validation — it is a PROXY FOR
    // SETTLEMENT. `limit=2` returns [completed D, running D+1]; fewer than two rows
    // means there may be no settled candle to mark, a symbol-attributable failure
    // (R4) rather than a silent fall-back to a running mark.
    if (rows.length < 2) {
      throw new Error(`Binance ${entry.symbol} -> expected >=2 klines, got ${rows.length}`);
    }
  } else if (rows.length < 1) {
    // DATE-PINNED PATH. A window over one past UTC day returns exactly one row, so
    // the settlement proxy above would reject every recovery. Settlement is instead
    // guaranteed upstream: the run's `asOf` is strictly earlier than the current
    // trading day, and in a UTC-6 timezone that makes this UTC candle complete by
    // construction. Zero rows means the day itself is absent — name it.
    throw new Error(`Binance ${entry.symbol} -> no kline for ${targetDate}`);
  }
  // The settled candle: the older row on the live path, the only row on the pinned one.
  const row = rows[0];
  if (!Array.isArray(row)) {
    throw new Error(`Binance ${entry.symbol} -> unexpected payload shape`);
  }
  // Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...].
  const close = Number(row[4]);
  if (!Number.isFinite(close) || close <= 0) {
    throw new Error(`Binance ${entry.symbol} -> non-positive close ${String(row[4])}`);
  }
  // The bar's own date, from its `openTime` (epoch ms), in UTC — read from the
  // payload on both paths, never assumed from the request. The orchestrator gates
  // the crypto mark on this equalling the run's `asOf`. Fall back to the fetch date
  // only if a payload ever omits a usable openTime.
  const openTime = Number(row[0]);
  const observationDate = (Number.isFinite(openTime) ? new Date(openTime) : now())
    .toISOString()
    .slice(0, 10);
  return {
    instrumentId: entry.instrumentId,
    symbol: entry.symbol,
    close,
    fetchedAt: now().toISOString(),
    observationDate,
  };
}
