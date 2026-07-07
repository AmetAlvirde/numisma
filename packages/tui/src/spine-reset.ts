/**
 * Iteration helper for a THROWAWAY dataDir: undo a consumed ingest so an edited
 * inbox can be re-folded during local experimentation.
 *
 * `ingestInbox` archives the inbox (rename → <dataDir>/ingested/<asOf>.json) and the
 * appended ids are deduped forever after, so editing prices and re-running
 * `pnpm spine` would skip every line as a duplicate. This reset:
 *   1. deletes the append-only log (<dataDir>/events.jsonl), and
 *   2. if the inbox is gone, restores the most recent archive back to it.
 *
 * DESTRUCTIVE-DEFAULT GUARD: `rm(paths.log)` deletes the sacred append-only log.
 * With the default dataDir resolving to the private `accumulus` sibling repo, an
 * unguarded run would `rm ~/Dev/accumulus/data/events.jsonl` — the very durable
 * ledger this increment exists to protect. So this command REFUSES to run whenever
 * the resolved dataDir is the accumulus default; it requires an explicit,
 * non-default `NUMISMA_DATA_DIR` (a throwaway experiment/test dir). Scoping it this
 * way — rather than dropping it from the reliable cut — keeps the local-iteration
 * ergonomics while making the accumulus footgun structurally impossible.
 *
 * Genesis is never touched. Safe to run repeatedly; a no-op when already clean.
 */
import { readdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { resolveDataDir } from "@numisma/engine";
import { resolveDataDirDefault, resolveEventStorePaths } from "./event-store.js";

const dataDir = resolveDataDirDefault();
// The accumulus default, ignoring any env override: `resolveDataDir` with an empty
// env skips the `NUMISMA_DATA_DIR` branch and returns the homedir-derived default.
// Refuse whenever the resolved dataDir equals it — whether the default was reached
// implicitly (env unset) or by an explicit `NUMISMA_DATA_DIR` pointed at accumulus.
if (resolve(dataDir) === resolve(resolveDataDir({}))) {
  process.stderr.write(
    `⚠️ spine:reset refused: dataDir resolves to the default accumulus ledger (${dataDir}).\n` +
      `   This command deletes events.jsonl and must NEVER touch the durable log.\n` +
      `   Set NUMISMA_DATA_DIR to an explicit throwaway dir to reset that instead.\n`,
  );
  process.exit(1);
}

const paths = resolveEventStorePaths(dataDir);

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
