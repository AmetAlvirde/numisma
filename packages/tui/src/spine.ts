/**
 * PROTOTYPE (mvi 2026-06-29-portfolio-persistence). Node-runnable tracer for the
 * event-sourcing spine — the verifiable end-to-end path that does NOT need Bun
 * or openTUI. Mirrors `report.ts`, but the read model comes from the fold:
 *
 *   1. ingest the inbox (dedup by id, append, archive) and report counts
 *   2. fold genesis + log to `--as-of <date>` (or current state)
 *   3. render the existing composition report, unchanged
 *
 * Run: `pnpm spine` (current) or `pnpm spine --as-of 2026-06-26`.
 */
import { buildCompositionReport, formatCompositionReport } from "@numisma/engine";
import {
  ingestInbox,
  loadFoldedReview,
  parseAsOfArg,
  resolveEventStorePaths,
} from "./event-store.js";

try {
  const paths = resolveEventStorePaths();
  const asOf = parseAsOfArg(process.argv);

  const ingest = await ingestInbox(paths);
  process.stdout.write(
    `Success, ${ingest.newCount} new transaction${ingest.newCount === 1 ? "" : "s"} found, ` +
      `${ingest.duplicateCount} duplicate${ingest.duplicateCount === 1 ? "" : "s"} skipped` +
      (ingest.archivedTo ? ` (inbox archived to ${ingest.archivedTo})` : "") +
      "\n\n",
  );

  const data = await loadFoldedReview(paths, asOf);
  const report = buildCompositionReport(data, {
    load: {
      status: "loaded",
      sourcePath: asOf ? `${paths.log} as-of ${asOf}` : paths.log,
      loadedAt: new Date().toISOString(),
    },
  });
  process.stdout.write(`${formatCompositionReport(report)}\n`);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
}
