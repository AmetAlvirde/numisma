/**
 * The heartbeat's IO shell — the read half only. **Nothing here writes it:** the
 * writer is a `printf` from an `EXIT` trap in `ops/price-feed/run-daily-fetch.sh`,
 * pure bash on purpose, because the case that justifies the whole design is
 * exit 127 — `pnpm` or `node` unresolvable — in which nothing that needs node can
 * run at all. A writer in this package could not record its own most important case.
 *
 * Mirrors `gap-report-io.ts`: the verdict is pure and lives in `heartbeat.ts`; this
 * is the file read, and it accepts resolved {@link EventStorePaths} so the caller's
 * store resolution is honoured rather than re-derived.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EventStorePaths } from "./event-store.js";
import {
  HEARTBEAT_FILENAME,
  formatHeartbeatWarning,
  parseHeartbeat,
  type JobHeartbeat,
} from "./heartbeat.js";

/** `job-heartbeat.json`, beside `gap-report.json` and the log it accompanies. */
export function heartbeatPath(paths: EventStorePaths): string {
  return join(dirname(paths.log), HEARTBEAT_FILENAME);
}

/**
 * Read and parse the breadcrumb, or `undefined` when there is none to read.
 *
 * AN ABSENT FILE IS NOT AN ERROR — it is the normal state of a machine that never
 * hosted the job. Neither is an unreadable one: a file being written by a trap on a
 * failing machine can legitimately be caught half-written, so every IO and parse
 * failure alike resolves to `undefined`. This function cannot reject.
 */
export async function loadHeartbeat(
  paths: EventStorePaths,
): Promise<JobHeartbeat | undefined> {
  try {
    return parseHeartbeat(await readFile(heartbeatPath(paths), "utf8"));
  } catch {
    return undefined;
  }
}

/**
 * The lines the TUI prints, if any. Empty when the last run was healthy, when the
 * file is absent, and when it cannot be read — see `heartbeat.ts` on why those
 * three are deliberately the same answer.
 */
export async function loadHeartbeatLines(
  paths: EventStorePaths,
  now: Date,
): Promise<string[]> {
  return formatHeartbeatWarning(await loadHeartbeat(paths), now);
}
