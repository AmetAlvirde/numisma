/**
 * The operator notice's IO shell — the read, the compose, and the one write.
 *
 * Mirrors `gap-report-io.ts` exactly: every rendering decision lives in the pure
 * `operator-notice.ts`, and this file does nothing but touch disk. It accepts
 * RESOLVED {@link EventStorePaths}, so the caller's `NUMISMA_DATA_DIR` resolution is
 * honoured rather than re-derived, and one store resolution serves the process.
 *
 * IT CANNOT REJECT. Both halves already refuse to throw — `loadHeartbeatLines`
 * treats an unreadable breadcrumb as absent, and the gap derivation's failure is
 * caught here and rendered AS A LINE rather than swallowed. The write itself is the
 * one operation left that can fail, and it is left to the caller: the CLI entry that
 * runs inside the wrapper decides what a disk failure means for the run.
 */
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EventStorePaths } from "./event-store.js";
import type { GapWindow } from "./gap-report.js";
import { loadGapReport } from "./gap-report-io.js";
import { loadHeartbeatLines } from "./heartbeat-io.js";
import { formatOperatorNotice, type NoticeGapFindings } from "./operator-notice.js";

/**
 * THE FILE THE SHELL PROFILE CATS. One fixed, well-known name under the resolved
 * data dir, beside `gap-report.json` and `job-heartbeat.json` — `gap-report-io.ts`'s
 * stated reason applies unchanged: the notice travels with the DATA rather than with
 * the checkout, so it survives a fresh clone and follows a moved store.
 *
 * `.txt`, not `.json`, and that is the point of the whole transport: the consumer is
 * `cat`, and a reader that needs `jq` is a reader that needs a tool the operator's
 * shell profile should not require.
 *
 * REWRITTEN EVERY RUN, WITH NO ROTATION AND NO HISTORY — `gap-report-io.ts`'s
 * convention for exactly this class of file. "The shell reads THE notice" needs
 * exactly one well-known name, and a notice that accumulated would be a log.
 */
export const OPERATOR_NOTICE_FILENAME = "operator-notice.txt";

/** The one path: `operator-notice.txt` beside the durable log in the caller's store. */
export function operatorNoticePath(paths: EventStorePaths): string {
  return join(dirname(paths.log), OPERATOR_NOTICE_FILENAME);
}

/**
 * Derive both signals for ONE instant and render the notice. Empty means healthy.
 *
 * `now` IS PASSED ONCE AND SHARED, for `liveness-lines.ts`' reason verbatim: the
 * heartbeat's staleness threshold and the gap report's ceiling are the same rule
 * (`dueThrough`), so evaluating them against two different clock reads is the one
 * way the two halves of one notice could contradict each other.
 */
export async function loadOperatorNoticeLines(
  paths: EventStorePaths,
  now: Date,
  window: Omit<GapWindow, "now"> = {},
): Promise<string[]> {
  const [heartbeatLines, findings] = await Promise.all([
    loadHeartbeatLines(paths, now),
    loadGapFindings(paths, { ...window, now }),
  ]);
  return formatOperatorNotice(heartbeatLines, findings);
}

/** The one `try` in the module — the derivation's failure, carried as data. */
async function loadGapFindings(
  paths: EventStorePaths,
  window: GapWindow,
): Promise<NoticeGapFindings> {
  try {
    return { kind: "report", report: await loadGapReport(paths, window) };
  } catch (error) {
    return { kind: "failed", error };
  }
}

/**
 * Write the notice and return the path written.
 *
 * IT ALWAYS WRITES, INCLUDING THE EMPTY CASE, and that is the whole self-clearing
 * contract: a healthy run must actively truncate the previous run's findings, or the
 * operator reads yesterday's lost day forever and learns to ignore the channel. An
 * empty file is the healthy state — `cat` of it prints nothing, so the shell profile
 * needs no test and there is NO DISMISSAL STATE to get wrong.
 *
 * IT OVERWRITES; IT NEVER APPENDS AND NEVER MERGES. A later wrapper step 0 writes
 * this same file before the toolchain is resolved, reporting the PREVIOUS run's
 * failure. Reaching this writer means the current run got through the fetch, the
 * ingest, the commit and the post-check — so the previous failure is stale news and
 * being replaced wholesale is correct. The single `writeFile` with no `flag` is what
 * makes that non-negotiable in code rather than in a comment.
 *
 * NOT ATOMIC, AND IT DOES NOT CREATE THE DIRECTORY — both accepted, for
 * `writeGapReportFile`'s reasons unchanged. This is a small single-writer file in a
 * directory that by construction already holds the log it was derived from, and a
 * torn write is repaired by the next run, at most a day away. (The repo's
 * `atomicWrite` lives in `apps/price-feed` and guards the DURABLE store; a package
 * may not import an app, and a derived notice does not need the guarantee.)
 */
export async function writeOperatorNoticeFile(
  lines: readonly string[],
  options: { path: string },
): Promise<string> {
  const body = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
  await writeFile(options.path, body, "utf8");
  return options.path;
}

/** Derive and write in one call — what the wrapper's step 5 invokes. */
export async function writeOperatorNotice(
  paths: EventStorePaths,
  options: { now: Date; window?: Omit<GapWindow, "now"> },
): Promise<string> {
  const lines = await loadOperatorNoticeLines(paths, options.now, options.window ?? {});
  return writeOperatorNoticeFile(lines, { path: operatorNoticePath(paths) });
}
