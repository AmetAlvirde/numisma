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
 *
 * MAGNITUDE-GUARD OVERRIDE (opt-in, off by default). A genuine >50% move trips the
 * spine's ±50% fat-finger guard and is rejected. To consciously land such a mark,
 * raise the guard for THIS one run with `--magnitude-threshold=<n>` (or the
 * `SPINE_MAGNITUDE_THRESHOLD=<n>` env var), e.g. `pnpm spine --magnitude-threshold=1.5`
 * for a ±150% band. A normal run passes NO override, so the ±50% guard stands. When
 * an override is active the run announces it loudly on stderr, so a relaxed guard is
 * never silent; a malformed value fails loud before anything is ingested.
 */
import { buildCompositionReport, formatCompositionReport } from "@numisma/engine";
import { loadFoldedReview, resolveEventStorePaths } from "@numisma/event-store";
import { ingestInbox, parseAsOfArg, parseMagnitudeThresholdArg } from "./event-store.js";
import { plural } from "./plural.js";

try {
  const paths = resolveEventStorePaths();
  const asOf = parseAsOfArg(process.argv);
  const magnitudeThreshold = parseMagnitudeThresholdArg(process.argv);

  if (magnitudeThreshold !== undefined) {
    process.stderr.write(
      `WARNING: magnitude guard RELAXED to ±${magnitudeThreshold * 100}% for this ingest ` +
        `(default is ±50%). Only genuine large moves should be landed this way.\n`,
    );
  }

  const ingest =
    magnitudeThreshold === undefined
      ? await ingestInbox(paths)
      : await ingestInbox(paths, { magnitudeThreshold });
  process.stdout.write(
    `Success, ${plural(ingest.newCount, "new transaction")} found, ` +
      `${plural(ingest.duplicateCount, "duplicate")} skipped` +
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
