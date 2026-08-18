/**
 * S3 · THE FAKE-TOOL BIN — the fixture module of the wrapper harness (PRD #314 §4).
 *
 * EVERY BYTE HERE IS AUTHORED for this purpose. Nothing is captured from a real run, in
 * content or in shape — the repo's transaction data is private and lives in a gitignored
 * sibling repo, and the line is authorship, not resemblance.
 *
 * ONE FAKE `pnpm` THAT DISPATCHES ON ITS FIRST ARGUMENT, not five unrelated scripts. The
 * wrapper calls `pnpm` five times with distinct first arguments — `prices:fetch`,
 * `spine`, `gap-report -- --write`, `operator-notice`, `backfill` — and case 6 needs a run that succeeds
 * through `spine` and then hangs at `backfill` specifically, which is what makes it a
 * CRY-WOLF case: the day's marks are in the log and the run wedged afterwards. A
 * single-behavior fake cannot express that; a per-command behavior table can, and case 6
 * asserts the dispatch record ({@link dispatchRecordNameFor}) rather than trusting it.
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
 * out. Slice 1 implemented `succeeds`; slice 2 adds the timeout family.
 *
 * ── A HANG IS "FOREVER" UNLESS THE HARNESS RELEASES IT (slice 2) ──────────────────────
 * The hanging behaviors block until a release file appears in the case dir. No case that
 * wants a timeout ever writes one, so for cases 2 and 3 this IS `hangs forever` — the
 * watchdog is what ends those runs, exactly as the contract says.
 *
 * The release exists for the one case that needs a hang the watchdog will NOT end: case 7
 * runs with the watchdog disabled, and its whole claim is that such a run does **not**
 * time out. Proving that needs a run which is genuinely wedged past its own ceiling and
 * grace and then finishes normally — a hang with no exit is unobservable (it would only
 * ever hit the harness cap, which is a failure, not a proof) and a run killed from outside
 * would be the external-stop path, which belongs to another slice entirely.
 *
 * ── THE HANGS WAIT IN SHORT HOPS, NEVER ONE LONG `sleep` ──────────────────────────────
 * A bash script waiting on a foreground `sleep 99999` is only as reactive as that `sleep`,
 * and "reactive to TERM" is precisely what case 2 is measuring. One-second hops make the
 * distinction between the reactive child (case 2) and the TERM-deaf one (case 3) a
 * property of the `trap`, which is what it is supposed to be, rather than of `sleep`.
 */

