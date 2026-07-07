/**
 * The one documented home for price-feed configuration defaults (ADR-005). The
 * INVARIANT — a timezone-anchored `asOf` and one mark per instrument per mark
 * period — lives in the engine and is not configurable; the concrete knobs below
 * are. Promotion to a user-editable config artifact is deferred until a second
 * knob-turner exists (there is one operator today), so these are named defaults,
 * not a sidecar.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
  /**
   * Root data directory holding the price store and the inbox. Defaults to an
   * ABSOLUTE path in the sibling `accumulus` repo (`~/Dev/accumulus/data`; see
   * `resolveWorkspaceDataDir`), overridable via `NUMISMA_DATA_DIR` or any explicit
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

/**
 * The single real data plane's default now lives in the sibling private `accumulus`
 * repo's `data/` — per the grill decision (the durable log lives in `accumulus`, not
 * the numisma checkout), the DEFAULT is `~/Dev/accumulus/data`, resolved from
 * `os.homedir()` (never a hardcoded `/Users/...`). `NUMISMA_DATA_DIR` still overrides.
 *
 * This is the same store `pnpm spine` reads. The prior workspace-root walk (anchoring
 * the default at `<repo>/data`) is retired as the default, but the reasoning it guarded
 * against still holds for any relative fallback: the package ships a `prices:fetch`
 * script run with CWD = `packages/price-feed`, so a CWD-relative default would silently
 * write a divergent ghost store. An ABSOLUTE default under the home dir sidesteps that
 * entirely and matches the tui event-store resolver.
 */
function resolveWorkspaceDataDir(): string {
  // NUMISMA_DATA_DIR override — the SINGLE knob that moves BOTH planes (price-feed AND
  // the tui event-store). When set, `~`-expanded and made absolute; otherwise default
  // to the sibling `accumulus` repo's `data/` (the grill's durable-log home).
  //
  // SHORTCUT: duplicated verbatim from `packages/tui/src/event-store.ts`
  // (`resolveDataDirDefault`). tui and price-feed share no runtime package and cannot
  // import each other, and ADR-001 keeps this IO out of the engine — so the honest
  // minimal placement is the same few lines in each resolver. Keep the two copies in sync.
  const fromEnv = process.env.NUMISMA_DATA_DIR;
  if (fromEnv && fromEnv.trim() !== "") {
    const raw = fromEnv.trim();
    const expanded = raw === "~" || raw.startsWith("~/") ? join(homedir(), raw.slice(1)) : raw;
    return resolve(expanded);
  }
  return join(homedir(), "Dev", "accumulus", "data");
}

export const DEFAULT_CONFIG: PriceFeedConfig = {
  timeZone: "America/Mexico_City",
  markTime: "18:00",
  requestTimeoutMs: 10_000,
  fixMaxStaleDays: 4,
  dataDir: resolveWorkspaceDataDir(),
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
