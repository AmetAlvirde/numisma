// The ONE pure resolver for the durable ledger's data root, shared by every
// runtime plane (the tui event-store, the price-feed config, the preferences
// sidecar). It was byte-identical duplicated across `event-store.ts` and
// `config.ts` — the exact duplication ADR-001's realized note (#58) celebrated
// removing with a contract test — so it lives here as the single copy.
//
// This is pure string/env computation: `homedir()` reads a process-derived value
// (like `$HOME`) and the `node:path` helpers are pure — no fs, no clock, no IO —
// so it belongs in the engine alongside `INBOX_PATH_SEGMENTS` /
// `PRICE_STORE_DIR_SEGMENT` without violating ADR-001's IO boundary.
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * The durable log's default home: the sibling private `accumulus` repo's `data/`.
 * Per the grill decision (the durable log lives in the sibling `accumulus` repo,
 * not the numisma checkout), the DEFAULT data root is `~/Dev/accumulus/data`,
 * derived from `os.homedir()` — ABSOLUTE and homedir-derived, NEVER a hardcoded
 * `/Users/...` literal and NEVER a CWD-relative `"data"`.
 */
function accumulusDataDirDefault(): string {
  return join(homedir(), "Dev", "accumulus", "data");
}

/**
 * Resolve the durable ledger's data root, honoring the `NUMISMA_DATA_DIR` env var —
 * the SINGLE knob that moves EVERY plane (the tui event-store, the price-feed
 * config, and the preferences sidecar), so one override steers them all and no
 * plane can drift onto a divergent ghost ledger.
 *
 * Resolution rule (must stay byte-identical across planes):
 *   - unset, empty, or whitespace-only  → the accumulus default (`~/Dev/accumulus/data`).
 *   - `~` or `~/…`                       → `~`-expanded against `homedir()`, then made absolute.
 *   - an absolute path                   → normalized via `resolve()`.
 *   - a RELATIVE path (e.g. `data`)      → REJECTED loudly (D6). A relative value
 *     resolves differently depending on the process CWD — `pnpm prices:fetch`
 *     (CWD = repo root) vs a package's own script (CWD = package dir) would land on
 *     two different stores — so it must fail loud rather than silently split-brain.
 *
 * `env` is injectable so callers (and the drift/contract test) can resolve against a
 * given environment without mutating the real `process.env`. price-feed reads at
 * import time and the tui reads per call; both are equivalent for a CLI process (D8).
 */
export function resolveDataDir(
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env.NUMISMA_DATA_DIR;
  if (fromEnv && fromEnv.trim() !== "") {
    const raw = fromEnv.trim();
    if (raw === "~" || raw.startsWith("~/")) {
      return resolve(join(homedir(), raw.slice(1)));
    }
    if (!isAbsolute(raw)) {
      throw new Error(
        `NUMISMA_DATA_DIR must be an absolute path or start with "~/" (got "${raw}"). ` +
          `A relative value resolves differently depending on the working directory, ` +
          `so it is rejected to prevent a split-brain ledger.`,
      );
    }
    return resolve(raw);
  }
  return accumulusDataDirDefault();
}
