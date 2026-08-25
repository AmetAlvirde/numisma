import type { ReactElement } from "react";
import {
  Absent,
  Card,
  useFillPath,
  FillPathProvider,
} from "@numisma/components";
/**
 * ── THE TRANSITIONAL SUBPATH IMPORT (spec #439 S6, and it dies at S9) ────────────────
 *
 * The seam, the shared helpers and — since S7 and S8 — three of the four cards all live
 * in the package; `RungList` does not, and it reads what those moves left behind.
 * `FillPathProvider` and `useFillPath` come from the curated index above, because the
 * ladder route's runtime closure already allows the bare `@numisma/components` specifier
 * and because those two are the seam itself. EVERYTHING ON THIS LINE IS DIFFERENT: these
 * are internals of `ui/fill-path.tsx` with no business on the package's public surface,
 * so they cross by subpath and the whole import disappears when S9 takes the last part,
 * rather than leaving names someone has to unpublish later.
 *
 * TEN NAMES, AND THIS IS THE WIDEST THE LINE EVER GETS. Five are the elements the frozen
 * object and `FillPathCards` still assemble from over there. Five are vocabulary the
 * unmoved list reads: `CARD_HEADING` is the heading rule all three ladder cards share and
 * `RungList`'s `Rungs` title is the third arm of it; `PILL` and `PILL_TONE` paint
 * `RowState`'s two qualifier pills; `SIZE_PLAIN` and `PRICE_PLAIN` are the two formatters
 * the moved panel's headline and the rung rows both use, and the two surfaces must not
 * print the same price two ways. Duplicating any of the five here would be two spellings
 * of one rule for one slice's lifetime.
 *
 * `TILE_LABEL` IS GONE FROM THIS LINE. Its last app-side consumer was `Chart`'s
 * inspect-slider label, which moved with `Chart` at S8, and the name went module-private
 * in the package in the same diff. S7 retired seven names the same way. Every one of them
 * crossed for a component that has now landed over there, so each comes off this line in
 * the diff that moves its caller rather than in a sweep at S9.
 */
import {
  CARD_HEADING,
  Chart,
  Header,
  PILL,
  PILL_TONE,
  PRICE_PLAIN,
  SelectedRung,
  SIZE_PLAIN,
  TornActBanner,
  UnrecordedWarnings,
} from "@numisma/components/ui/fill-path.tsx";
import type { FillPathRungView, FillPathView } from "../ladder/fill-path-view.ts";

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
 * THE PARTS, ATTACHED AS PLAIN PROPERTIES (grill D4, the same shape `Card` uses).
 * `FillPath.RungList` is the call-site vocabulary, and mounting one property on its own
 * is how each card's half of the accessibility contract is asserted without its three
 * siblings standing in for it.
 *
 * ASSEMBLED FROM BOTH SIDES, AND ONLY UNTIL S9. `Header`, `Chart` and `SelectedRung` are
 * named exports of `@numisma/components/ui/fill-path.tsx` — the first as of spec #439 S7,
 * the other two as of S8; `RungList` is still a bare function in this file, attached as a
 * property below. That mixed assembly is the visible shape of the transition and it is
 * temporary by construction: it cannot survive S9, which deletes the file it lives in. A
 * per-part test reaches `FillPath.Header`, which is what it has always done.
 *
 * THE ONE THAT IS STILL LOCAL IS NOT NAMED-EXPORTED. This docblock claimed all four were
 * until spec #439 S6 read it against the code, and the frozen object is this file's only
 * export of a part.
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
