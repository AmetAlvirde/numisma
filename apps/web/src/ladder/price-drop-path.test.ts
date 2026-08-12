/**
 * `ladder/price-drop-path` — the Price Drop Path's quantitative logic, tested (spec #302
 * slices A and C, T1–T4 and T6).
 *
 * WHY THESE FOUR FUNCTIONS ARE TESTED AND THE CHART IS STILL NOT. The chart is
 * presentation (ADR-019) and the repo buys no render harness for it. What used to sit
 * beside the marks inside a `.tsx` file, though, was not presentation: a square root, a
 * legibility floor, a running sum with an ordering dependency, a split index and a
 * three-armed clamp. The repo's own coverage rule (`docs/coverage-rationale.md` §6) says
 * any branch that CAN be lifted into a pure module should be, before it buys a
 * toolchain — so these moved, and this file is what they moved for.
 *
 * EVERY LADDER BELOW IS SYNTHESIZED — authored here for the arithmetic it exercises,
 * never copied or seeded from real trade output (the repo's private-data rule).
 *
 * ── MUTATION CHECK (repo discipline; performed 2026-08-12) ───────────────────────────
 * Every guard below was reverted once and confirmed red FOR THE RIGHT REASON, then
 * restored. Ten mutants, ten red on the first round — recorded here because a mutation
 * check that finds nothing is usually a mutation check that was not run:
 *
 *  - dropped the `R_MIN` floor → the past-boundary ladder red with `1.8` where `2.5` was
 *    expected. Right reason: a ring smaller than the legibility floor reached the plot.
 *  - normalized on `points[0]` instead of the largest rung → 2 red, the second reading
 *    `[9, 27]`. Right reason: a ring larger than `R_MAX` left the plot.
 *  - dropped the `largest > 0` guard → the declared-zero ladder red with `NaN`. Right
 *    reason: a `NaN` radius draws nothing, silently dropping a rung.
 *  - dropped the `√` (radius by ratio, not area) → 3 red, the first reading `[1, 4, 9]`.
 *    Right reason: the deepest ring carried the ratio in radius, not in ink.
 *  - made `cumulate` re-sort descending by price → the array-order test red. Right
 *    reason: the module took a second opinion about which way the ladder runs.
 *  - `splitAt` took the FIRST filled index → 2 red, the out-of-order ladder reading `0`
 *    where `2` was expected. Right reason: the solid segment stopped short of a walked
 *    rung.
 *  - `>=`/`<=` on the spot clamp → the on-the-end test red with the top pin. Right
 *    reason: a price the plot can draw was clamped and warned about.
 *  - clamped against `yHigh` (the padded plot edge) instead of `high` (the ladder's own
 *    top) → the in-the-padding test red. Right reason: a spot outside the ladder plotted
 *    glyph-free, as if it were an ordinary rung price.
 *  - gave the in-range label a direction glyph → 2 red. Right reason: the glyph is the
 *    clamp warning, and nothing was clamped.
 *  - dropped the bottom-pinned label's `dy` nudge → 1 red. Right reason: the label sat
 *    back in the capital axis's own tick gutter.
 *
 * ── MUTATION CHECK, T6 (slice C; performed 2026-08-12) ───────────────────────────────
 * `deployedMarkFor`'s first red was WEAK — "not a function", which proves only that an
 * export is missing. So the arms were mutated after green instead. Seven mutants, seven
 * red on the first round:
 *
 *  - removed the over-domain arm entirely — THE DEFECT ITSELF, restored → 2 red, reading
 *    `expected 5525 to be 4500` and `expected 4501 to be less than or equal to 4500`.
 *    Right reason: the rule left the plot, at 1.3× the axis, in silence.
 *  - `>=` instead of `>` on the clamp → the on-the-end test red with `'Deployed ~$4.5K →'`.
 *    Right reason: a total the plot can draw was clamped and warned about.
 *  - pinned the rule but left the label `"Deployed"` → 2 red. Right reason: a mark pinned
 *    to the edge while its label reads like an ordinary plotted value invites the reader to
 *    measure a position that was clamped — `spotMarkFor`'s own argument.
 *  - pinned label left at `yLow` → 1 red. Right reason: the bottom-right corner is where a
 *    below-the-ladder spot label prints, and an overfilled ladder is exactly the one whose
 *    price has fallen through every rung.
 *  - REFUSED the rule instead of clamping it → 2 red. The contract allows either arm, so
 *    this mutant is what makes the ruling a checked decision rather than a preference: the
 *    reading an overfilled ladder most needs would vanish precisely when it matters.
 *  - removed the under-domain arm → 2 red, reading `expected -9999 to be greater than or
 *    equal to 0`. Right reason: a rule off the LEFT edge is exactly as silent as one off
 *    the right.
 *  - drew the absent figure as a rule at $0 → 1 red. Right reason: "measured and found to
 *    have spent nothing" is a different sentence from "no fill has been recorded yet".
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  R_MAX,
  R_MIN,
  cumulate,
  deployedMarkFor,
  splitAt,
  spotMarkFor,
  withRadius,
  type CumulatedRung,
  type PlottableRung,
  type RungPoint,
} from "./price-drop-path.ts";

/** A rung as the chart's caller hands it over: size present, filled decided upstream. */
function rung(
  key: string,
  priceUsd: number,
  sizeUsd: number,
  filled = false,
): PlottableRung {
  return { key, priceUsd, sizeUsd, filled };
}

