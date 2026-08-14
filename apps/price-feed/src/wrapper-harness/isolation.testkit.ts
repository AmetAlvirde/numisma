/**
 * S2 · THE ISOLATION CONTRACT — the safety module of the wrapper harness (PRD #314 §4).
 *
 * IT OWNS THE NINE `NUMISMA_*` VARIABLES THE WRAPPER READS, and its whole interface is a
 * REFUSAL. That is why it is a module of its own rather than three lines inside the
 * launcher: a missing override is not a flaky test, it is a real `prices:fetch`, a real
 * `spine` append, a real `git commit` against the durable event log and a real `backfill`
 * against the hosted database — **and the run passes green while doing it.**
 *
 * Exactly nine, verified against the wrapper's own configuration block
 * (`ops/price-feed/run-daily-fetch.sh`): every one of them must be set, and every
 * path-valued one must resolve INSIDE the case's temp directory. Refusal, never a
 * default — a default is how the real durable log gets written by a test.
 *
 * THE TWO MARK VARIABLES ARE HERE FOR A DIFFERENT REASON THAN THE OTHER SEVEN, and the
 * difference is worth stating because it decides how far the refusal goes. Neither is
 * path-valued and neither selects data, so an unset one cannot touch the real ledger. What
 * it CAN do is let the wrapper fall back to the contract zone — and then a case that meant
 * to be in-window is in-window only between 18:00 and 23:59 CDMX, so its heartbeat
 * assertions quietly stop meaning anything for most of the day. That is the same
 * green-while-testing-nothing failure the other seven prevent, arriving through the clock,
 * so it is refused the same way: unset is a refusal, never a default.
 *
 * THEIR VALUES ARE DELIBERATELY NOT VALIDATED HERE. The wrapper refuses an unresolvable
 * zone and a non-hour mark hour itself (#315), and a case ASSERTS that refusal by launching
 * with a bad one — a contract that pre-screened them would make that case unreachable and
 * leave the wrapper's own guard untested. Presence is the contract; content is the
 * wrapper's, and the harness proves it there.
 *
 * `NUMISMA_PATH_PREPEND` GETS THE STRICTEST TREATMENT OF THE NINE, and it is the reason
 * this module exists at all. The wrapper re-exports `PATH="$PATH_PREPEND:$PATH"` in its
 * OWN body, so the prepend — not the inherited `PATH` — is what decides which `pnpm` the
 * run executes. Its documented default contains the directories where the REAL pnpm and
 * node live. So every colon-separated entry is checked individually: one stray
 * `/opt/homebrew/bin` in that list silently converts the whole suite into a live run
 * against real, private data, and nothing downstream would go red.
 *
 * FAIL-CLOSED, deliberately the opposite direction from the arming trigger, which fails
 * toward running. Failing open here means touching real private data; failing open there
 * costs a slow test run.
 */

import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/**
 * The complete set the wrapper reads — no more, no fewer. Verified line by line against
 * the wrapper's configuration block; a wrapper edit that adds a tenth is a change to
 * this contract, and the trigger arms the suite on exactly that edit.
 */
export const WRAPPER_ENV_VARS = [
  "NUMISMA_REPO_DIR",
  "NUMISMA_PRICEFEED_ENV",
  "NUMISMA_PRICEFEED_LOG_DIR",
  "NUMISMA_PATH_PREPEND",
  "NUMISMA_DATA_DIR",
  "NUMISMA_PRICEFEED_MAX_RUN_SECONDS",
  "NUMISMA_PRICEFEED_WATCHDOG_GRACE_SECONDS",
  "NUMISMA_MARK_TZ",
  "NUMISMA_MARK_HOUR",
] as const;

/**
 * The five that name a filesystem location, each of which defaults — when unset — to
 * something REAL: the live checkout, the private token file, `~/Library/Logs/numisma`,
 * the directories holding the real pnpm/node, and the durable accumulus data root.
 */
export const PATH_VALUED_ENV_VARS = [
  "NUMISMA_REPO_DIR",
  "NUMISMA_PRICEFEED_ENV",
  "NUMISMA_PRICEFEED_LOG_DIR",
  "NUMISMA_PATH_PREPEND",
  "NUMISMA_DATA_DIR",
] as const;

