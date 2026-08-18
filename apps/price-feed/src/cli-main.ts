/**
 * The body of the `prices:fetch` command — everything `cli.ts` used to hold inline,
 * moved behind one exported, injectable function so the console report and the exit
 * code are testable without spawning a process. `cli.ts` is now wiring and nothing
 * else: it reads `process.argv`, calls this, and assigns the returned exit code.
 * There is no second copy of the classification here — this function is the ONLY
 * path the real command takes.
 *
 * It owns console reporting and the exit code; every domain decision and every IO
 * step lives behind `runPriceFetch` and `scanFetchedMarks`. A fetch failure is
 * surfaced (never swallowed) and forces a non-zero exit so a scheduler notices, but
 * only after all partial progress is stored and emitted.
 *
 * ── THE RECOVERY EXIT CONTRACT (R3.2/R3.3) ───────────────────────────────────────
 *
 * Under an explicit `--as-of`, every registry instrument lands in exactly one of
 * three states for the run's date — NOT OWED (the venue owed no mark), OWED AND
 * MARKED, or OWED AND ABSENT — and a non-empty absent set exits 1.
 *
 * ⚠️ DO NOT "FIX" THAT EXIT CODE BACK TO 0. The nearby precedent (#266 D7/D8) types
 * `pnpm gap-report`'s exit as the literal `0` — warn only, no exit-code change — and
 * it is easy to read that as house style. It is not. Its whole argument rests on one
 * premise, stated verbatim in three modules: *"a lost day is reported; a broken job
 * is failed, because a permanently red job is one nobody reads."* That is an argument
 * about RECURRING UNATTENDED AUTOMATION. `pnpm gap-report` runs nightly from the
 * wrapper and accepts ~10 holiday false positives a year, so a non-zero exit there
 * would fail the daily job ten times a year and train everyone to ignore it. This
 * command is OPERATOR-INVOKED, one date at a time, by someone who just typed the
 * date. It is not in that channel and cannot erode it.
 *
 * The positive argument is the stronger one: #356 exists BECAUSE a total failure
 * exited green. A recovery tool that recovers nothing and exits 0 is that same defect
 * wearing a new name.
 *
 * RECORDED TRIGGER THAT WOULD FLIP THIS: if recovery is ever put INTO an unattended
 * loop — a catch-up pass at the top of the daily job — it inherits the nightly
 * channel and #266 D7's argument reaches it. Then, and only then, revisit.
 *
 * ── THE STALE-BAR BOUNDARY, WHICH CUTS BOTH WAYS ─────────────────────────────────
 *
 * A stale-bar skip (`staleMarkSkips`) on an OWED instrument is a FAILURE under an
 * explicit `asOf`: the request was pinned to the target date, so a bar that is not
 * that date means the day did not come back. On the LIVE daily path the identical
 * skip stays INFO and still exits 0 — an equity's newest bar on a Saturday is
 * Friday's, and failing the nightly automation on that would be a regression. Both
 * halves are pinned by tests; changing either one is a behaviour change, not a tidy.
 *
 * ── WHAT THE RUN TOUCHES (R3.4) ──────────────────────────────────────────────────
 *
 * Stored quotes and inbox marks, and nothing else. No heartbeat write (stamping
 * `job-heartbeat.json` for a past date would assert an evening run that never
 * happened — the manufactured-clean surface #356 is about; its only writer is the
 * daily wrapper's EXIT trap, so the operational rule is simply NEVER ROUTE RECOVERY
 * THROUGH THE WRAPPER). No spine invocation, no accumulus commit, no projection
 * refresh — all three stay the operator's, in the runbook.
 */
import { instrumentsForSource, type PriceSource } from "@numisma/engine";
import { DEFAULT_CONFIG, type PriceFeedConfig } from "./config.js";
import { parsePriceFetchArgs } from "./cli-args.js";
import { runPriceFetch, type FetchRunResult, type RunOptions } from "./fetch-prices.js";
import { resolvePriceFeedPaths } from "./paths.js";
import { scanFetchedMarks, type RejectionScan } from "./rejection-check.js";

/** Every seam the command reaches through, so a test can drive it in memory. */
export interface PriceFetchCliDeps {
  /** Arguments AFTER the node/script pair, i.e. `process.argv.slice(2)`. */
  argv: readonly string[];
  /** Config overrides; omitted entirely on the real command so the run reads DEFAULT_CONFIG. */
  config?: Partial<PriceFeedConfig>;
  run?: (options: RunOptions) => Promise<FetchRunResult>;
  scan?: typeof scanFetchedMarks;
  log?: (line: string) => void;
  logError?: (line: string) => void;
}

