import { createContext, useContext, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { formatUsd } from "@numisma/engine/format";

import { Absent } from "./absent";
import { Card, CARD_SURFACE } from "./card";
import type { DcaPositionView } from "./dca-card";
import type { FillPathRungView, MeasuredFigure } from "./price-drop-path-chart";
import { NOTICE_CODE } from "./snapshot-notice";

/**
 * ── THE FILL PATH'S VIEW CONTRACT, DECLARED HERE (spec #439 §4.1, S6) ────────────────
 *
 * `apps/web/src/ladder/fill-path-view.ts` keeps every line of `composeFillPathPage` and
 * imports these types back from `@numisma/components`. The consumer defines the
 * interface, which is the standard direction and also the only one that lets a cosmos
 * fixture build a `FillPathView` literal without importing `apps/web` — the crossing
 * `seam-isolation.test.ts` forbids.
 *
 * NOTHING HERE DECIDES ANYTHING. Every flag, count, coordinate and absence cause below
 * arrives already decided from the composer. What the package owns is the SHAPE, and the
 * shape is what a fixture can be authored against.
 */

/**
 * WHAT THE DECLARED LADDER WOULD ACQUIRE IF IT WERE WALKED — an INTENTION, and a
 * separate type from `MeasuredFigure` for exactly that reason.
 *
 * `MeasuredFigure` means "a figure that was measured, or the named reason it was not",
 * and its whole job is that no projection can ever stand where a measurement belongs. An
 * expectation is a third thing: nothing was measured and nothing failed to be measured,
 * because there was nothing to measure yet. Giving it its own type is what stops a
 * refactor from quietly passing these numbers to `<Figure>` and printing a projection
 * under the label `Deployed`. The word "Expected" in the UI copy is the operator-facing
 * half of that guarantee; this type is the half that survives the next edit.
 *
 * BOTH NUMBERS ARE DERIVED FROM RUNGS THE OPERATOR DECLARED, and from nothing else. No
 * order, no lot and no venue reading is involved.
 */
export interface ExpectedFigures {
  /** Σ over declared rungs of `sizeUsd / priceUsd` — units, if every rung filled. */
  units: number;
  /**
   * Total declared USD ÷ expected units.
   *
   * THIS IS A SIZE-WEIGHTED HARMONIC MEAN OF THE RUNG PRICES, NOT THE ARITHMETIC MEAN.
   * A DCA ladder is convex — the lower rungs commit more capital and buy more units per
   * dollar — so averaging the prices would overstate the entry the ladder is aiming at,
   * by more the more convex the operator made it. It is derived from the two totals here
   * precisely so no caller is tempted to average prices instead.
   */
  avgEntryUsd: number;
}

/** Whether a torn act was found, cleared, or never looked for. */
export type TornActReading =
  | { status: "outstanding"; count: number }
  | { status: "clear" }
  | { status: "unchecked" };

export interface ChartCircle {
  key: string;
  cx: number;
  cy: number;
  filled: boolean;
  next: boolean;
}

/**
 * Hand-rolled SVG geometry, and a type narrower than it looks.
 *
 * The picture is drawn by `PriceDropPathChart` off `price-drop-path.ts` (ADR-018), and
 * the only field with a live consumer is `nowX`, read as a message chain to answer "is
 * spot live". Finishing that demolition — and promoting `spotIsLive` to a named boolean
 * so the chain goes away — is **slice 3 of spec #285**, which owns this code.
 */
export interface ChartGeometry {
  width: number;
  height: number;
  /** `"x,y x,y …"`, ready for a `<polyline points>`. */
  points: string;
  circles: readonly ChartCircle[];
  /** x of the "now" line. Absent unless spot is LIVE — a last close is not now. */
  nowX?: number;
}

/**
 * WHICH OF THREE THINGS IS TRUE about the waiting capital, decided by the composer
 * rather than in JSX. `nothing-waiting` is a fully walked ladder; `all-resting` is every
 * waiting dollar encumbered at the venue; `partly-unplaced` is the split that makes
 * hidden encumbrance visible. Two arms cannot say this: an `else` on `neverPlacedUsd > 0`
 * prints "all of it is resting at the venue" for a ladder with nothing resting at all.
 */
export type WaitingSplit =
  | "nothing-waiting"
  | "all-resting"
  | "partly-unplaced";

export interface FillPathFigures {
  waitingDeclaredUsd: number;
  waitingRestingUsd: number;
  /**
   * Declared but NEVER PLACED — the whole of what the two waiting totals disagree
   * about. See `fill-path-view.ts`'s header for why it is not an unfilled-vs-open split.
   */
  neverPlacedUsd: number;
  split: WaitingSplit;
}

/** The whole page, decided. */
export interface FillPathView {
  planId: string;
  positionId: string;
  /** What the header calls this ladder. NEVER the plan id — a UUID is a join key. */
  title: string;
  /**
   * `DcaPositionRow["state"]`, READ BY NAME FROM THE ONE PLACE THIS PACKAGE SPELLS IT
   * (spec #439 §4.1). `dca-card.tsx` wrote the union out when `DcaPositionView` crossed;
   * a second copy here would be two spellings of one fact, drifting silently in exactly
   * the direction the type direction was chosen to close. `composeFillPathPage` assigning
   * `row.state` into this field is the compile-time pin that catches a fifth state, and
   * it only works against ONE name.
   */
  state: DcaPositionView["state"];
  /** Whether a reconciliation ran for this row at all — absence rule 2. */
  reconciled: boolean;
  deployed: MeasuredFigure;
  unitsAcquired: MeasuredFigure;
  avgEntry: MeasuredFigure;
  /**
   * DAY ZERO — a reconciliation RAN and found nothing filled. See `hasNotStarted`.
   *
   * This is NOT the same question as "are the three measured figures absent", even
   * though today the answer coincides: `figures` absent (absence rule 2) also leaves
   * all three absent, and that ladder has NOT been established as unstarted — it was
   * never checked. `false` here therefore covers both "something has filled" and "we
   * could not tell", which are different facts and stay different downstream.
   */
  notStarted: boolean;
  /**
   * The declared ladder's own projection — present ONLY on a `notStarted` ladder that
   * declares enough to project from (see `expectedFigures`). Absent everywhere else,
   * including on any ladder that has started: once a real fill exists, the measured
   * figures are the answer and an expectation beside them would compete with it.
   */
  expected?: ExpectedFigures;
  /**
   * ABSENT WHEN NO RECONCILIATION RAN — absence rule 2, held all the way to the render.
   * These two totals are present at zero (zero waiting capital is a real answer) but
   * only when there was something to measure them from; reading an absent `figures` as
   * `0` would print a capital figure and an all-clear off a row that could not check.
   */
  figures?: FillPathFigures;
  rungs: readonly FillPathRungView[];
  /**
   * Recorded lots no declared rung explains. Absent-at-zero ON THE WIRE (rule 5) — but
   * absent HERE means the same thing `figures` absent means, because rule 5's
   * unambiguity comes entirely from `figures` sitting beside it saying a reconciliation
   * ran. Without that neighbour, `0` would state "none unexplained" from an absence.
   */
  orphanLots?: number;
  tornActs: TornActReading;
  /** The two unrecorded-fill warnings, counted APART: their certainties differ. */
  warnings: { filledNotRecorded: number; pricePassedNoFill: number };
  /** How far down the ladder the walk has got. Present whenever a reconciliation ran. */
  progress?: { filledRungs: number; totalRungs: number; percent: number };
  chart?: ChartGeometry;
  /** The chart's accessible substitute. Absent when the ladder carries no shape. */
  caption?: string;
  /** The price the page is decorated with — live, or the last close it fell back to. */
  spotUsd?: number;
  /** True when the fetch failed. Every spot-independent fact still renders. */
  spotUnavailable: boolean;
  spotLoading: boolean;
  /**
   * THE BOUNDARY OF WHAT THIS ROW COULD HAVE KNOWN — the anchor's own `asOf`, passed
   * through verbatim. Not a clock, not a wire date (the `dca` branch carries none, and
   * three invariants depend on it staying that way), not a fill timestamp.
   */
  recordedThrough: string;
}

/**
 * ── THE SHARED CLASS-STRING CHAIN (spec #439 §4.1, S6) ───────────────────────────────
 *
 * Nine strings, and they travel together because the code composes them into one
 * another. `Figure` and `Expectation` below read `TILE`, `STACKED_LABEL`, `TILE_VALUE`,
 * `TILE_ABSENT` and `EXPECTED_VALUE`; `STACKED_LABEL` composes down through `SPOT_LABEL`,
 * `RAIL_LABEL` and `TILE_LABEL` to `RAIL`. Splitting the chain at any link would fork a
 * string, which is the one thing the composition exists to prevent.
 *
 * EVERY LINK NOW HAS A CONSUMER IN THIS FILE. S6 left three of them reaching back into
 * `apps/web` by subpath: `SPOT_LABEL` for `SpotReadout`, `TILE_VALUE` for `Waiting`'s
 * figure, `TILE_LABEL` for `ExpectedRow`'s hero label. Spec #439's S7 brought all three
 * of those components across, so the only name still crossing the boundary is
 * `TILE_LABEL`, read a second time by `Chart`'s inspect-slider label until S8.
 *
 * THE CONTAINER NAME IS `fp-header`, AND THE HEADER CARD DECLARES IT — `HEADER_CARD`,
 * below, which arrived with S7. Every `@[380px]/fp-header:` variant in this file is a
 * read of that container; the tiles reflow with the header card and with nothing else.
 */

/** The narrow row every data block on the header card is: label left, figure hard right. */
const RAIL = "flex flex-wrap items-baseline justify-end gap-x-[10px] gap-y-0 m-0 min-w-0";

/**
 * THE LABEL IS THE ONLY THING THAT GIVES. `flex-[1_1_0]` — a ZERO basis, not `auto` — is
 * what makes "Expected average entry" wrap to two lines instead of shoving its figure
 * onto a line of its own: the label is prose and survives a break, the number is the
 * thing being aligned and must not leave the rail.
 *
 * ONE COLOUR READ, REACHED BY FOUR NAMES. `RAIL_LABEL`, `SPOT_LABEL` and
 * `STACKED_LABEL` all compose from this string, so the tile label's grey is written
 * once here and nowhere else. `--nms-muted-foreground` is `apps/web`'s `--muted`, its
 * secondary TEXT grey — never `--nms-muted`, which is a recessed SURFACE and would
 * compile, emit a rule and paint this label wrong.
 */
const TILE_LABEL =
  "text-[0.7rem] font-semibold uppercase tracking-[0.04em] text-[var(--nms-muted-foreground)]";
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
 * A PROJECTION READS QUIETER THAN A MEASUREMENT, in two ways at once. The grey is the
 * one every other unmeasured thing on this page already uses, and 0.95rem is the step
 * down the deleted `.fp-tiles-quiet .fp-tile-value` rule used to make. That rule was a
 * CONTEXT — a descendant selector on the wrapper — and it collapses into this one string
 * because `Expectation` is the only thing that ever rendered inside that wrapper. Both
 * sizes are spelled once, never as a base plus an override: `TILE_VALUE`'s 1.05rem and
 * this 0.95rem are unvariant `font-size` utilities and would race each other on one
 * element.
 */
const EXPECTED_VALUE =
  "flex-none text-right text-[0.95rem] tabular-nums text-[var(--nms-muted-foreground)] @[380px]/fp-header:text-left";

/** One measured tile: the figure, or the named reason there is none. Never a `$0`. */
export function Figure({
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
 * construction: a `~` claims the number is not a measurement, and the two kinds of figure
 * that owe one are a projection and a rounded rendering of a figure printed exactly
 * elsewhere.
 */
export function Expectation({
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
export function formatUnits(value: number): string {
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
 * seam it was `FillPathCards`' JSX, translating index to key on the way down and key to
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

/**
 * The context, or a loud failure.
 *
 * EXPORTED, AND SPEC #439 S6 IS WHY. This used to say "read by the parts; never
 * exported", which was true while the parts sat in the same file. They no longer do:
 * `Header`, `Chart`, `SelectedRung` and `RungList` are still in `apps/web` and read this
 * provider across the package boundary until S7 to S9 bring them over. It is lowercase,
 * so `fixture-coverage.test.ts` demands no fixture for it, and it goes on the curated
 * index rather than crossing by subpath because that is the specifier the ladder route's
 * runtime closure already allows.
 *
 * WHAT THAT COSTS, SO S9 DOES NOT HAVE TO DISCOVER IT: once the last part lands here,
 * this is published surface with no caller outside the package. Wave 3 decides whether to
 * withdraw it; wave 2 does not.
 */
export function useFillPath(): FillPathSelection {
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
 * value on the page arrives already decided from `apps/web/src/ladder/fill-path-view.ts`.
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
 * The four parts read `useFillPath` instead. Not because this shape is wrong for them,
 * but because it is deliberately NARROWER than any of them needs: every part also reads
 * `view` — the card that is the page's title, the panel that counts rungs, the list that
 * renders them — and `Chart` needs `selectIndex` as well. A part consuming this hook
 * would call the wider one beside it for the rest, which is two reads of one context to
 * satisfy a signature.
 *
 * The alternative was to delete it and let Seam E be `useFillPath` until the workbench
 * needs the narrow shape. It stays because the shape is the seam's stated contract: what
 * a component outside this module is allowed to know about the selection is these three
 * fields and NOT `view`, which is exactly the boundary the workbench's fixture mounts
 * against. Publishing the narrow surface is what keeps `view` from leaking into the next
 * consumer's props by default.
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
 * ── THE HEADER CARD'S SECTION, AS UTILITIES (spec #420 slice 7, moved by #439 S7) ────
 *
 * `styles.css` opened the fill path with about three hundred lines covering this one
 * card: an identity row, a state chip, a spot reading, three tiles, a progress bar, the
 * waiting block, day zero's hero and TWO `@container fp-header` blocks reflowing most of
 * it at 380px. Every declaration in that section is one of the strings below, and
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
 * `1px solid currentColor`, so the chip's edge is whatever its text is, and the four
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
 *
 * `--nms-muted-foreground` IS THE SECONDARY TEXT GREY, never `--nms-muted`, which is a
 * recessed SURFACE and would compile, emit a rule and paint two of these arms wrong.
 * `tokens.ts`'s header holds that argument; no guard in the repo can catch the wrong
 * name inside the right namespace.
 */
const BADGE_TONE: Record<FillPathView["state"], string> = {
  pending: "text-[var(--nms-muted-foreground)]",
  active: "text-[var(--nms-pos)]",
  ended: "text-[var(--nms-muted-foreground)]",
  unreadable: "text-[var(--nms-warn)]",
};

/**
 * SPOT IS CONTEXT, NOT THE ANSWER. It reads in the muted foreground like every other
 * reference figure on the card, which leaves Waiting as the one accented number.
 *
 * At 380px it becomes the corner figure again — label over value, right-aligned, no rule
 * under it — which is why the border and the padding both have an arm that removes them.
 */
const SPOT =
  `${RAIL} mb-3 pb-[10px] border-b border-b-[var(--nms-border)]` +
  " @[380px]/fp-header:flex-col @[380px]/fp-header:items-end @[380px]/fp-header:gap-x-0" +
  " @[380px]/fp-header:gap-y-px @[380px]/fp-header:pb-0 @[380px]/fp-header:border-b-0" +
  " @[380px]/fp-header:text-right";
const SPOT_VALUE =
  "flex-none text-right text-[1.05rem] tabular-nums text-[var(--nms-muted-foreground)]";
const SPOT_NOTE = "m-0 mt-1 text-[0.7rem] text-[var(--nms-muted-foreground)]";
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
const PROGRESS_TRACK = "h-1.5 overflow-hidden rounded-[3px] bg-[var(--nms-border)]";
const PROGRESS_FILL = "h-full bg-[var(--nms-pos)]";
const PROGRESS_NOTE = "m-0 mt-1.5 text-[0.78rem] text-[var(--nms-muted-foreground)]";

/**
 * The measured-layout waiting block takes the SAME row shape as the tiles above it, with
 * its sentence breaking to a full-width line under both. `flex-[1_0_100%]` is what forces
 * that break, so the sentence never tries to share the rail with the number it explains.
 */
const WAITING =
  "flex flex-wrap items-baseline justify-end gap-x-[10px] border-t border-t-[var(--nms-border)] pt-3" +
  " @[380px]/fp-header:flex-col @[380px]/fp-header:items-stretch" +
  " @[380px]/fp-header:justify-start @[380px]/fp-header:gap-y-[2px]";
const WAITING_SUB =
  "flex-[1_0_100%] m-0 mt-1 text-[0.78rem] text-pretty text-[var(--nms-muted-foreground)]";

/**
 * DAY ZERO'S BLOCK — a headline figure and two quiet projections under it.
 *
 * THE HERO STEPS OUT OF THE RAIL, label above rather than beside: the rail is for the
 * reference rows and leaving it is half of what makes this figure read first. The other
 * half is size — the muted grey alone lost to the projections, whose strings are simply
 * longer, so the projections step DOWN in size as well as being muted.
 */
const EXPECTED = "mb-[14px]";
const HERO = "flex flex-col gap-px mb-3";
const HERO_VALUE =
  "text-[1.75rem] font-bold leading-[1.15] tracking-[-0.01em] tabular-nums";

/**
 * ── THE ONE CARD-SURFACED ELEMENT THAT SPELLS THE SURFACE ITSELF (spec #420 slice 8) ──
 *
 * Everything else that is painted like a card imports `CARD_SURFACE` and adds to it. This
 * banner cannot, because the deleted rule repainted the border: the shared string draws
 * the ordinary hairline and this banner's edge is the alarm red, and two unvariant
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
  "rounded-xl border border-[var(--nms-neg)] bg-[var(--nms-card)] p-4 text-[var(--nms-neg)]";
/**
 * THE SENTENCE STEPS BACK TO THE ORDINARY FOREGROUND. It is prose inside a block painted
 * in the alarm colour, and reading it in that colour too makes the whole card shout
 * instead of the one line that is the alarm.
 */
const TORN_BODY = "m-0 mt-1.5 text-[0.85rem] text-[var(--nms-foreground)]";
/**
 * `margin: 0`, ALL FOUR EDGES. The deleted rule zeroed the margin outright and, being
 * unlayered, beat the `mt-1` this paragraph carried from slice 2's shared-vocabulary
 * conversion. Reproducing the rule means dropping that `mt-1`; keeping it would open a
 * 4px gap nothing has ever rendered.
 */
const UNCHECKED = "m-0 text-[0.8rem] text-[var(--nms-muted-foreground)]";

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
const WARN_CERTAIN = `${WARN} border-l-4 border-l-[var(--nms-neg)]`;
const WARN_INFERRED = `${WARN} border-l-4 border-l-[var(--nms-warn)] [border-left-style:dashed] text-[var(--nms-muted-foreground)]`;

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
 * THE SWITCH IS `view.expected`, decided in `apps/web/src/ladder/fill-path-view.ts`, and
 * this file asks rather than re-derives. It is emphatically NOT "are the measured figures
 * absent": a ladder whose orders sidecar could not be read has all three absent too, and
 * it gets the ORIGINAL layout, because nothing about it has been established — least of
 * all that it has not started. Projecting onto that row would print a confident number
 * beside the sentence saying nothing could be checked.
 */
export function Header(): ReactElement {
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
function SpotReadout({ view }: { view: FillPathView }): ReactElement {
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
 * still computed and tested in `apps/web/src/ladder/fill-path-view.ts`, so the fact is
 * available to whatever surface wants to carry it; nothing renders it today.
 */
function ExpectedRow({
  expected,
  figures,
}: {
  expected: NonNullable<FillPathView["expected"]>;
  figures: NonNullable<FillPathView["figures"]>;
}): ReactElement {
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
function Waiting({ figures }: { figures: FillPathView["figures"] }): ReactElement {
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
 * ABOVE EVERYTHING, AND RED (G-D7/G-D12). The copy states the literal truth rather than
 * a severity: `record-fill` REFUSES to record anything while a torn act is outstanding,
 * so the operator is not being warned, they are being told why the next thing they try
 * will not work.
 *
 * ABSENCE IS NOT THE ALL-CLEAR (absence rule 3). A row that could not check says so, in
 * a quiet line — silence there would claim a check that never ran.
 *
 * NOT A PART, AND IT COORDINATES NOTHING (spec #439 S7). It reads the view and renders or
 * returns null, so it travels with the card it sits above rather than joining the frozen
 * `FillPath` object as an arrangement nobody would change.
 */
export function TornActBanner({ view }: { view: FillPathView }): ReactElement | null {
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
 * Between header and chart (G-D12), and VISUALLY DISTINCT because their certainties
 * differ. `filled at venue — not recorded` is a FACT the venue reported. `price passed,
 * no fill recorded` is INFERRED from spot: price traded through a resting order and the
 * venue has not said anything, which usually means nothing happened. Rendering them the
 * same would teach the operator to treat a certainty like a guess.
 */
export function UnrecordedWarnings({ view }: { view: FillPathView }): ReactElement {
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
 * ── THE TRANSITIONAL SUBPATH SURFACE (spec #439 S6, removed at S9) ───────────────────
 *
 * `TILE_LABEL` is exported from this MODULE and is deliberately absent from
 * `src/index.ts`. `apps/web/src/components/FillPath.tsx` reads it at
 * `@numisma/components/ui/fill-path.tsx` for `Chart`'s inspect-slider label, which waits
 * for S8, and the import dies with the last unmoved part rather than becoming public
 * surface someone has to unpublish later. `tokens.ts` and `ui/price-drop-path.ts` set the
 * same precedent; the exports map already carries `"./*"`.
 *
 * S7 RETIRED SEVEN NAMES FROM THE APP'S IMPORT — the six #447 tabulates, `Figure`,
 * `Expectation`, `formatUnits`, `STACKED_LABEL`, `TILE_VALUE` and `SPOT_LABEL`, plus
 * `RAIL`, which that table missed and which `SPOT` composes from. Every one of them
 * crossed for a component that has now landed here, so each came off the app's line in
 * the same diff that moved its caller. A stale name on that line is a name this package
 * can never make private again, which is why they go one slice at a time rather than in a
 * sweep at S9.
 *
 * `Figure`, `Expectation` and `formatUnits` stay MODULE exports without being on that
 * line: `apps/workbench/src/ui/fill-path.fixture.tsx` mounts all three directly.
 *
 * `Header`, `TornActBanner` and `UnrecordedWarnings` are named exports above and are
 * likewise absent from the index: publishing a bare capitalized function there makes
 * `fixture-coverage.test.ts` demand a fixture for it, and the per-part fixtures this wave
 * writes are a deliberate choice rather than a guard obligation.
 *
 * `RAIL_LABEL`, `TILE` and `TILE_ABSENT` are module-private because nothing outside this
 * file reads them, today or transitionally.
 */
export { TILE_LABEL };
