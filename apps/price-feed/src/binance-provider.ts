/**
 * The Binance public-REST provider (crypto, keyless). It performs network IO only
 * — no domain decisions: it fetches a symbol's last COMPLETED (settled) daily-close
 * observation and hands the raw close back for the pure engine to turn into a
 * quote/mark. It requests the newest TWO daily klines and takes the older, settled
 * one — never the still-running current-day candle (a live spot reading dressed as
 * a close). Every call is bounded by an `AbortController` timeout (R4) so a stalled
 * provider can never hang a scheduled run, and every failure carries the symbol so
 * it stays per-symbol attributable.
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
 * Fetch the last COMPLETED daily close for one registry entry from Binance. It asks
 * for the newest two 1d klines (`limit=2`) — Binance returns them ascending as
 * `[completed D, running D+1]` — and takes the settled candle `rows[0]`, never the
 * still-running `rows[1]`. Throws a symbol-attributable error on HTTP failure, an
 * unexpected payload shape, a payload with fewer than 2 rows (no settled candle to
 * mark), a non-positive close, or a timeout — the orchestrator records it as a
 * per-symbol failure and keeps going, never silently falling back to a running mark.
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
    const url = `${BINANCE_KLINES}?symbol=${entry.symbol}&interval=1d&limit=2`;
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
  if (!Array.isArray(rows)) {
    throw new Error(`Binance ${entry.symbol} -> unexpected payload shape`);
  }
  // Binance returns the newest two 1d klines ascending as [completed D, running
  // D+1]. Fewer than two rows means there is no SETTLED candle to mark — a
  // symbol-attributable failure (R4), never a silent fall-back to a running mark.
  if (rows.length < 2) {
    throw new Error(`Binance ${entry.symbol} -> expected >=2 klines, got ${rows.length}`);
  }
  // Take the completed candle (the older row), never the still-running rows[1].
  const row = rows[0];
  if (!Array.isArray(row)) {
    throw new Error(`Binance ${entry.symbol} -> unexpected payload shape`);
  }
  // Binance kline row: [openTime, open, high, low, close, volume, closeTime, ...].
  const close = Number(row[4]);
  if (!Number.isFinite(close) || close <= 0) {
    throw new Error(`Binance ${entry.symbol} -> non-positive close ${String(row[4])}`);
  }
  // The completed bar's own date, from its `openTime` (epoch ms), in UTC. The
  // orchestrator gates the crypto mark on this equalling the run's `asOf`; at/after
  // 18:00 CDMX the settled UTC candle's date equals `asOf` by construction. Fall
  // back to the fetch date only if a payload ever omits a usable openTime.
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
