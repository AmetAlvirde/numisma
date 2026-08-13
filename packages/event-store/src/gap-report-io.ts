/**
 * The gap report's IO shell — and the ONLY async surface in the whole derivation.
 *
 * It does three things and deliberately nothing else: read the durable log, hand
 * the events to the pure {@link computeGapReport}, and write the result out as the
 * standup's `gap-report.json`. Every decision about what counts as a mark, where
 * the window starts and where it stops lives in `gap-report.ts`, which is
 * synchronous and testable with no disk at all.
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
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { assertLogFullyLoaded, loadEventLog } from "./event-store.js";
import type { EventStorePaths } from "./event-store.js";
import {
  computeGapReport,
  formatGapReport,
  formatGapSummary,
  type GapReport,
  type GapWindow,
} from "./gap-report.js";

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

/**
 * THE FILE THE MORNING STANDUP READS. One fixed, well-known name under the
 * resolved data dir, beside the log it derives from, so the report travels with
 * the DATA rather than with the checkout.
 *
 * DELIBERATELY UNCHANGED, and not an oversight: it is overwritten every run, with
 * NO ROTATION AND NO HISTORY. "The standup reads THE file" needs exactly one
 * well-known name; if you want to know what the report said last Tuesday, it is
 * gone. Versioning is the blocking half of a history feature, rotation is not — so
 * the version ships here and rotation is carried forward.
 */
export const GAP_REPORT_FILENAME = "gap-report.json";

/**
 * THE SCHEMA VERSION — enforced by a test, not by a docstring, because readers are
 * arriving. An integer starting at 1, bumped on any change that would break a
 * reader (a removed or retyped field; adding a field does not bump it), serialized
 * as the FIRST key so `head -2` identifies the file before anything parses it.
 *
 * THE CONVENTION IS PER FILE, NOT GLOBAL. Each durable sidecar carries its own
 * counter and moves on its own schedule — a sibling like `job-heartbeat.json` gets
 * `schemaVersion: 1` of its own rather than sharing or forking this one. Two files
 * with two lifetimes must not be coupled through a version number.
 */
export const GAP_REPORT_SCHEMA_VERSION = 1;

/** The one path: `gap-report.json` beside the durable log in the caller's store. */
export function gapReportPath(paths: EventStorePaths): string {
  return join(dirname(paths.log), GAP_REPORT_FILENAME);
}

/**
 * Serialize the report and write it. Returns the path written.
 *
 * CONTENT IS DATES AND COUNTS ONLY — no NAV, no positions, no prices, no balances,
 * no magnitudes of any kind. That is what makes this file safe to write beside the
 * private durable log and safe to paste into a standup, and it is enforced by the
 * privacy walk in `gap-report-io.test.ts` rather than by inspection: every key is
 * allowlisted there, so a field nobody has thought of yet fails by default.
 *
 * The structured `lost` and `venueDark` arrays and the already-rendered `lines` are
 * ALL carried. The duplication is deliberate: the standup can `jq -r '.lines[]'`
 * today without anything having to agree on a text format, and a later reader can
 * consume the structure. A test keeps them in agreement.
 *
 * `venueDark` IS ITS OWN KEY, never folded into `lost` — a reader that counts
 * `.lost | length` is counting permanently unrecoverable days, and a venue-dark day
 * is not one (see `gap-report.ts`'s header). Adding it does NOT bump
 * {@link GAP_REPORT_SCHEMA_VERSION}: the version moves on a removed or retyped
 * field, and a new key breaks no existing reader.
 *
 * NOT ATOMIC, AND IT DOES NOT CREATE THE DIRECTORY — both accepted. This is a
 * small single-writer file in a directory that by construction already holds the
 * event log it was derived from: if the directory is missing there is no log to
 * report on, and a torn write is repaired by the next run, which is at most a day
 * away. A temp-file-and-rename would buy nothing this file needs.
 */
export async function writeGapReportFile(
  report: GapReport,
  options: { path: string; now: Date },
): Promise<string> {
  const body = {
    schemaVersion: GAP_REPORT_SCHEMA_VERSION,
    generatedAt: options.now.toISOString(),
    since: report.since,
    until: report.until,
    calendarDays: report.calendarDays,
    anchorsChecked: report.anchorsChecked,
    lost: report.lost,
    venueDark: report.venueDark,
    unattributedMarks: report.unattributedMarks,
    summary: formatGapSummary(report),
    lines: formatGapReport(report),
  };
  await writeFile(options.path, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return options.path;
}
