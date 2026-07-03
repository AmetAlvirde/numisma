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
 * FIX, `BANXICO_TOKEN`). Binance is fetched one symbol at a time (keyless, no rate
 * budget worth batching); Twelve Data is fetched in ONE batched multi-symbol
 * request, because the free tier's 8 req/min cap cannot fit the registry's 9
 * Twelve Data symbols as 9 sequential calls (the 9th 429s and the run dies). Either
 * way a bad symbol stays individually attributable instead of masking the others.
 * Partial progress is always kept — a failure records and continues; the run exits
 * non-zero so a scheduler notices.
 *
 * Non-trading-day honesty (finding 3): the schedule fires 7 days/week so crypto —
 * which trades 24/7 — marks every day. Equities do NOT trade weekends/holidays, so
 * on those days Twelve Data returns the LAST trading day's bar; emitting it under
 * today's `asOf` would append a misdated, never-moved stale mark. Each equity mark
 * is therefore gated on the provider bar's `observationDate` equaling the run's
 * `asOf`; a mismatch is an INFO skip (market closed, no fresh close), never a
 * failure, so the run stays clean and the crypto marks still ingest. Crypto is
 * intentionally UNGATED (a Saturday crypto bar is a real close).
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
import { fetchTwelveDataDailyCloses, type ProviderFetchResult } from "./twelvedata-provider.js";
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

/**
 * One equity whose fresh mark was intentionally SKIPPED this run because the market
 * was closed (weekend/holiday): the provider's latest bar (`observationDate`)
 * predates the run's trading-day `asOf`, so emitting it would append a misdated
 * stale mark. This is expected INFO, NOT a {@link FetchFailure} — it must not force
 * a non-zero exit and must not block the spine.
 */
export interface EquityMarkSkip {
  instrumentId: string;
  symbol: string;
  /** The provider's latest bar date (`YYYY-MM-DD`) — a prior trading day. */
  observationDate: string;
  /** The run's trading-day `asOf` (`YYYY-MM-DD`) there was no fresh close for. */
  asOf: string;
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
  /**
   * Equity marks skipped because the market was closed (weekend/holiday): the
   * provider's latest bar predates `asOf`, so no fresh close exists to mark. These
   * are INFO, not failures — the run stays clean and crypto still marks. Empty
   * before the mark time (no marks are built then) and on ordinary trading days.
   */
  staleEquitySkips: EquityMarkSkip[];
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
  /** The provider bar's own date (`YYYY-MM-DD`); gates equity mark freshness. */
  observationDate: string;
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
  const staleEquitySkips: EquityMarkSkip[] = [];

  // Crypto (Binance): keyless, so fetch one symbol at a time — no rate budget worth
  // batching, and each stays individually attributable.
  await fetchInto(binanceEntries, successes, failures, paths.pricesDir, asOf, (entry) =>
    fetchBinanceDailyClose(entry, { timeoutMs: config.requestTimeoutMs, fetchImpl, now }),
  );
  // Equities (Twelve Data): ONE batched multi-symbol request (rate-limit fix) — 9
  // sequential calls would blow the 8 req/min free-tier cap; a bad symbol is still
  // per-instrument attributable within the batch.
  const equityResults = await fetchTwelveDataDailyCloses(equityEntries, {
    timeoutMs: config.requestTimeoutMs,
    apiKey: credentials.twelveDataApiKey,
    fetchImpl,
    now,
  });
  await recordResults(equityResults, successes, failures, paths.pricesDir, asOf);

  // Two-plane rule: the store always upserts above; marks only at/after mark time.
  const markEmitted = isAtOrAfterMarkTime(instant, config);
  const marks = markEmitted
    ? await buildMarks(successes, failures, staleEquitySkips, asOf, config, credentials, fetchImpl)
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
    staleEquitySkips,
  };
}

