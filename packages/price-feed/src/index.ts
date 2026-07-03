/**
 * `@numisma/price-feed` — the headless runtime shell for the two-plane price
 * model (ADR-005). It hosts the provider fetch, the disposable price-store IO,
 * the atomic inbox emit, and the CLI, and depends ONLY on `@numisma/engine`,
 * never on `@numisma/tui`, so any future access surface (web, scheduler) can
 * reuse the pipeline. All domain decisions live in the engine's pure core.
 */
export type { PriceFeedConfig } from "./config.js";
export { DEFAULT_CONFIG } from "./config.js";
export { atomicWrite, type AtomicWriteIo } from "./atomic-write.js";
export { fetchBinanceDailyClose, type ProviderObservation, type FetchOptions } from "./binance-provider.js";
export { upsertQuote } from "./price-store.js";
export { emitMarksToInbox } from "./inbox.js";
export { resolvePriceFeedPaths, type PriceFeedPaths } from "./paths.js";
export {
  runPriceFetch,
  type FetchRunResult,
  type FetchFailure,
  type RunOptions,
} from "./fetch-prices.js";
