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

/**
 * Every price data source the registry can resolve an instrument to. `twelvedata`
 * is the free-key US-equities provider chosen for slice 2 (see below); the Banxico
 * SF43718 FIX is NOT a source here — it is the USD/MXN rate the `*-mxn` derivation
 * multiplies by, not an instrument that gets its own quote row.
 */
export type PriceSource = "binance" | "twelvedata";

/**
 * One registry row: a genesis `instrumentId` bound to the provider `symbol` that
 * quotes it, the `quoteCurrency` the resulting MARK is denominated in, and the
 * serving `source`.
 *
 * For `derived` rows (the `*-mxn` SIC instruments) `symbol` is the US-listed
 * ticker fetched in USD from `source`, `quoteCurrency` is `MXN`, and the mark is
 * the pure `USD close × FIX` derivation (see `derive.ts`) — never a direct
 * provider quote. For non-derived rows the provider quote is the mark currency
 * as-is (Binance USDT pairs are treated as USD at daily granularity).
 */
export interface InstrumentRegistryEntry {
  instrumentId: string;
  symbol: string;
  quoteCurrency: Currency;
  source: PriceSource;
  /**
   * True for MXN-listed SIC instruments whose mark is DERIVED as `USD close × FIX`
   * with the `usdMxn` snapshot attached — an explicit, recorded modeling
   * approximation (ADR-005), not a provider quote. Absent/false = direct quote.
   */
  derived?: boolean;
  /**
   * The first `YYYY-MM-DD` on which this instrument owes a mark. Absent means it has
   * owed one since genesis, which is true of every row registered before this field
   * existed.
   *
   * WHY A REGISTRY ROW NEEDS A DATE AT ALL. The glance builder expects every
   * registered instrument on every anchor, and `pnpm backfill` refolds EVERY anchor
   * nightly. A row added today with no date is owed on every historical anchor, none
   * of which can ever hold its mark, so the first backfill after it lands suppresses
   * fund value, change and Reserve % across the whole hosted history.
   *
   * WHY IT IS STATED HERE AND NOT DERIVED FROM THE FIRST MARK. "Expected once it has
   * marked" never expects an instrument whose feed has never worked, which is a false
   * *no* on exactly the day a new row is most likely to be broken. Set it to the day
   * the row lands. That is always safe, since no earlier anchor can owe a mark the
   * feed was not yet fetching, and it is public. Never use the day the position
   * opened: that is trade data, and this repository is public.
   */
  expectedFrom?: string;
}

/**
 * Crypto rows served by Binance public REST (keyless). GRAM is ex-TON; the
 * `GRAMUSDT` / `RENDERUSDT` symbols were verified live on Binance 2026-07-03.
 */
const CRYPTO_ENTRIES: readonly InstrumentRegistryEntry[] = [
  { instrumentId: "btc", symbol: "BTCUSDT", quoteCurrency: "USD", source: "binance" },
  { instrumentId: "eth", symbol: "ETHUSDT", quoteCurrency: "USD", source: "binance" },
  { instrumentId: "render", symbol: "RENDERUSDT", quoteCurrency: "USD", source: "binance" },
  { instrumentId: "gram", symbol: "GRAMUSDT", quoteCurrency: "USD", source: "binance" },
];

/**
 * US-listed equities quoted directly in USD by the chosen free-key provider.
 *
 * Provider decision (resolves PRD-#105 open question 1): TWELVE DATA over Alpha
 * Vantage. Both fit this registry seam identically, but Twelve Data's free tier
 * (800 req/day, 8 req/min) comfortably covers the daily cadence, where Alpha
 * Vantage's 25 req/day free cap would be exhausted almost immediately. NOTE: the 8
 * req/min cap does NOT fit the 10 Twelve Data symbols below (3 equities + 7 `*-mxn`
 * USD legs) in one minute, batched or not: a batch costs one credit PER SYMBOL. What
 * makes them fit is BATCHING plus PACING: the fetch shell packs at most 8 symbols
 * into each comma-separated `/time_series` request and sleeps a minute between
 * requests (see `fetchTwelveDataDailyCloses` and `twelveDataMaxSymbolsPerMinute`). Twelve Data's
 * `/time_series?interval=1day` returns a daily OHLC row that maps cleanly onto the
 * same `ProviderObservation` shape the Binance kline already produces.
 */
const EQUITY_ENTRIES: readonly InstrumentRegistryEntry[] = [
  { instrumentId: "aapl", symbol: "AAPL", quoteCurrency: "USD", source: "twelvedata" },
  { instrumentId: "googl", symbol: "GOOGL", quoteCurrency: "USD", source: "twelvedata" },
  { instrumentId: "tsla", symbol: "TSLA", quoteCurrency: "USD", source: "twelvedata" },
];

/**
 * MXN-listed SIC instruments. Each is priced from its US-listed underlying
 * (`symbol`) fetched in USD from `source`, then DERIVED to an MXN mark as
 * `USD close × FIX` with the `usdMxn` snapshot attached (ADR-005 MXN-derivation
 * honesty). The FIX is the Banxico SF43718 USD/MXN rate.
 */
const MXN_DERIVED_ENTRIES: readonly InstrumentRegistryEntry[] = [
  { instrumentId: "eww-mxn", symbol: "EWW", quoteCurrency: "MXN", source: "twelvedata", derived: true },
  { instrumentId: "intc-mxn", symbol: "INTC", quoteCurrency: "MXN", source: "twelvedata", derived: true },
  { instrumentId: "nke-mxn", symbol: "NKE", quoteCurrency: "MXN", source: "twelvedata", derived: true },
  { instrumentId: "nu-mxn", symbol: "NU", quoteCurrency: "MXN", source: "twelvedata", derived: true },
  { instrumentId: "rivn-mxn", symbol: "RIVN", quoteCurrency: "MXN", source: "twelvedata", derived: true },
  { instrumentId: "sbux-mxn", symbol: "SBUX", quoteCurrency: "MXN", source: "twelvedata", derived: true },
  { instrumentId: "mcd-mxn", symbol: "MCD", quoteCurrency: "MXN", source: "twelvedata", derived: true, expectedFrom: "2026-10-08" },
];

const REGISTRY: ReadonlyMap<string, InstrumentRegistryEntry> = new Map(
  [...CRYPTO_ENTRIES, ...EQUITY_ENTRIES, ...MXN_DERIVED_ENTRIES].map((entry) => [
    entry.instrumentId,
    entry,
  ]),
);

/** Every registered instrument served by the given `source` (fetch loop input). */
export function instrumentsForSource(source: PriceSource): InstrumentRegistryEntry[] {
  return [...REGISTRY.values()].filter((entry) => entry.source === source);
}

/**
 * Does `entry` owe a mark on `date`? True from its `expectedFrom` onward, and always
 * for a row without one. Lexicographic `<=` is date order on `YYYY-MM-DD`, the
 * comparison this codebase uses throughout.
 *
 * Callers pass the date the mark is OWED FOR, not the anchor: the glance builder
 * passes `lastExpectedMarkDate(source, asOf)`, so a Sunday anchor after a Friday
 * start date still owes Friday's mark, and one after a Saturday start owes nothing
 * until Monday.
 */
export function isExpectedOn(entry: InstrumentRegistryEntry, date: string): boolean {
  return entry.expectedFrom === undefined || entry.expectedFrom <= date;
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