/** The same, already carrying a running total — `withRadius`'s input shape. */
function cumulated(
  key: string,
  priceUsd: number,
  sizeUsd: number,
  cumulativeUsd: number,
  filled = false,
): CumulatedRung {
  return { key, priceUsd, sizeUsd, cumulativeUsd, filled };
}

const radii = (points: readonly RungPoint[]) =>
  points.map((point) => point.radiusPx);

describe("withRadius — the rung's size drawn as area (T1)", () => {
  it("gives the largest rung R_MAX, and scales the rest by √(size ÷ largest)", () => {
    // 100 : 400 : 900 — the square numbers, so the √ is legible in the expectation
    // rather than hidden in a float: 9 · √(1/9) = 3, 9 · √(4/9) = 6, 9 · √1 = 9.
    const points = withRadius([
      cumulated("r1", 60_000, 100, 100),
      cumulated("r2", 55_000, 400, 500),
      cumulated("r3", 50_000, 900, 1_400),
    ]);
    expect(radii(points)).toEqual([3, 6, R_MAX]);
  });

  it("normalizes on the LARGEST rung wherever it sits, not on the first", () => {
    // The deepest rung is the biggest on a convex ladder, but nothing here may assume
    // that: normalizing on `points[0]` would put R_MAX on the shallowest rung and draw
    // every other ring larger than the plot's own maximum.
    const points = withRadius([
      cumulated("big", 60_000, 900, 900),
      cumulated("small", 55_000, 100, 1_000),
    ]);
    expect(radii(points)).toEqual([R_MAX, 3]);
  });

  it("floors at R_MIN exactly past max ÷ size > 12.96, and not before", () => {
    // The floor binds where the formula would fall under R_MIN:
    //   R_MAX · √(s / max) < R_MIN  ⇔  s / max < (2.5 / 9)²  ⇔  max / s > 12.96.
    // AT the boundary the two agree — 9 · √(100/1296) = 9 · (10/36) = 2.5 — so the floor
    // changes nothing there. These three ladders straddle it.
    const justInside = withRadius([
      cumulated("small", 60_000, 100, 100),
      cumulated("large", 50_000, 1_200, 1_300),
    ]);
    // max / s = 12, still above the floor: 9 · √(1/12) = 2.598…
    expect(justInside[0]!.radiusPx).toBeGreaterThan(R_MIN);
    expect(justInside[0]!.radiusPx).toBeCloseTo(2.598, 3);

    const atBoundary = withRadius([
      cumulated("small", 60_000, 100, 100),
      cumulated("large", 50_000, 1_296, 1_396),
    ]);
    expect(atBoundary[0]!.radiusPx).toBe(R_MIN);

    const pastBoundary = withRadius([
      cumulated("small", 60_000, 100, 100),
      cumulated("large", 50_000, 2_500, 2_600),
    ]);
    // max / s = 25: the formula gives 1.8, and the floor is what the reader sees.
    expect(pastBoundary[0]!.radiusPx).toBe(R_MIN);
  });

  it("returns R_MIN, never NaN, when the largest declared size is zero", () => {
    // A ladder of declared zeroes has no ratio to normalize on. `size / 0` is NaN, and a
    // NaN radius draws nothing at all — a rung silently missing from the picture.
    const points = withRadius([
      cumulated("r1", 60_000, 0, 0),
      cumulated("r2", 50_000, 0, 0),
    ]);
    expect(radii(points)).toEqual([R_MIN, R_MIN]);
    expect(points.every((point) => Number.isNaN(point.radiusPx))).toBe(false);
  });
});

