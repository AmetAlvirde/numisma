import type { FillPathRungView, MeasuredFigure } from "./price-drop-path-chart";

/**
 * `PriceDropPathChart`'s prop literals, beside the component (spec #439 §4.3, S5).
 *
 * AUTHORED FROM SCRATCH, and the first in the wave that is. The other five components
 * arrived with their prop literals already written inside a test file that moved with
 * them; this chart's coverage comes through the fill-path tests, which reach a composed
 * `FillPathView` by calling `composeFillPathPage(ladderFixture(name))` in `apps/web`.
 * Its props are not a `FillPathView` at all — they are a rung array, a selected key, an
 * optional live spot and a `MeasuredFigure` — so there was nothing to lift.
 *
 * WHAT KEEPS AN AUTHORED LITERAL HONEST HERE IS THE TYPE DIRECTION. This package
 * DECLARES `FillPathRungView`, and `composeFillPathPage` composes into it, so a field
 * that moves stops compiling on both sides rather than drifting on one. It is worth
 * saying out loud what that does NOT buy: the compose-to-fixture equivalence test spec
 * #439 S9 adds compares a `FillPathView` against what `composeFillPathPage` emits and
 * says nothing about a bare `FillPathRungView[]`. Folding these rungs onto that pinned
 * view is a wave-3 question.
 *
 * ── THE THREE PRECONDITIONS, MET DELIBERATELY ────────────────────────────────────────
 * `./price-drop-path`'s header states three things it trusts and never re-checks, so a
 * fixture that broke one would produce a wrong picture rather than a loud failure:
 *
 *  1. THE LADDER IS PLOTTABLE. Every rung below carries a declared `sizeUsd`, there are
 *     at least two rungs at at least two distinct prices, and the largest declared size
 *     is positive. `walkedLadder` and `dayZeroLadder` both satisfy this on their own.
 *  2. SPOT IS LIVE OR ABSENT. The chart's `spotUsd` prop is a LIVE price or `undefined`,
 *     never a last close — the now rule claims to know where price is right now. So
 *     {@link dayZeroLadder} is paired with no spot at all rather than with a stale one.
 *  3. RUNGS ARRIVE DESCENDING BY PRICE. `cumulate` is a running sum and therefore an
 *     order: the array below runs from the shallowest rung to the deepest, which is the
 *     order a falling price walks them in.
 *
 * SYNTHESIZED. Every price, size and key below is authored — a round-numbered convex
 * ladder chosen so the ring areas are visibly different and the cumulative curve bends.
 * No ledger output, no plans sidecar and no real transaction has been near this file.
 */

/**
 * One rung, spelled from the few fields the chart actually reads, with the rest of
 * `FillPathRungView`'s facts filled in consistently.
 *
 * THE CHART READS FOUR FIELDS — `key`, `priceUsd`, `sizeUsd` and `filled` — and that is
 * the whole of what turns a view rung into the pure module's `PlottableRung`. The others
 * are on the contract because the rung LIST renders them, and a fixture that left them
 * inconsistent with `filled` would be staging a state the composer cannot produce.
 */
function rung(
  key: string,
  priceUsd: number,
  sizeUsd: number,
  filled: boolean,
  extra: { readonly isNext?: boolean } = {},
): FillPathRungView {
  return {
    key,
    ladderIndex: Number(key.slice(1)),
    priceUsd,
    sizeUsd,
    stateCopy: filled ? "filled" : "resting",
    venueAxis: filled ? "filled" : "resting",
    bookAxis: filled ? "recorded" : "not-recorded",
    filled,
    notPlaced: false,
    resting: !filled,
    venueResting: !filled,
    waiting: !filled,
    isNext: extra.isNext ?? false,
    pricePassedUnconfirmed: false,
    filledAtVenueNotRecorded: false,
    matchedByPrice: false,
  };
}

/**
 * A PARTLY WALKED LADDER — the state that draws the most marks at once.
 *
 * Three of the six rungs filled, so the solid path and the dashed path BOTH draw and
 * both the `Filled` and `Waiting` legend entries appear. The two slices share the
 * junction rung, which is what makes the handoff continuous rather than a rung-wide gap.
 *
 * CONVEX ON PURPOSE: the sizes accelerate down the ladder, so the ring areas are visibly
 * different top to bottom and the cumulative curve bends rather than running straight.
 * A ladder of equal sizes would draw a correct picture that showed nothing about the
 * encoding under review.
 */
export function walkedLadder(): readonly FillPathRungView[] {
  return [
    rung("r1", 64000, 1000, true),
    rung("r2", 60000, 1500, true),
    rung("r3", 56000, 2250, true),
    rung("r4", 52000, 3400, false, { isNext: true }),
    rung("r5", 48000, 5100, false),
    rung("r6", 44000, 7650, false),
  ];
}

/**
 * A DAY-ZERO LADDER — declared, and nothing has happened to it.
 *
 * No rung filled, so `splitAt` finds no junction, the solid slice is empty and the whole
 * path draws dashed. The `Filled` entry disappears from the legend with it, which is the
 * gate the chart set for itself: an entry appears only when the thing it explains is on
 * screen. Paired with no spot, so the now rule and its label are absent too — the state
 * that proves the picture holds when there is nothing to say.
 */
export function dayZeroLadder(): readonly FillPathRungView[] {
  return [
    rung("r1", 64000, 1000, false, { isNext: true }),
    rung("r2", 60000, 1500, false),
    rung("r3", 56000, 2250, false),
    rung("r4", 52000, 3400, false),
  ];
}

/**
 * A LIVE SPOT INSIDE THE LADDER'S OWN PRICE DOMAIN, so the now rule lands on the plot
 * rather than pinned to an edge. It sits between `r3` and `r4` on {@link walkedLadder}:
 * price has walked through the three filled rungs and is approaching the next.
 */
export const SPOT_USD = 54200;

/** The measured spend behind {@link walkedLadder}'s three filled rungs, slightly under
 *  their declared total — the ordinary case, where the fund filled for a little less
 *  than it wrote down. The rule therefore stands LEFT of the solid/dashed junction. */
export const DEPLOYED_KNOWN: MeasuredFigure = { known: true, value: 4600 };

/** The absent arm, which must draw NOTHING rather than a rule at zero. The cause is a
 *  view concept and never reaches the pure module — the chart reduces the figure to its
 *  presence and the mark refuses itself. */
export const DEPLOYED_UNKNOWN: MeasuredFigure = {
  known: false,
  why: "no fill has been recorded yet",
};
