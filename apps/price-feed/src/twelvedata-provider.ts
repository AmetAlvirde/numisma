/**
 * The Twelve Data provider (US equities, free key). Like the Binance provider it
 * performs network IO only — no domain decisions: it fetches each symbol's latest
 * daily-close observation in USD and hands the raw close back for the pure engine
 * to turn into a quote/mark (a direct USD mark for US-listed instruments, or the
 * USD leg of the `USD × FIX` derivation for `*-mxn` instruments).
 *
 * It rides the SAME reliability envelope as Binance (R4): every call is bounded by
 * an `AbortController` timeout so a stalled provider cannot hang a scheduled run,
 * and every failure carries the symbol so it stays per-symbol attributable.
 *
 * BATCHING + PACING (rate-limit fix): the free tier caps at 8 API CREDITS/minute
 * and a batched `time_series` costs 1 CREDIT PER SYMBOL, so the registry's 9 Twelve
 * Data symbols (3 US equities + 6 `*-mxn` USD legs) are 9 credits > 8 — a single
 * request 429s no matter how it is batched. This function packs a GIVEN chunk of
 * symbols into ONE comma-separated request (returning an object keyed by symbol);
 * the orchestrator (`fetch-prices.ts`) is what splits the 9 symbols into ≤8-credit
 * chunks and paces them a minute apart. A bad/failed symbol still becomes only THAT
 * instrument's failure (the others in the chunk succeed), preserving per-symbol
 * attribution.
 *
 * Provider decision (PRD-#105 open question 1): Twelve Data over Alpha Vantage —
 * see the equities rows in `@numisma/engine`'s registry for the rationale. The API
 * key is read from the environment (`TWELVEDATA_API_KEY`), never committed, and
 * passed in via {@link EquitiesFetchOptions.apiKey}.
 */
import type { InstrumentRegistryEntry } from "@numisma/engine";
import {
  fetchJson,
  isRecord,
  type FetchOptions,
  type ProviderObservation,
} from "./provider.js";

const TWELVEDATA_TIME_SERIES = "https://api.twelvedata.com/time_series";

export interface EquitiesFetchOptions extends FetchOptions {
  /** The Twelve Data API key, read from `TWELVEDATA_API_KEY`. */
  apiKey: string;
}

/**
 * One entry's outcome from a batched fetch: exactly one of `observation` (parsed
 * ok) or `error` (a symbol-attributable message) is set, and `entry` is always the
 * registry row it belongs to so the orchestrator can store the quote or record the
 * failure without re-looking-up the symbol.
 */
export interface ProviderFetchResult {
  entry: InstrumentRegistryEntry;
  observation?: ProviderObservation;
  error?: string;
}

/**
 * Fetch the latest daily close (USD) for every entry in ONE batched Twelve Data
 * request (`symbol=AAPL,GOOGL,...`), returning a per-entry result. A REQUEST-level
 * problem (missing key, HTTP failure, timeout, non-object body) fails every entry,
 * each attributably; a PER-SYMBOL problem (that symbol's `status:"error"`, a
 * missing row, a non-positive close, an unusable bar date) fails only that entry
 * while the rest of the batch still succeeds. Rides the same `AbortController`
 * timeout envelope as the single fetch (R4). Never throws for a data problem — it
 * maps it to a result — so one bad symbol can never abort the whole run.
 */
