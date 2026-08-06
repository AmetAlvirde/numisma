/**
 * The provider kernel: the contracts every price provider speaks and the one
 * network envelope they all ride.
 *
 * `fetchJson` deliberately returns a Result rather than throwing: the providers
 * disagree on channel (Binance and Banxico throw a symbol-attributable error;
 * Twelve Data maps a request-level failure onto every entry in the batch, and
 * must never throw for a data problem). A helper that imposed a channel would
 * force one of them to convert back. Each provider surfaces the bare reason in
 * one line, with its own label — the helper never formats the label, because
 * Twelve Data's is built per batch entry.
 */

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
 * The outcome of one guarded JSON fetch. `reason` is BARE — no provider label, no
 * symbol: the caller owns the prefix (`Binance BTCUSDT -> …`), because Twelve Data
 * builds one prefix per entry in a batch.
 */
export type FetchJsonResult = { ok: true; body: unknown } | { ok: false; reason: string };

interface FetchJsonOptions {
  timeoutMs: number;
  /**
   * Injectable for tests; defaults to the global `fetch`. Explicitly `| undefined`
   * so a provider can forward its own optional `fetchImpl` straight through under
   * `exactOptionalPropertyTypes`.
   */
  fetchImpl?: typeof fetch | undefined;
  /** Extra request init (headers, method, …); the `signal` is always ours. */
  init?: RequestInit | undefined;
}

/**
 * Fetch `url` and decode its JSON body, bounded by an `AbortController` timeout
 * (R4) so a stalled provider can never hang a scheduled run. Returns a bare-reason
 * Result for a timeout, a transport error, a non-ok HTTP status, or a body that is
 * not JSON — the caller labels it.
 *
 * The JSON decode is INSIDE the guarded region on purpose: a 200 with a non-JSON
 * body (a maintenance page, a Cloudflare interstitial) used to escape each provider
 * as an unlabelled `SyntaxError`, which in Twelve Data's case aborted the whole run
 * against that function's own "never throws for a data problem" contract. Here it is
 * an ordinary `{ ok: false, reason }`, attributed by whoever asked for it.
 */
export async function fetchJson(
  url: string,
  options: FetchJsonOptions,
): Promise<FetchJsonResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const res = await fetchImpl(url, { ...options.init, signal: controller.signal });
    if (!res.ok) {
      return { ok: false, reason: `HTTP ${res.status} ${res.statusText}` };
    }
    return { ok: true, body: (await res.json()) as unknown };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { ok: false, reason: `request timed out after ${options.timeoutMs}ms` };
    }
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * True for any non-null object — INCLUDING arrays, deliberately. Every caller
 * follows the guard with a property read that an array answers `undefined`, which
 * the shape checks then refuse attributably, so a narrower predicate would buy
 * nothing. Package-internal: imported by sibling modules, intentionally NOT
 * re-exported from `index.ts` (same stance as `packages/engine/src/internal.ts`).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
