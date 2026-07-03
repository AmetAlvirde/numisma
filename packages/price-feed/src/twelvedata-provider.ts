/**
 * The Twelve Data provider (US equities, free key). Like the Binance provider it
 * performs network IO only — no domain decisions: it fetches a symbol's latest
 * daily-close observation in USD and hands the raw close back for the pure engine
 * to turn into a quote/mark (a direct USD mark for US-listed instruments, or the
 * USD leg of the `USD × FIX` derivation for `*-mxn` instruments).
 *
 * It rides the SAME reliability envelope as Binance (R4): every call is bounded by
 * an `AbortController` timeout so a stalled provider cannot hang a scheduled run,
 * and every failure carries the symbol so it stays per-symbol attributable.
 *
 * Provider decision (PRD-#105 open question 1): Twelve Data over Alpha Vantage —
 * see the equities rows in `@numisma/engine`'s registry for the rationale. The API
 * key is read from the environment (`TWELVEDATA_API_KEY`), never committed, and
 * passed in via {@link EquitiesFetchOptions.apiKey}.
 */
import type { InstrumentRegistryEntry } from "@numisma/engine";
import type { FetchOptions, ProviderObservation } from "./binance-provider.js";

const TWELVEDATA_TIME_SERIES = "https://api.twelvedata.com/time_series";

export interface EquitiesFetchOptions extends FetchOptions {
  /** The Twelve Data API key, read from `TWELVEDATA_API_KEY`. */
  apiKey: string;
}

/**
 * Fetch the latest daily close (USD) for one registry entry from Twelve Data.
 * Throws a symbol-attributable error on a missing key, HTTP failure, a Twelve Data
 * `status:"error"` body, an unexpected payload shape, a non-positive close, or a
 * timeout — the orchestrator records it as a per-symbol failure and keeps going.
 */
export async function fetchTwelveDataDailyClose(
  entry: InstrumentRegistryEntry,
  options: EquitiesFetchOptions,
): Promise<ProviderObservation> {
  if (!options.apiKey) {
    throw new Error(
      `Twelve Data ${entry.symbol} -> TWELVEDATA_API_KEY is not set; export a free ` +
        `Twelve Data key before fetching equities.`,
    );
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  let res: Response;
  try {
    const url =
      `${TWELVEDATA_TIME_SERIES}?symbol=${encodeURIComponent(entry.symbol)}` +
      `&interval=1day&outputsize=1&apikey=${encodeURIComponent(options.apiKey)}`;
    res = await fetchImpl(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `Twelve Data ${entry.symbol} -> request timed out after ${options.timeoutMs}ms`,
      );
    }
    throw new Error(
      `Twelve Data ${entry.symbol} -> ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`Twelve Data ${entry.symbol} -> HTTP ${res.status} ${res.statusText}`);
  }
  const body = (await res.json()) as unknown;
  if (!isRecord(body)) {
    throw new Error(`Twelve Data ${entry.symbol} -> unexpected payload shape`);
  }
  // Twelve Data signals rejected requests with a 200 + { status: "error", message }.
  if (body.status === "error") {
    const message = typeof body.message === "string" ? body.message : "unknown error";
    throw new Error(`Twelve Data ${entry.symbol} -> ${message}`);
  }
  const values = body.values;
  const row = Array.isArray(values) ? values[0] : undefined;
  if (!isRecord(row)) {
    throw new Error(`Twelve Data ${entry.symbol} -> unexpected payload shape`);
  }
  const close = Number(row.close);
  if (!Number.isFinite(close) || close <= 0) {
    throw new Error(`Twelve Data ${entry.symbol} -> non-positive close ${String(row.close)}`);
  }
  return {
    instrumentId: entry.instrumentId,
    symbol: entry.symbol,
    close,
    fetchedAt: now().toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
