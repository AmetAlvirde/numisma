/**
 * The typed instrument registry: the single source of truth mapping a genesis
 * `instrumentId` to the reference data a price provider needs — the provider
 * `symbol`, the `quoteCurrency` that symbol is denominated in, and the `source`
 * that serves it. It replaces the prototype's loose const `SYMBOL_MAP`.
 *
 * This is CODE-OWNED reference data (ADR-005 / ADR-001): it changes when a
 * provider integration is added, not when trader policy changes, so it lives in
 * the pure engine — not the ADR-004 preferences sidecar. `crossReferenceMark`'s
 * genesis-existence gate stays the runtime backstop; this registry is the
 * fetch-time backstop, failing loud on an unknown id rather than silently
 * skipping an instrument.
 */
import type { Currency } from "../contracts.js";

/** Every price data source the registry can resolve an instrument to. */
export type PriceSource = "binance";

/**
 * One registry row: a genesis `instrumentId` bound to the provider `symbol` that
 * quotes it, the `quoteCurrency` that symbol trades in (Binance USDT pairs are
 * treated as USD at daily granularity), and the serving `source`.
 */
export interface InstrumentRegistryEntry {
  instrumentId: string;
  symbol: string;
  quoteCurrency: Currency;
  source: PriceSource;
}

/**
 * Crypto rows served by Binance public REST (keyless). GRAM is ex-TON; the
 * `GRAMUSDT` / `RENDERUSDT` symbols were verified live on Binance 2026-07-03.
 * Equities and `*-mxn` rows arrive with slice 2 behind the same seam.
 */
const CRYPTO_ENTRIES: readonly InstrumentRegistryEntry[] = [
  { instrumentId: "btc", symbol: "BTCUSDT", quoteCurrency: "USD", source: "binance" },
  { instrumentId: "eth", symbol: "ETHUSDT", quoteCurrency: "USD", source: "binance" },
  { instrumentId: "render", symbol: "RENDERUSDT", quoteCurrency: "USD", source: "binance" },
  { instrumentId: "gram", symbol: "GRAMUSDT", quoteCurrency: "USD", source: "binance" },
];

const REGISTRY: ReadonlyMap<string, InstrumentRegistryEntry> = new Map(
  CRYPTO_ENTRIES.map((entry) => [entry.instrumentId, entry]),
);

/** Every registered instrument served by the given `source` (fetch loop input). */
export function instrumentsForSource(source: PriceSource): InstrumentRegistryEntry[] {
  return [...REGISTRY.values()].filter((entry) => entry.source === source);
}

/**
 * Resolve one `instrumentId` to its registry row, or throw loud (R5). An unknown
 * id is a registry omission, never a silent skip: the fetch orchestrator surfaces
 * it as an attributable failure, and `crossReferenceMark` remains the second gate.
 */
export function resolveInstrument(instrumentId: string): InstrumentRegistryEntry {
  const entry = REGISTRY.get(instrumentId);
  if (!entry) {
    throw new Error(
      `Unknown instrument id '${instrumentId}': it has no row in the price-feed ` +
        `instrument registry. Add one (instrumentId ↔ provider symbol ↔ quote ` +
        `currency ↔ source) before fetching it.`,
    );
  }
  return entry;
}