/** One owed instrument that produced no mark — the third state, and the one that exits 1. */
interface AbsentInstrument {
  instrumentId: string;
  symbol: string;
  source: PriceSource;
  /** The provider's own words where there are any (R1.4 puts them in the failure message). */
  reason: string;
  /** What that reason most likely means — never asserted as certain. */
  suspected: string;
}

/**
 * Run the whole command and return its exit code. Never throws: an argument refusal
 * and a `runPriceFetch` refusal are both rendered as a single readable sentence, so
 * an operator who mistyped a date gets a sentence rather than a stack trace.
 */
export async function runPriceFetchCli(deps: PriceFetchCliDeps): Promise<number> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const logError = deps.logError ?? ((line: string) => console.error(line));
  const run = deps.run ?? runPriceFetch;
  const scanImpl = deps.scan ?? scanFetchedMarks;
  const config: PriceFeedConfig = { ...DEFAULT_CONFIG, ...deps.config };
  const paths = resolvePriceFeedPaths(config.dataDir);

  let asOf: string | undefined;
  try {
    asOf = parsePriceFetchArgs(deps.argv).asOf;
  } catch (error) {
    logError(`prices:fetch — ${messageOf(error)}`);
    return 1;
  }
  const recovering = asOf !== undefined;

  const options: RunOptions = {
    ...(deps.config === undefined ? {} : { config: deps.config }),
    ...(asOf === undefined ? {} : { asOf }),
  };

  let result: FetchRunResult;
  try {
    result = await run(options);
  } catch (error) {
    // On the recovery path the only thing that throws before any IO is R2.2's
    // validation refusal (not a real calendar day, or not strictly in the past), and
    // an operator who just typed a date needs its sentence, not a stack. The live
    // path keeps the original stack-preserving behaviour — there, a throw IS a bug.
    if (recovering) {
      logError(`prices:fetch — ${messageOf(error)}`);
      return 1;
    }
    throw error;
  }

  if (recovering) {
    log(`prices:fetch — recovering ${result.asOf}: marks are dated ${result.asOf}, while`);
    log("  fetchedAt records this run, because that is what a late measurement is.");
    log("");
  }

  for (const quote of result.quotes) {
    log(
      `  fetched ${quote.instrumentId.padEnd(7)} ${quote.symbol.padEnd(11)} ${quote.asOf}  ${quote.price}`,
    );
  }
  for (const failure of result.failures) {
    logError(
      `  FETCH FAILED  ${failure.instrumentId.padEnd(7)} ${failure.symbol.padEnd(11)} ${failure.message}`,
    );
  }

  log("");
  log(`prices:fetch — ${result.storedCount}/${result.totalCount} quotes stored in ${paths.pricesDir}`);
  if (result.markEmitted) {
    log(`  ${result.emittedCount} new PriceMarked candidate(s) written to ${paths.inbox}`);
    log(`  ${result.skippedCount} already pending (same id) — skipped`);
  } else {
    log(
      `  before the ${config.markTime} ${config.timeZone} mark time — store upserted, no mark emitted`,
    );
  }
  if (result.failures.length > 0) {
    log(`  ${result.failures.length} fetch failure(s) surfaced above (not swallowed).`);
  }

  // The three-state report — recovery path only. On the live path the classification
  // is not even computed: before the mark time a live run legitimately has zero marks
  // and must still exit 0, and a weekend stale skip is INFO there by design.
  const absent = recovering ? classifyAbsent(result) : [];
  if (recovering) {
    reportRecovery(result, absent, log, logError);
  }

  // Fetch-time pre-check (open question 2): would the spine's ±50% guard reject any
  // mark this run queued? Surface it here, attributably and distinctly from a
  // provider failure, so a scheduled run never exits 0 on a doomed-but-queued mark.
  //
  // ⚠️ UNCHANGED BY THIS SLICE, DELIBERATELY. The pre-check builds its reference from
  // genesis plus the WHOLE durable log, so a back-dated mark is judged against the
  // newest known close rather than the one immediately preceding its own date. That
  // is correct BY CONSTRUCTION — the pre-check's contract is to be faithful to what
  // `pnpm spine` will actually do, and the spine folds the log then walks the inbox.
  // Making it "smarter" for recovery would make it wrong. Do not fix it.
  const scan = await scanImpl(result, paths);
  reportSpineScan(scan, log, logError);

  log("");
  log("Next: run `pnpm spine` to validate + append the marks to the event log.");

  // Non-zero exit so a scheduler notices — but only AFTER storing and emitting
  // everything that DID succeed (partial progress is always kept). A provider
  // failure, a guard rejection and an absent owed instrument are three distinct
  // triage paths (surfaced above) but all must halt a hands-off run so the operator
  // looks before `pnpm spine`.
  return result.failures.length > 0 || scan.rejections.length > 0 || absent.length > 0 ? 1 : 0;
}

