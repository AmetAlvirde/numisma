import { createContext, useContext, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { formatUsd } from "@numisma/engine/format";
import type {
  FillPathRungView,
  FillPathView,
  MeasuredFigure,
} from "../ladder/fill-path-view.ts";
import { COMPACT_USD } from "../ladder/price-drop-path.ts";
import { PriceDropPathChart } from "./PriceDropPathChart.tsx";
import { Absent } from "./ui/Absent.tsx";
import { Card, CARD_SURFACE } from "./ui/Card.tsx";
import { NOTICE_CODE } from "./ui/SnapshotNotice.tsx";

/**
 * THE FILL PATH, ON THE PHONE (spec #285 §5.6–5.13 / G-D10b, slice #289) — the declared
 * ladder rendered as a path partly walked.
 *
 * FOUR STACKED CARDS, in U's 320px rework's order: header figures → `Price Drop Path`
 * chart with its inspect slider → the selected-rung panel → the rung list. Stacked
 * rather than gridded because the surface is judged on a phone held in one hand; the
 * desk gets the same stack, wider.
 *
 * IT RENDERS DECIDED FACTS AND DECIDES NOTHING. Every flag, count, coordinate and
 * absence cause below arrives from `ladder/fill-path-view.ts`, which is where a test can
 * reach them. The only state that lives here is which rung the operator is inspecting,
 * which is a UI affordance and not a fact about the fund.
 *
 * ── `~` MEANS "THIS NUMBER IS NOT A MEASUREMENT" (G-D5c, restated) ──────────────────
 * There used to be a provenance footer whose first paragraph explained, in prose, which
 * figures on this page are exact and which are not. It is gone: the distinction now
 * travels ON each figure as a leading `~`, where the reader is already looking, instead
 * of in a paragraph three cards below the number it describes.
 *
 * A `~` is owed by exactly two kinds of figure, and by nothing else:
 *
 *   1. A PROJECTION — the two `Expectation` tiles, which are what the DECLARED ladder
 *      would acquire if it were walked. Nothing was measured to produce them.
 *   2. A ROUNDED RENDERING of a figure printed exactly elsewhere — the compact price
 *      span here, and the chart's own spot label. Both round hard enough to disagree
 *      with the exact figure on the same screen, and the `~` is what makes that a
 *      rounding rather than a contradiction.
 *
 * Everything measured (`Figure`) prints bare, and so does every DECLARED total: a rung
 * size and the waiting sum over rung sizes are exact statements of what the operator
 * wrote down. They are intentions rather than measurements, but they are not estimates,
 * and tilde-ing them would spend the mark's meaning on the wrong distinction — the one
 * the `Waiting` label already carries.
 *
 * ── EVERY ABSENCE IS RENDERED AND NAMED, AND NO `$0` IS REACHABLE ───────────────────
 * The three measured figures are ABSENT on the wire until a fill is recorded (G-D8),
 * not zero, so this file has no branch that could print `$0.00` for them: it is handed a
 * `MeasuredFigure` and the `known: false` arm carries a cause string, never a number.
 * The 0% progress bar stays, because a bar at zero reads as absence — which is the
 * truth — while a zero DOLLAR figure would read as a measurement.
 *
 * ── THE CHART IS PRESENTATION, NOT THE RECORD (§6.3) ────────────────────────────────
 * The chart is `aria-hidden`. Every per-rung fact it plots is in the rung list below
 * it, and the one thing only the picture carries — the shape of the capital curve — is
 * the generated caption beside it, from `ladder/convexity-caption.ts`. There is no
 * hand-maintained chart description here and there must never be one.
 *
 * It is drawn by `@tanstack/charts` as of the charts spike; `PriceDropPathChart` holds
 * the whole of that decision, including the four things that keep a library chart out
 * of the accessibility tree. This surface is unchanged by the swap.
 *
 * The inspect slider is NOT the only path to the selected-rung panel: every rung row is
 * a `<button>` that selects on click AND on focus, so tabbing down the ladder walks the
 * inspect panel with it. That is what makes inspection keyboard- and screen-reader-
 * reachable without the chart being involved at all.
 */

/**
 * ── THE HEADER CARD'S SECTION, AS UTILITIES (spec #420 slice 7) ──────────────────────
 *
 * `styles.css` opened the fill path with about three hundred lines covering this one
 * card: an identity row, a state chip, a spot reading, three tiles, a progress bar, the
 * waiting block, day zero's hero and TWO `@container fp-header` blocks reflowing most of
 * it at 380px. Every declaration in that section is now one of the strings below, and
 * `fill-path-header-section-deleted.test.ts` holds the other end.
 *
 * ── THE CONTAINER IS THE CARD, NOT THE VIEWPORT, AND KEEPS ITS ONE NAME ──────────────
 * `container: fp-header / inline-size` is a shorthand with a single name, which is
 * exactly what Tailwind's NAMED container utility emits, so `@container/fp-header` is a
 * literal translation here. The glance card's pair had to be split into a bare
 * `@container` plus an arbitrary `container-name` because the shorthand carries only
 * what it is given and that card needed two names; this one needed one.
 *
 * ── THE RAIL IS THE SHAPE, AND THREE BLOCKS SHARE IT ─────────────────────────────────
 * Spot, a tile and the waiting block are the SAME row at 320px — label left, figure hard
 * right, one line each — and all three turn into a stacked block at 380px of CARD width.
 * `RAIL` is that shared narrow form; each block adds what it alone declared. Composing
 * rather than repeating is what keeps the three from drifting apart at one edge, which is
 * what the deleted rules' shared selector lists were doing.
 *
 * ── WHERE A SHORTHAND SITS BESIDE ITS OWN LONGHAND ───────────────────────────────────
 * `m-0 mb-3` and `m-0 mt-1.5` are the preflight-off pattern every converted surface in
 * this app uses: the UA margins on `p` are live, so a rule that said `margin: 0 0 12px`
 * has to zero three edges and set one, and Tailwind sorts the shorthand ahead of the
 * longhand so the specific edge wins. Two utilities setting the SAME property would be a
 * coin toss instead — see `BADGE_TONE` below, which is a total map for that reason.
 */
const HEADER_CARD = "@container/fp-header";
const HEADER_TITLE = "m-0 text-[1.15rem] wrap-anywhere";
const HEADER_HEAD =
  "block @[380px]/fp-header:flex @[380px]/fp-header:flex-wrap @[380px]/fp-header:items-baseline @[380px]/fp-header:justify-between @[380px]/fp-header:gap-x-4 @[380px]/fp-header:gap-y-0";
const HEADER_ID =
  "flex flex-wrap items-baseline gap-x-2 gap-y-1 min-w-0 mb-[10px] @[380px]/fp-header:flex-[1_1_180px]";

/**
 * THE STATE, AS A TAG — a chip rather than bare text, because it sits beside a heading
 * and needs an edge to stop reading as part of the title.
 *
 * `border-current` IS THE WHOLE POINT OF SPLITTING THE COLOUR OUT. The deleted rule drew
 * `1px solid currentColor`, so the chip's edge is whatever its text is, and the three
 * tones below each move both at once.
 */
const BADGE =
  "flex-none rounded-[999px] border border-current px-[7px] py-[2px] text-[0.65rem] font-semibold uppercase leading-[1.4] tracking-[0.05em]";

/**
 * ONE COLOUR REACHES THE CHIP, AND WHICH ONE IS A FACT ABOUT THIS MAP.
 *
 * The deleted rules were a base that painted `--muted` and two overrides that repainted
 * it. As utilities that is a cascade this string cannot express: two unvariant `color`
 * utilities on one element are resolved by Tailwind's EMITTED order, not by the order
 * they are written in. A total map has no override to lose. `DcaCard`'s state word made
 * the same move for the same reason, and the semantics are deliberately identical —
 * `pending` is NOT an alarm colour, because a declared ladder awaiting its first fill is
 * the normal starting state; `unreadable` is the only one that wants the eye.
 */
const BADGE_TONE: Record<FillPathView["state"], string> = {
  pending: "text-[var(--muted)]",
  active: "text-[var(--pos)]",
  ended: "text-[var(--muted)]",
  unreadable: "text-[var(--warn)]",
};

/** The narrow row every data block on this card is: label left, figure hard right. */
const RAIL = "flex flex-wrap items-baseline justify-end gap-x-[10px] gap-y-0 m-0 min-w-0";

/**
 * THE LABEL IS THE ONLY THING THAT GIVES. `flex-[1_1_0]` — a ZERO basis, not `auto` — is
 * what makes "Expected average entry" wrap to two lines instead of shoving its figure
 * onto a line of its own: the label is prose and survives a break, the number is the
 * thing being aligned and must not leave the rail.
 */
const TILE_LABEL =
  "text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-[var(--muted)]";
const RAIL_LABEL = `${TILE_LABEL} flex-[1_1_0] min-w-0`;
/** Spot keeps its right alignment when the card reflows; the tiles turn left. */
const SPOT_LABEL = `${RAIL_LABEL} @[380px]/fp-header:flex-none`;
const STACKED_LABEL = `${SPOT_LABEL} @[380px]/fp-header:text-left`;

const TILE =
  `${RAIL} @[380px]/fp-header:flex-col @[380px]/fp-header:items-stretch` +
  " @[380px]/fp-header:justify-start @[380px]/fp-header:gap-x-0 @[380px]/fp-header:gap-y-[2px]";
const TILE_VALUE =
  "flex-none text-right text-[1.05rem] tabular-nums @[380px]/fp-header:text-left";
/**
 * An absent figure carries a CAUSE, and the cause is longer than any price. It wraps
 * under its em dash at the right rail rather than widening the row, and follows the tile
 * back to the left edge when the card reflows.
 */
const TILE_ABSENT =
  "flex-wrap justify-end text-right @[380px]/fp-header:justify-start @[380px]/fp-header:text-left";

/**
 * SPOT IS CONTEXT, NOT THE ANSWER. It reads in `--muted` like every other reference
 * figure on the card, which leaves Waiting as the one accented number.
 *
 * At 380px it becomes the corner figure again — label over value, right-aligned, no rule
 * under it — which is why the border and the padding both have an arm that removes them.
 */
const SPOT =
  `${RAIL} mb-3 pb-[10px] border-b border-b-[var(--line)]` +
  " @[380px]/fp-header:flex-col @[380px]/fp-header:items-end @[380px]/fp-header:gap-x-0" +
  " @[380px]/fp-header:gap-y-px @[380px]/fp-header:pb-0 @[380px]/fp-header:border-b-0" +
  " @[380px]/fp-header:text-right";
const SPOT_VALUE = "flex-none text-right text-[1.05rem] tabular-nums text-[var(--muted)]";
const SPOT_NOTE = "m-0 mt-1 text-[0.7rem] text-[var(--muted)]";
/** Spot's own reflow already right-aligns the block, so this one has no wide arm. */
const SPOT_ABSENT = "flex-wrap justify-end text-right";

/**
 * One column of rows at 320px; a real grid of tiles once the CARD is wide enough.
 *
 * `grid-cols-1` IS NOT LITERALLY THE DELETED `grid-template-columns: 1fr`, and here it
 * cannot differ. `1fr` is `minmax(auto, 1fr)`, whose automatic minimum is the item's
 * min-content contribution; `grid-cols-1` emits `repeat(1, minmax(0, 1fr))`, which has no
 * such floor. The two part company only when a tile's min-content exceeds the card
 * interior — measured in Chrome at 320px, with `min-width: auto` forced onto a tile and a
 * 363px unbreakable token in it: `1fr` grows the track to 363.008px, `minmax(0,1fr)`
 * holds 254px.
 *
 * Every tile carries `min-w-0`, which is `TILE`'s reproduction of the `min-width: 0` the
 * deleted `.fp-spot, .fp-tile` rule declared. That zeroes the automatic minimum, so the
 * `auto` half of `minmax(auto, 1fr)` was already 0 on the pre-slice tree. The
 * substitution is inert by construction, not merely unobserved: measured at 254px of card
 * interior the real tiles' widest min-content is 97.82px, and both track definitions
 * resolve to the same 254px track.
 */
const TILES =
  "grid grid-cols-1 gap-2" +
  " @[380px]/fp-header:grid-cols-[repeat(auto-fit,minmax(130px,1fr))] @[380px]/fp-header:gap-3";

/**
 * A BAR AT ZERO READS AS ABSENCE, which is the truth on day zero — so the track is always
 * drawn and the fill is allowed to be 0 wide. The fill's WIDTH stays an inline style: it
 * is a measurement, not a design decision, and there is no utility for "whatever fraction
 * this ladder happens to be at".
 */
const PROGRESS = "m-0 mb-[14px]";
const PROGRESS_TRACK = "h-1.5 overflow-hidden rounded-[3px] bg-[var(--line)]";
const PROGRESS_FILL = "h-full bg-[var(--pos)]";
const PROGRESS_NOTE = "m-0 mt-1.5 text-[0.78rem] text-[var(--muted)]";

/**
 * The measured-layout waiting block takes the SAME row shape as the tiles above it, with
 * its sentence breaking to a full-width line under both. `flex-[1_0_100%]` is what forces
 * that break, so the sentence never tries to share the rail with the number it explains.
 */
const WAITING =
  "flex flex-wrap items-baseline justify-end gap-x-[10px] border-t border-t-[var(--line)] pt-3" +
  " @[380px]/fp-header:flex-col @[380px]/fp-header:items-stretch" +
  " @[380px]/fp-header:justify-start @[380px]/fp-header:gap-y-[2px]";
const WAITING_SUB =
  "flex-[1_0_100%] m-0 mt-1 text-[0.78rem] text-pretty text-[var(--muted)]";

/**
 * DAY ZERO'S BLOCK — a headline figure and two quiet projections under it.
 *
 * THE HERO STEPS OUT OF THE RAIL, label above rather than beside: the rail is for the
 * reference rows and leaving it is half of what makes this figure read first. The other
 * half is size — `--muted` alone lost to the projections, whose strings are simply
 * longer, so the projections step DOWN in size as well as being muted.
 */
const EXPECTED = "mb-[14px]";
const HERO = "flex flex-col gap-px mb-3";
const HERO_VALUE =
  "text-[1.75rem] font-bold leading-[1.15] tracking-[-0.01em] tabular-nums";
/**
 * A PROJECTION READS QUIETER THAN A MEASUREMENT, in two ways at once. `--muted` is the
 * colour every other unmeasured thing on this page already uses, and 0.95rem is the step
 * down `.fp-tiles-quiet .fp-tile-value` used to make. That rule was a CONTEXT — a
 * descendant selector on the wrapper — and it collapses into this one string because
 * `Expectation` is the only thing that ever rendered inside that wrapper. Both sizes are
 * spelled once, never as a base plus an override: `TILE_VALUE`'s 1.05rem and this
 * 0.95rem are unvariant `font-size` utilities and would race each other on one element.
 */
const EXPECTED_VALUE =
  "flex-none text-right text-[0.95rem] tabular-nums text-[var(--muted)] @[380px]/fp-header:text-left";

/** One measured tile: the figure, or the named reason there is none. Never a `$0`. */
function Figure({
  label,
  figure,
  render = formatUsd,
}: {
  label: string;
  figure: MeasuredFigure;
  render?: (value: number) => string;
}) {
  return (
    <div className={TILE}>
      <span className={STACKED_LABEL}>{label}</span>
      {figure.known ? (
        <strong className={TILE_VALUE}>{render(figure.value)}</strong>
      ) : (
        <Absent why={figure.why} className={TILE_ABSENT} />
      )}
    </div>
  );
}

/**
 * ONE PROJECTED TILE. Deliberately NOT `<Figure>`: it takes a bare number, because an
 * expectation is not a `MeasuredFigure` and must never reach a slot that promises one.
 * The label carries "Expected" for the operator; the separate component and the separate
 * type carry it for the next person editing this file.
 *
 * THE `~` IS PRINTED HERE AND NOT PASSED IN, so it cannot be forgotten at a call site.
 * This is the component that renders projections, so every projection wears the mark by
 * construction — see this file's header for what the mark claims.
 */
function Expectation({
  label,
  value,
  render = formatUsd,
}: {
  label: string;
  value: number;
  render?: (value: number) => string;
}) {
  return (
    <div className={TILE}>
      <span className={STACKED_LABEL}>{label}</span>
      <strong className={EXPECTED_VALUE}>~{render(value)}</strong>
    </div>
  );
}

/** Units render to 8 places at most — a satoshi is the smallest thing there is. */
function formatUnits(value: number): string {
  return `${value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} BTC`;
}

/**
 * ── SEAM E: ONE SELECTION, FOUR CARDS, AND THE PROVIDER THAT OWNS BOTH ITS SHAPES ────
 *
 * Everything the four parts share. `view` rides along with the selection because a part
 * that reads its selection from context and its data from a prop is still a part its
 * parent has to assemble, and assembling it was the coupling this seam deleted.
 *
 * THE PROVIDER OWNS THE KEY↔INDEX TRANSLATION, WHICH IS THE WHOLE POINT (grill D3). The
 * chart is a `<input type="range">` and a range is an INDEX — that is not a modelling
 * choice, it is what the element is. The rung list is a list of keyed rungs. Selection
 * therefore has two natural spellings and something has to reconcile them; before this
 * slice it was `FillPathCards`' JSX, translating index to key on the way down and key to
 * index on the way back, which is why the two cards took two different prop pairs. Now
 * exactly one module converts, both directions are next to each other, and each part asks
 * in the only terms it has.
 *
 * `selectIndex` IS INTERNAL AND `select` IS NOT. `useFillPathSelection` — the published
 * hook, spec #403 Seam E — hands out `select(key)` and nothing else, because a key is the
 * stable identity of a rung and an index is an artifact of the slider. The index setter
 * stays inside this file, used by the one part that has an index to give.
 */
type FillPathSelection = {
  view: FillPathView;
  selected: FillPathRungView | undefined;
  selectedIndex: number;
  select: (key: string) => void;
  selectIndex: (index: number) => void;
};

const SelectionContext = createContext<FillPathSelection | undefined>(undefined);

/** The context, or a loud failure. Read by the parts; never exported. */
function useFillPath(): FillPathSelection {
  const selection = useContext(SelectionContext);
  if (selection === undefined) {
    // A part mounted outside the provider would otherwise render an empty card and look
    // like a data problem. It is a composition problem, and it says so.
    throw new Error("a fill-path part was rendered outside `FillPathProvider`");
  }
  return selection;
}

/**
 * THE ONE PIECE OF STATE ON THIS PAGE: which rung the operator is inspecting. It is a UI
 * affordance and not a fact about the fund, which is why it lives here and every other
 * value on the page arrives already decided from `ladder/fill-path-view.ts`.
 *
 * STATE AND DERIVATION, AND NO EFFECT. The default — the rung price will reach next,
 * falling back to the top of the ladder when there is no live spot — is derived on every
 * render from the view rather than written into state when the view arrives. An effect
 * that seeded state from a prop would render one frame with the wrong rung selected and
 * would need a second effect to notice the view changing underneath it.
 */
export function FillPathProvider({
  view,
  children,
}: {
  view: FillPathView;
  children?: ReactNode;
}): ReactElement {
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);

  const fallback = view.rungs.find((rung) => rung.isNext) ?? view.rungs[0];
  const selected =
    view.rungs.find((rung) => rung.key === selectedKey) ?? fallback;
  const selectedIndex = selected
    ? view.rungs.findIndex((rung) => rung.key === selected.key)
    : 0;

  return (
    <SelectionContext.Provider
      value={{
        view,
        selected,
        selectedIndex,
        select: setSelectedKey,
        // THE OTHER HALF OF THE TRANSLATION, and the only place it is spelled. An index
        // past the end selects nothing rather than throwing: a range whose `max` and
        // whose rung count disagree is a bug, but not one worth crashing the page over.
        selectIndex: (index) => setSelectedKey(view.rungs[index]?.key),
      }}
    >
      {children}
    </SelectionContext.Provider>
  );
}

