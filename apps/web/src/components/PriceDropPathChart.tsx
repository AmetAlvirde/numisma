import { useMemo } from "react";
import { defineChart, dot, lineY, ruleX, ruleY, text } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Chart } from "@tanstack/charts/react";
import type { FillPathRungView, MeasuredFigure } from "../ladder/fill-path-view.ts";
import {
  COMPACT_USD,
  cumulate,
  splitAt,
  spotMarkFor,
  withRadius,
  type RungPoint,
} from "../ladder/price-drop-path.ts";

/**
 * THE PRICE DROP PATH, DRAWN BY TANSTACK CHARTS (ADR-018).
 *
 * ── THIS FILE IS MARKS AND A DEFINITION; THE ARITHMETIC IS NEXT DOOR ─────────────────
 * Every quantity the picture stands on — the running total, the ring radius, the split
 * index, the now rule's clamp and the one compact-USD formatter — lives in
 * `ladder/price-drop-path.ts`, which is pure, coverage-visible and tested. Read that
 * module for WHY each number is the number it is, and for the three preconditions this
 * component's props are required to satisfy (a plottable ladder, LIVE-only spot, rungs
 * descending by price). What is left here is which mark draws what, and why.
 *
 * A LINE, BECAUSE THE LINE IS THE ARGUMENT. The ladder's convexity — that each rung
 * buys more than the last, and by how much it accelerates — lives in the SLOPE between
 * rungs. A bar chart has no slope: it shows eight independent magnitudes and leaves the
 * reader to infer the curve. This was tried as bars and rejected for exactly that.
 *
 * The capital value is the RUNNING CUMULATIVE declared capital down the ladder, not the
 * per-rung size — see `cumulate` for why, and for the ordering the sum depends on. Under
 * that reading the slope between two points IS the next rung's size, so the convexity
 * argument above is not weakened by the change; it is drawn more directly.
 *
 * ── THE RING SIZE SAYS WHAT THE CAPTION USED TO ──────────────────────────────────────
 * Each rung's dot is scaled by the AREA of that rung's declared size (`withRadius`), so
 * the deepest ring is visibly six-odd times the shallowest on a convex ladder. This took
 * over from a printed sentence — "the deepest rung is 6.3× the first" — which now renders
 * screen-reader-only under the chart (`FillPath`'s `ChartCard`). The two encodings are
 * complements, not duplicates: the SLOPE answers "how fast does commitment accelerate as
 * price falls" across the ladder, the RING answers "how big is THIS buy" at one rung, and
 * a reader working the inspect slider is asking the second question.
 *
 * ── PRICE IS THE VERTICAL AXIS, THE WAY EVERY TRADING CHART IS DRAWN ─────────────────
 * This was once price-on-x with the axis REVERSED so price fell left to right, which is
 * a picture nobody has ever read a market off. Price now runs up the y axis, ascending —
 * the deepest rung at the bottom, the shallowest at the top — and cumulative capital runs
 * along x from $0. The path therefore starts top-left (highest rung, nothing committed
 * yet) and descends to bottom-right (deepest rung, the ladder's whole declared total).
 * No axis is reversed: the library's default linear y already puts high at the top, and
 * the old `reverse: true` existed only to undo the old orientation.
 *
 * THE CAPITAL AXIS STARTS AT $0, NOT AT THE FIRST RUNG'S RUNNING TOTAL. "How much has
 * been committed by the time price reaches here" begins at nothing, and an axis that
 * began at the first rung's size would silently hide the first commitment.
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
 * `initialWidth` fixes the server's width so the first client render matches, the one
 * `Intl.NumberFormat` is module-scope in the pure module and explicitly `en-US` rather
 * than locale-dependent, both scale domains are computed from the data instead of
 * inferred, and the definition is memoized on the values it captures. Nothing here reads
 * a clock, a `window`, or a random number.
 */

/** The card is judged on a phone; this is close to the real width, so the first
 *  post-hydration resize is small rather than a jump. */
const INITIAL_WIDTH = 320;

/** THE PICTURE IS A RATIO, NOT A FIXED-HEIGHT BAND. A constant height over a measured
 *  width is not a shape at all — the same ladder was a squat strip on a wide card and a
 *  near-square on a phone. `aspectRatio` is width ÷ height, so 1.25 is a 5:4 box: barely
 *  wider than it is tall, which gives the cumulative climb room to read as a climb
 *  without turning the price axis into a slit.
 *
 *  The wrapper caps the width (`.fp-chart`) so the ratio cannot turn a wide desktop card
 *  into a half-viewport-tall chart. The cap belongs in CSS rather than here because it is
 *  a layout bound, not a property of the chart. */
const ASPECT_RATIO = 1.25 / 1;

