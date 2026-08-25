import { useMemo } from "react";
import { defineChart, dot, lineY, ruleX, ruleY, text } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { Chart } from "@tanstack/charts/react";
import {
  COMPACT_USD,
  cumulate,
  deployedMarkFor,
  splitAt,
  spotMarkFor,
  withRadius,
  type DeployedMark,
  type RungPoint,
} from "./price-drop-path";

/**
 * A measured figure, or the named reason there is none. Never a zero standing in.
 *
 * DECLARED HERE, IMPORTED BACK BY `apps/web` (spec #439 §4.1). The type belongs to the
 * component that renders it, and the `known: false` arm carrying a CAUSE rather than a
 * zero is the whole of it: the deployed rule below reduces the figure to its PRESENCE
 * before handing it to `deployedMarkFor`, because a reason is a view concept and the
 * pure module has no business with it. A figure that arrived as `0` instead would draw
 * a rule at the left edge and claim the fund had measurably spent nothing.
 */
export type MeasuredFigure =
  | { known: true; value: number }
  | { known: false; why: string };

/**
 * THE TWO WIRE AXES, SPELLED RATHER THAN IMPORTED.
 *
 * `apps/web`'s `projection/contract.ts` declares `DcaWireVenueAxis` and
 * `DcaWireBookAxis`, and it does not move — a package that imported them would import
 * `apps/web`. Spelling them here is not a silent drift risk: `composeFillPathPage`
 * assigns the wire's own axis values into a `FillPathRungView`, so a fifth venue axis
 * added to the contract stops that assignment compiling, in `apps/web`, on the function
 * whose author has to decide what the picture says about it.
 */
type WireVenueAxis = "not-placed" | "resting" | "partly-filled" | "filled";
type WireBookAxis = "not-recorded" | "partly-recorded" | "recorded";

/** One rung, decided. Every flag below is a fact the component renders, not re-derives. */
export interface FillPathRungView {
  /** The wire's own rung id where there is one; otherwise a positional stand-in. */
  key: string;
  /** 1-based position AS RENDERED, counting down the ladder. Not the plan's rung id. */
  ladderIndex: number;
  priceUsd: number;
  sizeUsd?: number;
  /**
   * THE STATE WORDS, AUTHORED ON THIS SIDE — `rungStateCopy`'s output, from the two axes
   * (see `apps/web`'s `ladder/rung-state-copy.ts` for why the engine's `label` is not
   * read here).
   *
   * IT IS COPY, AND NOTHING BRANCHES ON IT. Every component that used to compare it now
   * reads a fact beside it — `venueResting`, `notPlaced`, `filledPercent`. The field is
   * named for what it is so that a comparison against it reads as the mistake it is.
   */
  stateCopy: string;
  venueAxis?: WireVenueAxis;
  bookAxis?: WireBookAxis;
  /**
   * THE VENUE FILLED THIS RUNG — decided here, and nowhere else on the web side.
   *
   * This is the one state the fill path's three-colour key turns on: the solid segment,
   * the filled dot, the `Filled` legend entry and the tinted row all read it, and a
   * picture that disagreed with its own legend about which rung filled would be the
   * surface contradicting its own caption. `venueAxis === "filled"` was spelled at six
   * sites before this field existed; it is now spelled once, by `venueFilled`.
   *
   * `venueAxis` IS OPTIONAL ON THIS CONTRACT, AND ITS ABSENCE MEANS NEVER PLACED
   * (absence rule 1) — so the undefined arm is `false`. A rung no order ever joined has
   * not filled, and neither has a rung whose fill state is unavailable: `true` here is
   * only ever the venue's own positive statement, never an inference from a gap.
   */
  filled: boolean;
  /** No order ever joined this rung — absence rule 1. */
  notPlaced: boolean;
  /** An order is still claiming capital at the venue for this rung. */
  resting: boolean;
  /**
   * THE VENUE IS HOLDING AN ORDER AND HAS CONSUMED NOTHING — `venueAxis === "resting"`,
   * decided here, and the FACT the two components branch on where they used to compare
   * the engine's `waiting` literal.
   *
   * NOT THE SAME QUESTION AS `resting` ABOVE, and the pair is why this field exists.
   * `resting` is "the order still claims capital", which a PARTLY FILLED rung also does;
   * this is "the venue has said nothing about it yet", which is the ladder's ordinary
   * state and the one the surface prints as an empty state column. Suppressing on
   * `resting` would blank the column on a rung that is 40% filled.
   *
   * Absence of `venueAxis` is `false`, both times: a rung no order joined is not resting,
   * and a rung whose fill state is unavailable is not a rung the venue is holding.
   */
  venueResting: boolean;
  /** Unfilled at the venue: what `waitingDeclaredUsd` is summed over. */
  waiting: boolean;
  /** SPOT-DEPENDENT: the first rung a falling price would reach. */
  isNext: boolean;
  /** SPOT-DEPENDENT: resting, and price has already traded through it. */
  pricePassedUnconfirmed: boolean;
  /** The venue says filled; the book has no lot for it. A call to action. */
  filledAtVenueNotRecorded: boolean;
  /**
   * The join was inferred (`joinProvenance === "price-matched"`), not declared.
   *
   * NOTHING RENDERS THIS, AND THAT IS DELIBERATE (M5.3, spec #302 §5). This doc used to
   * call it "the surface showing its own confidence", which read as a claim that the rung
   * list draws it; `RowState`'s own header, written in the same commit, says the opposite
   * and is the one that is true — a price-matched join is how a limit ladder NORMALLY
   * reconciles, so marking it marked the ordinary case with nothing to compare against.
   * What the mark was guarding survives as `declaredPriceMismatch` on the inspect card.
   *
   * THE FIELD STAYS ANYWAY (D7, standing AAR call): it is a decided conclusion the UI has
   * chosen not to draw, and unpicking a view module for a presentation call would be the
   * wrong layer to edit. A reader looking for its render site should stop looking.
   */
  matchedByPrice: boolean;
  /** A declared join whose order sits at a different price. Honored, and flagged. */
  placedAtUsd?: number;
  /** MEASURED `consumed / placed` as whole percent — only on a partly-filled rung. */
  filledPercent?: number;
}

