/**
 * S3 · THE FAKE-TOOL BIN — the fixture module of the wrapper harness (PRD #314 §4).
 *
 * EVERY BYTE HERE IS AUTHORED for this purpose. Nothing is captured from a real run, in
 * content or in shape — the repo's transaction data is private and lives in a gitignored
 * sibling repo, and the line is authorship, not resemblance.
 *
 * ONE FAKE `pnpm` THAT DISPATCHES ON ITS FIRST ARGUMENT, not four unrelated scripts. The
 * wrapper calls `pnpm` four times with distinct first arguments — `prices:fetch`,
 * `spine`, `gap-report -- --write`, `backfill` — and a later slice needs a run that
 * succeeds through `spine` and then hangs at `backfill` specifically. A single-behavior
 * fake cannot express that; a per-command behavior table can.
 *
 * INSTALLED THROUGH `NUMISMA_PATH_PREPEND`, NEVER ON THE INHERITED `PATH`. This is the
 * single most dangerous mistake available in this increment. The wrapper re-exports
 * `PATH="$PATH_PREPEND:$PATH"` in its own body, and the documented default prepend holds
 * the directories where the REAL pnpm and node live — so a fake installed early on the
 * inherited `PATH` is overridden BY THE SCRIPT ITSELF, and the run executes a real
 * `prices:fetch`, a real `spine` append, a real `git commit` against the durable event
 * log and a real `backfill` against the hosted database. **That failure does not go red.
 * It passes green while running the real pipeline against real, private data.**
 *
 * THE SENTINEL IS THE GUARD AGAINST EXACTLY THAT, and it is not optional (§6). Every fake
 * writes a sentinel into the case dir when it is invoked and every case asserts the
 * sentinels exist, so a `NUMISMA_PATH_PREPEND` mistake becomes a RED TEST rather than a
 * real run that happens to pass.
 *
 * THE BEHAVIOR TABLE FAILS CLOSED. A behavior name this fake does not implement exits 99
 * with a message rather than falling through to `succeeds` — otherwise a later slice
 * could ask for `hangs`, silently get a success, and ship a timeout case that never times
 * out. Slice 1 implements `succeeds`; slices 2-4 add entries here.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Behaviors the fake implements. Slice 1 ships one; the dispatch is what is being built. */
export type FakeBehavior = "succeeds";

/** The four first-arguments the wrapper invokes `pnpm` with, in the order it invokes them. */
export const WRAPPER_PNPM_COMMANDS = ["prices:fetch", "spine", "gap-report", "backfill"] as const;

/**
 * The sentinel filename a given `pnpm` sub-command writes. Mirrors the `tr` in the fake
 * itself: anything outside `[A-Za-z0-9._-]` becomes `-`, so `prices:fetch` lands as
 * `pnpm-prices-fetch`.
 */
export function sentinelNameFor(command: string): string {
  return `pnpm-${command.replace(/[^A-Za-z0-9._-]/g, "-")}`;
}

function behaviorKeyFor(command: string): string {
  return command.replace(/[^A-Za-z0-9._-]/g, "-");
}

/**
 * The authored fake `pnpm`. The case dir is BAKED IN rather than read from the
 * environment: the sentinel is the harness's proof that this script — and not the real
 * pnpm — was what ran, so it must not depend on an environment variable the subject under
 * test is free to rewrite. The wrapper rewrites `PATH` and sources a token file; a
 * sentinel that could be redirected by either would be proving the wrong thing.
 */
