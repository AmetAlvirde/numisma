/**
 * Fetch orchestration — thin wiring over the pure engine core and the shell IO.
 * It holds NO domain decisions (ADR-001/R1): the engine owns the registry, the
 * trading-day/mark-instant rule, quote→mark construction, the MXN derivation, and
 * the inbox merge; this function only sequences fetch → store → derive → emit and
 * tallies the run.
 *
 * Two-plane invariant (ADR-005): EVERY run upserts the price store; a mark is
 * emitted only at/after the configured mark time. The store and the mark share
 * one clock, so the stored quote and the queued mark cannot diverge on `asOf`.
 *
 * Three providers ride ONE reliability envelope (R4): Binance (crypto, keyless),
 * Twelve Data (US equities, `TWELVEDATA_API_KEY`), and Banxico SF43718 (USD/MXN
 * FIX, `BANXICO_TOKEN`). Sequential fetch is deliberate: a handful of daily calls
 * sits far under every provider's rate budget, and a bad symbol stays individually
 * attributable instead of masking the others. Partial progress is always kept — a
 * failure records and continues; the run exits non-zero so a scheduler notices.
 *
 * MXN honesty (ADR-005): `*-mxn` instruments store the raw USD leg as their
 * disposable quote and get a DERIVED `USD × FIX` mark with the `usdMxn` snapshot
 * attached — the derived MXN value lives ONLY on the mark, never in the store, and
 * a missing/stale FIX fails those derivations loudly rather than reusing an old
 * rate or emitting an underived mark.
 */
import {
  deriveMxnMark,
  instrumentsForSource,
  isAtOrAfterMarkTime,
  markFromQuote,
  requireFreshFix,
  tradingDayAsOf,
  type FixObservation,
  type InstrumentRegistryEntry,
  type PriceMarkedEvent,
  type Quote,
} from "@numisma/engine";
import { mkdir } from "node:fs/promises";
import {
  DEFAULT_CONFIG,
  readCredentialsFromEnv,
  type PriceFeedConfig,
  type ProviderCredentials,
} from "./config.js";
import { fetchBinanceDailyClose, type ProviderObservation } from "./binance-provider.js";
import { fetchTwelveDataDailyClose } from "./twelvedata-provider.js";
import { fetchBanxicoFix } from "./banxico-provider.js";
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
  /** Quotes successfully fetched and upserted this run (crypto + equities + USD legs). */
  quotes: Quote[];
  totalCount: number;
  storedCount: number;
  /** New mark candidates written to the inbox (0 before the mark time). */
  emittedCount: number;
  /** Marks already pending under the same id — skipped. */
  skippedCount: number;
  /** Whether this run is at/after the mark time (marks eligible to emit). */
  markEmitted: boolean;
  /**
   * The exact mark candidates this run constructed — a direct `markFromQuote`
   * mark for crypto/US equities and a derived `USD × FIX` mark for `*-mxn`.
   * Empty before the mark time. Carried so the fetch-time spine pre-check checks
   * the REAL emitted marks (including the derived MXN value + `usdMxn` snapshot),
   * not a re-derivation from the raw USD quotes.
   */
  marks: PriceMarkedEvent[];
  failures: FetchFailure[];
}

export interface RunOptions {
  config?: Partial<PriceFeedConfig>;
  /** Injectable for tests; defaults to the global `fetch`. No live network in tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock; defaults to `new Date()`. Anchors `asOf` and the mark gate. */
  now?: () => Date;
  /** Provider credentials; default to the environment. Injectable for tests. */
  credentials?: Partial<ProviderCredentials>;
}

/** One fetched instrument paired with its registry row (needed to build the mark). */
interface FetchedQuote {
  entry: InstrumentRegistryEntry;
  quote: Quote;
}

/**
 * Run one price fetch across every provider: fetch each instrument's daily close,
 * upsert the store, and — at/after the mark time — queue exactly one
 * deterministic-id `PriceMarked` candidate per instrument in the inbox (a direct
 * mark for crypto/US equities, a derived `USD × FIX` mark for `*-mxn`).
 */