/**
 * THE PRICE DROP PATH, DRAWN BY TANSTACK CHARTS (ADR-018).
 *
 * ── THIS FILE IS MARKS AND A DEFINITION; THE ARITHMETIC IS NEXT DOOR ─────────────────
 * Every quantity the picture stands on — the running total, the ring radius, the split
 * index, the now rule's clamp and the one compact-USD formatter — lives in
 * `./price-drop-path`, which is pure, coverage-visible and tested. Read that module for
 * WHY each number is the number it is, and for the three preconditions this component's
 * props are required to satisfy (a plottable ladder, LIVE-only spot, rungs descending by
 * price). What is left here is which mark draws what, and why.
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
 *  The wrapper caps the width (`CHART_BOX` below) so the ratio cannot turn a wide desktop
 *  card into a half-viewport-tall chart. The cap belongs on the wrapper rather than here
 *  because it is a layout bound, not a property of the chart. */
const ASPECT_RATIO = 1.25 / 1;

/**
 * THE MEASURED WRAPPER, AS UTILITIES (spec #420 slice 9).
 *
 * THE CAP IS WHAT KEEPS THE RATIO SANE. The chart's height is derived from its measured
 * width (`ASPECT_RATIO` above), so width and height cannot be tuned independently:
 * uncapped on the 760px column, the same 5:4 box that reads well on a phone becomes a
 * 550px-tall chart. Centred, so it does not read as left-weighted on a wide screen.
 * 500px rather than the 360px it shipped with: capping near the phone width left the desk
 * rendering a phone-sized picture in the middle of a wide card, and this chart's whole
 * subject is the SHAPE of a curve. The phone never reached either cap.
 *
 * THE WRAPPER'S TEXT COLOUR IS THE CHART'S WHOLE THEME, not a label colour, and the
 * secondary-text grey below is set for that job rather than for any type on screen.
 * TanStack Charts paints its axes, ticks, grid and titles with `currentColor` rather than
 * shipping a palette, so the wrapper's colour is what makes the guides legible;
 * `text-[10px]` is the tick size for the same reason. The role is named here and not the
 * spelling: a docblock that pins a class string is a docblock that goes stale on the next
 * rename, and the argument is about `currentColor` and guide legibility, which no
 * spelling changes. Per-mark paint is named below, from the same namespace.
 *
 * THE CLASS NAME STAYS AND THE RULE DOES NOT. `fp-chart` selects nothing in `styles.css`
 * any more; it is the hook `fill-path-chart-a11y.test.tsx` and the selection tests query
 * the wrapper by, and deleting it would take a presentation contract's only handle with
 * it.
 */
const CHART_BOX =
  "block w-full max-w-[500px] mx-auto text-[10px] text-[var(--nms-muted-foreground)]";

