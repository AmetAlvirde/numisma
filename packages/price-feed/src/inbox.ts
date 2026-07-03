/**
 * The atomic emit around the engine's pure inbox merge (ADR-005 / C3). The
 * merge-by-id, non-clobbering semantics live in `@numisma/engine`
 * (`mergeInbox`); this shell only reads the current inbox, applies that merge,
 * and writes the next image atomically (temp+rename) so an interrupted write
 * cannot leave the inbox as corrupt JSON that would block `pnpm spine`.
 *
 * The fetcher NEVER writes the event log (R6): it drops candidates in the inbox
 * and `pnpm spine` owns the guarded, validated append.
 */
import { readFile } from "node:fs/promises";
import { mergeInbox, type InboxRecord, type PriceMarkedEvent } from "@numisma/engine";
import { atomicWrite } from "./atomic-write.js";

/**
 * Merge fresh marks into the inbox without clobbering pending (e.g. hand-authored)
 * events, and return the number newly added. Existing records are preserved
 * verbatim; a mark whose id is already queued is skipped (idempotent re-runs).
 */
export async function emitMarksToInbox(
  inboxPath: string,
  marks: readonly PriceMarkedEvent[],
): Promise<number> {
  const existing = await readInbox(inboxPath);
  // Marks are engine-typed events; the inbox may also hold hand-authored records
  // of any shape, so the merge operates on the shared `{ id }` surface.
  const { next, addedCount } = mergeInbox<InboxRecord>(existing, marks);
  // Nothing fresh (a pre-mark-time or idempotent re-run): leave the inbox exactly
  // as-is — never create an empty inbox, never reformat hand-authored entries.
  if (addedCount === 0) {
    return 0;
  }
  await atomicWrite(inboxPath, `${JSON.stringify(next, null, 2)}\n`);
  return addedCount;
}

async function readInbox(inboxPath: string): Promise<InboxRecord[]> {
  let raw: string;
  try {
    raw = await readFile(inboxPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(`Inbox ${inboxPath} must be a JSON array of transactions.`);
  }
  return parsed as InboxRecord[];
}
