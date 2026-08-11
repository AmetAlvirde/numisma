/**
 * THE CHART'S ACCESSIBLE SUBSTITUTE (spec #285 §6.3, slice #289) — one generated
 * sentence describing the shape of the declared capital curve.
 *
 * WHY IT IS GENERATED AND NOT WRITTEN. §6.3a makes the chart `aria-hidden`: it is
 * presentation, and every per-rung fact it plots is already in the rung list below it.
 * That leaves exactly one thing the picture carries that the list does not — the SHAPE,
 * how capital is distributed across the operator's own declared levels. §6.3b rules
 * that this ships as a generated caption from the same view model, and forbids a
 * hand-maintained chart description anywhere, in this slice or ever. A prose
 * description would be a second statement of the ladder, free to disagree with the
 * first the day a rung moves.
 *
 * PURE, WITH NO IO AND NO CLOCK, like the view module it is called from. It reads
 * declared prices and declared sizes plus the wire's own waiting total, and nothing
 * else — in particular it does NOT read spot, so the caption is stable while the market
 * moves and a screen reader is not told the page changed when it did not.
 *
 * ── THE TWO CLAUSES, AND WHERE THEIR NUMBERS COME FROM ──────────────────────────────
 * 1. THE RATIO — `sizeUsd` of the deepest (lowest-priced) rung over `sizeUsd` of the
 *    first (highest-priced) one. This is the whole reason per-rung `sizeUsd` crosses
 *    the wire at all (see `projection/contract.ts`'s note on the field): a sum cannot
 *    be un-summed, so `waitingDeclaredUsd` alone could never reconstruct the curve.
 * 2. THE WAITING SPLIT — how much of the capital still waiting sits below the MIDPOINT
 *    of the declared price range. The total is the wire's `waitingDeclaredUsd`, not a
 *    figure re-derived here, so the caption and the waiting tile can never disagree.
 *
 * WHY THE MIDPOINT AND NOT SPOT. A convexity claim has to be about the ladder, not
 * about today. The midpoint of the declared range is a property of the declaration
 * itself, so the sentence says the same thing tomorrow; a spot-anchored threshold would
 * make the accessible substitute flicker while the chart it substitutes for did not.
 * §6.3b's illustrative sentence names a price without saying which one it is — its
 * figures are marked synthesized there — and this is the reading that keeps the claim
 * purely declared. The copy names the midpoint explicitly rather than dropping a bare
 * price on the reader, and says "below", which the strict `<` filter honors.
 *
 * EVERY CLAUSE CAN DROP OUT, and the sentence is still true without it. A v4 ladder
 * carries no sizes, so there is no shape to describe and the caption is ABSENT — the
 * surface renders a named cause there, the same discipline as every other absence on
 * this page. Absence is never faked with a zero.
 */

/** One declared rung, as much of it as the caption needs. */
export interface CaptionRung {
  priceUsd: number;
  /** Absent on a v4 rung. Its absence is what makes the whole caption absent. */
  sizeUsd?: number;
  /** Whether this rung's capital is still waiting — i.e. unfilled at the venue. */
  waiting: boolean;
}

export interface CaptionInput {
  /** The declared rungs, in ANY order — this module sorts what it needs. */
  rungs: readonly CaptionRung[];
  /** The wire's own `figures.waitingDeclaredUsd`, never re-derived here. */
  waitingDeclaredUsd?: number;
}

/**
 * Whole dollars, because the caption is read aloud. `formatUsd` renders cents, which is
 * right for a figure tile and wrong inside a sentence — "three thousand one hundred
 * dollars and zero cents" is noise a screen-reader user has to sit through.
 */
function wholeUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * The sentence, or `undefined` when the ladder carries no shape to describe.
 *
 * Returns `undefined` — never an empty string and never a placeholder — so the caller
 * has to decide what to render in its place, which is a named absence.
 */
export function convexityCaption(input: CaptionInput): string | undefined {
  const rungs = [...input.rungs].sort((a, b) => b.priceUsd - a.priceUsd);
  if (rungs.length < 2) return undefined;

  const shallowest = rungs[0]!;
  const deepest = rungs[rungs.length - 1]!;
  // A v4 rung carries no size. One missing size is enough to make the curve
  // unknowable, so the whole caption is absent rather than partly invented.
  if (rungs.some((rung) => rung.sizeUsd === undefined)) return undefined;

  const clauses: string[] = [];

  // ── clause 1: the direction and the ratio ────────────────────────────────────────
  const firstSize = shallowest.sizeUsd!;
  const deepestSize = deepest.sizeUsd!;
  if (firstSize > 0) {
    const ratio = deepestSize / firstSize;
    const rounded = Math.round(ratio * 10) / 10;
    if (rounded > 1) {
      clauses.push(`Buys grow as price falls: the deepest rung is ${rounded}× the first`);
    } else if (rounded < 1) {
      clauses.push(
        `Buys shrink as price falls: the deepest rung is ${rounded}× the first`,
      );
    } else {
      // Neither "grow" nor "shrink" is true here, and asserting either would be the
      // caption claiming a shape the declaration does not have.
      clauses.push("Buys are even across the ladder: every rung is the same size");
    }
  }

  // ── clause 2: where the waiting capital sits ─────────────────────────────────────
  const waitingTotal = input.waitingDeclaredUsd;
  if (waitingTotal !== undefined && waitingTotal > 0) {
    const midpoint = (shallowest.priceUsd + deepest.priceUsd) / 2;
    // Strictly below: a rung sitting exactly ON the midpoint is not below it, and the
    // copy says "below".
    const belowMidpoint = rungs
      .filter((rung) => rung.waiting && rung.priceUsd < midpoint)
      .reduce((sum, rung) => sum + rung.sizeUsd!, 0);
    clauses.push(
      `${wholeUsd(belowMidpoint)} of the ${wholeUsd(waitingTotal)} waiting sits ` +
        `below the ladder's midpoint, ${wholeUsd(midpoint)}`,
    );
  }

  if (clauses.length === 0) return undefined;
  return `${clauses.join("; ")}.`;
}
