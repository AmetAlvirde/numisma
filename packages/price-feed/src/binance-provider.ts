/**
 * The Binance public-REST provider (crypto, keyless). It performs network IO only
 * — no domain decisions: it fetches a symbol's latest daily-close observation and
 * hands the raw close back for the pure engine to turn into a quote/mark. Every
 * call is bounded by an `AbortController` timeout (R4) so a stalled provider can
 * never hang a scheduled run, and every failure carries the symbol so it stays
 * per-symbol attributable.
 */
import type { InstrumentRegistryEntry } from "@numisma/engine";

const BINANCE_KLINES = "https://api.binance.com/api/v3/klines";

/** A raw provider observation: the close and the instant it was fetched. */
export interface ProviderObservation {
  instrumentId: string;
  symbol: string;
  close: number;
  fetchedAt: string;
}

export interface FetchOptions {
  timeoutMs: number;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable clock for the `fetchedAt` stamp; defaults to `Date.now`. */
  now?: () => Date;
}

/**
 * Fetch the latest daily close for one registry entry from Binance. Throws a
 * symbol-attributable error on HTTP failure, an unexpected payload shape, a
 * non-positive close, or a timeout — the orchestrator records it as a per-symbol
 * failure and keeps going.
 */
export async function fetchBinanceDailyClose(
  entry: InstrumentRegistryEntry,
  options: FetchOptions,
): Promise<ProviderObservation> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let res: Response;
  try {
    const url = `${BINANCE_KLINES}?symbol=${entry.symbol}&interval=1d&limit=1`;
    res = await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Binance ${entry.symbol} -> request timed out after ${options.timeoutMs}ms`,
      );
    }
    throw new Error(
      `Binance ${entry.symbol} -> ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Binance ${entry.symbol} -> HTTP ${res.status} ${res.statusText}`);
  }
  const rows = (await res.json()) as unknown;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  if (!Array.isArray(row)) {
    throw new Error(`Binance ${entry.symbol} -> unexpected payload shape`);
  }
  // Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...].
  const close = Number(row[4]);
  if (!Number.isFinite(close) || close <= 0) {
    throw new Error(`Binance ${entry.symbol} -> non-positive close ${String(row[4])}`);
  }
  return {
    instrumentId: entry.instrumentId,
    symbol: entry.symbol,
    close,
    fetchedAt: now().toISOString(),
  };
}
