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

/**
 * Resolve the price-feed's on-disk locations from one data root.
 *
 * A blank or whitespace-only `dataDir` is REFUSED (#348), and the refusal has to live
 * HERE rather than being inherited. This function calls `resolve()` on its argument
 * BEFORE handing it to `resolveEventStorePaths`, and `resolve("")` is the process's CWD
 * — an absolute, perfectly valid-looking path. So a blank laundered through this
 * function arrived at the hardened resolver already disguised, its own guard never
 * fired, and the pair produced exactly the `<cwd>/events.jsonl` that resolver's error
 * message says must never happen. Measured before this guard, not theorised.
 *
 * `dataDir` is REQUIRED here and there is deliberately no default, so unlike the
 * resolvers upstream this one has no `undefined` → default arm to preserve: every
 * caller (`cli.ts`, `fetch-prices.ts`) passes `config.dataDir`, which is
 * `resolveDataDir()` — already absolute and already blank-refused. The guard is
 * therefore unreachable from the real callers by construction, which is the point: it
 * exists so that stays true.
 */
export function resolvePriceFeedPaths(dataDir: string): PriceFeedPaths {
  if (dataDir.trim() === "") {
    throw new Error(
      `a price-feed data directory must not be empty (got "${dataDir}"). ` +
        `An empty value is not "unset": it resolves to the process's working ` +
        `directory, which would scatter the price store, the inbox and a phantom ` +
        `event log into whatever directory the fetch happened to start in. ` +
        `Pass an absolute path.`,
    );
  }
  const base = resolve(dataDir);
  // Reading the log refreshes its derived `events.jsonl.quarantine` lane, which is
  // shared with `pnpm spine` and the tui and is not the log itself (R6 holds).
  // `pricesDir` is assembled here because the event store has no equivalent for it.
  const { genesis, log, inbox } = resolveEventStorePaths(base);
  return {
    pricesDir: join(base, PRICE_STORE_DIR_SEGMENT),
    inbox,
    genesis,
    log,
  };
}
