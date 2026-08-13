/**
 * The one documented home for price-feed configuration defaults (ADR-005). The
 * INVARIANT — a timezone-anchored `asOf` and one mark per instrument per mark
 * period — lives in the engine and is not configurable; the concrete knobs below
 * are. Promotion to a user-editable config artifact is deferred until a second
 * knob-turner exists (there is one operator today), so these are named defaults,
 * not a sidecar.
 */
import {
  resolveDataDir,
  MARK_TIME,
  TRADING_DAY_TIME_ZONE,
  type MarkClock,
} from "@numisma/engine";

export interface PriceFeedConfig extends MarkClock {
  /**
   * IANA trading-day timezone the mark `asOf` is anchored to. Defaults to the
   * engine's `TRADING_DAY_TIME_ZONE` (CDMX) so a CDMX-evening fetch is dated the
   * local trading day, not the provider's UTC tomorrow. DERIVED, NOT RESTATED: the
   * durable log's gap report and the daily wrapper have to agree with this value,
   * and a second literal here would let them drift apart while both compile.
   */
  timeZone: string;
  /**
   * Daily mark time (`HH:MM` local). A fetch before it upserts the store only.
   * Defaults to the engine's `MARK_TIME`, built from the same `MARK_HOUR` the
   * wrapper's mark-window comparison is pinned against.
   */
  markTime: string;
  /**
   * Per-request network budget in milliseconds, covering CONNECT + HEADERS + BODY
   * DECODE — not just time-to-headers. `fetchJson` holds one `AbortController` over
   * the whole exchange (the decode is inside the guarded region on purpose), so this
   * single number funds every phase and must be sized for the slowest of them
   * together. A stalled provider still cannot hang a scheduled run (R4); bounded
   * retry/backoff is deferred (a missed run is harmless under the idempotent
   * deterministic id).
   */
  requestTimeoutMs: number;
  /**
   * How many calendar days old the Banxico USD/MXN FIX may be before an `*-mxn`
   * derivation refuses it (ADR-005: no stale-rate reuse). Default 4 tolerates a
   * Friday FIX marking through a weekend plus one holiday; an older FIX fails the
   * derivation loudly rather than silently reusing it.
   */
  fixMaxStaleDays: number;
  /**
   * Root data directory holding the price store and the inbox. Defaults to an
   * ABSOLUTE path in the sibling `accumulus` repo (`~/Dev/accumulus/data`; see the
   * engine's `resolveDataDir`), overridable via `NUMISMA_DATA_DIR` or any explicit
   * path. Never a CWD-relative `"data"`.
   */
  dataDir: string;
  /**
   * Max Twelve Data symbols fetched per minute. The free Basic tier caps at 8 API
   * CREDITS/minute and a batched `time_series` request costs 1 CREDIT PER SYMBOL
   * (per Twelve Data docs) — so the registry's 9 equity symbols cannot clear the
   * cap in one request (9 credits > 8 ⇒ HTTP 429), batched or not. The fetch
   * therefore paces equities in chunks of this size, sleeping {@link twelveDataPauseMs}
   * between chunks. Default 8 = the free cap; a paid tier can raise this to fetch
   * every symbol in one window (set it ≥ the equity count to disable pacing).
   */
  twelveDataMaxSymbolsPerMinute: number;
  /**
   * Milliseconds to pause between Twelve Data chunks so the per-minute credit quota
   * resets before the next chunk. Default 60_000 (the quota resets each minute). A
   * daily fetch with 9 equity symbols therefore takes ~one extra minute; that is
   * fine for a daily/scheduled run and the only cost of staying on the free tier.
   */
  twelveDataPauseMs: number;
}

export const DEFAULT_CONFIG: PriceFeedConfig = {
  timeZone: TRADING_DAY_TIME_ZONE,
  markTime: MARK_TIME,
  requestTimeoutMs: 30_000,
  fixMaxStaleDays: 4,
  // The SINGLE engine resolver: `NUMISMA_DATA_DIR` override with an absolute,
  // homedir-derived accumulus default (`~/Dev/accumulus/data`), never a CWD-relative
  // `"data"`. price-feed reads it at import time; the tui reads it per call — both
  // equivalent for a CLI process (D8). Both planes resolve the same store.
  dataDir: resolveDataDir(),
  twelveDataMaxSymbolsPerMinute: 8,
  twelveDataPauseMs: 60_000,
};

/**
 * Provider credentials, read from the environment — NEVER committed. Document the
 * two variables here so operators know what to export:
 *   - `TWELVEDATA_API_KEY` — free Twelve Data key for US equities.
 *   - `BANXICO_TOKEN`      — free Banxico SIE token for the USD/MXN FIX (SF43718).
 * Binance is keyless, so no credential is needed for crypto.
 */
export interface ProviderCredentials {
  twelveDataApiKey: string;
  banxicoToken: string;
}

/** Read the provider credentials from `process.env`; missing keys become "". */
export function readCredentialsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProviderCredentials {
  return {
    twelveDataApiKey: env.TWELVEDATA_API_KEY ?? "",
    banxicoToken: env.BANXICO_TOKEN ?? "",
  };
}