/**
 * WHAT A PART KNOWS ABOUT THE SELECTION (spec #403 Seam E). The chart reads
 * `selectedIndex`, the list reads `selected` and calls `select`, and neither one asks a
 * parent to convert between them.
 *
 * ── ITS ONLY CONSUMER TODAY IS ITS TEST, AND THAT IS THE CHOICE, NOT AN OVERSIGHT ────
 * The four parts below read `useFillPath` instead. Not because this shape is wrong for
 * them, but because it is deliberately NARROWER than any of them needs: every part also
 * reads `view` — the card that is the page's title, the panel that counts rungs, the list
 * that renders them — and `Chart` needs `selectIndex` as well. A part consuming this hook
 * would call the internal one beside it for the rest, which is two reads of one context
 * to satisfy a signature.
 *
 * The alternative was to delete it and let Seam E be `useFillPath` until the workbench
 * needs the narrow shape. It stays because the shape is the seam's stated contract: what
 * a component outside this module is allowed to know about the selection is these three
 * fields and NOT `view`, which is exactly the boundary the workbench's fixtures will
 * mount against. Publishing the narrow surface is what keeps `view` from leaking into the
 * next consumer's props by default.
 *
 * What that costs — a published surface with no in-tree caller — is paid off in
 * `fill-path-selection.test.tsx`, which exercises it as a consumer would: the exact three
 * fields, and a selection made through `select` that the parts mounted beside it see.
 */
