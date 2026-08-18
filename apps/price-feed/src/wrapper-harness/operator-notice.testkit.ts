/**
 * S8 · THE OPERATOR-NOTICE FIXTURES — what step 0 reads, and where the harness reads its
 * answer (#357 slice 3).
 *
 * The wrapper's step 0 runs BEFORE `resolve-tools`, in pure bash, and writes
 * `operator-notice.txt` beside the durable log when — and only when — the PREVIOUS run's
 * heartbeat positively says it did not finish clean. Everything in this module exists to
 * put a heartbeat in front of it and to read the file it did or did not write.
 *
 * ── THE FILENAME IS IMPORTED, NEVER RETYPED ───────────────────────────────────────────
 * {@link OPERATOR_NOTICE_FILENAME} comes from `@numisma/event-store`, which is the same
 * constant the TypeScript writer at step 5b resolves its path from. The bash half spells
 * the name out in `OPERATOR_NOTICE_FILE`, so these are two independent spellings of one
 * path — exactly the join the heartbeat's bash-writer/TS-reader pair already taught this
 * harness to distrust. Importing the constant here means a rename on either side lands as
 * a red case rather than as a notice written where nothing looks for it, which for a
 * channel whose healthy state is an EMPTY FILE is silence that reads as health.
 *
 * ── EVERY FIXTURE IS AUTHORED ─────────────────────────────────────────────────────────
 * Nothing here is captured from a real run, in content or in shape. The instants are the
 * same authored ones `mark-window.testkit.ts` uses and the exit codes and step names are
 * chosen to be distinguishable from whatever the run under test produces — a fixture that
 * happened to match the run's own outcome would make "step 0 wrote this" and "something
 * later wrote this" the same observation.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OPERATOR_NOTICE_FILENAME } from "@numisma/event-store";
import {
  FAKE_NOTICE_PAYLOAD_NAME,
  FAKE_NOTICE_TARGET_NAME,
  setFakeBehavior,
} from "./fake-bin.testkit.js";

/** Authored instants for the seeds below. Never a captured value. */
const AUTHORED_SEED_STARTED_AT = "2001-02-03T04:00:00Z";
const AUTHORED_SEED_FINISHED_AT = "2001-02-03T04:05:06Z";

/**
 * The previous run's outcome, as step 0 will read it back out of the breadcrumb.
 *
 * A pair rather than two loose arguments because step 0's rule is a joint one: clean is
 * `exitCode` 0 AND `lastStep` `complete`, and every case here is chosen for which half of
 * that conjunction it exercises.
 */
export interface SeededOutcome {
  readonly exitCode: number;
  readonly lastStep: string;
}

/**
 * A PREVIOUS RUN THAT DIED IN ITS OWN TOOLCHAIN CHECK — the failure step 0 exists for.
 *
 * `resolve-tools` with exit 127 is not a decorative choice: it is the shape a missing
 * `pnpm` or an invisible asdf `node` takes, and on that path nothing node-shaped can run,
 * so a notice about it can only ever be written by something with no toolchain dependency
 * at all.
 */
export const AUTHORED_FAILED_OUTCOME: SeededOutcome = {
  exitCode: 127,
  lastStep: "resolve-tools",
};

/**
 * A PREVIOUS RUN THAT WEDGED AFTER LANDING THE DAY'S MARKS — not clean, and the reading
 * is the whole point.
 *
 * Exit 124 at `timeout:backfill` is what the watchdog leaves behind, and it is the case
 * most easily got wrong: the marks ARE in the log, so it is tempting to call the run
 * successful. It did not finish, and step 0's equality against `complete` catches the
 * decorated step name for free — which is why the heartbeat writer decorates at print time
 * rather than rewriting `LAST_STEP` in place.
 *
 * It is also deliberately UNLIKE the run under test in every case that uses it, so the
 * notice's contents can only have come from this seed.
 */
export const AUTHORED_WEDGED_OUTCOME: SeededOutcome = {
  exitCode: 124,
  lastStep: "timeout:backfill",
};

/** A PREVIOUS RUN THAT FINISHED CLEAN — the one shape step 0 must leave the file alone for. */
export const AUTHORED_CLEAN_OUTCOME: SeededOutcome = {
  exitCode: 0,
  lastStep: "complete",
};

/**
 * Write a v2 heartbeat carrying one outcome.
 *
 * `markWindow: false` on every seed, and it is not laziness: these cases are about step 0,
 * which reads two fields and no others, and an in-window seed would additionally interact
 * with the carry-forward contract that cases 6 and 8 already own. One claim per case.
 */
export function seedHeartbeatOutcome(dataDir: string, outcome: SeededOutcome): void {
  writeFileSync(
    join(dataDir, "job-heartbeat.json"),
    `{
  "schemaVersion": 2,
  "startedAt": "${AUTHORED_SEED_STARTED_AT}",
  "finishedAt": "${AUTHORED_SEED_FINISHED_AT}",
  "exitCode": ${outcome.exitCode},
  "lastStep": "${outcome.lastStep}",
  "markWindow": false
}
`,
    "utf8",
  );
}