export async function fetchTwelveDataDailyCloses(
  entries: readonly InstrumentRegistryEntry[],
  options: EquitiesFetchOptions,
): Promise<ProviderFetchResult[]> {
  if (entries.length === 0) {
    return [];
  }
  const now = options.now ?? (() => new Date());
  // A request-level failure is attributed to EVERY symbol (each still names itself).
  const failAll = (reason: string): ProviderFetchResult[] =>
    entries.map((entry) => ({ entry, error: `Twelve Data ${entry.symbol} -> ${reason}` }));

  if (!options.apiKey) {
    return failAll(
      `TWELVEDATA_API_KEY is not set; export a free Twelve Data key before fetching equities.`,
    );
  }

  // `encodeURIComponent` THROWS (`URIError`) on a lone surrogate, so building the
  // URL is itself a failure channel: a malformed key or registry symbol must become
  // an attributed result here, not a throw that escapes and aborts the whole run.
  let url: string;
  try {
    const symbols = entries.map((entry) => encodeURIComponent(entry.symbol)).join(",");
    url =
      `${TWELVEDATA_TIME_SERIES}?symbol=${symbols}` +
      `&interval=1day&outputsize=1&apikey=${encodeURIComponent(options.apiKey)}`;
  } catch (error) {
    return failAll(error instanceof Error ? error.message : String(error));
  }
  const r = await fetchJson(url, {
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
  });
  if (!r.ok) {
    return failAll(r.reason);
  }
  const body = r.body;
  if (!isRecord(body)) {
    return failAll(`unexpected payload shape`);
  }
  // Twelve Data returns the UN-KEYED `{ values, status }` shape for a SINGLE symbol
  // and a map keyed by symbol for MULTIPLE. A batch-level rejection (e.g. a bad key)
  // comes back as a top-level `{ status:"error", message }` even for many symbols —
  // attribute that to every entry.
  if (entries.length > 1 && body.status === "error") {
    const message = typeof body.message === "string" ? body.message : "unknown error";
    return failAll(message);
  }
  return entries.map((entry) => {
    const symbolBody = entries.length === 1 ? body : body[entry.symbol];
    try {
      return { entry, observation: observationFromBody(entry, symbolBody, now) };
    } catch (error) {
      return { entry, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

/**
 * Fetch the latest daily close (USD) for one registry entry from Twelve Data — a
 * thin wrapper over the batched {@link fetchTwelveDataDailyCloses} (a single symbol
 * is just a one-element batch). Throws a symbol-attributable error on a missing key,
 * HTTP failure, a Twelve Data `status:"error"` body, an unexpected payload shape, a
 * non-positive close, or a timeout — the orchestrator records it as a per-symbol
 * failure and keeps going.
 */
export async function fetchTwelveDataDailyClose(
  entry: InstrumentRegistryEntry,
  options: EquitiesFetchOptions,
): Promise<ProviderObservation> {
  const [result] = await fetchTwelveDataDailyCloses([entry], options);
  if (result === undefined || result.observation === undefined) {
    throw new Error(result?.error ?? `Twelve Data ${entry.symbol} -> no result returned`);
  }
  return result.observation;
}

/**
 * Parse one symbol's slice of a Twelve Data response into a {@link ProviderObservation},
 * or throw a symbol-attributable error. Shared by the single and batched fetches so
 * both apply identical validation. `symbolBody` is the un-keyed `{ values, status }`
 * object for that symbol (the whole body for a single-symbol request, or one keyed
 * entry from a batch).
 */
function observationFromBody(
  entry: InstrumentRegistryEntry,
  symbolBody: unknown,
  now: () => Date,
): ProviderObservation {
  if (!isRecord(symbolBody)) {
    throw new Error(`Twelve Data ${entry.symbol} -> unexpected payload shape`);
  }
  // Twelve Data signals a rejected symbol with a 200 + { status: "error", message }.
  if (symbolBody.status === "error") {
    const message = typeof symbolBody.message === "string" ? symbolBody.message : "unknown error";
    throw new Error(`Twelve Data ${entry.symbol} -> ${message}`);
  }
  const values = symbolBody.values;
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
    observationDate: barDateFromRow(entry, row),
  };
}

/**
 * The bar's own date (`YYYY-MM-DD`) from a Twelve Data row's `datetime` (which may
 * be `"YYYY-MM-DD"` or `"YYYY-MM-DD HH:MM:SS"`). This is what lets the orchestrator
 * skip a stale equity close on a weekend/holiday (the latest bar is a prior trading
 * day); a row with no usable date is a malformed payload, thrown attributably.
 */
function barDateFromRow(entry: InstrumentRegistryEntry, row: Record<string, unknown>): string {
  const datetime = typeof row.datetime === "string" ? row.datetime : "";
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(datetime);
  if (!match) {
    throw new Error(`Twelve Data ${entry.symbol} -> unexpected payload shape (no bar datetime)`);
  }
  return match[1]!;
}