export function useFillPathSelection(): {
  selected: FillPathRungView | undefined;
  selectedIndex: number;
  select: (key: string) => void;
} {
  const { selected, selectedIndex, select } = useFillPath();
  return { selected, selectedIndex, select };
}

/**
 * THE PARTS, ATTACHED AS PLAIN PROPERTIES AND NAMED-EXPORTED (grill D4, the same shape
 * `Card` uses). `FillPath.RungList` is the call-site vocabulary; the named exports are
 * what a per-part test mounts on its own, which is how each card's half of the
 * accessibility contract is asserted without its three siblings standing in for it.
 *
 * There is no `FillPath` component: the fill path is a composition, and the composition
 * with the house arrangement already has a name — `FillPathCards`, below.
 */
export const FillPath = {
  Header,
  Chart,
  SelectedRung,
  RungList,
} as const;

/**
 * THE HOUSE ARRANGEMENT, and the only thing the ladder route mounts. Its name and its
 * single `view` prop are unchanged across this conversion, which is what keeps
 * `routes/ladder.$planId.tsx` out of the diff (grill D2).
 *
 * SIX CHILDREN, FOUR OF THEM PARTS. The torn-act banner and the unrecorded warnings are
 * not cards and coordinate nothing — they read the view and render or return null — so
 * they stay internal to this composition rather than being published as parts nobody
 * would arrange differently.
 */
export function FillPathCards({ view }: { view: FillPathView }): ReactElement {
  return (
    <FillPathProvider view={view}>
      <TornActBanner view={view} />
      <FillPath.Header />
      <UnrecordedWarnings view={view} />
      <FillPath.Chart />
      <FillPath.SelectedRung />
      <FillPath.RungList />
    </FillPathProvider>
  );
}

/**
 * ABOVE EVERYTHING, AND RED (G-D7/G-D12). The copy states the literal truth rather than
 * a severity: `record-fill` REFUSES to record anything while a torn act is outstanding,
 * so the operator is not being warned, they are being told why the next thing they try
 * will not work.
 *
 * ABSENCE IS NOT THE ALL-CLEAR (absence rule 3). A row that could not check says so, in
 * a quiet line — silence there would claim a check that never ran.
 */
/**
 * THE ONE CARD-SURFACED ELEMENT THAT SPELLS THE SURFACE ITSELF (spec #420 slice 8).
 *
 * Everything else that is painted like a card imports `CARD_SURFACE` and adds to it. This
 * banner cannot, because the deleted rule repainted the border: the shared string carries
 * `border-[var(--line)]` and the banner's edge is `--neg`, and two unvariant
 * `border-color` utilities on one element are resolved by Tailwind's EMITTED order rather
 * than by the order they are written in. That is the same cascade `BADGE_TONE` is a total
 * map to avoid, one property along. Written out once, with the border it actually wants.
 *
 * SPELLING THE SURFACE OUT DOES NOT BUY OUT THE DESCENDANT RULES. `.notice code` reached
 * the `<code>` in the sentence below and is a separate deletion; dropping `notice` here
 * takes the chip with it unless the chip carries `NOTICE_CODE` itself, which it does.
 * The other three carriers of that rule import the same constant.
 */
const TORN =
  "rounded-xl border border-[var(--neg)] bg-[var(--card)] p-4 text-[var(--neg)]";
/**
 * THE SENTENCE STEPS BACK TO `--text`. It is prose inside a block painted in the alarm
 * colour, and reading it in that colour too makes the whole card shout instead of the one
 * line that is the alarm.
 */
const TORN_BODY = "m-0 mt-1.5 text-[0.85rem] text-[var(--text)]";
/**
 * `margin: 0`, ALL FOUR EDGES. The deleted rule zeroed the margin outright and, being
 * unlayered, beat the `mt-1` this paragraph carried from slice 2's shared-vocabulary
 * conversion. Reproducing the rule means dropping that `mt-1`; keeping it would open a
 * 4px gap nothing has ever rendered.
 */
const UNCHECKED = "m-0 text-[0.8rem] text-[var(--muted)]";

function TornActBanner({ view }: { view: FillPathView }) {
  if (view.tornActs.status === "outstanding") {
    return (
      <div className={TORN} role="alert">
        <strong>
          {view.tornActs.count} torn fill{" "}
          {view.tornActs.count === 1 ? "act" : "acts"} outstanding
        </strong>
        <p className={TORN_BODY}>
          Recording is blocked until this is repaired —{" "}
          <code className={NOTICE_CODE}>pnpm orders:fill</code>{" "}
          will refuse while a half-written act is open. Repair it at the desk.
        </p>
      </div>
    );
  }
  if (view.tornActs.status === "unchecked") {
    return (
      <p className={UNCHECKED}>
        Torn fill acts were not checked for this snapshot — this is NOT "none
        outstanding".
      </p>
    );
  }
  return null;
}

/**
 * Card 1 — the figures and the progress bar.
 *
 * ── TWO LAYOUTS, AND THE VIEW MODULE PICKS WHICH ────────────────────────────────────
 * ONCE ANYTHING HAS FILLED the card is exactly what it always was: three measured tiles,
 * then the progress bar, then the waiting block. BEFORE anything has filled those three
 * tiles are three copies of `— no fill recorded yet`, which is three rows of layout
 * spent saying one thing, so the card projects instead: Waiting (already the honest
 * substitute for Deployed on day zero) beside what the DECLARED ladder would acquire.
 *
 * THE SWITCH IS `view.expected`, decided in `ladder/fill-path-view.ts`, and this file
 * asks rather than re-derives. It is emphatically NOT "are the measured figures absent":
 * a ladder whose orders sidecar could not be read has all three absent too, and it gets
 * the ORIGINAL layout, because nothing about it has been established — least of all that
 * it has not started. Projecting onto that row would print a confident number beside the
 * sentence saying nothing could be checked.
 */
function Header() {
  const { view } = useFillPath();
  // `expected` is only ever set on a reconciled row, so `figures` is present with it;
  // pairing them here is what lets the row below take both non-optional.
  const projection =
    view.expected !== undefined && view.figures !== undefined
      ? { expected: view.expected, figures: view.figures }
      : undefined;

  return (
    <Card className={HEADER_CARD}>
      {/* WHAT THIS IS, AND WHERE PRICE IS — the two things the operator reads before
          anything else, on one row. Spot used to sit in the provenance footer, four
          cards down, which put the only number that moves while you look at it below
          every number that does not. */}
      <div className={HEADER_HEAD}>
        <div className={HEADER_ID}>
          {/* `level={1}` IS NOT DECORATION. This card's heading is the PAGE's heading,
              which only the call site knows; `Card.Title` defaults to 2, and a page
              whose deepest heading is an `h2` reads as a document with no title to
              everything that navigates by headings. */}
          <Card.Title level={1} className={HEADER_TITLE}>
            {view.title}
          </Card.Title>
          {/* THE STATE IS A BADGE, NOT A SENTENCE. It used to ride a `Price ladder ·
              pending · all figures in USD` sub-line, which spent two rows of a 320px
              card on one word the operator actually reads. The kind is already told by
              the ladder below, and every figure on this card carries its own `$` or its
              own unit, so the currency note was restating what the numbers say. */}
          <span className={`${BADGE} ${BADGE_TONE[view.state]}`}>
            {view.state === "active" ? "in force" : view.state}
          </span>
        </div>
        <SpotReadout view={view} />
      </div>

      {projection ? (
        <ExpectedRow expected={projection.expected} figures={projection.figures} />
      ) : (
        <div className={`${TILES} mb-[14px]`}>
          <Figure label="Deployed" figure={view.deployed} />
          <Figure
            label="Units acquired"
            figure={view.unitsAcquired}
            render={formatUnits}
          />
          <Figure label="Average entry" figure={view.avgEntry} />
        </div>
      )}

      {view.progress ? (
        <div className={PROGRESS}>
          {/* A BAR AT ZERO IS THE TRUTH and stays: it reads as absence, which is what
              day zero is. A zero-dollar figure would read as a measurement instead. */}
          <div
            className={PROGRESS_TRACK}
            role="img"
            aria-label={`${view.progress.filledRungs} of ${view.progress.totalRungs} rungs filled`}
          >
            <div
              className={PROGRESS_FILL}
              style={{ width: `${view.progress.percent}%` }}
            />
          </div>
          <p className={PROGRESS_NOTE}>
            {view.progress.filledRungs} of {view.progress.totalRungs} rungs walked
          </p>
        </div>
      ) : null}

      {projection ? null : <Waiting figures={view.figures} />}
    </Card>
  );
}

