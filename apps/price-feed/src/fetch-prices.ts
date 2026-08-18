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
 * budget worth batching). Twelve Data is fetched in batched multi-symbol requests
 * that are PACED across minute windows: the free tier caps at 8 API CREDITS/minute
 * and a batched `time_series` costs 1 CREDIT PER SYMBOL, so the registry's 9 equity
 * symbols exceed the cap in a single request (9 credits > 8 ⇒ HTTP 429) — batching
 * alone does NOT fix it. The fetch therefore chunks equities into
 * `twelveDataMaxSymbolsPerMinute`-sized batches and sleeps `twelveDataPauseMs`
 * between chunks so each window stays under the cap (config.ts). Either way a bad
 * symbol stays individually attributable instead of masking the others. Partial
 * progress is always kept — a failure records and continues; the run exits non-zero
 * so a scheduler notices.
 *
 * Freshness honesty (finding 3 / ADR-005): EVERY instrument's mark is gated on the
 * provider bar's `observationDate` equalling the run's trading-day `asOf` — one
 * uniform rule for crypto, US equities, and derived `*-mxn` alike. Equities do NOT
 * trade weekends/holidays, so on those days Twelve Data returns the LAST trading
 * day's bar; crypto reads the last SETTLED UTC daily candle. Either way, emitting a
 * bar that predates `asOf` would append a misdated, never-moved stale mark, so it is
 * an INFO skip (market closed for equities; a late/missed fire or provider hiccup
 * for crypto), never a failure — the run stays clean. In normal operation at/after
 * 18:00 CDMX the settled UTC candle's date equals `asOf` by construction, so the
 * gate does not fire for crypto.
 *
 * MXN honesty (ADR-005): `*-mxn` instruments store the raw USD leg as their
 * disposable quote and get a DERIVED `USD × FIX` mark with the `usdMxn` snapshot
 * attached — the derived MXN value lives ONLY on the mark, never in the store, and
 * a missing/stale FIX fails those derivations loudly rather than reusing an old
 * rate or emitting an underived mark.
 *
 * RECOVERING A LOST DAY (#359). `RunOptions.asOf` replaces the derived trading day
 * and NOTHING ELSE — `now` stays the real clock, so `fetchedAt` records the instant
 * the recovery actually happened. A mark dated for the day it measures and stamped
 * with the day it was fetched IS what "measurement recovered late" means; fabricating
 * `now` instead would forge that provenance, and would steer no provider anyway (a
 * provider reads `now` only for the `fetchedAt` stamp and as a fallback for a
 * malformed bar timestamp). The override is validated HERE rather than in the CLI —
 * a programmatic caller must not be able to bypass it — and it must be a REAL
 * calendar day strictly earlier than the current trading day. That last rule is
 * load-bearing twice over: it is what makes forcing the mark gate open safe (a past
 * bar settled days ago, so the 18:00 settlement proxy has nothing left to infer),
 * and it is what guarantees Binance's target UTC day is complete now that the
 * date-pinned path has no `>= 2 klines` proxy of its own.
 *
 * OWED-SET FILTERING IS RECOVERY-ONLY (spec §8.1). Under an override the registry is
 * filtered through `owesMarkOn` BEFORE any request is constructed, so a Saturday
 * never asks Twelve Data for a bar that does not exist — which matters because a
 * non-ok status is a REQUEST-level failure there, and one dateless symbol would
 * collapse all nine into `failAll`. The live daily path is deliberately UNCHANGED:
 * it still fetches all 9 equity symbols on a Saturday, stores Friday's close under
 * Saturday's `asOf`, and records 9 stale-mark skips. Making the filter unconditional
 * would quietly change what the nightly job stores; that is a separate decision.
 */
import {
  deriveMxnMark,
  instrumentsForSource,
  isAtOrAfterMarkTime,
  isIsoCalendarDate,
  markFromQuote,
  owesMarkOn,
  requireFreshFix,
  tradingDayAsOf,
  type FixObservation,
  type InstrumentRegistryEntry,
  type PriceMarkedEvent,
  type PriceSource,
  type Quote,
} from "@numisma/engine";
import { mkdir } from "node:fs/promises";
import {
  DEFAULT_CONFIG,
  readCredentialsFromEnv,
  type PriceFeedConfig,
  type ProviderCredentials,
} from "./config.js";
import { fetchBinanceDailyClose } from "./binance-provider.js";
import type { ProviderObservation } from "./provider.js";
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
 * One instrument whose fresh mark was intentionally SKIPPED this run because its bar
 * (`observationDate`) predates the run's trading-day `asOf`, so emitting it would
 * append a misdated stale mark. For an equity this means the market was closed
 * (weekend/holiday); for crypto it means a late/missed fire or a provider hiccup —
 * NOT a market-closed day, since crypto trades 24/7. Either way this is expected
 * INFO, NOT a {@link FetchFailure} — it must not force a non-zero exit and must not
 * block the spine.
 */
export interface MarkSkip {
  instrumentId: string;
  symbol: string;
  /** The provider's latest bar date (`YYYY-MM-DD`) — a prior trading day. */
  observationDate: string;
  /** The run's trading-day `asOf` (`YYYY-MM-DD`) there was no fresh close for. */
  asOf: string;
}

/**
 * One instrument the run did NOT attempt because its venue owed no mark on the
 * target day — a Twelve Data equity under a Saturday `asOf`. Recovery path only:
 * empty on every live daily run (see the owed-set note in the module doc).
 */
export interface NotOwed {
  instrumentId: string;
  symbol: string;
  source: PriceSource;
}

export interface FetchRunResult {
  /** Quotes successfully fetched and upserted this run (crypto + equities + USD legs). */
  quotes: Quote[];
  /**
   * The trading day this run marked against — the derived one on a live run, the
   * validated override on a recovery run. The only place a caller can read the
   * run's date without picking a quote out of the store.
   */
  asOf: string;
  /**
   * Instruments the owed-set filter removed before any request was built. Empty on
   * the live path, which never filters (spec §8.1).
   */
  notOwed: readonly NotOwed[];
  /**
   * Instruments this run ATTEMPTED: the owed set under an override, all 13 without
   * one. So a Saturday recovery reads `4/4` rather than `4/13`.
   */
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
   * Marks skipped because the instrument's bar predates `asOf`, so no fresh close
   * exists to mark: an equity on a closed market (weekend/holiday), or a crypto bar
   * from a late/missed fire or provider hiccup. These are INFO, not failures — the
   * run stays clean and the other instruments still mark. Empty before the mark time
   * (no marks are built then) and on ordinary at/after-18:00 CDMX runs.
   */
  staleMarkSkips: MarkSkip[];
}

export interface RunOptions {
  config?: Partial<PriceFeedConfig>;
  /** Injectable for tests; defaults to the global `fetch`. No live network in tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock; defaults to `new Date()`. Anchors `asOf` and the mark gate. */
  now?: () => Date;
  /**
   * Recover a PAST trading day instead of today's: `YYYY-MM-DD`, replacing the
   * derived `asOf` and nothing else. `now` stays the real clock, so `fetchedAt`
   * still records when the recovery ran. Validated here, not by the caller —
   * a value that is not a real calendar day, or that is not strictly earlier than
   * the current trading day, throws rather than being coerced.
   */
  asOf?: string;
  /** Provider credentials; default to the environment. Injectable for tests. */
  credentials?: Partial<ProviderCredentials>;
  /**
   * Injectable sleep used to PACE Twelve Data chunks under the free-tier per-minute
   * credit cap. Defaults to a real `setTimeout` wait; tests pass a no-op so pacing
   * logic is exercised without waiting a real minute.
   */
  sleepImpl?: (ms: number) => Promise<void>;
}

/** One fetched instrument paired with its registry row (needed to build the mark). */
interface FetchedQuote {
  entry: InstrumentRegistryEntry;
  quote: Quote;
  /** The provider bar's own date (`YYYY-MM-DD`); gates every mark's freshness. */
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
  const sleepImpl =
    options.sleepImpl ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const instant = now();
  const today = tradingDayAsOf(instant, config.timeZone);
  // The override REPLACES the derived trading day and nothing else — validated
  // before a single request is built, so a bad date can never reach the store.
  const override = validateAsOfOverride(options.asOf, today);
  const asOf = override ?? today;
  // The provider's word for the same day. Translated here, at the call sites, and
  // omitted entirely on the live path so those requests stay byte-identical.
  const targetDate = override;
  const paths = resolvePriceFeedPaths(config.dataDir);

  // The owed set, computed BEFORE any request — recovery path only (spec §8.1).
  const notOwed: NotOwed[] = [];
  const owed = (entries: InstrumentRegistryEntry[]): InstrumentRegistryEntry[] => {
    if (override === undefined) return entries;
    return entries.filter((entry) => {
      if (owesMarkOn(entry.source, asOf)) return true;
      notOwed.push({
        instrumentId: entry.instrumentId,
        symbol: entry.symbol,
        source: entry.source,
      });
      return false;
    });
  };
  const binanceEntries = owed(instrumentsForSource("binance"));
  const equityEntries = owed(instrumentsForSource("twelvedata"));
  // What the run ATTEMPTED, so `storedCount/totalCount` stays an honest ratio.
  const totalCount = binanceEntries.length + equityEntries.length;

  await mkdir(paths.pricesDir, { recursive: true });

  const successes: FetchedQuote[] = [];
  const failures: FetchFailure[] = [];
  const staleMarkSkips: MarkSkip[] = [];

  // Crypto (Binance): keyless, so fetch one symbol at a time — no rate budget worth
  // batching, and each stays individually attributable.
  await fetchInto(binanceEntries, successes, failures, paths.pricesDir, asOf, (entry) =>
    fetchBinanceDailyClose(entry, { timeoutMs: config.requestTimeoutMs, fetchImpl, now, targetDate }),
  );
  // Equities (Twelve Data): batched, but PACED across minute windows. The free tier
  // caps at 8 CREDITS/min and a batch costs 1 credit PER SYMBOL, so all 9 symbols in
  // one request is 9 credits > 8 ⇒ 429. Chunk to `twelveDataMaxSymbolsPerMinute` and
  // sleep `twelveDataPauseMs` between chunks so each window stays under the cap. A
  // bad symbol is still per-instrument attributable within its chunk.
  const equityChunks = chunk(equityEntries, Math.max(1, config.twelveDataMaxSymbolsPerMinute));
  for (let i = 0; i < equityChunks.length; i++) {
    if (i > 0) {
      // Pace the next chunk so the free-tier per-minute credit quota resets first.
      // Announce it — a silent ~1-minute gap otherwise looks like a hung run.
      console.info(
        `  pausing ${Math.round(config.twelveDataPauseMs / 1000)}s for the Twelve Data ` +
          `per-minute credit quota to reset (chunk ${i + 1}/${equityChunks.length}, ` +
          `${equityChunks[i]!.length} symbol(s))…`,
      );
      await sleepImpl(config.twelveDataPauseMs);
    }
    const equityResults = await fetchTwelveDataDailyCloses(equityChunks[i]!, {
      timeoutMs: config.requestTimeoutMs,
      apiKey: credentials.twelveDataApiKey,
      fetchImpl,
      now,
      ...(targetDate === undefined ? {} : { targetDate }),
    });
    await recordResults(equityResults, successes, failures, paths.pricesDir, asOf);
  }

  // Two-plane rule: the store always upserts above; marks only at/after mark time.
  //
  // …except on the recovery path, where the gate is forced open and
  // `isAtOrAfterMarkTime` is not consulted at all. That gate answers "has TODAY's
  // bar settled yet?", and for a day already in the past the question is vacuous —
  // settlement is in hand rather than inferred from the hour. Validation guarantees
  // `asOf < today`, which is the whole reason this is safe: without it,
  // `--as-of=<today>` before 18:00 would mark an unsettled bar. Keeping the gate
  // instead would fail as "correct fetch, zero marks, exit 0" — #356's exact shape,
  // re-created inside the tool built to fix #356.
  const markEmitted = override !== undefined || isAtOrAfterMarkTime(instant, config);
  const marks = markEmitted
    ? await buildMarks(
        successes,
        failures,
        staleMarkSkips,
        asOf,
        targetDate,
        config,
        credentials,
        fetchImpl,
      )
    : [];
  const emittedCount = await emitMarksToInbox(paths.inbox, marks);

  return {
    quotes: successes.map((s) => s.quote),
    asOf,
    notOwed,
    totalCount,
    storedCount: successes.length,
    emittedCount,
    skippedCount: marks.length - emittedCount,
    markEmitted,
    marks,
    failures,
    staleMarkSkips,
  };
}

/**
 * Validate an `asOf` override, or pass `undefined` straight through (the live path).
 *
 * WHY HERE AND NOT IN THE CLI. The module's two-plane invariant reads "one clock, so
 * the stored quote and the queued mark cannot diverge on `asOf`". Today divergence is
 * impossible BY CONSTRUCTION; an override downgrades that to merely incorrect, so the
 * obligation to check belongs to the function that holds the invariant — a
 * programmatic caller must not be able to route around it.
 *
 * Two rules, and both refusals throw a plain `Error` carrying a sentence an operator
 * can act on (the CLI renders it; it does not compose it):
 *
 *  1. A REAL calendar day, via `isIsoCalendarDate` — shape AND round-trip. A
 *     shape-only regex accepts `"2026-02-30"`, which then silently becomes March 2 in
 *     every date computation downstream. Refused, never coerced.
 *  2. STRICTLY earlier than the current trading day (`YYYY-MM-DD` sorts
 *     chronologically, so a string compare is the date compare). This disposes of a
 *     future date as well, and it is the precondition the forced-open mark gate and
 *     Binance's pinned path both rest on.
 */
function validateAsOfOverride(asOf: string | undefined, today: string): string | undefined {
  if (asOf === undefined) return undefined;
  if (!isIsoCalendarDate(asOf)) {
    throw new Error(
      `asOf "${asOf}" is not a real calendar date. Give a day that exists, in YYYY-MM-DD ` +
        `form — a near-miss like 2026-02-30 is refused, never quietly read as March 2.`,
    );
  }
  if (asOf >= today) {
    throw new Error(
      `asOf "${asOf}" is not in the past: the current trading day is ${today}, and a ` +
        `recovery run marks against a day strictly earlier than it. To mark ${today}, ` +
        `run the daily job with no asOf — "recover today" is just "run the daily job".`,
    );
  }
  return asOf;
}

/** Split `items` into consecutive chunks of at most `size` (size ≥ 1). */
function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
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
 * recorded as a per-symbol failure. Called once per paced Twelve Data chunk so a
 * single bad symbol in a chunk stays individually attributable.
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
 * Uniform bar-date validation (finding 3 / ADR-005): EVERY mark — crypto (Binance),
 * US equity (Twelve Data), and derived `*-mxn` — is built only when the provider
 * bar's `observationDate` equals the run's trading-day `asOf`. One rule, no
 * per-source special case. On a weekend/holiday an equity's latest bar is a prior
 * trading day; a crypto bar can predate `asOf` on a late/missed fire or a provider
 * hiccup. Either way the instrument (incl. each `*-mxn` USD leg) is SKIPPED as INFO
 * — recorded in `staleMarkSkips`, never a failure. In normal operation at/after
 * 18:00 CDMX the settled UTC crypto candle's date equals `asOf` by construction, so
 * the gate does not fire for crypto.
 */
async function buildMarks(
  successes: readonly FetchedQuote[],
  failures: FetchFailure[],
  staleMarkSkips: MarkSkip[],
  asOf: string,
  /** The provider's word for `asOf` on a recovery run; `undefined` on the live path. */
  targetDate: string | undefined,
  config: PriceFeedConfig,
  credentials: ProviderCredentials,
  fetchImpl: typeof fetch,
): Promise<PriceMarkedEvent[]> {
  let fix: FixObservation | undefined;
  // Only fetch the FIX when a `*-mxn` instrument will actually mark (its USD leg's
  // bar is today's trading day). On a market-closed day every equity self-skips
  // below, so fetching the FIX then is not only wasted — a FIX outage would push a
  // spurious failure and block the spine for marks that were never going to emit.
  if (successes.some((s) => s.entry.derived && isFreshBar(s, asOf))) {
    try {
      fix = await fetchBanxicoFix({
        timeoutMs: config.requestTimeoutMs,
        token: credentials.banxicoToken,
        fetchImpl,
        // On a recovery run the newest FIX is days too new; ask for the one
        // published on the recovered day, or `requireFreshFix` rejects it below.
        ...(targetDate === undefined ? {} : { targetDate }),
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
    // Uniform freshness skip: the bar predates today's asOf, so no fresh close to
    // mark. INFO, not failure — fires for crypto, equity, and derived alike.
    if (!isFreshBar(success, asOf)) {
      staleMarkSkips.push({ instrumentId: entry.instrumentId, symbol: entry.symbol, observationDate, asOf });
      console.info(
        `  mark skipped — no fresh close for ${asOf}: ${entry.instrumentId} ` +
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

/** Whether an instrument's fetched bar is today's trading day (a fresh close to mark). */
function isFreshBar(success: FetchedQuote, asOf: string): boolean {
  return success.observationDate === asOf;
}
