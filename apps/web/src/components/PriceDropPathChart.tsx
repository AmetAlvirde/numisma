import { useMemo } from "react";
import { barY, defineChart, dot, ruleX, text } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Chart } from "@tanstack/charts/react";
import type { FillPathRungView } from "../ladder/fill-path-view.ts";

/**
 * THE PRICE DROP PATH, DRAWN BY TANSTACK CHARTS (supersedes spec #285 §6.2, whose
 * "no chart library: the repo has none and adds none" this file deliberately breaks —
 * an ADR is owed).
 *
 * WHAT THE HAND-ROLLED SVG COULD NOT SAY. The old picture was a bare polyline over an
 * unlabelled canvas: no axis, no tick, no unit, and `preserveAspectRatio="none"`
 * squashing every dot into an ellipse. It carried the SHAPE of the capital curve and
 * nothing quantitative, and it rose up-and-right on a card called "Price Drop Path",
 * which reads like growth over time to anyone who has ever seen a chart.
 *
 * BARS AGAINST A ZERO BASELINE, ON A REVERSED PRICE AXIS. Capital per rung is a
 * magnitude, so it is drawn as a magnitude standing on zero rather than as a point on a
 * line. The x axis is real USD price with `reverse: true`, so price FALLS left to right
 * and the bars visibly grow as it falls — the card's name and its picture finally agree.
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

/**
 * ONE BAR'S WORTH OF DECIDED FACT. `state` is chosen here from flags the view module
 * already decided, and is the ONLY thing that picks a colour — no component re-derives
 * whether a rung is filled.
 */
interface RungBar {
  key: string;
  priceUsd: number;
  sizeUsd: number;
  state: "filled" | "next" | "unplaced" | "waiting";
}

/**
 * COLOUR COMES FROM `styles.css`, NOT FROM A SECOND PALETTE. These are the same four
 * variables the old `.fp-chart-dot` rules used, so the chart still changes with the
 * theme and there is one place to change it. The SVG renderer emits these straight into
 * the paint attribute and the browser resolves them against the card.
 */
function fillFor(bar: RungBar): string {
  if (bar.state === "filled") return "var(--pos)";
  if (bar.state === "next") return "var(--text)";
  if (bar.state === "unplaced") return "var(--line)";
  return "var(--muted)";
}

function stateOf(rung: FillPathRungView): RungBar["state"] {
  if (rung.venueAxis === "filled") return "filled";
  if (rung.isNext) return "next";
  if (rung.notPlaced) return "unplaced";
  return "waiting";
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
    // Rungs with no declared size cannot be a bar. The caller only renders this
    // component when the view module says the ladder is plottable, so this is a
    // type narrowing rather than a policy.
    const bars: RungBar[] = rungs.flatMap((rung) =>
      rung.sizeUsd === undefined
        ? []
        : [
            {
              key: rung.key,
              priceUsd: rung.priceUsd,
              sizeUsd: rung.sizeUsd,
              state: stateOf(rung),
            },
          ],
    );

    const prices = bars.map((bar) => bar.priceUsd);
    // SPOT IS FOLDED INTO THE PRICE DOMAIN, as the hand-rolled chart also did: the fund
    // sits above or below its whole ladder more often than inside it, and a "now" rule
    // outside the domain is a rule drawn off the canvas.
    const withSpot = spotUsd === undefined ? prices : [...prices, spotUsd];
    const high = Math.max(...withSpot);
    const low = Math.min(...withSpot);

    // Half a rung of air at each end, so the outermost bars are not sliced in half by
    // the plot edge. Derived from the tightest rung spacing, so it holds for an even
    // ladder and a convex one alike.
    const gaps = prices
      .slice()
      .sort((a, b) => a - b)
      .flatMap((price, index, sorted) =>
        index === 0 ? [] : [price - sorted[index - 1]!],
      )
      .filter((gap) => gap > 0);
    const pad = (gaps.length > 0 ? Math.min(...gaps) : (high - low) / 4) * 0.75;

    const xScale = scaleLinear().domain([low - pad, high + pad]);
    // `.nice()` first, THEN read the top back, so the spot label is placed against the
    // domain the axis actually drew rather than against a number we guessed.
    const yScale = scaleLinear()
      .domain([0, Math.max(...bars.map((bar) => bar.sizeUsd))])
      .nice();
    const yTop = yScale.domain()[1];

    const selected = bars.filter((bar) => bar.key === selectedKey);
    const spotRow = spotUsd === undefined ? [] : [{ priceUsd: spotUsd }];

    return defineChart({
      marks: [
        barY(bars, {
          x: "priceUsd",
          y: "sizeUsd",
          key: "key",
          fill: fillFor,
          radius: 2,
          maxThickness: 26,
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
          anchor: "middle",
          dy: -4,
        }),
        // SELECTION IS A MARKER, NOT A RECOLOUR. Repainting the selected bar would
        // overwrite the one thing its colour is for — whether the rung filled.
        dot(selected, {
          x: "priceUsd",
          y: "sizeUsd",
          key: "key",
          r: 3.5,
          fill: "var(--text)",
          stroke: "var(--bg)",
          strokeWidth: 1.5,
        }),
      ],
      x: {
        scale: xScale,
        // PRICE FALLS TO THE RIGHT. This one flag is what makes the picture match the
        // card's name; without it the bars grow leftward and the card reads backwards.
        reverse: true,
        axis: {
          label: "Rung price (USD)",
          ticks: { format: (value: number) => AXIS_USD.format(value) },
        },
      },
      y: {
        scale: yScale,
        grid: true,
        axis: {
          label: "Capital (USD)",
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

  return (
    // THE WRAPPER IS WHAT HIDES IT. `ariaLabel` below is a required prop of the adapter
    // and cannot be omitted; `aria-hidden` here hides the whole subtree including it.
    <div className="fp-chart" aria-hidden="true">
      <Chart
        definition={definition}
        height={HEIGHT}
        initialWidth={INITIAL_WIDTH}
        tabIndex={-1}
        idPrefix="fp-chart"
        ariaLabel="Price drop path"
      />
    </div>
  );
}
