import { createContext, useContext, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { formatUsd } from "@numisma/engine/format";

import { Absent } from "./absent";
import type { DcaPositionView } from "./dca-card";
import type { FillPathRungView, MeasuredFigure } from "./price-drop-path-chart";

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
 * THREE OF THEM HAVE NO CONSUMER IN THIS FILE YET, and that is transitional rather than
 * dead. `SPOT_LABEL` is `SpotReadout`'s, `TILE_LABEL` is `ExpectedRow`'s hero label and
 * `Chart`'s inspect label, `TILE_VALUE` is also `Waiting`'s figure — all of them still in
 * `apps/web`, reading these by subpath until spec #439's S7 and S8 bring their components
 * across.
 *
 * THE CONTAINER NAME IS `fp-header`, AND IT IS DECLARED BY THE CARD, NOT HERE. Every
 * `@[380px]/fp-header:` variant below is a read of a container the header card names;
 * the tiles reflow with that card and with nothing else.
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
 * ── THE TRANSITIONAL SUBPATH SURFACE (spec #439 S6, removed at S9) ───────────────────
 *
 * `RAIL`, `TILE_LABEL`, `SPOT_LABEL`, `STACKED_LABEL`, `TILE_VALUE`, `Figure`,
 * `Expectation` and `formatUnits` are exported from this MODULE and are deliberately
 * absent from `src/index.ts`. `apps/web/src/components/FillPath.tsx` reads them at
 * `@numisma/components/ui/fill-path.tsx` while its six remaining components wait for S7
 * to S9, and that import dies with the last of them rather than becoming public surface
 * someone has to unpublish later. `tokens.ts` and `ui/price-drop-path.ts` set the same
 * precedent; the exports map already carries `"./*"`.
 *
 * `RAIL_LABEL`, `TILE` and `TILE_ABSENT` are module-private because nothing outside this
 * file reads them, today or transitionally.
 */
export { RAIL, SPOT_LABEL, STACKED_LABEL, TILE_LABEL, TILE_VALUE };
