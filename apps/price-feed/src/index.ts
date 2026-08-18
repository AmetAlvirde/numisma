/**
 * `@numisma/price-feed` — the headless runtime shell for the two-plane price
 * model (ADR-005). It hosts the provider fetch, the disposable price-store IO,
 * the atomic inbox emit, and the CLI. It depends on `@numisma/engine` and
 * `@numisma/event-store` — never on `@numisma/tui` — so any future access surface
 * (web, scheduler) can reuse the pipeline. All domain decisions live in the
 * engine's pure core.
 *
 * WHAT IS AND IS NOT PUBLISHED (audit finding 18). This barrel is shaped for that
 * future consumer, not for the package's internals. `atomic-write.ts` and
 * `price-store.ts` are internal plumbing — the three modules that use them do so by
 * relative import — so they are deliberately NOT re-exported here. And Twelve Data
 * is published only in its BATCHED form: the registry's 9 Twelve Data symbols cost
 * 1 credit each against a free-tier cap of 8/minute, so a consumer looping a
 * single-symbol fetch would 429 itself. `fetchTwelveDataDailyCloses` is the call
 * `runPriceFetch` itself drives. `src/index.test.ts` locks this exact set.
 */
export type { PriceFeedConfig, ProviderCredentials } from "./config.js";
export { DEFAULT_CONFIG, readCredentialsFromEnv } from "./config.js";
export { fetchBinanceDailyClose, type BinanceFetchOptions } from "./binance-provider.js";
export type { ProviderObservation, FetchOptions } from "./provider.js";
export {
  fetchTwelveDataDailyCloses,
  type EquitiesFetchOptions,
  type ProviderFetchResult,
} from "./twelvedata-provider.js";
export { fetchBanxicoFix, type FixFetchOptions } from "./banxico-provider.js";
export { emitMarksToInbox } from "./inbox.js";
export { resolvePriceFeedPaths, type PriceFeedPaths } from "./paths.js";
export {
  runPriceFetch,
  type FetchRunResult,
  type FetchFailure,
  type RunOptions,
  // `FetchRunResult`'s own member types. Without these a front-door consumer can
  // READ `result.notOwed` / `result.staleMarkSkips` but cannot name the element
  // type to hold one in a variable or a signature — which is a published surface
  // that is not actually usable.
  type NotOwed,
  type MarkSkip,
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
