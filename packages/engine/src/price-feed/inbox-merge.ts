/**
 * The pure, non-clobbering inbox merge (ADR-005 / C3) and the shared inbox +
 * price-store path convention. This is the ONE definition of the merge semantics
 * the prototype duplicated: `@numisma/price-feed` performs the atomic temp+rename
 * write around it, and tui's `event-store.ts` keeps consuming the same channel —
 * with no price-feed↔tui dependency in either direction.
 *
 * Merge-by-id, non-clobbering: every entry already in the inbox is preserved
 * verbatim (a hand-authored pending event is never touched), and an incoming mark
 * whose id already appears is skipped. Combined with the deterministic
 * `pm-<instrumentId>-<asOf>` id, re-running a fetch the same day adds nothing.
 */

/** The minimal shape the merge needs: any inbox record carries a stable `id`. */
export interface InboxRecord {
  id: string;
}

/** The outcome of a merge: the next inbox image and how many records were new. */
export interface InboxMergeResult<T extends InboxRecord> {
  next: T[];
  addedCount: number;
}

/**
 * Merge `incoming` records into the `existing` inbox without clobbering. Existing
 * records keep their order and identity; an incoming record is appended only when
 * its `id` is not already present. Pure — it returns a new array and mutates
 * nothing.
 */
export function mergeInbox<T extends InboxRecord>(
  existing: readonly T[],
  incoming: readonly T[],
): InboxMergeResult<T> {
  const seen = new Set(existing.map((record) => record.id));
  const fresh: T[] = [];
  for (const record of incoming) {
    if (!seen.has(record.id)) {
      seen.add(record.id);
      fresh.push(record);
    }
  }
  return { next: [...existing, ...fresh], addedCount: fresh.length };
}

/**
 * Path segments (relative to the `data` dir) of the shared inbox write channel,
 * matching tui's `resolveEventStorePaths`. Named here so both access surfaces
 * agree on one convention without depending on each other.
 */
export const INBOX_PATH_SEGMENTS: readonly string[] = ["inbox", "transactions.json"];

/** The disposable price-store plane's directory segment under the `data` dir. */
export const PRICE_STORE_DIR_SEGMENT = "prices";

/** The per-instrument price-store file name (`<instrumentId>.jsonl`). */
export function priceStoreFileName(instrumentId: string): string {
  return `${instrumentId}.jsonl`;
}
