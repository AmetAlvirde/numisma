/**
 * THE PRICE DROP PATH'S QUANTITATIVE LOGIC — the pure module `PriceDropPathChart` draws
 * from (spec #302 slice A, Seam A).
 *
 * PURE, AND SEPARATE FROM THE MARKS, for the reason `docs/coverage-rationale.md` §6
 * states: the coverage glob reaches `.ts` under `apps/…/src` and no `.tsx` at all, so a
 * square root, a legibility
 * floor, a running sum with an ordering dependency, a split index and a three-armed
 * clamp were all invisible to it while they sat beside the marks in a `.tsx` file. The
 * rule the repo wrote for itself is that a branch which CAN be lifted into a pure module
 * should be, before it buys a render toolchain. These can, so they are — and
 * `price-drop-path.test.ts` is what the lift bought.
 *
 * ── THE THREE PRECONDITIONS, STATED HERE RATHER THAN HELD IN PROSE ───────────────────
 * The component's four-prop interface used to hide these; that hiding is what made
 * Seam A shallow. Nothing below re-checks them — they are the caller's to guarantee —
 * but they are now written on the interface that depends on them:
 *
 *  1. THE LADDER IS PLOTTABLE. Every rung handed over carries a declared `sizeUsd`
 *     (`PlottableRung` requires it, so a v4 rung cannot be passed at all), there are at
 *     least two of them at at least two distinct prices, and the largest declared size is
 *     positive. The gate that decides this lives in `fill-path-view.ts` and is spec
 *     #285's to finish; this module trusts it and states what it trusts.
 *  2. SPOT IS LIVE OR ABSENT. `spotMarkFor` draws a rule that claims to know where price
 *     is NOW, so a last close must arrive as `undefined` rather than as a number — see
 *     that function.
 *  3. RUNGS ARRIVE DESCENDING BY PRICE. `cumulate` is a running sum, so it IS an order;
 *     see that function for why it depends on the caller's sort instead of taking a
 *     second opinion about which way the ladder runs.
 *
 * Nothing here reads a clock, a `window`, or a random number, and the one formatter is
 * module-scope and explicitly `en-US` — the SSR boundary is exactly where an implicit
 * locale diverges.
 */

/**
 * THE ONE COMPACT-USD FORMATTER ON THE FILL PATH — the chart's axis ticks, the spot
 * mark's label, and the header card's price span.
 *
 * IT IS ONE CONSTANT BECAUSE THE HEADER SITS DIRECTLY ABOVE THE AXIS. Two formatters
 * agreeing by inspection is not agreement: it is a byte-for-byte duplicate with a
 * comment on each half asking the other not to change, which is what the pair replaced
 * here used to be (`AXIS_USD` in the chart, `RANGE_USD` in `FillPath.tsx`). One constant
 * cannot print the same price two ways.
 *
 * EVERY READING IT FORMATS WEARS A `~` AT THE CALL SITE. Compact notation rounds hard —
 * `$47.5K` is a rung the list below prints as `$47,499.00` — so an unmarked compact price
 * beside an exact one reads as a disagreement rather than as a summary. The exception is
 * an axis tick, which is a gridline and understood as one.
 */
export const COMPACT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** THE RING OF THE LARGEST RUNG, and the floor no ring may shrink below. See
 *  `withRadius` for why these are the two numbers the encoding needs and why there is
 *  no cap: normalizing on the largest rung means the biggest ring is `R_MAX` on every
 *  ladder, so a steep ratio makes the small end small rather than the big end huge. */
export const R_MAX = 9;
export const R_MIN = 2.5;

/**
 * ONE RUNG THE CHART CAN PLOT — precondition 1, absorbed by a type.
 *
 * `sizeUsd` is REQUIRED here while it is optional on `FillPathRungView`, which is what
 * makes "the ladder is plottable" a thing the compiler checks at the seam rather than a
 * sentence in a component header. `filled` likewise arrives decided (the view module
 * owns that predicate — see `FillPathRungView.filled`); nothing in this module
 * re-derives whether a rung filled.
 */
export interface PlottableRung {
  key: string;
  priceUsd: number;
  sizeUsd: number;
  filled: boolean;
}

/** A plottable rung carrying its running total — `cumulate`'s output, `withRadius`'s
 *  input. Split from `RungPoint` so each function's contract names its own stage. */
export interface CumulatedRung extends PlottableRung {
  /** RUNNING TOTAL of `sizeUsd` from the first rung down to this one — see `cumulate`
   *  for why this, and not `sizeUsd`, is what the line plots. */
  cumulativeUsd: number;
}