describe("cumulate — the running total, and the order it depends on (T2)", () => {
  it("accumulates DOWN THE LADDER when rungs arrive descending by price", () => {
    const points = cumulate([
      rung("r1", 60_000, 100),
      rung("r2", 55_000, 200),
      rung("r3", 50_000, 400),
    ]);
    expect(points.map((point) => point.cumulativeUsd)).toEqual([100, 300, 700]);
  });

  it("accumulates in ARRAY ORDER — the descending sort is the caller's precondition", () => {
    // THE DEPENDENCY, ASSERTED AS THE SUBJECT rather than left in a comment. The same
    // three rungs, shuffled: the running total follows the array, so an unsorted caller
    // gets a curve that is not the price drop path. `composeFillPathPage` sorts
    // descending precisely so this module never needs a second opinion about which way
    // the ladder runs — and this test is what makes that contract visible if it breaks.
    const shuffled = cumulate([
      rung("r3", 50_000, 400),
      rung("r1", 60_000, 100),
      rung("r2", 55_000, 200),
    ]);
    expect(shuffled.map((point) => point.cumulativeUsd)).toEqual([
      400, 500, 700,
    ]);
    // The shallowest rung's own running total is the tell: $100 walking down the ladder,
    // $500 out of order. Only the first is "capital committed by the time price is here".
    expect(shuffled.find((point) => point.key === "r1")!.cumulativeUsd).toBe(
      500,
    );
    // The ladder's whole declared total is order-free, which is why the wrong order is
    // silent everywhere except at the intermediate points.
    expect(shuffled.at(-1)!.cumulativeUsd).toBe(700);
  });

  it("carries every other field through untouched", () => {
    const points = cumulate([rung("r1", 60_000, 100, true)]);
    expect(points[0]).toEqual({
      key: "r1",
      priceUsd: 60_000,
      sizeUsd: 100,
      filled: true,
      cumulativeUsd: 100,
    });
  });
});

describe("splitAt — where the solid path becomes the dashed one (T3)", () => {
  const points = (...filled: readonly boolean[]) =>
    withRadius(
      cumulate(
        filled.map((isFilled, index) =>
          rung(`r${index + 1}`, 60_000 - index * 1_000, 100, isFilled),
        ),
      ),
    );

  it("returns -1 on day zero, so the whole path is dashed", () => {
    expect(splitAt(points(false, false, false))).toBe(-1);
  });

  it("returns the LAST filled index on an out-of-order fill", () => {
    // The venue filled rungs 1 and 3 and skipped 2 — which is exactly when a per-rung
    // classification would shatter the line into pieces. The last filled index says the
    // weaker true thing: everything to here has been walked.
    expect(splitAt(points(true, false, true, false))).toBe(2);
  });

  it("returns the last index when the whole ladder has filled", () => {
    expect(splitAt(points(true, true, true))).toBe(2);
  });

  it("returns -1 on an empty ladder rather than reading off the end", () => {
    expect(splitAt([])).toBe(-1);
  });
});

