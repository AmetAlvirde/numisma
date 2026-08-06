/**
 * `@numisma/price-feed` — the headless runtime shell for the two-plane price
 * model (ADR-005). It hosts the provider fetch, the disposable price-store IO,
 * the atomic inbox emit, and the CLI. It depends on `@numisma/engine` and
 * `@numisma/event-store` — never on `@numisma/tui` — so any future access surface
 * (web, scheduler) can reuse the pipeline. All domain decisions live in the
 * engine's pure core.
 */
export type { PriceFeedConfig, ProviderCredentials } from "./config.js";
export { DEFAULT_CONFIG, readCredentialsFromEnv } from "./config.js";
export { atomicWrite, type AtomicWriteIo } from "./atomic-write.js";
export { fetchBinanceDailyClose } from "./binance-provider.js";
export type { ProviderObservation, FetchOptions } from "./provider.js";
export { fetchTwelveDataDailyClose, type EquitiesFetchOptions } from "./twelvedata-provider.js";
export { fetchBanxicoFix, type FixFetchOptions } from "./banxico-provider.js";
export { upsertQuote } from "./price-store.js";
export { emitMarksToInbox } from "./inbox.js";
export { resolvePriceFeedPaths, type PriceFeedPaths } from "./paths.js";
export {
  runPriceFetch,
  type FetchRunResult,
  type FetchFailure,
  type RunOptions,
} from "./fetch-prices.js";
export {
  loadSpineReference,
  findMarkRejections,
  marksFromRun,
  scanFetchedMarks,
  type MarkRejection,
  type SpineReferencePaths,
  type RejectionScan,
} from "./rejection-check.js";