/** One rung's worth of decided fact, ready for the marks. */
export interface RungPoint extends CumulatedRung {
  /** THE RUNG'S OWN SIZE, DRAWN AS AREA — see `withRadius`. Carried on the point rather
   *  than recomputed per mark so the ring, its selection halo and its selection disc are
   *  all sized off one number and cannot disagree about how big this rung is. */
  radiusPx: number;
}

/**
 * THE CAPITAL VALUE IS A RUNNING TOTAL, BECAUSE THAT IS THE QUESTION THE CARD IS ASKED.
 *
 * The reader of a price drop path wants "if price falls to HERE, how much will the fund
 * have committed IN TOTAL?" — a running sum. The per-rung series cannot answer it: it
 * shows eight independent amounts and leaves the reader adding in their head, and the
 * top of its axis is the single largest rung rather than the whole ladder. The convexity
 * survives the change intact — it is now the ACCELERATING SLOPE of the cumulative curve
 * rather than the rising height of separate points.
 *
 * THE ORDER IS DECIDED IN ANOTHER MODULE AND THIS SUM DEPENDS ON IT (precondition 3).
 * `rungs` arrive already sorted DESCENDING by price by `ladder/fill-path-view.ts`
 * (`wireRungs.sort((a, b) => b.priceUsd - a.priceUsd)`), which is the order a FALLING
 * price walks them in — so accumulating in array order is accumulating down the ladder.
 * Nothing here re-sorts: a second ordering would be a second opinion about which way the
 * ladder runs, and the two would drift. The dependency is asserted as its own subject in
 * `price-drop-path.test.ts` (T2), on a deliberately unsorted ladder, so it is a checked
 * contract rather than a comment.
 */
export function cumulate(
  points: readonly PlottableRung[],
): CumulatedRung[] {
  let running = 0;
  return points.map((point) => {
    running += point.sizeUsd;
    return { ...point, cumulativeUsd: running };
  });
}

/**
 * THE RUNG'S SIZE, SHOWN INSTEAD OF STATED. This replaces the caption clause that used to
 * be printed under the chart in words — "the deepest rung is 6.3× the first". A sentence
 * asserting a ratio is a thing the reader has to take on trust and then imagine; a ring
 * six times the area of the one above it IS the ratio, arriving before the reading does.
 *
 * AREA, NOT RADIUS, CARRIES THE MAGNITUDE — hence the square root. Sizing radius directly
 * by the ratio would draw a deepest rung with forty times the ink of the first, which is
 * not a picture of 6.3× by any reading. Area is the channel the eye actually integrates
 * for a disc, so `r ∝ √size` is what makes the ring look like the number it stands for.
 *
 * NORMALIZED ON THE LARGEST RUNG, NOT ON THE FIRST. The biggest ring is therefore `R_MAX`
 * on every ladder and the picture cannot outgrow its plot — a steep ratio shrinks the
 * shallow end rather than inflating the deep one. Normalizing on the first rung instead
 * would need a CAP to stay on canvas, and a cap silently flattens exactly the convex
 * ladders this encoding exists to show.
 *
 * `R_MIN` IS A LEGIBILITY FLOOR AND IT DOES DISTORT. On a ladder steeper than 12.96× the
 * shallowest ring would otherwise fall under `R_MIN` and read as a gap in the line — an
 * absent rung, which is a worse lie than an overstated small one. The floor binds rarely
 * and only at the end where the alternative is nothing at all; the exact boundary is
 * pinned by T1, because "rarely" is not a number.
 *
 * THE ZERO-LARGEST ARM IS `R_MIN`, NOT ARITHMETIC. Precondition 1 says the largest size
 * is positive, so this arm is unreachable through the gate — but `size / 0` is `NaN` and
 * a `NaN` radius draws NOTHING, silently dropping a rung out of the picture. The floor is
 * the honest fallback: a visible ring the reader can see carries no size information.
 */
export function withRadius(points: readonly CumulatedRung[]): RungPoint[] {
  const largest = Math.max(...points.map((point) => point.sizeUsd));
  return points.map((point) => ({
    ...point,
    radiusPx:
      largest > 0
        ? Math.max(R_MIN, R_MAX * Math.sqrt(point.sizeUsd / largest))
        : R_MIN,
  }));
}

