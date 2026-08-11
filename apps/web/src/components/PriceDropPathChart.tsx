import { useMemo } from "react";
import { defineChart, dot, lineY, ruleX, text } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Chart } from "@tanstack/charts/react";
import type { FillPathRungView } from "../ladder/fill-path-view.ts";

/**
 * THE PRICE DROP PATH, DRAWN BY TANSTACK CHARTS (supersedes spec #285 §6.2, whose
 * "no chart library: the repo has none and adds none" this file deliberately breaks —
 * an ADR is owed).
 *
 * A LINE, BECAUSE THE LINE IS THE ARGUMENT. The ladder's convexity — that each rung
 * buys more than the last, and by how much it accelerates — lives in the SLOPE between
 * rungs. A bar chart has no slope: it shows eight independent magnitudes and leaves the
 * reader to infer the curve. This was tried as bars and rejected for exactly that.
 *
 * WHAT THE HAND-ROLLED SVG COULD NOT SAY. The predecessor was also a polyline, but over
 * an unlabelled canvas: no axis, no tick, no unit, an unlabelled dashed rule stranded at
 * the canvas edge, and `preserveAspectRatio="none"` squashing every dot into an ellipse.
 * The line survives; everything quantitative around it is new.
 *
 * ── THE PATH IS SPLIT WHERE THE LADDER IS ────────────────────────────────────────────
 * Solid across the rungs that FILLED, dashed across the rungs still WAITING. The two
 * `lineY` marks are drawn over two slices that SHARE the junction rung, so the handoff
 * is continuous — a gap there would read as missing data rather than as a change of
 * state. See `splitAt` for why the split is one index and not a per-rung classification.
 *
 * ── THE ACCESSIBILITY CONTRACT IS UNCHANGED (§6.3a) ──────────────────────────────────
 * The chart is STILL presentation and still `aria-hidden`, and the generated caption
 * from `ladder/convexity-caption.ts` is STILL its substitute. Adopting a library did not
 * buy the chart a seat in the accessibility tree, and this file must not give it one.
 *
 * That costs something, because `ariaLabel` is a REQUIRED prop of `@tanstack/charts`'s
 * React adapter and its surface is focusable (`tabIndex` defaults to 0). An aria-hidden
 * subtree containing a focusable element is a defect, not a nicety, so all four of these
 * hold together and none of them is optional:
 *
 *   1. the wrapper carries `aria-hidden`, which hides the whole subtree, `ariaLabel`
 *      and all — the label is unavoidable, so it is neutralized instead;
 *   2. `tabIndex={-1}` takes the surface out of the tab order;
 *   3. `focus`, `pointer` and `keyboard` are all `false` in the definition, so the
 *      library mounts no interaction at all;
 *   4. `tooltip: false`, because a tooltip is a fact reachable only by pointer and
 *      every fact here is already in the rung list below.
 *
 * THE LEGEND IS INSIDE THAT HIDDEN SUBTREE, DELIBERATELY. It decodes a picture a screen
 * reader cannot see; read aloud on its own, "Filled / Waiting / Now" is three words with
 * no referent. Every state it names is already spelled out per rung, in words, by the
 * pills in the rung list below. It carries no interactive element, so hiding it removes
 * nothing reachable.
 *
 * ── DETERMINISTIC ACROSS THE SSR BOUNDARY ────────────────────────────────────────────
 * `initialWidth` fixes the server's width so the first client render matches, the two
 * `Intl.NumberFormat`s are module-scope and explicitly `en-US` rather than locale-
 * dependent, both scale domains are computed from the data instead of inferred, and the
 * definition is memoized on the values it captures. Nothing here reads a clock, a
 * `window`, or a random number.
 */

/** Explicit locale: an SSR boundary is exactly where an implicit one diverges. */
const AXIS_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const SPOT_USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** The card is judged on a phone; this is close to the real width, so the first
 *  post-hydration resize is small rather than a jump. */
const INITIAL_WIDTH = 320;
const HEIGHT = 200;

/** The dash the WAITING segment and its legend swatch share. One constant, so the
 *  picture and the key that explains it cannot drift apart. */
const WAITING_DASH = "5 4";

/** One rung's worth of decided fact. `filled` is read off the view module's own
 *  `venueAxis`; no component here re-derives whether a rung filled. */
interface RungPoint {
  key: string;
  priceUsd: number;
  sizeUsd: number;
  filled: boolean;
}

/**
 * THE ONE PLACE THAT DECIDES "FILLED", because the legend and the path must never
 * disagree: a green segment with no `Filled` key beside it is the picture contradicting
 * its own caption. The view module already decided this; nothing here re-derives it.
 */