/**
 * SPOT, IN THE CORNER OF THE CARD THAT NAMES THE LADDER.
 *
 * THREE ARMS, NOT TWO, because "reading spot…" and "the fetch failed" are different
 * things to tell an operator and neither of them is a price. Both absences render as the
 * em-dash and a cause, the same treatment every other missing figure on this page gets;
 * there is no arm here that can print a number the page does not have.
 *
 * A LAST CLOSE IS SHOWN, AND SAID TO BE ONE. When the fetch failed but the session saw a
 * price earlier, that price still helps — it is roughly where the market is — so it
 * renders, with `last close · live price unavailable` beside it. What it must never do is
 * pass for `· live`, because the whole `next` marker downstream is decided off a LIVE
 * reading only (see `chart.nowX` at the chart call site).
 *
 * NO `~` ON EITHER. A spot reading is a price the venue printed, exact to the cent as
 * received; the chart's rounded copy of it wears the tilde instead.
 */
function SpotReadout({ view }: { view: FillPathView }) {
  return (
    <p className={SPOT}>
      <span className={SPOT_LABEL}>Spot</span>
      {view.spotLoading ? (
        <Absent why="reading spot…" className={SPOT_ABSENT} />
      ) : view.spotUsd === undefined ? (
        <Absent why="live price unavailable" className={SPOT_ABSENT} />
      ) : (
        <>
          <strong className={SPOT_VALUE}>{formatUsd(view.spotUsd)}</strong>
          <span className={SPOT_NOTE}>
            {view.spotUnavailable ? "last close · live price unavailable" : "live"}
          </span>
        </>
      )}
    </p>
  );
}

/**
 * DAY ZERO'S ROW — Waiting, and the two figures the declared ladder is AIMING at.
 *
 * WAITING IS THE MEASURED ONE and keeps its place first: it is a real total off a
 * reconciliation that ran. The two beside it are projections off rungs the operator
 * DECLARED — no order and no lot is involved — which is why they render through
 * `Expectation` and not `Figure`, and why both labels lead with "Expected".
 *
 * THE SPLIT SENTENCE IS GONE FROM THIS CARD. It used to sit under the row and say whether
 * the waiting capital was actually encumbered at the venue — `all-resting`, `partly-
 * unplaced`, `all-filled`. The card is now one accented number and its references, and a
 * paragraph reintroduced the crowding that shape exists to remove. `figures.split` is
 * still computed and tested in `ladder/fill-path-view.ts`, so the fact is available to
 * whatever surface wants to carry it; nothing renders it today.
 */
function ExpectedRow({
  expected,
  figures,
}: {
  expected: NonNullable<FillPathView["expected"]>;
  figures: NonNullable<FillPathView["figures"]>;
}) {
  return (
    <div className={EXPECTED}>
      {/* WAITING IS THE PROTAGONIST and is built to look like it: out of the tile grid
          entirely, label over figure, at the card's largest type. The two projections
          below it stay in the row form at a smaller size — muted alone did not carry
          the hierarchy, because the projected strings are the LONGEST on the card and
          at equal size length reads as importance. */}
      <div className={HERO}>
        <span className={TILE_LABEL}>Waiting</span>
        <strong className={HERO_VALUE}>{formatUsd(figures.waitingDeclaredUsd)}</strong>
      </div>
      <div className={`${TILES} mb-0`}>
        <Expectation label="Expected units" value={expected.units} render={formatUnits} />
        <Expectation label="Expected average entry" value={expected.avgEntryUsd} />
      </div>
    </div>
  );
}

/**
 * THE WAITING CAPITAL, on a ladder that has already started.
 *
 * ABSENT `figures` IS NOT `$0`. It means the orders sidecar could not be read, so there
 * is no waiting total to state; the em-dash and its cause are the same treatment the
 * three measured figures get one row up. That sentence STAYS — it is the cause attached
 * to its own em dash, not a footnote about the number, and it is the only prose left on
 * this card.
 */
function Waiting({ figures }: { figures: FillPathView["figures"] }) {
  if (figures === undefined) {
    return (
      <div className={WAITING}>
        <span className={STACKED_LABEL}>Waiting</span>
        <strong className={TILE_VALUE}>—</strong>
        <p className={WAITING_SUB}>
          The orders sidecar could not be read for this ladder, so nothing here is a
          measurement — this is NOT "nothing is waiting".
        </p>
      </div>
    );
  }
  return (
    <div className={WAITING}>
      <span className={STACKED_LABEL}>Waiting</span>
      <strong className={TILE_VALUE}>{formatUsd(figures.waitingDeclaredUsd)}</strong>
    </div>
  );
}

/**
 * Between header and chart (G-D12), and VISUALLY DISTINCT because their certainties
 * differ. `filled at venue — not recorded` is a FACT the venue reported. `price passed,
 * no fill recorded` is INFERRED from spot: price traded through a resting order and the
 * venue has not said anything, which usually means nothing happened. Rendering them the
 * same would teach the operator to treat a certainty like a guess.
 */
/**
 * TWO CERTAINTIES, ONE SURFACE, AND ONE EDGE BETWEEN THEM.
 *
 * Both paragraphs are card-surfaced, so `CARD_SURFACE` rides along and only the left
 * border differs. Every declaration that differs is a LONGHAND on purpose: `border-l-4`
 * beats the shared string's shorthand width and `border-l-[…]` beats its shorthand
 * colour, which is the one ordering Tailwind does guarantee.
 *
 * THE DASH IS ONE EDGE, NOT FOUR. `border-dashed` sets `border-style` on every side and
 * would dash the card's other three; the arbitrary property puts it on the left alone.
 * The difference between a venue fact and a guess is the whole reason these two look
 * different, and it must not spill onto the surface they share.
 */
const WARN = `${CARD_SURFACE} m-0 text-[0.85rem] leading-[1.45]`;
const WARN_CERTAIN = `${WARN} border-l-4 border-l-[var(--neg)]`;
const WARN_INFERRED = `${WARN} border-l-4 border-l-[var(--warn)] [border-left-style:dashed] text-[var(--muted)]`;

function UnrecordedWarnings({ view }: { view: FillPathView }) {
  return (
    <>
      {view.warnings.filledNotRecorded > 0 ? (
        <p className={WARN_CERTAIN}>
          <span aria-hidden="true">⚠ </span>
          {view.warnings.filledNotRecorded} filled at the venue —{" "}
          {view.warnings.filledNotRecorded === 1 ? "it is" : "they are"} not recorded.
          The venue reported this; the fund's book has no lot for it.
        </p>
      ) : null}
      {view.warnings.pricePassedNoFill > 0 ? (
        <p className={WARN_INFERRED}>
          <span aria-hidden="true">⚠ </span>
          {view.warnings.pricePassedNoFill} resting{" "}
          {view.warnings.pricePassedNoFill === 1 ? "rung has" : "rungs have"} had price
          pass through with no fill recorded. Inferred from spot, not reported by the
          venue — check before acting.
        </p>
      ) : null}
    </>
  );
}

/**
 * THE LADDER'S PRICE SPAN, TAKEN BY EXPLICIT MIN/MAX AND NOT OFF THE ENDS OF THE ARRAY.
 *
 * `view.rungs` does arrive sorted DESCENDING by price from `ladder/fill-path-view.ts`, so
 * `rungs[0]` and `rungs.at(-1)` would be right today — and would silently print the span
 * backwards the day that sort is changed or a caller passes an unsorted list. `cumulate`
 * in `ladder/price-drop-path.ts` genuinely cannot avoid depending on that ordering (a
 * running sum IS an order), so it states the dependency on its own interface and asserts
 * it in a test instead. This readout has no such excuse: a
 * min/max is order-free, so it takes one and owes the reader no caveat.
 *
 * Absent when there is nothing to span — a single rung is a price, not a range.
 *
 * IT WEARS A `~` BECAUSE COMPACT NOTATION ROUNDS HARD. `$47.5K` is a rung the list below
 * prints as `$47,499.00`, and without the mark the two readings of the same declared
 * price look like a disagreement rather than a summary.
 */
function priceSpan(rungs: readonly FillPathRungView[]): string | undefined {
  if (rungs.length < 2) return undefined;
  const prices = rungs.map((rung) => rung.priceUsd);
  // COMPACT, so the span reads as a span rather than as two long figures — and the SAME
  // formatter the chart's own axis ticks use, imported rather than declared again, so the
  // header and the axis directly beneath it cannot print the same price two ways. This
  // was a byte-identical second `Intl.NumberFormat` with a comment on each half asking
  // the other not to change.
  return `~${COMPACT_USD.format(Math.min(...prices))}–${COMPACT_USD.format(
    Math.max(...prices),
  )}`;
}

/**
 * THE CHART CARD'S SECTION, AS UTILITIES (spec #420 slice 9) — the last surface, and the
 * one whose deletion leaves `styles.css` holding no rule at all.
 *
 * THE HEADING RULE'S THIRD ARM IS HERE, WHICH IS WHAT RETIRES THE RULE. `.fp-chart-card
 * h2` was grouped with the ladder's two, and each arm was deleted in the commit that
 * converted the heading it was styling. This is the last of the three, so the constant
 * stops being the ladder's and becomes the card heading all three read. `m-0 mb-2.5` is
 * the preflight-off pattern: the UA's own `h2` margin is live, so three edges are zeroed
 * and one is set.
 */