/**
 * WHERE THE SOLID PATH BECOMES THE DASHED ONE — the LAST filled rung, not a per-rung
 * classification.
 *
 * A path is a sequence, and a sequence has one handoff. Classifying each rung and
 * drawing a segment per class would shatter the line into pieces the moment the venue
 * filled a rung out of order, which is exactly when the operator most needs to read the
 * curve. Taking the last filled index instead says something weaker and true: everything
 * up to here has been walked, everything past it has not.
 *
 * Returns `-1` when nothing has filled (day zero — the whole path is dashed).
 */
export function splitAt(points: readonly RungPoint[]): number {
  let last = -1;
  points.forEach((point, index) => {
    if (point.filled) last = index;
  });
  return last;
}

/** The plot's price extent: the LADDER's own ends, and the padded axis bounds the
 *  component derives from them. `spotMarkFor` clamps against `low`/`high` — the rungs —
 *  and pins to `yLow`/`yHigh` — the plot edges — because a spot inside the padding is
 *  still outside the ladder. */
export interface PriceBounds {
  low: number;
  high: number;
  yLow: number;
  yHigh: number;
}

/** The now rule and the label that says what it is. `y` is a price in the chart's own
 *  domain; `dy` is the label's pixel nudge off it. */
export interface SpotMark {
  y: number;
  label: string;
  dy: number;
}

/**
 * WHERE THE "NOW" RULE GOES, AND WHAT IT IS ALLOWED TO CLAIM.
 *
 * The axis is scaled to the ladder (see the domain comment in the component), so spot
 * is frequently outside it — the fund normally sits above every rung it has declared.
 * There are only two honest things to do with a price that is off the chart, and this
 * does the second: PIN the rule to the edge and SAY SO in the label.
 *
 * A rule pinned to the edge while the label still reads like an ordinary plotted price
 * is a lie — it invites the reader to measure a position that was clamped. So the two
 * always travel together: whenever `y` is not the real price, the label carries an ARROW
 * and the reader knows the mark is a direction, not a coordinate. T4 asserts that pairing
 * on all three arms, which is what keeps the honesty constraint from being a comment.
 *
 * `spotUsd` IS LIVE OR ABSENT — precondition 2. A last close is not "now", so the caller
 * passes `undefined` for it and this draws no mark at all rather than a present-tense
 * claim about a stale number.
 *
 * THE ARROW REPLACED THE SENTENCE. This used to read `spot ~$64,412 — above the ladder`:
 * a caption doing three jobs, of which the picture already did two. "spot" names a figure
 * the header card prints live, two lines above; "above the ladder" describes a rule the
 * reader can SEE sitting at the top edge. What survives is the one fact the picture
 * genuinely cannot state — the number — with `↑` carrying the clamp warning as a glyph
 * rather than as prose.
 *
 * COMPACT, IN `COMPACT_USD`, so the mark reads at the same precision as the tick labels
 * it floats among. A dollar-exact price beside `$60K` gridlines is a false precision: it
 * looks measurable off an axis that could never resolve it.
 *
 * The alternative — padding the domain out to reach spot with a cap on how far — cannot
 * work on its own: the moment the cap binds, spot is outside the domain again and needs
 * this same treatment anyway. It would buy a second mechanism for the same case.
 *
 * PRICE IS THE VERTICAL AXIS, so the rule is HORIZONTAL and the pinning rotated with it:
 * "above the ladder" pins to `yHigh`, the TOP of the plot, and "below the ladder" to
 * `yLow`, the bottom. The label no longer picks a side — it always rides the RIGHT edge
 * of the capital axis, end-anchored, which is where a trading chart prints its last
 * price. What still varies is `dy`: the top-pinned label sits ABOVE its rule (clear of
 * the plot entirely, where nothing is drawn) and every other one sits above it too, but
 * the bottom-pinned one is nudged to clear the capital axis's own tick labels.
 */
export function spotMarkFor(
  spotUsd: number | undefined,
  bounds: PriceBounds,
): SpotMark | undefined {
  if (spotUsd === undefined) return undefined;
  // `~` BECAUSE THIS COPY OF SPOT IS COMPACTED, while the header card prints the same
  // reading to the cent. Two exact-looking prices differing by change is the surface
  // contradicting itself; the mark says "this one is the rounded one".
  const money = `~${COMPACT_USD.format(spotUsd)}`;

  if (spotUsd > bounds.high) {
    return { y: bounds.yHigh, label: `↑ ${money}`, dy: -4 };
  }
  if (spotUsd < bounds.low) {
    return { y: bounds.yLow, label: `↓ ${money}`, dy: -5 };
  }

  // In range: the rule is to scale, so the label carries no direction.
  return { y: spotUsd, label: `spot ${money}`, dy: -4 };
}
