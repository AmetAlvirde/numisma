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
import { mergeInbox, type InboxRecord, type PriceMarkedEvent } from "@numisma/engine";
import { readOptional } from "@numisma/event-store";
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
  // Marks are engine-typed events; the inbox may also hold hand-authored records
  // of any shape, so the merge operates on the shared `{ id }` surface — which is
  // all this cast asserts over the shared reader's `unknown[]`.
  const existing = (await readInboxArray(inboxPath)) as InboxRecord[];
  const { next, addedCount } = mergeInbox<InboxRecord>(existing, marks);
  // Nothing fresh (a pre-mark-time or idempotent re-run): leave the inbox exactly
  // as-is — never create an empty inbox, never reformat hand-authored entries.
  if (addedCount === 0) {
    return 0;
  }
  await atomicWrite(inboxPath, `${JSON.stringify(next, null, 2)}\n`);
  return addedCount;
}

/**
 * Read the inbox as the JSON array of transactions `pnpm spine` expects, mirroring
 * `ingestInbox`'s parse. A missing inbox is the normal case (ENOENT → `[]`, via the
 * event-store package's `readOptional` — the one ENOENT-tolerant reader); invalid
 * JSON or a non-array throws.
 *
 * The single reader for BOTH price-feed callers: this module's own merge and the
 * fetch-time rejection pre-check (`rejection-check.ts`), which folds the pending
 * inbox into the spine's reference. It yields `unknown[]` because the inbox holds
 * records of any shape; every event-shape decision belongs to the engine's
 * `parseEvent` afterwards.
 *
 * The parse sits OUTSIDE the ENOENT tolerance but WITH its own attribution: a
 * corrupt or empty inbox file would otherwise throw a bare `SyntaxError: Unexpected
 * token…` with no path — and, worse, only AFTER fresh marks were already written to
 * the store, skipping the per-symbol report. Fail loudly naming the file, matching
 * the tui's event-store phrasing (`Inbox … is not valid JSON.`).
 */
export async function readInboxArray(inboxPath: string): Promise<unknown[]> {
  const raw = await readOptional(inboxPath);
  if (raw === undefined) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Inbox ${inboxPath} is not valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Inbox ${inboxPath} must be a JSON array of transactions.`);
  }
  return parsed;
}