/**
 * Fetch each entry through `fetchOne` (one symbol at a time), upsert its USD quote,
 * and record the result. A failure is per-symbol attributable and never blocks the
 * others (R4); the raw USD close is stored even for `*-mxn` instruments (the derived
 * MXN value never enters the disposable store — only the mark carries it).
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
      await storeSuccess(entry, await fetchOne(entry), successes, pricesDir, asOf);
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
 * Fold a BATCHED provider's per-entry results into the same success/failure tally
 * a sequential `fetchInto` produces: each `observation` is stored, each `error` is
 * recorded as a per-symbol failure. Used for the one-shot Twelve Data batch so a
 * single bad symbol in the batch stays individually attributable.
 */
async function recordResults(
  results: readonly ProviderFetchResult[],
  successes: FetchedQuote[],
  failures: FetchFailure[],
  pricesDir: string,
  asOf: string,
): Promise<void> {
  for (const { entry, observation, error } of results) {
    if (observation !== undefined) {
      await storeSuccess(entry, observation, successes, pricesDir, asOf);
    } else {
      failures.push({
        instrumentId: entry.instrumentId,
        symbol: entry.symbol,
        message: error ?? `Twelve Data ${entry.symbol} -> unknown error`,
      });
    }
  }
}

/** Upsert one observation's USD quote into the disposable store and tally it. */
async function storeSuccess(
  entry: InstrumentRegistryEntry,
  observation: ProviderObservation,
  successes: FetchedQuote[],
  pricesDir: string,
  asOf: string,
): Promise<void> {
  const quote: Quote = {
    instrumentId: entry.instrumentId,
    symbol: entry.symbol,
    asOf,
    price: observation.close,
    source: entry.source,
    fetchedAt: observation.fetchedAt,
  };
  await upsertQuote(pricesDir, quote);
  successes.push({ entry, quote, observationDate: observation.observationDate });
}

/**
 * Turn the fetched quotes into marks: crypto/US-equity quotes map straight to a
 * mark; `*-mxn` quotes are derived `USD × FIX` with the `usdMxn` snapshot. The FIX
 * is fetched once, only when an `*-mxn` instrument will ACTUALLY mark this run. A
 * missing or stale FIX fails every `*-mxn` derivation loudly and attributably — the
 * direct marks still emit (partial progress kept).
 *
 * Per-provider bar-date validation (finding 3): an EQUITY (Twelve Data) mark is
 * built only when the provider bar's `observationDate` equals the run's trading-day
 * `asOf`. On a weekend/holiday the latest bar is a prior trading day, so the equity
 * (incl. each `*-mxn` USD leg) is SKIPPED as INFO — recorded in `staleEquitySkips`,
 * never a failure. CRYPTO (Binance) trades 24/7, so it is UNGATED: a daily crypto
 * bar is a legitimately fresh close every day, and its UTC bar date is deliberately
 * NOT forced to equal the CDMX `asOf`.
 */
async function buildMarks(
  successes: readonly FetchedQuote[],
  failures: FetchFailure[],
  staleEquitySkips: EquityMarkSkip[],
  asOf: string,
  config: PriceFeedConfig,
  credentials: ProviderCredentials,
  fetchImpl: typeof fetch,
): Promise<PriceMarkedEvent[]> {
  let fix: FixObservation | undefined;
  // Only fetch the FIX when a `*-mxn` instrument will actually mark (its USD leg's
  // bar is today's trading day). On a market-closed day every equity self-skips
  // below, so fetching the FIX then is not only wasted — a FIX outage would push a
  // spurious failure and block the spine for marks that were never going to emit.
  if (successes.some((s) => s.entry.derived && isFreshEquityBar(s, asOf))) {
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
  for (const success of successes) {
    const { entry, quote, observationDate } = success;
    // Equity market-closed skip: no fresh close for today's asOf. INFO, not failure.
    if (entry.source === "twelvedata" && !isFreshEquityBar(success, asOf)) {
      staleEquitySkips.push({ instrumentId: entry.instrumentId, symbol: entry.symbol, observationDate, asOf });
      console.info(
        `  equity mark skipped — no fresh close for ${asOf}: ${entry.instrumentId} ` +
          `${entry.symbol} (latest bar ${observationDate})`,
      );
      continue;
    }
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

/** Whether an equity's fetched bar is today's trading day (a fresh close to mark). */
function isFreshEquityBar(success: FetchedQuote, asOf: string): boolean {
  return success.observationDate === asOf;
}