/**
 * The third state: instruments that were ATTEMPTED (owed) and produced no mark.
 *
 * Derived from the registry minus `notOwed` minus the marks actually built, rather
 * than from the failure list — so an instrument that vanished for a reason nobody
 * recorded still shows up, instead of the run reporting a clean recovery of a day
 * that did not come back.
 */
function classifyAbsent(result: FetchRunResult): AbsentInstrument[] {
  const notOwed = new Set(result.notOwed.map((row) => row.instrumentId));
  const marked = new Set(result.marks.map((mark) => mark.instrumentId));
  const failures = new Map(result.failures.map((failure) => [failure.instrumentId, failure.message]));
  const stale = new Map(result.staleMarkSkips.map((skip) => [skip.instrumentId, skip.observationDate]));

  const absent: AbsentInstrument[] = [];
  for (const entry of [...instrumentsForSource("binance"), ...instrumentsForSource("twelvedata")]) {
    if (notOwed.has(entry.instrumentId) || marked.has(entry.instrumentId)) continue;
    const failure = failures.get(entry.instrumentId);
    const staleBar = stale.get(entry.instrumentId);
    absent.push({
      instrumentId: entry.instrumentId,
      symbol: entry.symbol,
      source: entry.source,
      reason:
        failure ??
        (staleBar === undefined
          ? "owed a mark, but none was built and no reason was recorded"
          : `the provider served a bar dated ${staleBar}, not ${result.asOf}`),
      suspected:
        failure !== undefined
          ? "the provider refused or could not serve that day's bar — a market holiday and a provider fault produce the same refusal"
          : staleBar !== undefined
            ? "no bar exists for that date (a market holiday), or the provider answered with a neighbouring day"
            : "a gap in this run's own bookkeeping — not a provider answer at all",
    });
  }
  return absent;
}

/** The owed / marked / absent tally, and the loud block when the third set is non-empty. */
function reportRecovery(
  result: FetchRunResult,
  absent: readonly AbsentInstrument[],
  log: (line: string) => void,
  logError: (line: string) => void,
): void {
  log("");
  log(
    `  recovery of ${result.asOf} — ${result.totalCount} owed, ${result.marks.length} marked, ` +
      `${absent.length} absent; ${result.notOwed.length} not owed by their venue`,
  );
  if (result.notOwed.length > 0) {
    log(
      `  not owed (never attempted): ${result.notOwed.map((row) => row.instrumentId).join(", ")}`,
    );
  }
  if (absent.length === 0) return;

  logError("");
  logError(
    `  RECOVERY INCOMPLETE — ${absent.length} owed instrument(s) produced no mark for ${result.asOf}:`,
  );
  for (const row of absent) {
    logError(`    ABSENT  ${row.instrumentId.padEnd(9)} ${row.symbol.padEnd(11)} ${row.reason}`);
    logError(`            suspected: ${row.suspected}`);
  }
  log("");
  log(
    "  This exit code CANNOT distinguish a market holiday from a provider failure — it",
  );
  log(
    "  says only that the day did not come back. Read each message above and decide",
  );
  log("  which one it was; a holiday needs no action, a provider fault needs a re-run.");
}

/** The spine pre-check's own report — unchanged from the pre-R3 CLI. */
function reportSpineScan(
  scan: RejectionScan,
  log: (line: string) => void,
  logError: (line: string) => void,
): void {
  for (const rejection of scan.rejections) {
    logError(
      `  SPINE WOULD REJECT  ${rejection.instrumentId.padEnd(7)} ${rejection.asOf}  ` +
        `price ${rejection.price} — ${rejection.reason}`,
    );
  }
  if (scan.rejections.length > 0) {
    log("");
    log(`  ${scan.rejections.length} fetched mark(s) would be rejected by the spine guard (above).`);
    log("  Triage: this is NOT a provider failure. Review the move; if it is real, hand-author");
    log("  the mark through the inbox (the permanent manual fallback) and re-run `pnpm spine`.");
    log("  A doomed mark left in the inbox blocks the whole spine ingest (all-or-nothing).");
  } else if (scan.unavailableReason !== undefined) {
    log("");
    log(`  Note: could not pre-check marks against the spine guard — ${scan.unavailableReason}`);
    log("  `pnpm spine` remains the authoritative guard; run it to validate the marks.");
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
