/**
 * Resolve the two on-disk locations the shell writes to: the disposable
 * price-store directory and the shared inbox write channel. The event-store
 * locations come from `@numisma/event-store` itself, the same extracted read path
 * the tui consumes — so price-feed and tui agree by construction rather than by
 * two copies of one convention.
 */
import { join, resolve } from "node:path";
import { PRICE_STORE_DIR_SEGMENT } from "@numisma/engine";
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
  // tui and is not the log. All three event-store locations come from the event
  // store itself, so there is nothing left here to drift from what the spine and
  // tui read; only `pricesDir` — which the event store has no equivalent for — is
  // still assembled here, from the engine's own segment.
  const { genesis, log, inbox } = resolveEventStorePaths(base);
  return {
    pricesDir: join(base, PRICE_STORE_DIR_SEGMENT),
    inbox,
    genesis,
    log,
  };
}
