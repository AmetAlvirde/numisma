/**
 * Crash-safe file writes (ADR-005 R3 / ADR-003's discipline): write the full next
 * image to a sibling temp file, then `rename` it over the target. rename(2) within
 * a directory is atomic, so an interrupted write leaves the PRIOR file byte-for-
 * byte intact — a half-written price-store line or corrupt inbox JSON (which would
 * block `pnpm spine`) can never be observed. The IO primitives are injectable so
 * the regression test can force a failure between the temp write and the rename
 * and assert the original file survives.
 */
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface AtomicWriteIo {
  mkdir: typeof mkdir;
  writeFile: typeof writeFile;
  rename: typeof rename;
}

const REAL_IO: AtomicWriteIo = { mkdir, writeFile, rename };

/** Atomically write `contents` to `filePath` via a temp file + rename. */
export async function atomicWrite(
  filePath: string,
  contents: string,
  io: AtomicWriteIo = REAL_IO,
): Promise<void> {
  await io.mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  await io.writeFile(tempPath, contents, "utf8");
  await io.rename(tempPath, filePath);
}
