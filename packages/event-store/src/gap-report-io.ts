/**
 * The gap report's IO shell — and the ONLY async surface in the whole derivation.
 *
 * It does two things and deliberately nothing else: read the durable log, and hand
 * the events to the pure {@link computeGapReport}. Every decision about what
 * counts as a mark, where the window starts and where it stops lives in
 * `gap-report.ts`, which is synchronous and testable with no disk at all.
 *
 * IT ACCEPTS RESOLVED PATHS. The caller has already resolved its store — the TUI
 * from its startup path, the web push from its own — and re-deriving them here
 * would silently ignore a `NUMISMA_DATA_DIR` the caller had honoured. Passing
 * {@link EventStorePaths} in is what keeps one store resolution per process.
 *
 * IT LOADS NO GENESIS. The backfill's `enumerateAnchors` filters anchors to
 * `asOf >= genesis.review.asOf`; the window floor here is 2026-07-03, long after
 * genesis, so that filter is already subsumed by the window itself.
 */
import { assertLogFullyLoaded, loadEventLog } from "./event-store.js";
import type { EventStorePaths } from "./event-store.js";
import { computeGapReport, type GapReport, type GapWindow } from "./gap-report.js";

/**
 * Read the log and derive the report.
 *
 * REFUSES A PARTIAL LOG, matching `loadFoldedReview`. A quarantined line is a
 * potential `PriceMarked` this derivation cannot see, and a mark it cannot see is
 * a day it would call lost — a false positive MANUFACTURED BY THE READER on a day
 * the feed actually ran. Stopping loud is the only honest option for a detector:
 * the quarantine sidecar `loadEventLog` has already written names every offending
 * line.
 *
 * A log file that does not exist is NOT an error — it is a window with no anchors,
 * which is exactly what the report should say about it.
 */
export async function loadGapReport(
  paths: EventStorePaths,
  window: GapWindow,
): Promise<GapReport> {
  const load = await loadEventLog(paths.log);
  assertLogFullyLoaded(load, paths.log);
  return computeGapReport(load.events, window);
}