/** The dash the WAITING segment and its legend swatch share. One constant, so the
 *  picture and the key that explains it cannot drift apart. */
const WAITING_DASH = "1 1";

export function PriceDropPathChart({
  rungs,
  selectedKey,
  spotUsd,
  deployed,
}: {
  rungs: readonly FillPathRungView[];
  selectedKey: string | undefined;
  /** LIVE spot only. A last close is not "now", so the caller passes nothing for it. */
  spotUsd: number | undefined;
  /** The MEASURED deployed total, or the named reason there is none — see the deployed
   *  rule's mark below for why a measurement is being drawn on a declared axis, and why
   *  the `known: false` arm must draw nothing rather than a rule at zero. */
  deployed: MeasuredFigure;
}) {
  const definition = useMemo(() => {
    // A rung with no declared size has no x and cannot be a point. The caller only
    // renders this component when the view module says the ladder is plottable, so
    // this is a type narrowing rather than a policy — it is what turns a
    // `FillPathRungView` into the pure module's `PlottableRung`, whose required
    // `sizeUsd` is where that precondition is now written down.
    const points: RungPoint[] = withRadius(
      cumulate(
        rungs.flatMap((rung) =>
          rung.sizeUsd === undefined
            ? []
            : [
                {
                  key: rung.key,
                  priceUsd: rung.priceUsd,
                  sizeUsd: rung.sizeUsd,
                  filled: rung.filled,
                },
              ],
        ),
      ),
    );

    // THE DOMAIN IS THE LADDER, AND ONLY THE LADDER.
    //
    // The hand-rolled chart folded spot INTO the price domain to keep the "now" line on
    // canvas, and this component inherited that. It is why a quarter of the plot sat
    // empty with a rule floating in it: the fund's spot normally sits well above the
    // whole ladder, so the ladder — the actual subject — got squeezed into what was
    // left. Stretching the axis to reach a price no rung occupies spends the reader's
    // pixels on emptiness.
    //
    // So the axis is scaled to the rungs, and an out-of-range spot is handled by
    // `spotMark` below, which PINS the rule to the edge and SAYS SO in the label.
    // Whitespace is bounded by construction and nothing is silently clamped.
    const prices = points.map((point) => point.priceUsd);
    const high = Math.max(...prices);
    const low = Math.min(...prices);

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

    const yLow = low - pad;
    const yHigh = high + pad;
    const yScale = scaleLinear().domain([yLow, yHigh]);
    // THE FAR END OF THE CAPITAL AXIS IS THE WHOLE LADDER'S DECLARED TOTAL — the last
    // point's running sum, which is the largest by construction while sizes are
    // non-negative. `Math.max` over the column rather than `at(-1)` so a zero-or-negative
    // size could never make the domain shorter than a point already plotted inside it.
    //
    // IT STARTS AT $0 — see the header. The first rung's dot therefore sits off the left
    // edge by its own size, which is the picture being honest: reaching the top rung
    // already costs something.
    //
    // `.nice()` first, THEN read the end back, so the spot label is placed against the
    // domain the axis actually drew rather than against a number we guessed. The label
    // therefore rides the RIGHT edge of the plot, clear of the descending curve.
    const xScale = scaleLinear()
      .domain([0, Math.max(...points.map((point) => point.cumulativeUsd))])
      .nice();
    const xEnd = xScale.domain()[1];

    // THE TWO SLICES OVERLAP ON THE JUNCTION RUNG, which is what makes the solid and
    // dashed strokes meet instead of leaving a rung-wide hole between them.
    const split = splitAt(points);
    const solid = split < 0 ? [] : points.slice(0, split + 1);
    const dashed = split < 0 ? points : points.slice(split);

    const selected = points.filter((point) => point.key === selectedKey);
    const spotMark = spotMarkFor(spotUsd, { low, high, yLow, yHigh });
    const spotRow = spotMark === undefined ? [] : [{ priceUsd: spotMark.y }];

    // THE DEPLOYED RULE IS ONLY DRAWN WHEN THE FIGURE WAS MEASURED. `deployed` is a
    // `MeasuredFigure`, so the absent arm carries a REASON and never a number; a rule
    // parked at $0 on day zero would claim the fund had been measured and found to have
    // spent nothing, which is a different sentence from "no fill has been recorded yet".
    const deployedRow = deployed.known ? [{ deployedUsd: deployed.value }] : [];

    return defineChart({
      marks: [
        // WAITING FIRST, SO SOLID PAINTS OVER IT at the shared junction rung.
        //
        // STILL `lineY` AFTER THE SWAP: `lineY` means "y as a function of x", which is
        // exactly the new reading — price at each level of committed capital. Only the
        // channels moved.
        lineY(dashed, {
          x: "cumulativeUsd",
          y: "priceUsd",
          stroke: "var(--muted)",
          strokeWidth: 1.5,
          strokeDasharray: WAITING_DASH,
        }),
        lineY(solid, {
          x: "cumulativeUsd",
          y: "priceUsd",
          stroke: "var(--pos)",
          strokeWidth: 1.75,
        }),
        // THE "NOW" RULE, AND THE LABEL THAT SAYS WHAT IT IS. HORIZONTAL, at the spot
        // price — `ruleY` now, because price is the vertical axis and a last-price mark
        // that does not run across the price levels is not a last-price mark. `ruleY`
        // carries no label channel in 0.11.0, so the annotation is a composed `text` mark
        // at the same semantic y — the library's documented pattern, not a workaround.
        //
        // SOLID, AND IN ITS OWN COLOUR. It used to be a white DASHED rule standing next
        // to a grey DASHED path, which is the worst pairing in the picture: the same
        // stroke style meaning two unrelated things. Now the only dashed thing on the
        // chart is "waiting", and `--now` belongs to nothing else.
        ruleY(spotRow, {
          y: "priceUsd",
          stroke: "var(--now)",
          strokeWidth: 1.5,
        }),
        text(spotRow, {
          // A CONSTANT HAS TO BE AN ACCESSOR HERE. `text.x` takes only a channel in
          // 0.11.0, unlike `barY.y1`/`y2`, which also accept a bare number.
          x: () => xEnd,
          y: "priceUsd",
          text: () => spotMark!.label,
          fill: "var(--now)",
          fontSize: 10,
          // END-ANCHORED AT THE RIGHT EDGE, where a trading chart prints its last price.
          // The label runs back into the plot from there rather than off it.
          anchor: "end",
          dy: spotMark?.dy ?? -4,
        }),
        // THE DEPLOYED RULE — VERTICAL, ON THE CAPITAL AXIS.
        //
        // WHY THIS MARK MIXES TWO QUANTITIES, AND WHAT THAT COSTS THE READER. The axis it
        // stands on is CUMULATIVE DECLARED capital — an INTENTION, the sizes the operator
        // wrote down. `deployed` is MEASURED: what the fund actually spent, off recorded
        // lots. Both are USD committed to this ladder, and "how far along the declared
        // path am I really" is the question this card exists to answer, so putting them on
        // one axis is defensible — but it is NOT self-evident, and the next reader will
        // otherwise assume this rule sits exactly where the solid path becomes dashed.
        //
        // IT GENERALLY WILL NOT. That junction is the last FILLED rung's DECLARED
        // cumulative; this rule is the measured spend. They coincide only when every
        // filled rung filled in full at its declared size. A rule to the LEFT of the
        // junction means the fund spent less than it declared for the rungs it walked; to
        // the RIGHT, more. Neither is an error, and neither is readable off the picture
        // without knowing that these are two different kinds of number.
        ruleX(deployedRow, {
          x: "deployedUsd",
          stroke: "var(--pos)",
          // THINNER THAN THE "NOW" RULE, AT THE SAME OPACITY (0.5 is the library's own
          // rule default, which is what the now-rule renders at). Deployed is a standing
          // fact about the past; "now" is the mark the operator is reading the chart
          // against, and it must stay the loudest annotation on the picture.
          strokeWidth: 1.25,
          strokeOpacity: 0.5,
        }),
        text(deployedRow, {
          x: "deployedUsd",
          // WHERE IT MEETS THE AXIS — the bottom of the price domain, nudged up so the
          // word sits inside the plot rather than in the tick gutter.
          y: () => yLow,
          text: () => "Deployed",
          fill: "var(--pos)",
          fontSize: 10,
          anchor: "start",
          dx: 4,
          dy: -4,
        }),
        // HOLLOW DOTS, FILLED WITH THE CARD'S OWN BACKGROUND, so the line reads through
        // the ring rather than being interrupted by a blob. Two marks rather than one
        // because `dot.stroke` is a flat string in 0.11.0, not a per-datum channel — so
        // a ring's colour has to come from which mark drew it.
        //
        // THE RING'S SIZE IS THE RUNG'S SIZE — `r` IS a per-datum channel in 0.11.0, so
        // unlike `stroke` it needs no splitting. `rScale` is deliberately unused: the
        // radius arrives pre-computed by `withRadius`, which is where the √ and the
        // normalization are written down and argued for rather than inherited from a
        // library default.
        dot(
          points.filter((point) => !point.filled),
          {
            x: "cumulativeUsd",
            y: "priceUsd",
            key: "key",
            r: "radiusPx",
            fill: "var(--card)",
            stroke: "var(--muted)",
            strokeWidth: 1.5,
          },
        ),
        dot(
          points.filter((point) => point.filled),
          {
            x: "cumulativeUsd",
            y: "priceUsd",
            key: "key",
            r: "radiusPx",
            fill: "var(--card)",
            stroke: "var(--pos)",
            strokeWidth: 1.75,
          },
        ),
        // SELECTION IS THE MOST LEGIBLE MARK ON THE CHART, because it is the only one
        // tied to live UI state — it moves as the operator works the inspect slider, and
        // a mark you have to hunt for cannot do that job. It was a small white disc
        // among hollow white rings, which is nearly the same picture twice.
        //
        // TWO MARKS MAKE ONE TARGET. The halo is the card's own background, punching a
        // clear hole in the line and the ring underneath so the disc lands on empty
        // space instead of on top of stroke; the disc then reads as solid where every
        // other rung is hollow. Still a disc-versus-ring distinction, so it never
        // recolours a rung and cannot overwrite whether that rung filled.
        //
        // BOTH RADII ARE NOW THE SELECTED RUNG'S OWN, OFFSET — not the fixed 8/5.5 pair
        // they were while every ring was 3.5. Fixed sizes were a second, contradictory
        // size encoding the moment rings started carrying one: selecting the shallowest
        // rung would have INFLATED it past the deepest, so the slider would appear to
        // change how big a buy is. Offsetting instead keeps the selected rung the size
        // it is and makes selection read as fill, which is a channel the picture has
        // not otherwise spent.
        dot(selected, {
          x: "cumulativeUsd",
          y: "priceUsd",
          key: "key",
          r: (point: RungPoint) => point.radiusPx + 4,
          fill: "var(--bg)",
          stroke: "var(--bg)",
          strokeWidth: 2,
        }),
        dot(selected, {
          x: "cumulativeUsd",
          y: "priceUsd",
          key: "key",
          r: (point: RungPoint) => point.radiusPx + 1,
          fill: "var(--text)",
          stroke: "var(--bg)",
          strokeWidth: 1.5,
        }),
      ],
      x: {
        scale: xScale,
        axis: {
          // NOT "deployed capital", however the mock words it. Deployed is what the fund
          // actually SPENT, and it is a measured figure on the header card that is absent
          // until a fill is recorded. This axis plots the size the operator DECLARED,
          // which on an unwalked ladder is money that has not moved. Naming it "deployed"
          // would print a measurement where there is only an intention — and this axis
          // reaches the ladder's FULL total at the deepest rung, so on day zero
          // "deployed" would claim the whole ladder had been spent.
          //
          // "CUMULATIVE" because the value at a rung is the running total of every rung
          // at or above it, not that rung's own size — see `cumulate`. Dropping the word
          // would make the reader measure a single rung against a total-sized axis.
          //
          // THIS WORDING CARRIES MORE WEIGHT SINCE THE SWAP, because a rule literally
          // labelled `Deployed` now stands on this same axis — see that mark for why a
          // measured figure is allowed to sit on a declared axis, and why the two are
          // not the same number.
          label: "Cumulative declared capital (USD)",
          ticks: { format: (value: number) => COMPACT_USD.format(value) },
        },
      },
      y: {
        scale: yScale,
        // GRIDLINES ON PRICE, because a trading chart is read off horizontal price
        // levels: the whole point of the swap is that a rung is now a height.
        grid: true,
        axis: {
          // NO LABEL, DELIBERATELY — unlike the x axis above, which keeps its own.
          //
          // "Price (USD)" was the one caption on this chart that told the reader nothing
          // the ticks beside it did not already say: `$47.5K` running up the left edge of
          // a chart on a trading surface is a price in dollars by every convention the
          // reader arrives with. The x axis is the opposite case — "cumulative declared
          // capital" is a quantity nobody can infer from `$120K`, and it is doing real
          // work distinguishing declared from deployed. One label earns its ink; the
          // other was a rotated column of pixels spent restating the axis it sat on.
          //
          // MOVING IT — to a heading over the chart — was the alternative considered and
          // dropped: it frees the same horizontal strip but spends a whole line of
          // vertical space to do it, on the axis this 5:4 box has least of.
          ticks: { format: (value: number) => COMPACT_USD.format(value) },
        },
      },
      // See this file's header: the chart is presentation, so it mounts no interaction.
      focus: false,
      pointer: false,
      keyboard: false,
      tooltip: false,
    });
  }, [rungs, selectedKey, spotUsd, deployed]);

  const anyFilled = rungs.some((rung) => rung.filled);

  return (
    // THE WRAPPER IS WHAT HIDES IT — chart AND legend. `ariaLabel` below is a required
    // prop of the adapter and cannot be omitted; `aria-hidden` here hides the whole
    // subtree including it. See this file's header for why the legend is hidden too.
    <div className="fp-chart" aria-hidden="true">
      <Chart
        definition={definition}
        aspectRatio={ASPECT_RATIO}
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