const CARD_HEADING = "m-0 mb-2.5 text-[0.95rem]";

/**
 * TITLE LEFT, THE LADDER'S PRICE SPAN RIGHT — one row, baseline-aligned so the two read
 * as a heading and its subject rather than as two stacked labels.
 *
 * IT WRAPS RATHER THAN SQUEEZES, and the span is the half that gives way. At 254px the
 * two total 217px so the row survives as a row; a deeper ladder (`~$1.2M–$2.3M`) would
 * not, and the choice then is between breaking the TITLE across two lines and dropping
 * the span to its own. The span keeps the right rail on that second line through its own
 * `ml-auto` rather than through the row's `justify-between`, which aligns a lone wrapped
 * item to the start. No breakpoint: this holds at every width, so there is nothing for a
 * query to ask.
 *
 * THE TWO GAP AXES ARE SPELLED SEPARATELY because the deleted rule set them apart:
 * `gap: 0 10px` is `gap-x-[10px] gap-y-0`, and a single `gap-[10px]` would open a 10px
 * hole above the wrapped span that the row never had.
 */
const CHART_HEAD = "flex flex-wrap items-baseline justify-between gap-x-[10px] gap-y-0";
/** The title is the half that survives a break, so it grows and may shrink to nothing. */
const CHART_TITLE = `${CARD_HEADING} flex-auto min-w-0`;
/**
 * Quieter than the title: it is the chart's subject, not a second heading. Tabular
 * figures so the two ends of the span line up as numbers.
 *
 * ITS TWO FLEX DECLARATIONS CAME FROM A DESCENDANT RULE (`.fp-chart-head .fp-chart-range`)
 * and are folded in here rather than split across two strings: the span renders in the
 * head and nowhere else, so the context the descendant selector was testing for is the
 * only context there is.
 */
const CHART_RANGE = "ml-auto mb-2.5 flex-none text-[0.8rem] tabular-nums text-[var(--muted)]";
/**
 * The chart's accessible substitute, sized as prose rather than as a caption footnote:
 * for a screen-reader user this sentence IS the chart. `m-0 mt-2.5` because the UA's own
 * `p` margin is live with preflight off and the deleted rule zeroed three edges of it.
 */
const CHART_CAPTION = "m-0 mt-2.5 text-[0.85rem] leading-[1.5]";
/** The slider stacks under its label; the label's type comes from `TILE_LABEL`. */
const INSPECT = "mt-3.5 flex flex-col gap-1.5";
/**
 * `w-full` IS NOT THE WHOLE STORY FOR A RANGE INPUT. The UA sheet gives it a 2px side
 * margin, so a full-width slider is 4px wider than the label box around it and the tail
 * of the track sat under the card's border at 320px. The margin goes, not the width —
 * and with preflight off that margin is live, so `mx-0` is load-bearing here rather than
 * a default spelled out for tidiness.
 */
const INSPECT_RANGE = "w-full mx-0";

/** Card 2 — the chart, its generated caption, and the inspect slider. */
function Chart() {
  // THE CHART ASKS IN INDEXES, because its inspect control is a range input and a range
  // is an index. Nothing here converts: the slider reads and writes the index, the
  // adapter is handed the selected rung's own key, and the provider is the one module
  // that turns one into the other.
  const { view, selected, selectedIndex, selectIndex } = useFillPath();
  const span = priceSpan(view.rungs);
  return (
    <Card className="fp-chart-card">
      {/* THE SPAN SITS OPPOSITE THE TITLE, not in the chart. It is the one number the
          picture cannot state exactly — an axis tick is a rounded gridline, and the
          reader who wants "how deep does this ladder go" should not have to measure. */}
      <div className={CHART_HEAD}>
        <Card.Title className={CHART_TITLE}>Price Drop Path</Card.Title>
        {span === undefined ? null : <span className={CHART_RANGE}>{span}</span>}
      </div>
      {view.chart ? (
        <PriceDropPathChart
          rungs={view.rungs}
          selectedKey={selected?.key}
          // A LAST CLOSE IS NOT "NOW". `chart.nowX` is present only when the view
          // module saw a LIVE reading, so it — not `spotUsd`, which may be a close —
          // is what decides whether a now-rule is drawn at all.
          spotUsd={view.chart.nowX === undefined ? undefined : view.spotUsd}
          // MEASURED, and passed as the `MeasuredFigure` it is rather than as a number
          // with a fallback: the chart draws its `Deployed` rule only on the `known`
          // arm, so an unreconciled ladder gets no rule instead of one at zero.
          deployed={view.deployed}
        />
      ) : (
        <p>
          <Absent why="this ladder ships no rung sizes — there is no capital curve to plot" />
        </p>
      )}

      {/* THE CHART'S ACCESSIBLE SUBSTITUTE (§6.3b) — generated, never hand-written.

          IT IS NOW SCREEN-READER-ONLY, AND THAT IS A SHOW-DON'T-TELL EDIT, NOT A DELETION.
          Its first clause — "the deepest rung is 6.3× the first" — is a ratio the picture
          itself now draws: `withRadius` in `PriceDropPathChart` sizes each rung's ring by
          the AREA of its declared size, so a sighted reader sees the 6.3× before they
          could have read a sentence about it. Printing both left the card asserting in
          prose what it was simultaneously demonstrating.

          THE ELEMENT MUST NOT BE DROPPED, THOUGH. The chart above is `aria-hidden` by
          design and this paragraph is the ONLY form in which its content reaches the
          accessibility tree; removing the node rather than hiding it visually would take
          the whole picture away from a screen-reader user to tidy a sighted one's card.
          `sr-only` is therefore load-bearing here, and it is TAILWIND'S now: spec #420
          slice 2 deleted the house rule, which said the same thing in the same clip-rect
          idiom. `display: none` and `visibility: hidden` would remove the node from the
          tree along with the layout, which is exactly what must not happen to this
          paragraph. The class is emitted because this line writes it and `@source "./"`
          scans this file — nothing else in the repo asks for it.

          THE ABSENT ARM IS HIDDEN WITH IT. It stands in the same slot and speaks to the
          same reader: a sighted user needs no note that a caption they cannot see is
          unavailable, and its absence is already visible as a chart with no rings. */}
      <div className="sr-only">
        {view.caption ? (
          <p className={CHART_CAPTION}>{view.caption}</p>
        ) : (
          <p>
            <Absent why="the ladder's shape is unavailable" />
          </p>
        )}
      </div>

      {view.rungs.length > 0 ? (
        <label className={`fp-inspect ${INSPECT}`}>
          {/* The slider's label wears the tile label's TYPOGRAPHY and none of its rail
              geometry: `.fp-tile-label` was a type rule and the flex arms lived on the
              three `>` selectors above it, none of which reached inside `.fp-inspect`. */}
          <span className={TILE_LABEL}>Inspect rung</span>
          <input
            className={INSPECT_RANGE}
            type="range"
            min={0}
            max={view.rungs.length - 1}
            step={1}
            value={selectedIndex}
            onChange={(event) => selectIndex(Number(event.target.value))}
          />
        </label>
      ) : null}
    </Card>
  );
}

/**
 * THE SELECTED-RUNG CARD'S SECTION, AS UTILITIES (spec #420 slice 8).
 *
 * THE CARD IS THE QUERY CONTAINER, not the viewport — the same rule the header card
 * follows, and one name, which is exactly what Tailwind's named container utility emits.
 *
 * THE HEADING RULE WAS SHARED BY THREE CARDS and all three read `CARD_HEADING` now; the
 * split ended when slice 9 took the chart's arm and the grouped rule went with it.
 */
const SELECTED_CARD = "@container/fp-selected";
/** The heading carries the `next` badge, so it is a baseline row rather than a block. */
const SELECTED_HEADING = `${CARD_HEADING} flex items-center gap-[10px]`;

/**
 * THE HEADLINE — the money committed, AT the price it buys at.
 *
 * COLOUR ALONE DEMOTES THE SIZE, at the same type size: the two figures are one sentence
 * and shrinking half of it would break the line's rhythm and its tabular alignment. The
 * joining word recedes one step further, being the only thing on the line that is not a
 * number, and the UNIT steps down from the FIGURE — `0.75em`, relative to the price's own
 * size rather than to the root's — so the eye lands on the amount and reads `USD` second.
 * No opacity on the unit: it sits inside the muted size already, and stacking the two
 * dimmed the currency past legibility.
 */
const SELECTED_PRICE = "m-0 mb-2 text-[1.3rem] tabular-nums";
const SELECTED_SIZE = "text-[var(--muted)]";
const SELECTED_UNIT = "text-[0.75em]";
const SELECTED_AT = "text-[var(--muted)] opacity-70";

/**
 * THE EXCEPTION SHELF'S ROWS — term left, value against the right rail, until the card is
 * wide enough for the value to sit beside its term instead. At desk width a right rail
 * 690px from its label is not an alignment, it is a gap the eye has to cross.
 *
 * THE TERMS ARE SIZED TO CONTENT AND THE VALUE COLUMN TAKES THE REMAINDER, which is the
 * opposite of the header card's `dl`: one value on this list is a sentence rather than a
 * figure, and sizing it the header's way let that row's max-content eat the whole grid.
 */
const DETAIL =
  "grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 m-0 mt-2.5 text-[0.85rem]" +
  " @[380px]/fp-selected:grid-cols-[auto_1fr] @[380px]/fp-selected:gap-y-1";
const DETAIL_TERM = "text-[var(--muted)]";
/** `m-0` because the UA indents a `dd` by 40px and preflight is off. */
const DETAIL_VALUE = "m-0 text-right tabular-nums @[380px]/fp-selected:text-left";

