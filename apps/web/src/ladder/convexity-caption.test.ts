/**
 * `convexityCaption` — the accessible substitute for the `aria-hidden` chart
 * (spec #285 §6.3c, slice #289 AC7).
 *
 * WHY THIS FUNCTION IS TESTED AND THE CHART IS NOT. The chart is presentation: every
 * per-rung fact it plots is already in the rung list, which is why it ships
 * `aria-hidden`. The ONE thing only the chart shows is the SHAPE of the capital curve,
 * and §6.3b makes that a generated sentence rather than a hand-maintained description —
 * precisely so it can be asserted here instead of rotting silently beside a picture
 * nobody diffs.
 *
 * ── MUTATION CHECK (repo discipline; performed 2026-08-11) ──────────────────────────
 * Every guard below was reverted once and confirmed red FOR THE RIGHT REASON, then
 * restored. TWO OF THE FOUR SURVIVED THE FIRST ROUND and the tests were strengthened
 * until they did not — recorded here because a mutation check that finds nothing is
 * usually a mutation check that was not run:
 *
 *  - flipped `deepest`/`shallowest` in the ratio → 3 red, the first reading `0.3×`
 *    where `3.7×` was expected. Right reason: the ratio inverted.
 *  - deleted the `firstSize > 0` divisor guard → "drops the ratio clause rather than
 *    dividing by a declared zero" red with `Infinity× the first`. Right reason:
 *    division by a declared zero reached the sentence.
 *  - dropped the `sizeUsd === undefined` bail → SURVIVED at first. The v4 case passed
 *    it `waitingDeclaredUsd: 0`, so both clauses dropped out for unrelated reasons and
 *    the caption came back absent anyway. Raised to a non-zero total; the mutant is now
 *    red with `$NaN of the $500 waiting`. Right reason: a size a v4 rung does not carry
 *    reached the arithmetic.
 *  - changed the midpoint filter from `<` to `<=` → SURVIVED at first: `CONVEX` has no
 *    rung at its own midpoint, so no assertion could tell the two apart. Added "treats a
 *    rung sitting exactly ON the midpoint as not below it"; the mutant is now red with
 *    `$900` where `$500` was expected. Right reason: the copy says "below".
 */
import { describe, expect, it } from "vitest";
import { convexityCaption, type CaptionRung } from "./convexity-caption.ts";

/**
 * A synthesized convex ladder — authored here, never copied from real output. Eight
 * rungs, sizes growing as price falls, all waiting: the fund's day-zero SHAPE with
 * amounts and levels that are this test's own invention.
 */
const CONVEX: CaptionRung[] = [
  { priceUsd: 60_000, sizeUsd: 300, waiting: true },
  { priceUsd: 58_000, sizeUsd: 350, waiting: true },
  { priceUsd: 56_000, sizeUsd: 400, waiting: true },
  { priceUsd: 54_000, sizeUsd: 450, waiting: true },
  { priceUsd: 50_000, sizeUsd: 550, waiting: true },
  { priceUsd: 48_000, sizeUsd: 650, waiting: true },
  { priceUsd: 46_000, sizeUsd: 800, waiting: true },
  { priceUsd: 44_000, sizeUsd: 1_100, waiting: true },
];

// Midpoint of the declared range is (60_000 + 44_000) / 2 = 52_000. The four rungs
// strictly below it total 550 + 650 + 800 + 1100 = 3_100; the whole ladder is 4_600.
const WHOLE_LADDER = 4_600;