/**
 * THE SENTINEL NOTICE — an authored file standing in for one a step 5b left behind, naming
 * a loss that is still real.
 *
 * The date and the command are shaped like the notice's own lost-day pair, but the date is
 * an authored one this repo has never run on: the cases assert this text either survives
 * BYTE FOR BYTE or is gone ENTIRELY, so it must be impossible for any real derivation to
 * have produced it.
 *
 * It serves both 5b's: seeded on disk it is the PREVIOUS run's notice (what step 0 must
 * leave alone), and written by the fake mid-run it is THIS run's notice (what the EXIT
 * trap must replace when the run dies afterwards).
 */
export const AUTHORED_SENTINEL_NOTICE =
  "Numisma: 2001-02-03 is a LOST DAY (authored harness fixture, not a real finding).\n" +
  "Numisma: 2001-02-03 — recover with: pnpm prices:fetch --as-of=2001-02-03\n";

/**
 * The shortest span of {@link AUTHORED_SENTINEL_NOTICE} nothing else could have written.
 *
 * The case that asserts the sentinel is GONE needs a needle rather than the whole hay:
 * `not.toContain` on the full two-line body would also pass if a writer had kept the first
 * line and dropped the second, which is precisely the half-append this channel refuses.
 */
export const AUTHORED_SENTINEL_FRAGMENT = "is a LOST DAY (authored harness fixture";

/** Put the sentinel notice on disk where step 0 would find it. */
export function seedOperatorNotice(dataDir: string, body: string): void {
  writeFileSync(join(dataDir, OPERATOR_NOTICE_FILENAME), body, "utf8");
}

/** The path step 0 and step 5b must BOTH resolve to. */
export function operatorNoticeFixturePath(dataDir: string): string {
  return join(dataDir, OPERATOR_NOTICE_FILENAME);
}

/**
 * The notice's contents, or `undefined` when the file does not exist AT ALL.
 *
 * The distinction is load-bearing and is why this does not return `""` for a missing file:
 * "no notice was ever written" and "a notice was written and it is empty" are opposite
 * answers on this channel — the second is the healthy self-cleared state, the first is a
 * fresh machine that step 0 correctly declined to cry wolf on. A reader that flattened the
 * two would let a step 0 which truncates unconditionally pass the no-heartbeat case.
 */
export function readOperatorNotice(dataDir: string): string | undefined {
  const path = operatorNoticeFixturePath(dataDir);
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/**
 * The line step 0 writes for a failed previous run, as an oracle.
 *
 * It names BOTH fields, because the two failures it distinguishes need different responses
 * — exit 127 at `resolve-tools` is a PATH problem on this machine, exit 124 at
 * `timeout:backfill` is a wedged network call — and a notice that said only "the last run
 * failed" would send the operator to the wrong place. Asserted with `toContain` on the
 * whole file rather than as an exact match: the second line bounds the claim and is worth
 * having, but pinning its prose here would make every wording change a red for no gain.
 */
export function expectedFailureFragment(outcome: SeededOutcome): string {
  return `exit ${outcome.exitCode} at step '${outcome.lastStep}'`;
}

/**
 * ARM THE FAKE `pnpm operator-notice` TO ACTUALLY WRITE (#376).
 *
 * Until this existed the fake succeeded without touching anything, so every notice on disk
 * at the end of a run was step 0's by elimination. The EXIT trap now writes the same file
 * too, which turns "who wrote last" into a real question — and answering it needs a step 5b
 * that leaves bytes behind.
 *
 * BEHAVIOR AND FIXTURES ARE SET TOGETHER, deliberately: the behavior fails closed on a
 * missing payload, and a caller that could arm one without the other would be able to
 * produce that failure from a test rather than from the fake.
 *
 * THE TARGET IS DERIVED FROM {@link OPERATOR_NOTICE_FILENAME}, not retyped — the same
 * imported constant the rest of this module resolves its path from, so the fake writes
 * where both the wrapper's bash and the real CLI would.
 */
export function armFakeOperatorNoticeWrite(caseDir: string, dataDir: string, body: string): void {
  writeFileSync(join(caseDir, FAKE_NOTICE_TARGET_NAME), operatorNoticeFixturePath(dataDir), "utf8");
  writeFileSync(join(caseDir, FAKE_NOTICE_PAYLOAD_NAME), body, "utf8");
  setFakeBehavior(caseDir, "operator-notice", "writes-operator-notice");
}

/**
 * WHICH OF THE TWO BASH WRITERS PRODUCED THE FILE STANDING ON DISK.
 *
 * Step 0 and the EXIT trap share `write_operator_failure_notice` and therefore share the
 * FAILED line VERBATIM — that is the point of the shared writer, and it is also why the
 * failure line alone cannot say who wrote. The one thing the two callers vary is the scope
 * line's tail, which names the run that will replace the file: from step 0 the run that is
 * starting, from the trap the one after it. So these two fragments are the only
 * discriminator the channel has, and asserting on them is asserting on the seam.
 */
export const STEP_0_SCOPE_TAIL = "the run now starting replaces this file";

/** The trap's tail — see {@link STEP_0_SCOPE_TAIL}. */
export const EXIT_TRAP_SCOPE_TAIL = "the next run replaces this file";