/**
 * THE PILLS, AS A TOTAL MAP — one tone per exception, never a base plus three overrides.
 *
 * The deleted rules WERE a base plus three overrides, and as utilities that is a cascade
 * a class string cannot express: two unvariant `border-color` utilities on one element
 * are resolved by Tailwind's emitted order rather than by the order they are written in.
 * `BADGE_TONE` made the same move one card up and for the same reason.
 *
 * WHAT EACH TONE MEANS. Unplaced is greyed AND dashed (G-D12): a declared rung with no
 * order is not a state the ladder is in, it is one it never entered. Inferred is dashed
 * in `--warn`, matching the inferred warning above the chart — the same certainty, the
 * same visual language. Next is `--now` and never `--pos`, because the next rung is where
 * price is HEADING and green is the colour that means FILLED.
 */
const PILL =
  "rounded-[10px] border px-[7px] py-[2px] text-[0.68rem] font-semibold uppercase tracking-[0.03em]";
const PILL_TONE = {
  state: "border-[var(--line)] text-[var(--muted)]",
  unplaced: "border-[var(--line)] text-[var(--muted)] border-dashed opacity-[0.55]",
  inferred: "border-[var(--warn)] text-[var(--warn)] border-dashed",
  next: "border-[var(--now)] text-[var(--now)]",
} as const;
const PILLS = "flex flex-wrap items-center gap-1.5 m-0";

/**
 * THE COMPLETENESS LINE — quiet, and ruled off from the `State` row above it, because it
 * is the caveat ON that row rather than another fact about the rung.
 *
 * 12px, not the 4px this paragraph carried from slice 2's shared-vocabulary conversion:
 * the deleted rule set its own top margin and, being unlayered, won. Both edges of the
 * hairline are here — a half-reproduced border is a rule that never goes away.
 */
const RECORDED =
  "m-0 mt-3 pt-2.5 border-t border-t-[var(--line)] text-[0.75rem] leading-[1.5] text-[var(--muted)]";

/** Card 3 — everything known about the one rung under inspection. */
function SelectedRung() {
  const { view, selected: rung } = useFillPath();
  if (rung === undefined) {
    return (
      <Card>
        <Card.Title>Selected rung</Card.Title>
        <p>
          <Absent why="this ladder declares no rungs" />
        </p>
      </Card>
    );
  }
  return (
    // THE ONE CARD THAT IS STILL SPELLED OUT, and the reason is on the element rather
    // than in it. `Card` emits a `<section>` carrying a class string and nothing else —
    // spec #403's Seam C fixes that signature, and this panel needs `aria-live="polite"`
    // ON THE SECTION, because a live region is announced from the element that carries
    // it and moving it to a child changes what a screen reader says when selection
    // changes. Widening the primitive to pass one attribute through for one caller is a
    // knob bought for a single site; the panel keeps its own element instead, exactly as
    // the two `fp-warn` paragraphs and the `role="alert"` banner below do.
    <section className={`${CARD_SURFACE} ${SELECTED_CARD}`} aria-live="polite">
      {/* THE BADGE RIDES THE HEADING, because "next" answers WHICH RUNG THIS IS — the
          same question the heading asks — and not what state it is in. Down among the
          pills it read as one status among several; up here it qualifies the identity
          it belongs to, and the pill row below is left holding only exceptions. */}
      <h2 className={SELECTED_HEADING}>
        Rung {rung.ladderIndex} of {view.rungs.length}
        {rung.isNext ? (
          <span className={`${PILL} ${PILL_TONE.next}`}>next</span>
        ) : null}
      </h2>
      <RungHeadline rung={rung} />
      <Pills rung={rung} />
      {/* THE LIST IS NOW THE EXCEPTION SHELF, AND USUALLY RENDERS NOTHING. It held three
          rows and two of them were restatements: `Declared size` moved up into the
          headline, and `State` printed in full paragraph form the same word the pill
          directly above it already carries. What is left is the one fact that is only
          ever present when something is IRREGULAR — so the `dl` is conditional rather
          than empty, since an empty definition list is a labelled box promising detail
          it does not have. */}
      {rung.placedAtUsd === undefined ? null : (
        <dl className={DETAIL}>
          <dt className={DETAIL_TERM}>Order placed at</dt>
          {/* A DECLARED join whose order sits elsewhere is honored AND flagged: the
              operator said these belong together, and they do — at a different price. */}
          <dd className={DETAIL_VALUE}>
            {formatUsd(rung.placedAtUsd)}{" "}
            <span className="m-0 mt-1 text-[var(--muted)]">differs from the declared rung</span>
          </dd>
        </dl>
      )}
      <RecordedThrough view={view} />
    </section>
  );
}

/** The two figures that describe a rung, in the sentence an operator would actually say:
 *  the money committed, AT the price it buys at. They were a heading and a `dl` row apart,
 *  which made a reader assemble the one thought the card exists to deliver — and gave the
 *  price the accent, though the price is the axis the whole surface is already organized
 *  by and the SIZE is what distinguishes this rung from its neighbours.
 *
 *  ── NO `$`, BECAUSE `USD` IS ALREADY THERE ────────────────────────────────────────────
 *  One unit mark for one currency. `$149.96 USD @ $57,500` stamps the same fact three
 *  times; the suffix carries it once and the `@` reads as the preposition it is.
 *
 *  ── CENTS SURVIVE WHEN THERE ARE CENTS ────────────────────────────────────────────────
 *  The price is written with `maximumFractionDigits: 2` and NO minimum, so a whole rung
 *  prints `57,500` exactly as intended while a `$57,499.50` rung prints `57,499.5` rather
 *  than being silently rounded into a price no order was placed at. The rung list below
 *  prints the same price to the cent, and the two must not disagree.
 *
 *  A v4 SNAPSHOT CARRIES NO SIZE, and there is no sentence to make without it — so that
 *  arm falls back to the price alone, the accent this line had before. */
const SIZE_PLAIN = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const PRICE_PLAIN = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

function RungHeadline({ rung }: { rung: FillPathRungView }) {
  if (rung.sizeUsd === undefined) {
    return <p className={SELECTED_PRICE}>{formatUsd(rung.priceUsd)}</p>;
  }
  return (
    <p className={SELECTED_PRICE}>
      {/* THE PRICE TAKES THE ACCENT, NOT THE SIZE. This card is one stop on a ladder and
          the ladder's axis is PRICE — it is what the chart above plots vertically, what
          the rung list is ordered by, and the number the operator is deciding against.
          The size is what happens WHEN price gets here; it reads second by design. */}
      <span className={SELECTED_SIZE}>
        {SIZE_PLAIN.format(rung.sizeUsd)} <span className={SELECTED_UNIT}>USD</span>{" "}
      </span>
      <span className={SELECTED_AT}>@</span> {PRICE_PLAIN.format(rung.priceUsd)}
    </p>
  );
}

/**
 * THE COMPLETENESS LINE — how much of reality these states have seen. The date is the
 * anchor's own `asOf`, passed through by the view module: the boundary of what this row
 * could have known. No clock is read anywhere on this page, the `dca` branch carries no
 * date of its own (three invariants depend on that), and no fill timestamp is on the wire.
 *
 * ── IT IS ONE CLAIM NOW, AND THE SECOND ONE IS SHOWN INSTEAD OF TOLD ──────────────────
 * This used to spell out both ways the card can be behind reality (G-D5c): filled after
 * the cutoff, and filled but NEVER recorded. The second is now carried by
 * `UnrecordedWarnings` — a banner that fires with a COUNT on exactly the snapshots where
 * it is true, rather than a standing caveat printed under every rung on every ladder
 * whether or not anything is missing. A warning that is always on the screen is one the
 * operator stops reading, which is the failure mode the sentence was written to avoid.
 *
 * THE DATE STAYS ISO. `26/08/10` is unreadable without knowing which of three orders it
 * is in, and this surface is operated from a `DD/MM` locale where it would parse as 26
 * August 2010. `2026-08-10` is the same length and cannot be misread.
 */
function RecordedThrough({ view }: { view: FillPathView }) {
  return (
    <p className={RECORDED}>
      {/* NO `<strong>` ON THE DATE. The paragraph is painted in the secondary
          colour because the whole sentence
          is a provenance footnote, and bolding the date inside it pulled the loudest
          thing on the card down to its quietest line — the reader's eye landed on a
          cutoff before it landed on the rung. It is a boundary, not a headline. */}
      Fills recorded at {view.recordedThrough}
    </p>
  );
}

/**
 * The pills — now the surface's EXCEPTION ROW, not its status row. Everything that
 * survives here is a fact the card cannot state any other way; the ordinary case renders
 * no pills at all.
 *
 * ── "NEXT" IMPLIES "WAITING", AND THE VIEW MODULE GUARANTEES IT ───────────────────────
 * `fill-path-view.ts` picks `nextRung` from `wireRungs.find(rung => isWaiting(rung) && …)`,
 * so a rung cannot be next without being waiting. Printing both put the card's own
 * inference on screen beside its premise. The badge moved up to the heading and the
 * redundant pill is dropped.
 *
 * DROPPED ONLY ON THE VENUE'S RESTING STATE, THOUGH — never on `isNext` alone. A next rung
 * may still be `declared — not placed`, `cancelled — fills recorded against it`, partly
 * filled, or `fill state unavailable` on an unreconciled snapshot. None of those is implied
 * by "next", and all of them still print. `venueResting` is the narrow claim; `isNext`
 * alone would have been the wrong one and would have swallowed an unplaced next rung's
 * whole warning.
 *
 * IT IS A FACT, NOT THE WORDS (#306). This used to read `rung.label === "waiting"` — a
 * comparison against a string the ENGINE authored, in another package, whose rewording
 * would have re-enabled the pill silently with every test still green. `stateCopy` is
 * rendered here and compared nowhere; see `ladder/rung-state-copy.ts`.
 *
 * ── "MATCHED BY PRICE" IS GONE ────────────────────────────────────────────────────────
 * It is the join's provenance — that this rung was tied to its order by price rather than
 * by a carried id. On a WAITING rung there is nothing joined yet for the provenance to be
 * about, so it printed under almost every rung on the ladder and said nothing about any
 * of them. The rung list below still carries it per row, where a reader comparing rungs
 * can see which ones differ; on the single-rung card it was ambient.
 */