function fakePnpmSource(caseDir: string): string {
  return `#!/bin/bash
# AUTHORED fake \`pnpm\` for the wrapper test harness. Not captured from any real run.
# It exists so a case can drive ops/price-feed/run-daily-fetch.sh end to end without a
# real fetch, a real spine append, a real commit against the durable log, or a real
# backfill against the hosted database.
set -u

CASE_DIR="${caseDir}"
COMMAND="\${1:-}"
KEY="$(printf '%s' "\${COMMAND}" | tr -c 'A-Za-z0-9._-' '-')"

# THE SENTINEL, written FIRST and unconditionally: it is the harness's only proof that
# the fake — and not the real pnpm — is what the wrapper's own re-exported PATH selected.
mkdir -p "\${CASE_DIR}/sentinels" 2>/dev/null || true
: > "\${CASE_DIR}/sentinels/pnpm-\${KEY}"
printf 'pnpm %s\\n' "$*" >> "\${CASE_DIR}/sentinels/pnpm-invocations.log"

BEHAVIOR="succeeds"
if [[ -f "\${CASE_DIR}/behavior/\${KEY}" ]]; then
  BEHAVIOR="$(cat "\${CASE_DIR}/behavior/\${KEY}")"
fi

case "\${BEHAVIOR}" in
  succeeds)
    printf 'fake pnpm: %s succeeded (authored fixture)\\n' "\${COMMAND}"
    exit 0
    ;;
  *)
    # FAIL CLOSED. An unimplemented behavior must not degrade into a success, or a
    # timeout case would ship green while never timing out.
    printf 'fake pnpm: UNIMPLEMENTED behavior %s requested for %s\\n' "\${BEHAVIOR}" "\${COMMAND}" >&2
    exit 99
    ;;
esac
`;
}

/**
 * The authored fake `node`. The wrapper never EXECUTES node — it only asserts
 * `command -v node` resolves, because with asdf-managed node a resolvable pnpm whose node
 * is invisible dies as a bare exit 127 mid-run. So this exists to be FOUND. If it is ever
 * actually run, something has changed in the wrapper and the harness should say so loudly
 * rather than pretend to be a node.
 */
function fakeNodeSource(caseDir: string): string {
  return `#!/bin/bash
# AUTHORED fake \`node\` for the wrapper test harness. It exists to be FOUND by the
# wrapper's \`command -v node\` check, not to be run.
set -u
CASE_DIR="${caseDir}"
mkdir -p "\${CASE_DIR}/sentinels" 2>/dev/null || true
: > "\${CASE_DIR}/sentinels/node-executed"
printf 'fake node: EXECUTED, which the harness does not expect — the fakes stand in for pnpm, not for node\\n' >&2
exit 97
`;
}

/**
 * A DECOY `pnpm`, used by the one assertion that proves the fake actually won.
 *
 * It stands in for what the wrapper's real default `NUMISMA_PATH_PREPEND` holds: a
 * directory that shadows the inherited `PATH`. The assertion installs the case's fake on
 * the INHERITED `PATH` and this decoy on the PREPEND, then resolves `pnpm` exactly as the
 * wrapper's own `export PATH="$PATH_PREPEND:$PATH"` would — and gets the decoy. In the
 * real world the decoy is the real pnpm and the run is a live one.
 *
 * It refuses to do anything if executed. Nothing should ever execute it.
 */
function decoyPnpmSource(): string {
  return `#!/bin/bash
# AUTHORED decoy standing in for the REAL pnpm that the wrapper's default
# NUMISMA_PATH_PREPEND would resolve. It must never be executed by anything.
printf 'decoy pnpm: executed — the harness resolved the WRONG pnpm\\n' >&2
exit 98
`;
}

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source, "utf8");
  chmodSync(path, 0o755);
}

/**
 * Materialise the fake bin for a case. Returns the directory that becomes
 * `NUMISMA_PATH_PREPEND` — and it is the ONLY way the fakes reach the wrapper.
 */
export function installFakeBin(caseDir: string): string {
  const binDir = join(caseDir, "bin");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(join(caseDir, "sentinels"), { recursive: true });
  mkdirSync(join(caseDir, "behavior"), { recursive: true });
  writeExecutable(join(binDir, "pnpm"), fakePnpmSource(caseDir));
  writeExecutable(join(binDir, "node"), fakeNodeSource(caseDir));
  return binDir;
}

/** Materialise the decoy bin. Never on a launch path — only the fake-won assertion uses it. */
export function installDecoyBin(caseDir: string): string {
  const decoyDir = join(caseDir, "decoy");
  mkdirSync(decoyDir, { recursive: true });
  writeExecutable(join(decoyDir, "pnpm"), decoyPnpmSource());
  return decoyDir;
}

/** Set the behavior for one `pnpm` sub-command. Absent an entry, the fake succeeds. */
export function setFakeBehavior(caseDir: string, command: string, behavior: FakeBehavior): void {
  writeFileSync(join(caseDir, "behavior", behaviorKeyFor(command)), behavior, "utf8");
}
