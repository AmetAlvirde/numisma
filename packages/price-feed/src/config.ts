/**
 * The one documented home for price-feed configuration defaults (ADR-005). The
 * INVARIANT — a timezone-anchored `asOf` and one mark per instrument per mark
 * period — lives in the engine and is not configurable; the concrete knobs below
 * are. Promotion to a user-editable config artifact is deferred until a second
 * knob-turner exists (there is one operator today), so these are named defaults,
 * not a sidecar.
 */
import type { MarkClock } from "@numisma/engine";

export interface PriceFeedConfig extends MarkClock {
  /**
   * IANA trading-day timezone the mark `asOf` is anchored to. Default CDMX so a
   * CDMX-evening fetch is dated the local trading day, not the provider's UTC
   * tomorrow.
   */
  timeZone: string;
  /** Daily mark time (`HH:MM` local). A fetch before it upserts the store only. */
  markTime: string;
  /**
   * Per-request network timeout in milliseconds. A stalled provider cannot hang a
   * scheduled run (R4); bounded retry/backoff is deferred (a missed run is
   * harmless under the idempotent deterministic id).
   */
  requestTimeoutMs: number;
  /**
   * How many calendar days old the Banxico USD/MXN FIX may be before an `*-mxn`
   * derivation refuses it (ADR-005: no stale-rate reuse). Default 4 tolerates a
   * Friday FIX marking through a weekend plus one holiday; an older FIX fails the
   * derivation loudly rather than silently reusing it.
   */
  fixMaxStaleDays: number;
  /** Root data directory holding the price store and the inbox. */
  dataDir: string;
}

export const DEFAULT_CONFIG: PriceFeedConfig = {
  timeZone: "America/Mexico_City",
  markTime: "18:00",
  requestTimeoutMs: 10_000,
  fixMaxStaleDays: 4,
  dataDir: "data",
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