import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Behaviors the fake implements.
 *
 * - `succeeds` — prints and exits 0 (slice 1).
 * - `hangs` — blocks until released; reactive to TERM, since neither it nor its `sleep`
 *   traps anything. Case 2's child, and case 7's.
 * - `exits-127` — exits 127 immediately, the shape a missing `pnpm`/`node` takes. Case 5.
 * - `ignores-term` — `trap '' TERM` plus a sleep loop: survives the watchdog's group TERM
 *   and dies only to the SIGKILL escalation.
 * - `hangs-with-term-deaf-grandchild` — forks a TERM-deaf child, then hangs reactively
 *   itself. Case 3, and the exact historical shape: the grandchild outlived the group
 *   TERM while holding the inherited write end of the log pipe, so `tee` never saw EOF
 *   and both sat in the run's process group holding launchd's per-label job slot.
 * - `writes-operator-notice` — copies an authored payload over an authored target path,
 *   then succeeds. The ONLY behavior that has an effect outside the case's bookkeeping,
 *   and it exists for one reason (#376): step 5b is now a real writer of
 *   `operator-notice.txt` and the EXIT trap is a second one, so "the trap replaced what 5b
 *   wrote" is a claim about ORDERING between two writers that a fake succeeding silently
 *   cannot express. Both the path and the body come from files
 *   ({@link armFakeOperatorNoticeWrite}) rather than from this module, so the fake stays a
 *   dumb copier and the AUTHORED text lives beside the case that asserts it.
 */
export type FakeBehavior =
  | "succeeds"
  | "hangs"
  | "exits-127"
  | "ignores-term"
  | "hangs-with-term-deaf-grandchild"
  | "writes-operator-notice";

/** The file holding the absolute path `writes-operator-notice` copies ONTO. */
export const FAKE_NOTICE_TARGET_NAME = "operator-notice-target";

/** The file holding the authored body `writes-operator-notice` copies FROM. */
export const FAKE_NOTICE_PAYLOAD_NAME = "operator-notice-payload";

/**
 * The authored TERM-deaf child's filename. It is matched against `ps` output, so case 3
 * can prove the deaf process was still in the run's process group AFTER the group TERM
 * and gone only after the SIGKILL escalation — the difference between "reaped" and
 * "merely orphaned", which is the whole of that case.
 */
export const TERM_DEAF_CHILD_NAME = "numisma-harness-term-deaf-child";

/** The sentinel the TERM-deaf child writes on start, so case 3 cannot silently become case 2. */
export const TERM_DEAF_CHILD_SENTINEL = "term-deaf-grandchild-started";

/**
 * The five first-arguments the wrapper invokes `pnpm` with, IN THE ORDER IT INVOKES THEM.
 *
 * `operator-notice` sits where the wrapper's step 5b puts it — after `gap-report` and
 * before `backfill` — and that POSITION is the assertion, not decoration. Both halves of
 * case 6 compare `invocationOrder()` against this list exactly, so a notice step that
 * drifted to the far side of the networked `backfill` goes red here rather than shipping:
 * the whole reason 5b sits where it does is that `gap-report` and the notice are the LOCAL
 * derived surfaces, and a thirty-second database outage must not be able to take the
 * delivery channel down with it.
 */
export const WRAPPER_PNPM_COMMANDS = [
  "prices:fetch",
  "spine",
  "gap-report",
  "operator-notice",
  "backfill",
] as const;

/**
 * The sentinel filename a given `pnpm` sub-command writes. Mirrors the `tr` in the fake
 * itself: anything outside `[A-Za-z0-9._-]` becomes `-`, so `prices:fetch` lands as
 * `pnpm-prices-fetch`.
 */
export function sentinelNameFor(command: string): string {
  return `pnpm-${command.replace(/[^A-Za-z0-9._-]/g, "-")}`;
}

/**
 * The file recording WHICH BEHAVIOR the fake's per-first-argument dispatch selected for
 * one sub-command. It is what lets case 6 prove its hang originated in that dispatch —
 * `succeeds` for the three steps before it, `hangs` for `backfill` — rather than in a
 * single-behavior fake that could not have expressed "hangs at backfill specifically" at
 * all.
 */
export function dispatchRecordNameFor(command: string): string {
  return `behavior-${command.replace(/[^A-Za-z0-9._-]/g, "-")}`;
}

/** The file every invocation appends one line to, in the order the wrapper made them. */
export const INVOCATION_LOG_NAME = "pnpm-invocations.log";

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

# WHICH BRANCH THIS INVOCATION TOOK, RECORDED IN A FILE rather than only announced on
# stdout. A case that must prove a LATER step hung — case 6 hangs at \`backfill\` after
# succeeding through \`spine\` — needs evidence that the divergence came from THIS
# dispatch on the first argument, and stdout cannot carry it: a hanging fake is killed
# by the watchdog's group TERM with whatever bash had buffered still unwritten. A
# redirect that closes with the \`printf\` is on disk before the hang begins.
printf '%s\\n' "\${BEHAVIOR}" > "\${CASE_DIR}/sentinels/behavior-\${KEY}"

# BLOCK UNTIL RELEASED, IN ONE-SECOND HOPS. No case that wants a timeout ever writes the
# release file, so for those this is a hang with no end but the watchdog's. Short hops keep
# reactivity to TERM a property of the trap rather than of the sleep's remaining duration.
hang_until_released() {
  RELEASE_FILE="\${CASE_DIR}/release/\${KEY}"
  while [[ ! -e "\${RELEASE_FILE}" ]]; do
    sleep 1
  done
  printf 'fake pnpm: %s released by the harness (authored fixture)\\n' "\${COMMAND}"
}

case "\${BEHAVIOR}" in
  succeeds)
    printf 'fake pnpm: %s succeeded (authored fixture)\\n' "\${COMMAND}"
    exit 0
    ;;
  hangs)
    printf 'fake pnpm: %s hanging (authored fixture)\\n' "\${COMMAND}"
    hang_until_released
    exit 0
    ;;
  exits-127)
    # The shape a missing pnpm or an invisible node takes in production, and the reason
    # the heartbeat writer is pure bash: on this path nothing node-shaped can run.
    printf 'fake pnpm: %s exiting 127 immediately (authored fixture)\\n' "\${COMMAND}" >&2
    exit 127
    ;;
  ignores-term)
    # Deaf to the watchdog's group TERM, and its \`sleep\` is reforked every hop, so the
    # SIGKILL escalation is the only thing that ends it.
    trap '' TERM
    printf 'fake pnpm: %s hanging and DEAF to TERM (authored fixture)\\n' "\${COMMAND}"
    hang_until_released
    exit 0
    ;;
  hangs-with-term-deaf-grandchild)
    # Forked BEFORE the hang, and it inherits this process's stdout — which is the wrapper's
    # \`tee\` pipe. That inheritance is the historical defect verbatim.
    "\${CASE_DIR}/bin/${TERM_DEAF_CHILD_NAME}" &
    printf 'fake pnpm: %s hanging after forking a TERM-deaf grandchild (authored fixture)\\n' "\${COMMAND}"
    hang_until_released
    exit 0
    ;;
  writes-operator-notice)
    # STANDS IN FOR STEP 5b'S WRITE, and it is a plain copy on purpose: the harness never
    # runs the real notice CLI, so the only thing this may claim to be is "a writer that
    # put authored bytes at that path before the run went on". What those bytes MEAN is
    # the asserting case's business, not this fake's.
    #
    # FAIL CLOSED, LOUDLY. A missing payload or target would otherwise leave this behaving
    # exactly like \`succeeds\` — and the case that armed it would then "prove" the trap
    # replaced a file nobody ever wrote, which is the one way it could pass while
    # asserting nothing.
    if [[ ! -f "\${CASE_DIR}/${FAKE_NOTICE_TARGET_NAME}" || ! -f "\${CASE_DIR}/${FAKE_NOTICE_PAYLOAD_NAME}" ]]; then
      printf 'fake pnpm: %s was told to write the operator notice with no authored payload\\n' "\${COMMAND}" >&2
      exit 96
    fi
    NOTICE_TARGET="$(cat "\${CASE_DIR}/${FAKE_NOTICE_TARGET_NAME}")"
    if ! cat "\${CASE_DIR}/${FAKE_NOTICE_PAYLOAD_NAME}" > "\${NOTICE_TARGET}"; then
      printf 'fake pnpm: %s could not write the authored notice to %s\\n' "\${COMMAND}" "\${NOTICE_TARGET}" >&2
      exit 96
    fi
    printf 'fake pnpm: %s wrote the authored notice payload (authored fixture)\\n' "\${COMMAND}"
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
 * THE AUTHORED TERM-DEAF CHILD — case 3's whole subject.
 *
 * `trap '' TERM` plus a sleep loop, reforking its `sleep` every hop so nothing about it is
 * killable by TERM. It is forked by the fake `pnpm`, so it is an ordinary member of the
 * run's process group AND it inherits the write end of the wrapper's log pipe. That pair
 * of facts is the historical defect exactly: the group TERM left it alive, `tee` never saw
 * EOF and stayed alive with it, and both went on holding launchd's per-label job slot after
 * the run itself was long gone. Only the watchdog's SIGKILL escalation reaps it.
 */