/** The two that must be integers, since the wrapper arithmetic-compares them. */
export const NUMERIC_ENV_VARS = [
  "NUMISMA_PRICEFEED_MAX_RUN_SECONDS",
  "NUMISMA_PRICEFEED_WATCHDOG_GRACE_SECONDS",
] as const;

export class IsolationRefusal extends Error {
  constructor(message: string) {
    super(
      `wrapper harness REFUSED to launch: ${message}. This is not a fallback — an ` +
        "unisolated run executes the real pipeline against real, private data and passes green.",
    );
    this.name = "IsolationRefusal";
  }
}

/**
 * Resolve a path to its real location for containment checking. macOS matters here: the
 * system temp dir is `/var/folders/…`, and `/var` is a symlink to `/private/var`, so a
 * naive string comparison between a realpath'd case dir and an unresolved candidate would
 * report "outside" for a path that is plainly inside. Resolve the deepest existing
 * ancestor, since a path may legitimately not exist yet (a log file, a token file).
 */
function realOrNearest(path: string): string {
  let candidate = resolve(path);
  const seen = new Set<string>();
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate || seen.has(parent)) {
      return candidate;
    }
    seen.add(parent);
    candidate = parent;
  }
  const real = realpathSync(candidate);
  // `relative`, NOT `slice(candidate.length + 1)`. The arithmetic assumed the deepest
  // existing ancestor never carries a trailing separator, which is true of every
  // `dirname` result EXCEPT root: with `candidate === "/"` it dropped one character too
  // many and turned `/nope/data` into `/ope/data`. Reachable only when the whole path
  // sits under a nonexistent top-level directory, and it failed CLOSED (the mangled path
  // is still outside the case dir, so the refusal still fired) — but this is the one
  // function in the safety module that decides inside from outside, and it should be
  // right rather than accidentally right.
  return join(real, relative(candidate, resolve(path)));
}

function isInside(path: string, root: string): boolean {
  const realRoot = realpathSync(root);
  const realPath = realOrNearest(path);
  return realPath === realRoot || realPath.startsWith(`${realRoot}/`);
}

/**
 * THE REFUSAL. Throws {@link IsolationRefusal} unless all nine are set and every
 * path-valued one — every colon-separated entry of `NUMISMA_PATH_PREPEND` included —
 * resolves inside `caseDir`.
 *
 * Called by the launcher on every single launch, never by a case: a case that could
 * choose to skip it is a case that will eventually skip it.
 */
export function assertIsolated(env: NodeJS.ProcessEnv, caseDir: string): void {
  if (!isAbsolute(caseDir)) {
    throw new IsolationRefusal(`the case dir ${caseDir} is not an absolute path`);
  }
  if (!existsSync(caseDir)) {
    throw new IsolationRefusal(`the case dir ${caseDir} does not exist`);
  }

  for (const name of WRAPPER_ENV_VARS) {
    const value = env[name];
    if (value === undefined || value === "") {
      throw new IsolationRefusal(
        `${name} is unset, so the wrapper would fall back to its REAL default`,
      );
    }
  }

  for (const name of NUMERIC_ENV_VARS) {
    const value = env[name] ?? "";
    if (!/^-?\d+$/.test(value)) {
      throw new IsolationRefusal(`${name}=${value} is not an integer`);
    }
  }

  for (const name of PATH_VALUED_ENV_VARS) {
    const raw = env[name] ?? "";
    // Only PATH_PREPEND is a list, but splitting all five costs nothing and means a
    // colon smuggled into any of them is checked rather than assumed away.
    const entries = raw.split(":").filter((entry) => entry.length > 0);
    if (entries.length === 0) {
      throw new IsolationRefusal(`${name} is empty`);
    }
    for (const entry of entries) {
      if (!isAbsolute(entry)) {
        throw new IsolationRefusal(`${name} entry ${entry} is not an absolute path`);
      }
      if (!isInside(entry, caseDir)) {
        throw new IsolationRefusal(
          `${name} entry ${entry} resolves OUTSIDE the case dir ${caseDir}`,
        );
      }
    }
  }
}
