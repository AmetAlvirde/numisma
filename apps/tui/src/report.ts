import {
  buildCompositionReport,
  formatAvailableCapital,
  formatCompositionReport,
} from "@numisma/engine";
import {
  formatFoldDiscards,
  loadFoldedReview,
  resolveEventStorePaths,
} from "@numisma/event-store";
import { loadOrders, resolveOrdersPath } from "@numisma/preferences";
import { loadAvailableCapital } from "./available-capital.js";
import { parseAsOfArg } from "./spine-args.js";

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
  const folded = await loadFoldedReview(paths, asOf);
  const { data } = folded;
  // THE ENUMERATION, not the count (PRD #323 R7). This surface runs because a human
  // just asked it a question, so every dropped event's locator, verb and reason is
  // printed in full — the id is greppable in `events.jsonl`, which is what makes the
  // report actionable. The unattended push gets ONE counted line instead, because that
  // one prints daily forever and an enumeration there would starve its co-tenants.
  // On stderr, BEFORE the report: the composition below is the fold's product, and a
  // reader must know the fold was incomplete before they read its totals. It never
  // touches `process.exitCode` — the log is append-only, so this never extinguishes.
  for (const line of formatFoldDiscards(folded)) {
    process.stderr.write(`${line}\n`);
  }
  const sourcePath = asOf ? `${paths.log} as-of ${asOf}` : paths.log;
  const report = buildCompositionReport(data, {
    load: {
      status: "loaded",
      sourcePath,
      loadedAt: new Date().toISOString(),
    },
  });
  process.stdout.write(`${formatCompositionReport(report)}\n`);

  // `S7` — committed vs available, joined from `orders.jsonl` at read time and appended
  // AFTER the composition report rather than woven into it. That placement is the
  // architecture made visible: the report above is the fold and is NAV-bearing; this
  // block is a read-time join over a sidecar and touches none of it. It renders nothing
  // at all when no ladder is resting, so a machine that has never imported an export
  // gets byte-for-byte the previous output.
  const ordersPath = resolveOrdersPath();
  const capital = await loadAvailableCapital(
    data,
    { ordersPath, loadOrders: (path) => loadOrders(path) },
    asOf,
  );
  if (capital.status === "refused") {
    process.stderr.write(`Available Capital unavailable — ${capital.message}\n`);
  } else {
    const block = formatAvailableCapital(capital.report);
    if (block) {
      process.stdout.write(`\n${block}\n`);
    }
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${detail}\n`);
  process.exitCode = 1;
}