function termDeafChildSource(caseDir: string): string {
  return `#!/bin/bash
# AUTHORED TERM-deaf child for the wrapper test harness. Not captured from any real run.
# It exists to survive a SIGTERM sent to the whole process group, so the harness can prove
# the watchdog's SIGKILL escalation actually reaps it rather than merely orphaning it.
set -u
trap '' TERM
CASE_DIR="${caseDir}"
mkdir -p "\${CASE_DIR}/sentinels" 2>/dev/null || true
: > "\${CASE_DIR}/sentinels/${TERM_DEAF_CHILD_SENTINEL}"
while true; do
  sleep 1
done
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
  mkdirSync(join(caseDir, "release"), { recursive: true });
  writeExecutable(join(binDir, "pnpm"), fakePnpmSource(caseDir));
  writeExecutable(join(binDir, "node"), fakeNodeSource(caseDir));
  writeExecutable(join(binDir, TERM_DEAF_CHILD_NAME), termDeafChildSource(caseDir));
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

/**
 * Release a hanging fake so the run can finish on its own terms.
 *
 * ONLY CASE 7 CALLS THIS, and the restraint is the point: a timeout case that released its
 * own hang would be asserting a timeout it had already prevented. Case 7 needs it because
 * it is the one case whose claim is that the run does NOT get killed at the ceiling, and a
 * run that is never released can only ever end at the harness cap — which is a failure of
 * the case, never a proof of anything.
 */
export function releaseFakeHang(caseDir: string, command: string): void {
  writeFileSync(join(caseDir, "release", behaviorKeyFor(command)), "released by the harness\n", "utf8");
}
