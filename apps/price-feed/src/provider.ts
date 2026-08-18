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
 * How much of a provider's own error text may ride along in a `reason`. Generous
 * enough for any real API sentence, small enough that an HTML interstitial served
 * in place of JSON cannot flood a scheduled run's log.
 */
const MAX_PROVIDER_TEXT = 200;

/** Trim, then clip to `MAX_PROVIDER_TEXT` with an ellipsis marking the cut. */
function clip(text: string): string {
  const trimmed = text.trim();
  return trimmed.length <= MAX_PROVIDER_TEXT
    ? trimmed
    : `${trimmed.slice(0, MAX_PROVIDER_TEXT)}…`;
}

/**
 * Recover the provider's own sentence from a non-ok response body, or `""` when
 * there is nothing usable.
 *
 * The three providers disagree on the key, so we prefer `message`, then `msg`, then
 * `error`, and fall back to a snippet of the raw text. EVERY step is guarded: a body
 * read that rejects, a body that is not JSON, a JSON body that is not an object, and
 * a preferred key holding a non-string all resolve to a usable string or `""`. A
 * non-ok status must never become a throw — the Result-not-throw contract is what
 * keeps one bad symbol from aborting a whole batched run.
 */
async function readErrorText(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    return "";
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return clip(raw);
  }
  if (isRecord(parsed)) {
    for (const key of ["message", "msg", "error"] as const) {
      const value = parsed[key];
      if (typeof value === "string" && value.trim() !== "") return clip(value);
    }
  }
  return clip(raw);
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
 *
 * A non-ok status appends the provider's own sentence when one can be recovered
 * (`HTTP 400 Bad Request — No data is available on the specified dates`), because a
 * bare `HTTP 400 Bad Request` reads as a malformed request when on the recovery path
 * it almost always means that day had no trading. The `HTTP <status> <statusText>`
 * prefix stays first and byte-identical — callers match it by prefix.
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
      const bare = `HTTP ${res.status} ${res.statusText}`;
      const explanation = await readErrorText(res);
      return { ok: false, reason: explanation === "" ? bare : `${bare} — ${explanation}` };
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
