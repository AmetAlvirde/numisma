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

/**
 * A raw provider observation: the close, the DATE of the bar it came from, and the
 * instant it was fetched. `observationDate` (`YYYY-MM-DD`) is the provider's own bar
 * date — a Binance 1d kline's `openTime` day (UTC), or a Twelve Data row's
 * `datetime` day. The orchestrator uses it to tell a fresh close from a stale one on
 * a market-closed day (see the per-provider bar-date rule in `fetch-prices.ts`); it
 * is NOT the trading-day `asOf` (which is timezone-anchored in the engine).
 */
export interface ProviderObservation {
  instrumentId: string;
  symbol: string;
  close: number;
  fetchedAt: string;
  /** The provider bar's own date (`YYYY-MM-DD`); see the interface doc above. */
  observationDate: string;
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
  // The bar's own date, from its `openTime` (epoch ms), in UTC. Crypto trades 24/7
  // so this date is informational only — the orchestrator does NOT gate crypto
  // marks on it (a Saturday bar is a real close), and it is deliberately NOT forced
  // to equal the CDMX trading-day `asOf`. Fall back to the fetch date if a payload
  // ever omits a usable openTime (crypto is ungated, so this never hides staleness).
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
