/**
 * Resolve the two on-disk locations the shell writes to, from the shared engine
 * path convention (so price-feed and tui agree without depending on each other):
 * the disposable price-store directory and the shared inbox write channel.
 */
import { join, resolve } from "node:path";
import { INBOX_PATH_SEGMENTS, PRICE_STORE_DIR_SEGMENT } from "@numisma/engine";

export interface PriceFeedPaths {
  /** Directory holding `data/prices/<instrumentId>.jsonl`. */
  pricesDir: string;
  /** The shared inbox file `pnpm spine` consumes. */
  inbox: string;
}

export function resolvePriceFeedPaths(dataDir: string): PriceFeedPaths {
  const base = resolve(dataDir);
  return {
    pricesDir: join(base, PRICE_STORE_DIR_SEGMENT),
    inbox: join(base, ...INBOX_PATH_SEGMENTS),
  };
}
