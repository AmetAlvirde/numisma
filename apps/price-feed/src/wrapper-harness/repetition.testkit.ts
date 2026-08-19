/**
 * S5 · REPETITION — the confidence module of the wrapper harness (PRD #314 §4, D3).
 *
 * **12 consecutive runs per case, on every armed run, for every case.** Not a default of
 * 6 with a knob to 12 — twelve is what every case pays, always.
 *
 * A single green run means nothing about this subject, and that is not a stylistic
 * preference: it is literally how the `tee` race survived its first review. The wrapper's
 * teardown is a set of races — the watchdog cancel versus the `sleep` fork, the group
 * TERM versus the `tee`, the EXIT trap versus SIGPIPE — and every one of them was
 * observed to fail on 3 runs in 5, or 1 in 12, rather than on demand.
 *
 * Repetition is a property of the RUNNER, not of a case, so cases are written once and
 * repeated here.
 *
 * `NUMISMA_WRAPPER_TEST_RUNS` may RAISE the count for a deliberate soak. It may not lower
 * it, and a value below the floor is REFUSED rather than clamped: clamping would let
 * `NUMISMA_WRAPPER_TEST_RUNS=1` look like it worked while the suite quietly did the right
 * thing, which teaches exactly the wrong lesson about what this knob is for.
 *
 * ONE COUNT, TWO MEANINGS — AND A SOAK INVERTS THE SECOND ONE. Every ordinary case reads
 * this as "repeat N times, so a 1-in-12 defect is seen at least once", and raising it makes
 * the case strictly harder to pass. The two MUTATION CONTROLS in `run-daily-fetch.test.ts`
 * (child-reap and `tee`-deafness) read it as "attempt up to N times and stop at the first
 * observed failure of the mutated wrapper", because what they need to witness is itself
 * racy. Raising the count makes THOSE strictly EASIER to pass. So
 * `NUMISMA_WRAPPER_TEST_RUNS=50` soaks twelve cases and simultaneously relaxes two
 * controls, which is the opposite of what a soak is for.
 *
 * Left as one knob deliberately: the floor is the right floor for both readings, and the
 * controls' own bound is "how many attempts may be spent looking", which no separate number
 * would express better. What was missing was anyone writing the inversion down. Whoever
 * runs a soak and reads a green from those two controls should discount it accordingly.
 */

/** The committed floor. Ruled by U (#314 D3). Not a default — a floor. */
export const REPETITION_FLOOR = 12;

export function resolveRunCount(raw: string | undefined): number {
  if (raw === undefined || raw === "") {
    return REPETITION_FLOOR;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error(
      `wrapper harness: NUMISMA_WRAPPER_TEST_RUNS=${raw} is not a whole number.`,
    );
  }
  const requested = Number(raw);
  if (requested < REPETITION_FLOOR) {
    throw new Error(
      `wrapper harness: NUMISMA_WRAPPER_TEST_RUNS=${requested} is below the committed floor of ` +
        `${REPETITION_FLOOR}. This knob RAISES the count for a soak; it cannot lower it. A single ` +
        "green run means nothing here — that is how the `tee` race survived its first review.",
    );
  }
  return requested;
}