/**
 * THE KEY TO THE PICTURE, AS UTILITIES. The `<ul>` carries the UA's own list padding and
 * block margin with preflight off, so `m-0 p-0` are load-bearing and `mt-1.5` is the one
 * edge the deleted rule set. The two gap axes differ (`gap: 4px 14px`) and are spelled
 * apart for that reason.
 */
const LEGEND =
  "m-0 mt-1.5 flex flex-wrap gap-x-[14px] gap-y-1 p-0 list-none" +
  " text-[0.72rem] text-[var(--nms-muted-foreground)]";
const LEGEND_ENTRY = "flex items-center gap-1.5";
/**
 * EACH SWATCH IS A TOTAL MAP, not a base plus two overrides.
 *
 * The deleted rules were a base swatch and three modifiers that repainted it — a cascade
 * an unlayered stylesheet could express and a class string cannot, since two unvariant
 * utilities on one property are resolved by Tailwind's emitted order rather than by the
 * order they are written in. So colour and border style are named on every entry and
 * there is no override left to lose.
 *
 * IT IS A TOP BORDER AND NOT A BOX, which is what lets the key draw a RULE — a dashed
 * one, a solid one, a coloured one — rather than the colour chips a chart library's own
 * legend is limited to. `now` stays distinguishable from `waiting` on colour and on
 * solidity rather than on angle: the now rule is HORIZONTAL in the picture, because price
 * is the y axis and spot is a price LEVEL the way a trading chart draws last price, and
 * this swatch turned with it.
 *
 * THE STYLE IS A LONGHAND, AND `border-dashed` WOULD BE A BUG. `border-solid` and
 * `border-dashed` set `border-style` on ALL FOUR sides, and with preflight off nothing
 * has zeroed the UA's `border-width: medium` on the other three — a width that renders
 * only once a style makes it visible. Measured in Chrome: the shorthand turned each
 * swatch from an 18×2 rule into an 18×5 box with a 3px grey edge down three sides, in
 * `currentColor` rather than in the swatch's own colour, at both 320px and desktop. The
 * per-edge arbitrary property is the same idiom `WARN_INFERRED` in `FillPath.tsx` uses,
 * and for the same reason.
 */
const SWATCH = "w-[18px] border-t-2";
const SWATCH_FILLED = `${SWATCH} [border-top-style:solid] border-t-[var(--nms-pos)]`;
const SWATCH_WAITING =
  `${SWATCH} [border-top-style:dashed] border-t-[var(--nms-muted-foreground)]`;