function Pills({ rung }: { rung: FillPathRungView }) {
  // The state pill is suppressed exactly when the heading's `next` badge already said it.
  const stateIsRedundant = rung.isNext && rung.venueResting;
  const pills = [
    rung.notPlaced ? (
      <span key="state" className={`${PILL} ${PILL_TONE.unplaced}`}>
        declared — not placed
      </span>
    ) : stateIsRedundant ? null : (
      <span key="state" className={`${PILL} ${PILL_TONE.state}`}>
        {rung.stateCopy}
      </span>
    ),
    rung.pricePassedUnconfirmed ? (
      <span key="unconfirmed" className={`${PILL} ${PILL_TONE.inferred}`}>
        waiting · price passed, unconfirmed
      </span>
    ) : null,
    rung.filledPercent === undefined ? null : (
      <span key="partial" className={`${PILL} ${PILL_TONE.state}`}>
        partly filled · {rung.filledPercent}%
      </span>
    ),
  ].filter((pill) => pill !== null);

  // An empty pill row is still a row: it holds its own margin and opens a gap under the
  // headline that reads as something failing to load. The ordinary rung has no pills.
  if (pills.length === 0) return null;
  return <p className={PILLS}>{pills}</p>;
}

/**
 * Card 4 — the ladder itself, and the record for everything the chart draws.
 *
 * EVERY ROW IS A BUTTON, selecting on click and on FOCUS. That is §6.3c: the slider is
 * one path to the inspect panel and this is the other, so a keyboard or a screen reader
 * walks the ladder and the panel follows without touching the chart.
 *
 * ── EACH ROW IS ITS OWN TILE, TINTED BY STATE ───────────────────────────────────────
 * It used to be a bordered table: three columns of the same weight, so `$47,500` and
 * the pill beside it competed and the ladder's shape had to be read rather than seen.
 * A rung is one thing with a state, so it gets one tile — rung number, then the two
 * numbers that describe it stacked (the price it buys at, the capital it commits), then
 * the state, right-aligned.
 *
 * THE TINT REUSES THE CHART'S PALETTE and no other: `--pos` for filled, `--now` for the
 * rung price reaches next, bare `--bg` for waiting. That is the same three-colour key
 * the Price Drop Path draws with, so the list and the picture cannot say different
 * things about the same rung. The `next` pill was `--pos`-bordered before this, which
 * borrowed the colour that means FILLED for the one rung that has not.
 */
/**
 * THE RUNG LIST'S SECTION, AS UTILITIES (spec #420 slice 8).
 *
 * THE CARD IS THE QUERY CONTAINER, not the viewport, and the UA's own `ul` margin and
 * 40px indent are live with preflight off — both are zeroed here or the ladder sits
 * indented under its own heading.
 *
 * ── AT 320px THE PRICE IS SIZED AND THE STATE UNFOLDS ────────────────────────────────
 * There are 224px inside a tile. The desk shape spends 36 of them on a fixed rung-number
 * gutter and hands the leftover to the state, which took 93px for `matched by price` and
 * left a price in a 71px box it silently overflowed. So at this width the gutter shrinks
 * to the two characters it holds and the FIGURES column is sized to content: a price
 * never clips, because it is the thing the row is about.
 *
 * THE GUTTER SHRINKS BUT STAYS FIXED at both widths. Each tile is its own grid, so an
 * `auto` gutter would be measured per tile and `R9` and `R10` would set their prices at
 * different left edges — a ragged ladder in the one list whose job is to be read down.
 *
 * BOTH GAPS ARE LONGHANDS, on both sides of the breakpoint. `gap-3` is the shorthand and
 * Tailwind sorts shorthands ahead of longhands, so the narrow `gap-x`/`gap-y` pair would
 * have beaten the wide arm and the desk shape would have kept the phone's gaps with
 * nothing red.
 */
const LIST_CARD = "@container/fp-list";
const LIST_ITEMS = "list-none grid gap-2 m-0 p-0";
const ROW =
  "grid grid-cols-[1.75rem_auto_minmax(0,1fr)] items-baseline gap-x-[10px] gap-y-0" +
  " w-full px-[14px] py-3 border rounded-xl text-[var(--text)] [font:inherit]" +
  " text-left cursor-pointer" +
  // NEUTRAL, DELIBERATELY. `--pos` would ring a waiting rung in the colour that means
  // filled the moment a keyboard reached it, and this is the accessible path to the
  // inspect panel — it has to be visible.
  " focus-visible:outline-2 focus-visible:outline-[var(--text)] focus-visible:outline-offset-2" +
  " @[380px]/fp-list:grid-cols-[2.25rem_minmax(0,1fr)_auto] @[380px]/fp-list:items-center" +
  " @[380px]/fp-list:gap-x-3 @[380px]/fp-list:gap-y-3";

/**
 * FOUR DECISIONS ON ONE ELEMENT, AS FOUR TOTAL MAPS.
 *
 * The deleted rules resolved them by ORDER: `.is-next` sat below `.is-filled` and
 * `.is-selected` below both, so a rung that was two things at once took the lower rule's
 * colour. Utilities have no order to lean on — two unvariant `background-color` or
 * `border-color` utilities race — so the priority the stylesheet expressed by position is
 * spelled out in `rungRowClasses` instead, where it can be read.
 *
 * THE TINT REUSES THE CHART'S PALETTE AND NO OTHER: `--pos` filled, `--now` next, bare
 * `--bg` waiting. Mixed into the background rather than used neat, so the tint says which
 * state without competing with the price for the eye.
 *
 * SELECTION IS A RING, NOT A FILL. A background swap would fight the state tint and could
 * make a waiting rung look filled while the operator inspected it, so selection moves the
 * border colour and adds a shadow and touches the background of nothing.
 */
const ROW_TINT = {
  waiting: "bg-[var(--bg)]",
  filled: "bg-[color-mix(in_srgb,var(--pos)_12%,var(--bg))]",
  next: "bg-[color-mix(in_srgb,var(--now)_14%,var(--bg))]",
} as const;
const ROW_EDGE = {
  line: "border-[var(--line)]",
  filled: "border-[color-mix(in_srgb,var(--pos)_34%,var(--line))]",
  next: "border-[color-mix(in_srgb,var(--now)_42%,var(--line))]",
  selected: "border-[var(--text)]",
} as const;
/**
 * AN ARBITRARY PROPERTY RATHER THAN `shadow-[…]`, and measured before it was written.
 * Tailwind's shadow utility composes with its ring and inset variables, so the ring
 * arrives behind four transparent layers: `rgba(0,0,0,0) 0 0 0 0, …, rgb(231,233,238) 0
 * 0 0 1px`. Nothing paints differently, but the computed value stops being the deleted
 * rule's, and parity by computed value is what this migration is checked by. The property
 * form computes byte-for-byte what the rule did.
 */
const ROW_RING = "[box-shadow:0_0_0_1px_var(--text)]";

/**
 * Dashed, per G-D12: a declared rung with no order is not a state the ladder is in, it is
 * one it never entered. SELECTION FORCES IT SOLID, which is what the deleted rule's
 * `border-style: solid` did — a selected never-placed rung stops being dashed while it is
 * the one under inspection.
 */
function rungRowClasses(rung: FillPathRungView, isSelected: boolean): string {
  const tint = rung.isNext
    ? ROW_TINT.next
    : rung.filled
      ? ROW_TINT.filled
      : ROW_TINT.waiting;
  const edge = isSelected
    ? ROW_EDGE.selected
    : rung.isNext
      ? ROW_EDGE.next
      : rung.filled
        ? ROW_EDGE.filled
        : ROW_EDGE.line;
  const style = rung.notPlaced && !isSelected ? "border-dashed" : "border-solid";
  return `${ROW} ${tint} ${edge} ${style}${isSelected ? ` ${ROW_RING}` : ""}`;
}

/**
 * Centred against the whole tile rather than sat on the price's baseline: the rung number
 * labels the tile, not the first figure in it. At desk width the row centres its items
 * and the gutter goes back to sharing that alignment.
 */
const ROW_INDEX =
  "self-center text-[0.78rem] font-semibold tracking-[0.03em] text-[var(--muted)]" +
  " @[380px]/fp-list:self-auto";
/** The two numbers that describe a rung, stacked in the order the chart plots them. */
const ROW_FIGURES = "grid gap-px min-w-0";
const ROW_PRICE = "text-[1.05rem] font-bold tracking-[-0.01em] tabular-nums";
/**
 * THE SIZE AND ITS `@`, DEMOTED TOGETHER — the row is scanned down the price column, so
 * the price keeps its weight and everything leading up to it steps back. Weight AND
 * colour, unlike the inspect card's colour-only demotion: a list row is read at a glance
 * rather than as a sentence, and 700-weight grey still reads as loud. Its own string
 * rather than the shared muted one so it stays legible against the two state tints, which
 * already move the row's colour.
 */
const ROW_SIZE = "font-normal text-[var(--muted)]";
/** The preposition recedes one step further than the figure it follows. */
const ROW_AT = "opacity-70";

/**
 * THE STATE COLUMN DISSOLVES AT 320px. Even with the price sized, the remainder is ~80px
 * and `price passed, unconfirmed` cannot go in — no width is guaranteed to hold a pill.
 * `display: contents` dissolves the wrapper so its three children become items of the
 * ROW's grid: the two status lines stay on the right rail in column 3 and the qualifiers
 * take a full-width line of their own. It is the one thing CSS can do here that the
 * markup's nesting otherwise forbids, and it costs no change to the elements below.
 */