describe("spotMarkFor — the now rule, and what it may claim (T4)", () => {
  // A ladder spanning 50K–60K, with the padded plot bounds the component derives.
  const BOUNDS = { low: 50_000, high: 60_000, yLow: 49_250, yHigh: 60_750 };

  it("draws no mark at all when there is no live spot", () => {
    expect(spotMarkFor(undefined, BOUNDS)).toBeUndefined();
  });

  it("pins ABOVE the ladder to the top of the plot and carries the up glyph", () => {
    const mark = spotMarkFor(64_412, BOUNDS)!;
    expect(mark.y).toBe(BOUNDS.yHigh);
    expect(mark.label).toBe("↑ ~$64.4K");
    expect(mark.dy).toBe(-4);
  });

  it("pins BELOW the ladder to the bottom of the plot and carries the down glyph", () => {
    const mark = spotMarkFor(41_000, BOUNDS)!;
    expect(mark.y).toBe(BOUNDS.yLow);
    expect(mark.label).toBe("↓ ~$41K");
    // Nudged clear of the capital axis's own tick labels, unlike the top-pinned mark.
    expect(mark.dy).toBe(-5);
  });

  it("plots an IN-RANGE spot at its own price and carries no direction glyph", () => {
    const mark = spotMarkFor(55_500, BOUNDS)!;
    expect(mark.y).toBe(55_500);
    expect(mark.label).toBe("spot ~$55.5K");
    expect(mark.label).not.toContain("↑");
    expect(mark.label).not.toContain("↓");
    expect(mark.dy).toBe(-4);
  });

  it("clamps against the LADDER's own ends, not against the padded plot edges", () => {
    // A spot inside the padding is still outside the ladder, and the rule must say so:
    // clamping on `yHigh` instead would plot it as an ordinary price in a band where no
    // rung exists, glyph-free.
    const mark = spotMarkFor(60_500, BOUNDS)!;
    expect(mark.y).toBe(BOUNDS.yHigh);
    expect(mark.label).toContain("↑");
  });

  it("treats a spot sitting exactly ON a ladder end as in range", () => {
    // The comparisons are strict, and they should be: spot at the top rung's price is a
    // price the plot can draw, so nothing is clamped and nothing is warned about.
    expect(spotMarkFor(60_000, BOUNDS)!.y).toBe(60_000);
    expect(spotMarkFor(60_000, BOUNDS)!.label).toBe("spot ~$60K");
    expect(spotMarkFor(50_000, BOUNDS)!.y).toBe(50_000);
  });
});

describe("deployedMarkFor — a MEASURED rule on a DECLARED axis (T6)", () => {
  // A ladder declaring $4,250 in total, whose capital axis `.nice()`s out to $4,500,
  // spanning 22K–50K in price with the component's own padding. Authored to match the
  // shape of the `overfilled` fixture's ladder, not copied from any measurement.
  const BOUNDS = { xStart: 0, xEnd: 4_500, yLow: 21_250, yHigh: 50_750 };

  it("draws no mark at all when there is no measured deployed total", () => {
    // Day zero. A rule parked at $0 would claim the fund was measured and found to have
    // spent nothing, which is a different sentence from "no fill has been recorded yet".
    expect(deployedMarkFor(undefined, BOUNDS)).toBeUndefined();
  });

  it("plots an IN-DOMAIN total at its own value, unmarked and unnumbered", () => {
    const mark = deployedMarkFor(910, BOUNDS)!;
    expect(mark.x).toBe(910);
    expect(mark.label).toBe("Deployed");
    // The glyph is the clamp warning, and nothing was clamped.
    expect(mark.label).not.toContain("→");
    expect(mark.label).not.toContain("←");
    // Rides the bottom of the plot, nudged up out of the tick gutter.
    expect(mark.y).toBe(BOUNDS.yLow);
    expect(mark.anchor).toBe("start");
    expect(mark.dx).toBe(4);
    expect(mark.dy).toBe(-4);
  });

  it("PINS an overfill to the axis end and says so with a glyph AND the number", () => {
    // THE DEFECT THIS SLICE EXISTS FOR. `deployed` is measured and the axis is declared,
    // so the measurement has no reason to respect the axis's end — at 1.3× the declared
    // total the un-clamped rule drew at 130% of the plot width, outside the plot area,
    // to the right of the last tick, in silence.
    const mark = deployedMarkFor(5_525, BOUNDS)!;
    expect(mark.x).toBe(BOUNDS.xEnd);
    // Same contract `spotMarkFor` holds: whenever `x` is not the real value, the label
    // carries the direction glyph, so the mark reads as a direction and not a coordinate.
    expect(mark.label).toContain("→");
    // …and the one fact the pinned picture genuinely cannot state any more: the number.
    expect(mark.label).toBe("Deployed ~$5.5K →");
    // The label moves to the TOP of the plot when pinned, because the bottom-right corner
    // is where `spotMarkFor` prints a below-the-ladder spot — and an overfilled ladder is
    // exactly the one whose price has fallen through every rung.
    expect(mark.y).toBe(BOUNDS.yHigh);
    expect(mark.anchor).toBe("end");
    expect(mark.dx).toBe(-4);
    expect(mark.dy).toBe(12);
  });

  it("PINS a total below the axis start the same way, glyph pointing out", () => {
    const mark = deployedMarkFor(-500, BOUNDS)!;
    expect(mark.x).toBe(BOUNDS.xStart);
    expect(mark.label).toBe("← Deployed ~-$500");
    expect(mark.y).toBe(BOUNDS.yHigh);
    expect(mark.anchor).toBe("start");
    expect(mark.dx).toBe(4);
    expect(mark.dy).toBe(12);
  });

  it("treats a total sitting exactly ON the axis end as in domain", () => {
    // Strict comparisons, for `spotMarkFor`'s reason: a value the plot can draw is not
    // clamped and is not warned about. A ladder walked in full to its declared sizes
    // lands here, and it is the ordinary case rather than an edge.
    const mark = deployedMarkFor(BOUNDS.xEnd, BOUNDS)!;
    expect(mark.x).toBe(BOUNDS.xEnd);
    expect(mark.label).toBe("Deployed");
    expect(mark.y).toBe(BOUNDS.yLow);
  });

  it("never returns an `x` outside the axis, for any total", () => {
    // THE PROPERTY, ASSERTED AS THE SUBJECT. The old mark had no out-of-domain arm at all
    // — it was the one plot mark exempt from the contract the spot rule holds. This is
    // what makes the exemption gone rather than special-cased.
    const totals = [-9_999, -1, 0, 1, 910, 4_499, 4_500, 4_501, 5_525, 1e9];
    for (const total of totals) {
      const mark = deployedMarkFor(total, BOUNDS)!;
      expect(mark.x).toBeGreaterThanOrEqual(BOUNDS.xStart);
      expect(mark.x).toBeLessThanOrEqual(BOUNDS.xEnd);
      // …and a clamped mark is never silent about it.
      const clamped = mark.x !== total;
      expect(/[→←]/.test(mark.label)).toBe(clamped);
    }
  });
});