const SWATCH_NOW = `${SWATCH} [border-top-style:solid] border-t-[var(--nms-now)]`;

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

    // THE DEPLOYED RULE, DECIDED NEXT DOOR — where it draws, whether it was clamped, and
    // what the label is then allowed to say. Only the figure's PRESENCE crosses over: the
    // absent arm of a `MeasuredFigure` carries a REASON, which is a view concept and not
    // the pure module's business, so it becomes `undefined` here and the mark refuses
    // itself. See `deployedMarkFor` for why a measured figure may sit on a declared axis,
    // why an out-of-domain one is pinned rather than dropped, and why the pinned label is
    // the only one carrying a number.
    const deployedMark = deployedMarkFor(
      deployed.known ? deployed.value : undefined,
      { xStart: xScale.domain()[0], xEnd, yLow, yHigh },
    );
    const deployedRow = deployedMark === undefined ? [] : [deployedMark];

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
          stroke: "var(--nms-muted-foreground)",
          strokeWidth: 1.5,
          strokeDasharray: WAITING_DASH,
        }),
        lineY(solid, {
          x: "cumulativeUsd",
          y: "priceUsd",
          stroke: "var(--nms-pos)",
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
        // chart is "waiting", and the spot colour belongs to nothing else.
        ruleY(spotRow, {
          y: "priceUsd",
          stroke: "var(--nms-now)",
          strokeWidth: 1.5,
        }),
        text(spotRow, {
          // A CONSTANT HAS TO BE AN ACCESSOR HERE. `text.x` takes only a channel in
          // 0.11.0, unlike `barY.y1`/`y2`, which also accept a bare number.
          x: () => xEnd,
          y: "priceUsd",
          text: () => spotMark!.label,
          fill: "var(--nms-now)",
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
        //
        // AND BECAUSE THE MEASUREMENT CAN EXCEED THE INTENTION, the position is clamped and
        // the clamp is said out loud — `deployedMarkFor` decides `x`, `y`, the label and
        // every nudge, so no arm of this mark can leave the plot the way it used to. There
        // is no branch here: the marks read what the module decided.
        //
        // NEUTRAL INK, NOT THE FILLED GREEN. This rule used to be drawn in the SAME green
        // as the filled path, the filled dot, the `Filled` legend swatch and the filled row
        // tint — a fifth job for a colour whose one job is "this rung filled". The picture
        // and the list share exactly THREE state colours (`--nms-pos` filled,
        // `--nms-muted-foreground` waiting, `--nms-now` where price is) and add no fourth,
        // so `Deployed` cannot have a hue at all without either inventing a state or
        // borrowing one. It takes `--nms-foreground` instead: the chart's non-state ink,
        // already spent on the selection disc for the same reason, brighter than the guides
        // it must not be mistaken for, and theme-defined rather than a literal, so it stays
        // legible wherever the palette goes. The rule is a MEASUREMENT the chart annotates
        // itself with, and neutral ink is what that reads as.
        ruleX(deployedRow, {
          x: "x",
          stroke: "var(--nms-foreground)",
          // THINNER THAN THE "NOW" RULE, which stays the loudest annotation on the picture
          // at 1.5px in a saturated hue: deployed is a standing fact about the past, "now"
          // is the mark the operator reads the chart against.
          //
          // THE OPACITY IS SET AGAINST THE AXIS SPINE, NOT PICKED. `--nms-foreground` is
          // the brightest token in the palette, so it needs holding back — but the first
          // attempt (0.4) landed it DIMMER than the spines and gridlines the library draws
          // in `currentColor`, and a mark quieter than the frame it stands in
          // reads as part of the frame. 0.7 puts it just past the spine: unmistakably a
          // drawn mark, still plainly quieter than the now rule and the selection disc.
          strokeWidth: 1,
          strokeOpacity: 0.7,
        }),
        text(deployedRow, {
          x: "x",
          // THE HEIGHT IS THE MODULE'S CALL, NOT A CONSTANT — the bottom of the plot where
          // the rule meets its axis, the top when the rule was pinned to the right edge
          // and the bottom-right corner is already a spot label's. Same for `anchor`,
          // `dx` and `dy`: all three are per-datum channels in 0.11.0, so the decision
          // travels on the mark instead of being re-made here.
          y: "y",
          text: (mark: DeployedMark) => mark.label,
          fill: "var(--nms-foreground)",
          fontSize: 10,
          fontWeight: 600,
          anchor: (mark: DeployedMark) => mark.anchor,
          dx: (mark: DeployedMark) => mark.dx,
          dy: (mark: DeployedMark) => mark.dy,
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
            fill: "var(--nms-card)",
            stroke: "var(--nms-muted-foreground)",
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
            fill: "var(--nms-card)",
            stroke: "var(--nms-pos)",
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
          fill: "var(--nms-background)",
          stroke: "var(--nms-background)",
          strokeWidth: 2,
        }),
        dot(selected, {
          x: "cumulativeUsd",
          y: "priceUsd",
          key: "key",
          r: (point: RungPoint) => point.radiusPx + 1,
          fill: "var(--nms-foreground)",
          stroke: "var(--nms-background)",
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
  // THE SAME GATE, THE OTHER WAY ROUND. Every legend entry appears only when the thing
  // it explains is on screen (see the legend below), and a fully walked ladder has no
  // dashed segment: `splitAt` returns the last index, so the dashed slice is a single
  // point and the mark draws nothing. `Waiting` was printed unconditionally, so the
  // `overfilled` ladder captioned a colour absent from its own picture, beside a rung
  // list whose waiting total reads $0.00.
  const anyWaiting = rungs.some((rung) => !rung.filled);

  return (
    // THE WRAPPER IS WHAT HIDES IT — chart AND legend. `ariaLabel` below is a required
    // prop of the adapter and cannot be omitted; `aria-hidden` here hides the whole
    // subtree including it. See this file's header for why the legend is hidden too.
    <div className={`fp-chart ${CHART_BOX}`} aria-hidden="true">
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
      <ul className={LEGEND}>
        {anyFilled ? (
          <li className={LEGEND_ENTRY}>
            <span className={SWATCH_FILLED} />
            Filled
          </li>
        ) : null}
        {anyWaiting ? (
          <li className={LEGEND_ENTRY}>
            <span className={SWATCH_WAITING} />
            Waiting
          </li>
        ) : null}
        {spotUsd === undefined ? null : (
          <li className={LEGEND_ENTRY}>
            <span className={SWATCH_NOW} />
            Now
          </li>
        )}
      </ul>
    </div>
  );
}
