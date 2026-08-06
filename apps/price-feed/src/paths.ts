/**
 * Resolve the two on-disk locations the shell writes to, from the shared engine
 * path convention (so price-feed and tui agree without depending on each other):
 * the disposable price-store directory and the shared inbox write channel.
 */
import { join, resolve } from "node:path";
import { INBOX_PATH_SEGMENTS, PRICE_STORE_DIR_SEGMENT } from "@numisma/engine";
import { resolveEventStorePaths } from "@numisma/event-store";

export interface PriceFeedPaths {
  /** Directory holding `data/prices/<instrumentId>.jsonl`. */
  pricesDir: string;
  /** The shared inbox file `pnpm spine` consumes. */
  inbox: string;
  /** The immutable t0 seed the fetch-time rejection pre-check reads; never written. */
  genesis: string;
  /**
   * The append-only event log the rejection pre-check reads for last-close. The log
   * file itself is never written here; reading it refreshes its derived
   * `events.jsonl.quarantine` side lane, exactly as every other reader does.
   */
  log: string;
}

export function resolvePriceFeedPaths(dataDir: string): PriceFeedPaths {
  const base = resolve(dataDir);
  // The spine owns genesis/log writes (R6): the pre-check never writes either
  // file, it only READS them to rebuild the known world the ±50% guard judges a
  // fetched mark against. That read does refresh the log's derived quarantine
  // lane (`events.jsonl.quarantine`), which is shared with `pnpm spine` and the
  // tui and is not the log. Both filenames come from the event store itself, so
  // there is nothing left here to drift from what the spine and tui read.
  const { genesis, log } = resolveEventStorePaths(base);
  return {
    pricesDir: join(base, PRICE_STORE_DIR_SEGMENT),
    inbox: join(base, ...INBOX_PATH_SEGMENTS),
    genesis,
    log,
  };
}
