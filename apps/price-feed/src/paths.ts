/**
 * Resolve the two on-disk locations the shell writes to: the disposable
 * price-store directory and the shared inbox write channel. The event-store
 * locations come from `@numisma/event-store` itself, the same extracted read path
 * the tui consumes — so price-feed and tui agree by construction rather than by
 * two copies of one convention.
 */
import { join } from "node:path";
import { PRICE_STORE_DIR_SEGMENT, normalizeDataDirOverride } from "@numisma/engine";
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
 * The guard has to live HERE rather than being inherited, and that is the whole reason
 * this function is one of the doors #348 and #369 both had to reach. It used to call
 * `resolve()` on its argument BEFORE handing it to `resolveEventStorePaths`, which
 * LAUNDERS every value the upstream resolver refuses into one it accepts: `resolve("")`
 * is the process's CWD and `resolve("data")` is `<cwd>/data`, both absolute and both
 * indistinguishable at the boundary from a deliberate root. The upstream guard saw a
 * valid-looking path and passed it, and the pair produced exactly the
 * `<cwd>/events.jsonl` that resolver's error message says can never happen. Measured
 * before the blank guard, not theorised — and the relative arm laundered the same way
 * until #369.
 *
 * Validating through the shared `normalizeDataDirOverride` is what makes that
 * structurally impossible rather than fixed twice: the value is checked as the caller
 * WROTE it, before any `resolve()` can disguise it.
 *
 * `dataDir` is REQUIRED here and there is deliberately no default, so unlike the
 * resolvers upstream this one has no `undefined` → default arm to preserve — which is
 * why its refusal points only at "pass an absolute path" and not at a way to reach a
 * default it does not have. Every caller (`cli.ts`, `fetch-prices.ts`) passes
 * `config.dataDir`, which is `resolveDataDir()` — already absolute and already
 * validated. The guard is therefore unreachable from the real callers by construction,
 * which is the point: it exists so that stays true.
 */
export function resolvePriceFeedPaths(dataDir: string): PriceFeedPaths {
  const base = normalizeDataDirOverride(dataDir, {
    subject: "a price-feed data directory",
    blankHeadline: "a price-feed data directory must not be empty",
    blankConsequence:
      "it resolves to the process's working directory, which would scatter the price " +
      "store, the inbox and a phantom event log into whatever directory the fetch " +
      "happened to start in.",
  });
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
