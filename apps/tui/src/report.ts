import {
  buildCompositionReport,
  formatCompositionReport,
} from "@numisma/engine";
import { loadFoldedReview, resolveEventStorePaths } from "@numisma/event-store";
import { parseAsOfArg } from "./event-store.js";

// Single source of truth (ADR-003 slice 4): `pnpm report` renders the FOLD over
// the durable genesis + event log, the same read model `pnpm dev` (app.ts) and the
// tracer derive from — so no surface can show a "current portfolio" that diverges
// from the fold. The legacy snapshot path (`review-file.ts`, a single hand-edited
// `fund-review.local.json`) is no longer on the app path. Like the app, an optional
// `--as-of <YYYY-MM-DD>` renders the composition as of a prior date; with no flag it
// renders current state. report is read-only: it folds and renders, it never ingests
// the inbox (the app owns ingest-on-startup).
try {
  const paths = resolveEventStorePaths();
  const asOf = parseAsOfArg(process.argv);
  const data = await loadFoldedReview(paths, asOf);
  const sourcePath = asOf ? `${paths.log} as-of ${asOf}` : paths.log;
  const report = buildCompositionReport(data, {
    load: {
      status: "loaded",
      sourcePath,
      loadedAt: new Date().toISOString(),
    },
  });
  process.stdout.write(`${formatCompositionReport(report)}\n`);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
}
