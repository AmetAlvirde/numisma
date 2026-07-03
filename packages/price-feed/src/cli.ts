/**
 * `prices:fetch` CLI entry — thin wiring over {@link runPriceFetch}. It owns only
 * console reporting and the process exit code; every domain decision and every IO
 * step lives behind the exported, tested functions. A fetch failure is surfaced
 * (never swallowed) and forces a non-zero exit so a scheduler notices, but only
 * after all partial progress is stored and emitted.
 */
import { resolvePriceFeedPaths } from "./paths.js";
import { DEFAULT_CONFIG } from "./config.js";
import { runPriceFetch } from "./fetch-prices.js";
import { scanFetchedMarks } from "./rejection-check.js";

async function main(): Promise<void> {
  const paths = resolvePriceFeedPaths(DEFAULT_CONFIG.dataDir);
  const result = await runPriceFetch();

  for (const quote of result.quotes) {
    console.log(
      `  fetched ${quote.instrumentId.padEnd(7)} ${quote.symbol.padEnd(11)} ${quote.asOf}  ${quote.price}`,
    );
  }
  for (const failure of result.failures) {
    console.error(
      `  FETCH FAILED  ${failure.instrumentId.padEnd(7)} ${failure.symbol.padEnd(11)} ${failure.message}`,
    );
  }

  console.log("");
  console.log(
    `prices:fetch — ${result.storedCount}/${result.totalCount} quotes stored in ${paths.pricesDir}`,
  );
  if (result.markEmitted) {
    console.log(`  ${result.emittedCount} new PriceMarked candidate(s) written to ${paths.inbox}`);
    console.log(`  ${result.skippedCount} already pending (same id) — skipped`);
  } else {
    console.log(
      `  before the ${DEFAULT_CONFIG.markTime} ${DEFAULT_CONFIG.timeZone} mark time — store upserted, no mark emitted`,
    );
  }
  if (result.failures.length > 0) {
    console.log(`  ${result.failures.length} fetch failure(s) surfaced above (not swallowed).`);
  }

  // Fetch-time pre-check (open question 2): would the spine's ±50% guard reject any
  // mark this run queued? Surface it here, attributably and distinctly from a
  // provider failure, so a scheduled run never exits 0 on a doomed-but-queued mark.
  const scan = await scanFetchedMarks(result, paths);
  for (const rejection of scan.rejections) {
    console.error(
      `  SPINE WOULD REJECT  ${rejection.instrumentId.padEnd(7)} ${rejection.asOf}  ` +
        `price ${rejection.price} — ${rejection.reason}`,
    );
  }
  if (scan.rejections.length > 0) {
    console.log("");
    console.log(
      `  ${scan.rejections.length} fetched mark(s) would be rejected by the spine guard (above).`,
    );
    console.log(
      "  Triage: this is NOT a provider failure. Review the move; if it is real, hand-author",
    );
    console.log(
      "  the mark through the inbox (the permanent manual fallback) and re-run `pnpm spine`.",
    );
    console.log(
      "  A doomed mark left in the inbox blocks the whole spine ingest (all-or-nothing).",
    );
  } else if (scan.unavailableReason !== undefined) {
    console.log("");
    console.log(`  Note: could not pre-check marks against the spine guard — ${scan.unavailableReason}`);
    console.log("  `pnpm spine` remains the authoritative guard; run it to validate the marks.");
  }

  console.log("");
  console.log("Next: run `pnpm spine` to validate + append the marks to the event log.");

  // Non-zero exit so a scheduler notices — but only AFTER storing and emitting
  // everything that DID succeed (partial progress is always kept). A provider
  // failure and a guard rejection are distinct triage paths (surfaced above) but
  // both must halt a hands-off run so the operator looks before `pnpm spine`.
  if (result.failures.length > 0 || scan.rejections.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