const ROW_STATE =
  "contents @[380px]/fp-list:grid @[380px]/fp-list:justify-items-end" +
  " @[380px]/fp-list:gap-[3px] @[380px]/fp-list:text-right";
const ROW_LINE = "col-start-3 text-right @[380px]/fp-list:col-start-auto";
/** Sentence case from a lower-case wire label without touching the string. */
const ROW_STATUS = `${ROW_LINE} text-[0.82rem] font-bold first-letter:uppercase`;
/**
 * ONE COLOUR REACHES THE STATUS WORD, and which one is a fact about this map rather than
 * about rule order. Never-placed beats next beats filled, which is the order the three
 * deleted context rules were written in. The ordinary rung is the empty string on purpose:
 * its status had no rule and inherited the row's colour, and a `text-` utility here would
 * be a declaration the file never carried.
 */
const ROW_STATUS_TONE = {
  unplaced: "text-[var(--muted)]",
  next: "text-[var(--now)]",
  filled: "text-[var(--pos)]",
  plain: "",
} as const;
/** The venue's word, under the spot-derived one: quiet, but present — two claims. */
const ROW_SUBSTATUS = `${ROW_LINE} text-[0.72rem] text-[var(--muted)]`;
/**
 * A FULL-WIDTH LINE OF ITS OWN AT 320px. A pill cannot be made narrower than its longest
 * word, so it is given the whole tile rather than a column that might not hold it; still
 * right-aligned, so it hangs off the same rail as the status above.
 */
const ROW_QUALS =
  "flex flex-wrap justify-end gap-1 col-span-full mt-1" +
  " @[380px]/fp-list:col-auto @[380px]/fp-list:mt-0";
/** 12px of its own, which is what the deleted rule set over slice 2's shared 4px. */
const ORPHANS = "m-0 mt-3 text-[0.8rem] text-[var(--muted)]";

function RungList() {
  const { view, selected, select } = useFillPath();
  return (
    <Card className={LIST_CARD}>
      <Card.Title className={CARD_HEADING}>Rungs</Card.Title>
      <ul className={LIST_ITEMS}>
        {view.rungs.map((rung) => (
          <li key={rung.key}>
            <button
              type="button"
              className={rungRowClasses(rung, rung.key === selected?.key)}
              aria-current={rung.key === selected?.key ? "true" : undefined}
              onClick={() => select(rung.key)}
              onFocus={() => select(rung.key)}
            >
              <span className={ROW_INDEX}>R{rung.ladderIndex}</span>
              {/* ONE LINE, THE SAME SENTENCE THE INSPECT CARD LEADS WITH — see
                  `RungHeadline`. It was two stacked figures, `$57,500.00` over `$149.96`,
                  which made the reader pair them and printed a `$` eight times down a
                  column that is USD throughout. No unit mark here at all: the inspect card
                  says `USD` once for the ladder and the header card says it again.

                  ABSENT IS STILL THE EM-DASH AND ITS CAUSE, never a `0`: a rung whose size
                  the snapshot does not carry has not declared zero capital. It keeps the
                  `@ price` beside it, so the row still says which rung is missing it. */}
              <span className={ROW_FIGURES}>
                <span
                  className={
                    rung.notPlaced ? `${ROW_PRICE} text-[var(--muted)]` : ROW_PRICE
                  }
                >
                  {/* MUTED, FOR THE SAME REASON AS THE INSPECT CARD'S — the column is
                      ordered by price and scanned by price, so price carries the weight
                      and the size trails it. Keeping both at accent weight made every
                      row two competing headlines. */}
                  <span className={ROW_SIZE}>
                    {rung.sizeUsd === undefined ? (
                      <Absent why="size not carried" />
                    ) : (
                      SIZE_PLAIN.format(rung.sizeUsd)
                    )}{" "}
                    <span className={ROW_AT}>@</span>
                  </span>{" "}
                  {PRICE_PLAIN.format(rung.priceUsd)}
                </span>
              </span>
              <RowState rung={rung} />
            </button>
          </li>
        ))}
      </ul>

      {/* THE ORPHAN BUCKET — recorded lots no declared rung explains. A count, never
          the lots: the conclusion crosses the wire and the position data does not. */}
      {view.orphanLots !== undefined && view.orphanLots > 0 ? (
        <p className={ORPHANS}>
          {view.orphanLots} recorded {view.orphanLots === 1 ? "lot" : "lots"} that no
          declared rung explains.
        </p>
      ) : null}
    </Card>
  );
}

/**
 * THE RIGHT-HAND COLUMN — what state this rung is in, loudest thing first, and BLANK on
 * the ordinary rung.
 *
 * ── "WAITING" IS THE DEFAULT, AND A DEFAULT PRINTED EIGHT TIMES IS WALLPAPER ──────────
 * Every rung on an unwalked ladder is waiting, so the word ran down the whole column and
 * distinguished no row from any other — while the states that DO matter (filled, partly
 * filled, never placed, cancelled) had to compete with it for the reader's eye. An empty
 * state column now MEANS waiting, and the exceptions are the only things in it.
 *
 * The suppression is on `venueResting` — the venue holds an order and has consumed none of
 * it — and never on `rung.waiting` or `rung.resting`, either of which would blank the
 * column on a rung that is 40% filled. `declared — not placed`, `cancelled — fills
 * recorded against it`, every `filled` variant and `fill state unavailable` all still
 * print, in the same place, unchanged. See `Pills` for why it is a fact and not the words.
 *
 * `next` IS PROMOTED OVER THE STATE, NOT SUBSTITUTED FOR IT. Being next is the fact the
 * operator opened the page about, so it takes the strong line; but `next` is a fact about
 * SPOT and the state is a fact about the VENUE, and one cannot stand in for the other — a
 * rung can be next AND partly filled, or next AND never placed. So any state other than
 * plain resting still rides the line beneath. What is dropped is only the `waiting`
 * sub-line under `next`, which the view module already guarantees is implied.
 *
 * ── "MATCHED BY PRICE" IS DROPPED FROM THE ROW ────────────────────────────────────────
 * The distinction it drew is real — `joinProvenance` is `"declared" | "price-matched"`,
 * and a price-matched rung was joined to its order by a guess rather than by an id the
 * plan carried. But the guess is how a limit ladder normally reconciles, so the caption
 * marked the ordinary case and left the reader nothing to compare it against.
 *
 * WHAT THE CAPTION WAS ACTUALLY GUARDING SURVIVES ELSEWHERE. The one moment the join's
 * provenance bites is when a DECLARED join turns out to sit at a different price, and that
 * has its own row on the inspect card (`Order placed at … differs from the declared rung`)
 * driven by `declaredPriceMismatch`, not by this flag. `matchedByPrice` stays on the view
 * contract with its tests: it is a decided conclusion the UI has chosen not to draw, and
 * unpicking the view module for a presentation call would be the wrong layer to edit.
 *
 * THE UNPLACED PILL IS GONE because `stateCopy` already reads `declared — not placed` for
 * exactly that rung; the pill was the same sentence twice. The row's dashed border still
 * carries it visually, per G-D12.
 */
/**
 * WHICH OF THE FOUR TONES THE STATUS WORD TAKES, in the order the deleted context rules
 * were written in: `.is-unplaced` sat below `.is-next`, which sat below `.is-filled`, so
 * a rung that is two of them at once takes the last one's colour. Written as a lookup
 * rather than as three class-name concatenations, because that is the shape the cascade
 * had and utilities cannot reproduce it any other way.
 */
function statusTone(rung: FillPathRungView): keyof typeof ROW_STATUS_TONE {
  if (rung.notPlaced) return "unplaced";
  if (rung.isNext) return "next";
  if (rung.filled) return "filled";
  return "plain";
}

function RowState({ rung }: { rung: FillPathRungView }) {
  // THE ORDINARY RUNG, decided on the venue axis and not on what it is called.
  const stateIsDefault = rung.venueResting;
  const status = rung.isNext ? "next" : stateIsDefault ? undefined : rung.stateCopy;
  const substatus = rung.isNext && !stateIsDefault ? rung.stateCopy : undefined;
  const hasQuals =
    rung.pricePassedUnconfirmed || rung.filledPercent !== undefined;

  // NOT AN EMPTY SPAN — the column is a grid cell with its own spacing, and an empty one
  // still claims the width it would need for a status that is not there.
  if (status === undefined && !hasQuals) return null;

  return (
    <span className={ROW_STATE}>
      {status === undefined ? null : (
        <span className={`${ROW_STATUS} ${ROW_STATUS_TONE[statusTone(rung)]}`}>
          {status}
        </span>
      )}
      {substatus === undefined ? null : (
        <span className={ROW_SUBSTATUS}>{substatus}</span>
      )}
      {hasQuals ? (
        <span className={ROW_QUALS}>
          {rung.pricePassedUnconfirmed ? (
            <span className={`${PILL} ${PILL_TONE.inferred}`}>price passed, unconfirmed</span>
          ) : null}
          {rung.filledPercent === undefined ? null : (
            <span className={`${PILL} ${PILL_TONE.state}`}>
              partly filled · {rung.filledPercent}%
            </span>
          )}
        </span>
      ) : null}
    </span>
  );
}

/**
 * THE PROVENANCE FOOTER IS GONE, AND ITS THREE PARAGRAPHS ARE NOT LOST — deliberately
 * recorded here, because "a card was deleted" and "three facts were dropped" are
 * different edits and the next reader deserves to know which one this was.
 *
 *   PRECISION → the leading `~`. Which figures are measured and which are projected is
 *     now marked on the figures themselves; see this file's header for the rule.
 *   COMPLETENESS → `RecordedThrough`, in the selected-rung card, beside the `State` the
 *     cutoff actually bounds.
 *   SPOT → `SpotReadout`, in the corner of the header card, where the operator looks
 *     first rather than last.
 */
