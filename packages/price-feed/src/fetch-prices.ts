/**
 * Fetch orchestration — thin wiring over the pure engine core and the shell IO.
 * It holds NO domain decisions (ADR-001/R1): the engine owns the registry, the
 * trading-day/mark-instant rule, quote→mark construction, and the inbox merge;
 * this function only sequences fetch → store → emit and tallies the run.
 *
 * Two-plane invariant (ADR-005): EVERY run upserts the price store; a mark is
 * emitted only at/after the configured mark time. The store and the mark share
 * one clock, so the stored quote and the queued mark cannot diverge on `asOf`.
 *
 * Sequential fetch is deliberate: a handful of daily calls sits far under
 * Binance's rate budget, and a bad symbol stays individually attributable
 * instead of masking the others (R4). Partial progress is always kept — a
 * failure records and continues; the run exits non-zero so a scheduler notices.
 */
import {
  instrumentsForSource,
  isAtOrAfterMarkTime,
  markFromQuote,
  tradingDayAsOf,
  type PriceMarkedEvent,
  type Quote,
} from "@numisma/engine";
import { mkdir } from "node:fs/promises";
import { DEFAULT_CONFIG, type PriceFeedConfig } from "./config.js";
import { fetchBinanceDailyClose } from "./binance-provider.js";
import { emitMarksToInbox } from "./inbox.js";
import { resolvePriceFeedPaths } from "./paths.js";
import { upsertQuote } from "./price-store.js";

/** One instrument that could not be fetched, with the symbol-attributable reason. */
export interface FetchFailure {
  instrumentId: string;
  symbol: string;
  message: string;
}

export interface FetchRunResult {
  /** Quotes successfully fetched and upserted this run. */
  quotes: Quote[];
  totalCount: number;
  storedCount: number;
  /** New mark candidates written to the inbox (0 before the mark time). */
  emittedCount: number;
  /** Marks already pending under the same id — skipped. */
  skippedCount: number;
  /** Whether this run is at/after the mark time (marks eligible to emit). */
  markEmitted: boolean;
  failures: FetchFailure[];
}

export interface RunOptions {
  config?: Partial<PriceFeedConfig>;
  /** Injectable for tests; defaults to the global `fetch`. No live network in tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock; defaults to `new Date()`. Anchors `asOf` and the mark gate. */
  now?: () => Date;
}

/**
 * Run one crypto price fetch: for every Binance registry instrument, fetch the
 * daily close, upsert the store, and — at/after the mark time — queue exactly one
 * deterministic-id `PriceMarked` candidate per instrument in the inbox.
 */
export async function runPriceFetch(options: RunOptions = {}): Promise<FetchRunResult> {
  const config: PriceFeedConfig = { ...DEFAULT_CONFIG, ...options.config };
  const now = options.now ?? (() => new Date());
  const instant = now();
  const asOf = tradingDayAsOf(instant, config.timeZone);
  const paths = resolvePriceFeedPaths(config.dataDir);
  const entries = instrumentsForSource("binance");

  await mkdir(paths.pricesDir, { recursive: true });

  const quotes: Quote[] = [];
  const failures: FetchFailure[] = [];
  for (const entry of entries) {
    try {
      const observation = await fetchBinanceDailyClose(entry, {
        timeoutMs: config.requestTimeoutMs,
        fetchImpl: options.fetchImpl ?? fetch,
        now,
      });
      const quote: Quote = {
        instrumentId: entry.instrumentId,
        symbol: entry.symbol,
        asOf,
        price: observation.close,
        source: entry.source,
        fetchedAt: observation.fetchedAt,
      };
      await upsertQuote(paths.pricesDir, quote);
      quotes.push(quote);
    } catch (error) {
      failures.push({
        instrumentId: entry.instrumentId,
        symbol: entry.symbol,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Two-plane rule: the store always upserts above; marks only at/after mark time.
  const markEmitted = isAtOrAfterMarkTime(instant, config);
  const marks: PriceMarkedEvent[] = markEmitted ? quotes.map(markFromQuote) : [];
  const emittedCount = await emitMarksToInbox(paths.inbox, marks);

  return {
    quotes,
    totalCount: entries.length,
    storedCount: quotes.length,
    emittedCount,
    skippedCount: marks.length - emittedCount,
    markEmitted,
    failures,
  };
}