export async function runPriceFetch(options: RunOptions = {}): Promise<FetchRunResult> {
  const config: PriceFeedConfig = { ...DEFAULT_CONFIG, ...options.config };
  const credentials: ProviderCredentials = {
    ...readCredentialsFromEnv(),
    ...options.credentials,
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const instant = now();
  const asOf = tradingDayAsOf(instant, config.timeZone);
  const paths = resolvePriceFeedPaths(config.dataDir);

  const binanceEntries = instrumentsForSource("binance");
  const equityEntries = instrumentsForSource("twelvedata");
  const totalCount = binanceEntries.length + equityEntries.length;

  await mkdir(paths.pricesDir, { recursive: true });

  const successes: FetchedQuote[] = [];
  const failures: FetchFailure[] = [];

  await fetchInto(binanceEntries, successes, failures, paths.pricesDir, asOf, (entry) =>
    fetchBinanceDailyClose(entry, { timeoutMs: config.requestTimeoutMs, fetchImpl, now }),
  );
  await fetchInto(equityEntries, successes, failures, paths.pricesDir, asOf, (entry) =>
    fetchTwelveDataDailyClose(entry, {
      timeoutMs: config.requestTimeoutMs,
      apiKey: credentials.twelveDataApiKey,
      fetchImpl,
      now,
    }),
  );

  // Two-plane rule: the store always upserts above; marks only at/after mark time.
  const markEmitted = isAtOrAfterMarkTime(instant, config);
  const marks = markEmitted
    ? await buildMarks(successes, failures, asOf, config, credentials, fetchImpl)
    : [];
  const emittedCount = await emitMarksToInbox(paths.inbox, marks);

  return {
    quotes: successes.map((s) => s.quote),
    totalCount,
    storedCount: successes.length,
    emittedCount,
    skippedCount: marks.length - emittedCount,
    markEmitted,
    marks,
    failures,
  };
}

/**
 * Fetch each entry through `fetchOne`, upsert its USD quote, and record the result.
 * A failure is per-symbol attributable and never blocks the others (R4); the raw
 * USD close is stored even for `*-mxn` instruments (the derived MXN value never
 * enters the disposable store — only the mark carries it).
 */
async function fetchInto(
  entries: readonly InstrumentRegistryEntry[],
  successes: FetchedQuote[],
  failures: FetchFailure[],
  pricesDir: string,
  asOf: string,
  fetchOne: (entry: InstrumentRegistryEntry) => Promise<ProviderObservation>,
): Promise<void> {
  for (const entry of entries) {
    try {
      const observation = await fetchOne(entry);
      const quote: Quote = {
        instrumentId: entry.instrumentId,
        symbol: entry.symbol,
        asOf,
        price: observation.close,
        source: entry.source,
        fetchedAt: observation.fetchedAt,
      };
      await upsertQuote(pricesDir, quote);
      successes.push({ entry, quote });
    } catch (error) {
      failures.push({
        instrumentId: entry.instrumentId,
        symbol: entry.symbol,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Turn the fetched quotes into marks: crypto/US-equity quotes map straight to a
 * mark; `*-mxn` quotes are derived `USD × FIX` with the `usdMxn` snapshot. The FIX
 * is fetched once, only when an `*-mxn` instrument actually needs it. A missing or
 * stale FIX fails every `*-mxn` derivation loudly and attributably — the direct
 * marks still emit (partial progress kept).
 */
async function buildMarks(
  successes: readonly FetchedQuote[],
  failures: FetchFailure[],
  asOf: string,
  config: PriceFeedConfig,
  credentials: ProviderCredentials,
  fetchImpl: typeof fetch,
): Promise<PriceMarkedEvent[]> {
  let fix: FixObservation | undefined;
  if (successes.some((s) => s.entry.derived)) {
    try {
      fix = await fetchBanxicoFix({
        timeoutMs: config.requestTimeoutMs,
        token: credentials.banxicoToken,
        fetchImpl,
      });
    } catch (error) {
      // Surface the FIX outage once, attributably; each `*-mxn` derivation below
      // then fails loud via `requireFreshFix` rather than reusing an old rate.
      failures.push({
        instrumentId: "usd-mxn-fix",
        symbol: "SF43718",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const marks: PriceMarkedEvent[] = [];
  for (const { entry, quote } of successes) {
    try {
      if (entry.derived) {
        const freshFix = requireFreshFix(fix, asOf, config.fixMaxStaleDays);
        marks.push(deriveMxnMark(quote, freshFix));
      } else {
        marks.push(markFromQuote(quote));
      }
    } catch (error) {
      failures.push({
        instrumentId: entry.instrumentId,
        symbol: entry.symbol,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return marks;
}