describe("convexityCaption — the shape of the capital curve, in a sentence", () => {
  it("names the growth direction and the deepest-over-first ratio", () => {
    const caption = convexityCaption({
      rungs: CONVEX,
      waitingDeclaredUsd: WHOLE_LADDER,
    });
    expect(caption).toContain("Buys grow as price falls");
    // 1100 / 300 = 3.666… → one decimal place, the fidelity §6.3b's example uses.
    expect(caption).toContain("the deepest rung is 3.7× the first");
  });

  it("counts only waiting capital strictly below the ladder's midpoint", () => {
    const caption = convexityCaption({
      rungs: CONVEX,
      waitingDeclaredUsd: WHOLE_LADDER,
    });
    expect(caption).toContain("$3,100 of the $4,600 waiting");
    expect(caption).toContain("below the ladder's midpoint, $52,000");
  });

  it("treats a rung sitting exactly ON the midpoint as not below it", () => {
    // The teeth for the strict `<`. `CONVEX` has no rung at its own midpoint, so it
    // cannot tell `<` from `<=` — the mutation check found that, and this ladder exists
    // solely to close it. Midpoint of 60,000 and 44,000 is 52,000, which rung two sits
    // on exactly; only the $500 rung below it is "below the midpoint".
    const caption = convexityCaption({
      rungs: [
        { priceUsd: 60_000, sizeUsd: 300, waiting: true },
        { priceUsd: 52_000, sizeUsd: 400, waiting: true },
        { priceUsd: 44_000, sizeUsd: 500, waiting: true },
      ],
      waitingDeclaredUsd: 1_200,
    });
    expect(caption).toContain("$500 of the $1,200 waiting");
    expect(caption).toContain("below the ladder's midpoint, $52,000");
  });

  it("excludes rungs that are no longer waiting from the below-midpoint sum", () => {
    // A fill at the $44,000 rung removes its $1,100 from what waits; the total comes
    // from the wire's own `waitingDeclaredUsd`, so both halves move together.
    const walked = CONVEX.map((rung) =>
      rung.priceUsd === 44_000 ? { ...rung, waiting: false } : rung,
    );
    const caption = convexityCaption({
      rungs: walked,
      waitingDeclaredUsd: WHOLE_LADDER - 1_100,
    });
    expect(caption).toContain("$2,000 of the $3,500 waiting");
  });

  it("says buys SHRINK when the deepest rung is smaller than the first", () => {
    const caption = convexityCaption({
      rungs: [
        { priceUsd: 60_000, sizeUsd: 1_000, waiting: true },
        { priceUsd: 40_000, sizeUsd: 400, waiting: true },
      ],
      waitingDeclaredUsd: 1_400,
    });
    expect(caption).toContain("Buys shrink as price falls");
    expect(caption).toContain("0.4× the first");
  });

  it("says the ladder is EVEN rather than claiming a direction it does not have", () => {
    const caption = convexityCaption({
      rungs: [
        { priceUsd: 60_000, sizeUsd: 250, waiting: true },
        { priceUsd: 50_000, sizeUsd: 250, waiting: true },
        { priceUsd: 40_000, sizeUsd: 250, waiting: true },
      ],
      waitingDeclaredUsd: 750,
    });
    expect(caption).toContain("Buys are even across the ladder");
    expect(caption).not.toContain("grow");
    expect(caption).not.toContain("shrink");
  });

  it("gives a v4 ladder NO caption at all — the sizes it is computed from are absent", () => {
    // Absence is the answer. A caption built over missing sizes would read `$NaN`, and
    // the surface renders a named absence instead (`the ladder's shape is unavailable`).
    //
    // `waitingDeclaredUsd` is deliberately NON-ZERO here. With a zero total the waiting
    // clause drops out on its own and the ratio clause is skipped by the `firstSize > 0`
    // guard (`undefined > 0` is false), so the caption would come back absent for a
    // reason that has nothing to do with the missing sizes — the assertion would pass
    // while the bail it exists to guard was deleted. The mutation check caught exactly
    // that, which is why this figure is what it is.
    const caption = convexityCaption({
      rungs: [
        { priceUsd: 60_000, waiting: true },
        { priceUsd: 40_000, waiting: true },
      ],
      waitingDeclaredUsd: 500,
    });
    expect(caption).toBeUndefined();
  });

  it("gives a single-rung ladder no caption — one rung has no shape", () => {
    expect(
      convexityCaption({
        rungs: [{ priceUsd: 60_000, sizeUsd: 250, waiting: true }],
        waitingDeclaredUsd: 250,
      }),
    ).toBeUndefined();
  });

  it("drops the ratio clause rather than dividing by a declared zero", () => {
    const caption = convexityCaption({
      rungs: [
        { priceUsd: 60_000, sizeUsd: 0, waiting: true },
        { priceUsd: 40_000, sizeUsd: 500, waiting: true },
      ],
      waitingDeclaredUsd: 500,
    });
    expect(caption).not.toContain("×");
    expect(caption).toContain("below the ladder's midpoint");
  });

  it("drops the waiting clause when nothing waits, keeping the shape clause", () => {
    const caption = convexityCaption({
      rungs: CONVEX.map((rung) => ({ ...rung, waiting: false })),
      waitingDeclaredUsd: 0,
    });
    expect(caption).toContain("the deepest rung is 3.7× the first");
    expect(caption).not.toContain("waiting");
  });

  it("is pure — the same input yields the same sentence and mutates no rung", () => {
    const input = structuredClone(CONVEX);
    const once = convexityCaption({ rungs: input, waitingDeclaredUsd: WHOLE_LADDER });
    const twice = convexityCaption({ rungs: input, waitingDeclaredUsd: WHOLE_LADDER });
    expect(once).toBe(twice);
    expect(input).toEqual(CONVEX);
  });

  it("does not care what order the rungs arrive in", () => {
    const shuffled = [...CONVEX].reverse();
    expect(convexityCaption({ rungs: shuffled, waitingDeclaredUsd: WHOLE_LADDER })).toBe(
      convexityCaption({ rungs: CONVEX, waitingDeclaredUsd: WHOLE_LADDER }),
    );
  });
});