function isFilled(rung: FillPathRungView): boolean {
  return rung.venueAxis === "filled";
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
function splitAt(points: readonly RungPoint[]): number {
  let last = -1;
  points.forEach((point, index) => {
    if (point.filled) last = index;
  });
  return last;
}

export function PriceDropPathChart({
  rungs,
  selectedKey,
  spotUsd,
}: {
  rungs: readonly FillPathRungView[];
  selectedKey: string | undefined;
  /** LIVE spot only. A last close is not "now", so the caller passes nothing for it. */
  spotUsd: number | undefined;
}) {
  const definition = useMemo(() => {
    // A rung with no declared size has no y and cannot be a point. The caller only
    // renders this component when the view module says the ladder is plottable, so
    // this is a type narrowing rather than a policy.
    const points: RungPoint[] = rungs.flatMap((rung) =>
      rung.sizeUsd === undefined
        ? []
        : [
            {
              key: rung.key,
              priceUsd: rung.priceUsd,
              sizeUsd: rung.sizeUsd,
              filled: isFilled(rung),
            },
          ],
    );

    const prices = points.map((point) => point.priceUsd);
    // SPOT IS FOLDED INTO THE PRICE DOMAIN, as the hand-rolled chart also did: the fund
    // sits above or below its whole ladder more often than inside it, and a "now" rule
    // outside the domain is a rule drawn off the canvas.
    const withSpot = spotUsd === undefined ? prices : [...prices, spotUsd];
    const high = Math.max(...withSpot);
    const low = Math.min(...withSpot);

    // Air at each end, so the outermost dots are not clipped in half by the plot edge.
    // Derived from the tightest rung spacing, so it holds for an even ladder and a
    // convex one alike.
    const gaps = prices
      .slice()
      .sort((a, b) => a - b)
      .flatMap((price, index, sorted) =>
        index === 0 ? [] : [price - sorted[index - 1]!],
      )
      .filter((gap) => gap > 0);
    const pad = (gaps.length > 0 ? Math.min(...gaps) : (high - low) / 4) * 0.75;

    const xLow = low - pad;
    const xHigh = high + pad;
    const xScale = scaleLinear().domain([xLow, xHigh]);
    // `.nice()` first, THEN read the top back, so the spot label is placed against the
    // domain the axis actually drew rather than against a number we guessed.
    const yScale = scaleLinear()
      .domain([0, Math.max(...points.map((point) => point.sizeUsd))])
      .nice();
    const yTop = yScale.domain()[1];

    // THE TWO SLICES OVERLAP ON THE JUNCTION RUNG, which is what makes the solid and
    // dashed strokes meet instead of leaving a rung-wide hole between them.
    const split = splitAt(points);
    const solid = split < 0 ? [] : points.slice(0, split + 1);
    const dashed = split < 0 ? points : points.slice(split);

    const selected = points.filter((point) => point.key === selectedKey);
    const spotRow = spotUsd === undefined ? [] : [{ priceUsd: spotUsd }];

    // THE LABEL IS KEPT OFF THE GUTTER. `anchor: "middle"` overhangs the plot into the
    // axis area whenever spot sits at an extreme of the domain — which is the fund's
    // usual situation, since spot is normally above the whole ladder. The anchor flips
    // to the side with room instead of the text being clipped.
    //
    // The axis is REVERSED, so a HIGH price renders at the LEFT. That is why this
    // fraction counts down from `xHigh`.
    const spotFromLeft =
      spotUsd === undefined ? 0.5 : (xHigh - spotUsd) / (xHigh - xLow);
    const spotAnchor =
      spotFromLeft < 0.15 ? "start" : spotFromLeft > 0.85 ? "end" : "middle";
    const spotNudge = spotAnchor === "start" ? 4 : spotAnchor === "end" ? -4 : 0;

    return defineChart({
      marks: [
        // WAITING FIRST, SO SOLID PAINTS OVER IT at the shared junction rung.
        lineY(dashed, {
          x: "priceUsd",
          y: "sizeUsd",
          stroke: "var(--muted)",
          strokeWidth: 1.5,
          strokeDasharray: WAITING_DASH,
        }),
        lineY(solid, {
          x: "priceUsd",
          y: "sizeUsd",
          stroke: "var(--pos)",
          strokeWidth: 1.75,
        }),
        // THE "NOW" RULE, AND THE LABEL THAT SAYS WHAT IT IS. `ruleX` carries no label
        // channel in 0.11.0, so the annotation is a composed `text` mark at the same
        // semantic x — which is the library's documented pattern, not a workaround.
        ruleX(spotRow, {
          x: "priceUsd",
          stroke: "var(--text)",
          strokeWidth: 1,
          strokeOpacity: 0.9,
          strokeDasharray: "3 3",
        }),
        text(spotRow, {
          x: "priceUsd",
          // A CONSTANT HAS TO BE AN ACCESSOR HERE. `text.y` takes only a channel in
          // 0.11.0, unlike `barY.y1`/`y2`, which also accept a bare number.
          y: () => yTop,
          text: () => `spot ${SPOT_USD.format(spotUsd!)}`,
          fill: "var(--text)",
          fontSize: 10,
          anchor: spotAnchor,
          dx: spotNudge,
          dy: -4,
        }),
        // HOLLOW DOTS, FILLED WITH THE CARD'S OWN BACKGROUND, so the line reads through
        // the ring rather than being interrupted by a blob. Two marks rather than one
        // because `dot.stroke` is a flat string in 0.11.0, not a per-datum channel — so
        // a ring's colour has to come from which mark drew it.
        dot(
          points.filter((point) => !point.filled),
          {
            x: "priceUsd",
            y: "sizeUsd",
            key: "key",
            r: 3.5,
            fill: "var(--card)",
            stroke: "var(--muted)",
            strokeWidth: 1.5,
          },
        ),
        dot(
          points.filter((point) => point.filled),
          {
            x: "priceUsd",
            y: "sizeUsd",
            key: "key",
            r: 3.5,
            fill: "var(--card)",
            stroke: "var(--pos)",
            strokeWidth: 1.75,
          },
        ),
        // SELECTION IS THE ONE SOLID DOT. It reads against a field of hollow ones
        // without recolouring anything, so it cannot overwrite the one thing a ring's
        // colour is for — whether that rung filled.
        dot(selected, {
          x: "priceUsd",
          y: "sizeUsd",
          key: "key",
          r: 4,
          fill: "var(--text)",
          stroke: "var(--card)",
          strokeWidth: 1.5,
        }),
      ],
      x: {
        scale: xScale,
        // PRICE FALLS TO THE RIGHT. This one flag is what makes the picture match the
        // card's name; without it the path runs the other way and the card reads
        // backwards. It matches `chartFor`'s own high-left ordering.
        reverse: true,
        axis: {
          label: "Price dropping left to right",
          ticks: { format: (value: number) => AXIS_USD.format(value) },
        },
      },
      y: {
        scale: yScale,
        grid: true,
        axis: {
          // NOT "deployed capital". Deployed is what the fund actually SPENT, and it is
          // a measured figure on the header card that is absent until a fill is
          // recorded. This axis plots the size the operator DECLARED per rung, which on
          // an unwalked ladder is money that has not moved. Naming it "deployed" would
          // print a measurement where there is only an intention.
          label: "Declared capital (USD)",
          ticks: { format: (value: number) => AXIS_USD.format(value) },
        },
      },
      // See this file's header: the chart is presentation, so it mounts no interaction.
      focus: false,
      pointer: false,
      keyboard: false,
      tooltip: false,
    });
  }, [rungs, selectedKey, spotUsd]);

  const anyFilled = rungs.some(isFilled);

  return (
    // THE WRAPPER IS WHAT HIDES IT — chart AND legend. `ariaLabel` below is a required
    // prop of the adapter and cannot be omitted; `aria-hidden` here hides the whole
    // subtree including it. See this file's header for why the legend is hidden too.
    <div className="fp-chart" aria-hidden="true">
      <Chart
        definition={definition}
        height={HEIGHT}
        initialWidth={INITIAL_WIDTH}
        tabIndex={-1}
        idPrefix="fp-chart"
        ariaLabel="Price drop path"
      />
      {/* PLAIN HTML, NOT A CHART MARK. 0.11.0 ships `colorLegend`, but it is bound to a
          colour SCALE and its swatches are colour chips: it cannot draw a dashed rule
          or a "now" line, and these marks use explicit strokes rather than a colour
          scale at all. Faking a scale to borrow the legend would invent a data
          structure to satisfy a widget. */}
      <ul className="fp-legend">
        {anyFilled ? (
          <li>
            <span className="fp-legend-swatch is-filled" />
            Filled
          </li>
        ) : null}
        <li>
          <span className="fp-legend-swatch is-waiting" />
          Waiting
        </li>
        {spotUsd === undefined ? null : (
          <li>
            <span className="fp-legend-swatch is-now" />
            Now
          </li>
        )}
      </ul>
    </div>
  );
}