/**
 * THE ONE BRANCH OF THE CHART A TEST CAN SEE WITHOUT A HARNESS (finding on PR #308).
 *
 * `PriceDropPathChart` cannot be rendered by any test in this repo (D1, deferred —
 * `docs/coverage-rationale.md` §6), and its legend is plain JSX rather than a chart mark,
 * so no pure module holds it. What CAN be read is the source, the way
 * `rung-state-seam.test.ts` reads its own: whether each entry is GATED at all.
 *
 * THE RULE THE CHART SET FOR ITSELF is that each entry appears only when the thing it
 * explains is on screen — `Filled` on `anyFilled`, `Now` on a known spot. `Waiting` shipped
 * ungated, so `/ladder-fixture/overfilled` (eight filled rungs, a dashed slice one point
 * long that draws nothing) printed a grey dashed key for a colour absent from its picture.
 * This does not check WHICH condition gates which entry — that is behaviour no scan can
 * see. It checks that no entry is unconditional, which is what drifted.
 *
 * MUTATION CHECK (performed 2026-08-12): removed the `anyWaiting` gate again → red,
 * `legend entry 2 renders unconditionally`. Right reason: that IS the defect. Removed the
 * `anyFilled` gate → red on entry 1. Right reason: the rule is not about one entry.
 */
describe("the chart's legend gates every entry on the mark it explains", () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "components", "PriceDropPathChart.tsx"),
    "utf8",
  );

  it("renders no legend entry unconditionally", () => {
    const legend = /<ul className="fp-legend">([\s\S]*?)<\/ul>/.exec(source)?.[1];
    expect(legend, "the legend is no longer a `fp-legend` list").toBeDefined();
    // Each `<li>` must be preceded — since the previous entry closed — by a JSX
    // conditional. `?` covers the two ternary spellings the file already uses (`cond ? (…)
    // : null` and `cond ? null : (…)`); `&&` covers the other way anyone would write it.
    const chunks = legend!.split("<li>");
    expect(chunks.length - 1, "the legend no longer has three entries").toBe(3);
    for (const [index, chunk] of chunks.slice(0, -1).entries()) {
      const sincePreviousEntry = chunk.slice(chunk.lastIndexOf("</li>") + 1);
      expect(
        /\?|&&/.test(sincePreviousEntry),
        `legend entry ${index + 1} renders unconditionally`,
      ).toBe(true);
    }
  });
});
