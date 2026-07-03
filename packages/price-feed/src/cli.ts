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
      `  FAILED  ${failure.instrumentId.padEnd(7)} ${failure.symbol.padEnd(11)} ${failure.message}`,
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
  console.log("");
  console.log("Next: run `pnpm spine` to validate + append the marks to the event log.");

  // Non-zero exit so a scheduler notices failures — but only AFTER storing and
  // emitting everything that DID succeed (partial progress is always kept).
  if (result.failures.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
  process.exitCode = 1;
});
