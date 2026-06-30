/**
 * PROTOTYPE (mvi 2026-06-29-portfolio-persistence). Iteration helper for the
 * Node tracer: undo a consumed ingest so an edited inbox can be re-folded.
 *
 * `ingestInbox` archives the inbox (rename → data/ingested/<asOf>.json) and the
 * appended ids are deduped forever after, so editing prices and re-running
 * `pnpm spine` would skip every line as a duplicate. This reset:
 *   1. deletes the append-only log (data/events.jsonl), and
 *   2. if the inbox is gone, restores the most recent archive back to it.
 *
 * Genesis is never touched. Safe to run repeatedly; a no-op when already clean.
 */
import { readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { resolveEventStorePaths } from "./event-store.js";

const paths = resolveEventStorePaths();

await rm(paths.log, { force: true });

if (!(await exists(paths.inbox))) {
  const restored = await restoreLatestArchive();
  if (restored) {
    process.stdout.write(`Restored inbox from ${restored}; log cleared.\n`);
  } else {
    process.stdout.write("Log cleared; no archived inbox to restore.\n");
  }
} else {
  process.stdout.write("Log cleared; inbox already present.\n");
}

async function restoreLatestArchive(): Promise<string | undefined> {
  let entries: string[];
  try {
    entries = (await readdir(paths.ingestedDir)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  const latest = entries.at(-1);
  if (!latest) {
    return undefined;
  }
  const archived = join(paths.ingestedDir, latest);
  await rename(archived, paths.inbox);
  if ((await readdir(paths.ingestedDir)).length === 0) {
    await rm(paths.ingestedDir, { recursive: true, force: true });
  }
  return archived;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}
