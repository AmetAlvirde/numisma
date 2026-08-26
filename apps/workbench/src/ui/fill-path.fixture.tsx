import { useEffect } from "react";
import {
  FillPathCards,
  FillPathProvider,
  useFillPathSelection,
} from "@numisma/components";
import {
  Chart,
  Expectation,
  Figure,
  formatUnits,
  Header,
  RungList,
  SelectedRung,
  TornActBanner,
  UnrecordedWarnings,
} from "@numisma/components/ui/fill-path.tsx";
import type { FillPathRungView, FillPathView } from "@numisma/components";
import {
  dayZeroView,
  outOfOrderView,
  overfilledView,
  partlyWalkedView,
  placedAtMismatchView,
  runglessView,
  singleRungView,
  spotLastCloseView,
  spotLoadingView,
  spotMissingView,
  tornOutstandingView,
  tornUncheckedView,
  unreadableSidecarView,
  unrecordedWarningsView,
} from "@numisma/components/ui/fill-path.fixtures.ts";

/**
 * THE FILL PATH, WHOLE — ITS FOUR CARDS, ITS SELECTION SEAM, ITS SHARED HELPERS AND THE
 * PAGE THEY COMPOSE INTO (spec #439 S6 through S9).
 *
 * A PROVIDER PAINTS NOTHING, which is the whole difficulty of staging a seam slice. So
 * this fixture does two separate jobs and they are deliberately not mixed:
 *
 *   1. THE PROBE proves the seam. `useFillPathSelection` is the surface a component
 *      outside the module is allowed to mount against — `select`, `selected` and
 *      `selectedIndex`, and NOT `view` — and the probe is written the way the workbench
 *      would write a consumer: the hook in, the selected rung's key and index out, and a
 *      row of buttons that call `select`. A fixture that showed a provider with no
 *      consumer would prove the module imports and nothing else.
 *   2. THE HELPER ROW gives the mode switcher something to look at. `Figure` in its known
 *      arm, `Figure` in its absent arm and `Expectation` with its leading `~` are the
 *      three shared helpers this slice moved, and between them they perform BOTH of the
 *      slice's colour reads.
 *
 * ── THE TWO READS, AND THEY ARE ONE OBSERVATION MADE TWICE ───────────────────────────
 * `--nms-muted-foreground`, and nothing else. It reaches the screen by two independent
 * routes: the TILE LABEL, through the `TILE_LABEL` → `RAIL_LABEL` → `SPOT_LABEL` →
 * `STACKED_LABEL` chain that every label in the row composes from, and the PROJECTION
 * VALUE, on `Expectation`'s own 0.95rem string. Same token, two strings, and a rewrite
 * that caught one and missed the other is exactly what this row is here to show.
 *
 * WHAT TO LOOK FOR IN APP MODE, which is what `apps/web` paints today reached through
 * the new spelling: `#9aa1ad` on all four tile labels AND on the `~` projection figures.
 * `#14161c` would mean `--nms-muted` — the recessed SURFACE — got welded onto the text
 * role, which is the substitution `tokens.ts`'s header is written against. The measured
 * figures beside them stay at the ordinary foreground, and that CONTRAST is the point:
 * a projection reads quieter than a measurement in colour and in size at once.
 *
 * WHAT TO LOOK FOR IN THEMED MODE: both move, together. A label that stayed grey while
 * the projection moved would mean one of the two strings is still reading the app's bare
 * `--muted`, which no guard in the repo can see from here.
 *
 * IN GRAYSCALE the row is reviewed on hierarchy rather than colour: label smaller than
 * figure, projection smaller than measurement, and the absent arm reading as a stated
 * cause rather than as a missing number. No `$0` is reachable in any mode — `Figure`'s
 * absent arm carries a cause string and never a zero.
 *
 * ── THE HEADER CARD, AND WHAT S7 ADDED (spec #439 S7) ────────────────────────────────
 * `Header` declares `@container/fp-header`, which is the container every
 * `@[380px]/fp-header:` variant in the module reads. S6's helper row below could only
 * show the narrow form, because the card that names the container was still in
 * `apps/web`; the header rows above it are the first thing in this repo that can stage
 * the WIDE reflow, and they stage it against the real card rather than faking the name.
 * The two widths sit side by side for exactly that reason.
 *
 * SEVEN TOKENS REACH THIS CARD, and every one of them must visibly move between app mode
 * and themed mode: `--nms-muted-foreground` (the chip's `pending` and `ended` arms, the
 * rung count, the spot figure and its note, the sidecar sentence, the unchecked line, the
 * inferred warning's text), `--nms-pos` (the `in force` chip, the progress fill),
 * `--nms-warn` (the `unreadable` chip, the inferred warning's edge), `--nms-border` (the
 * progress track, the rule under spot, the rule above the waiting block), `--nms-neg`
 * (the torn banner's border and headline, the certain warning's edge), `--nms-card` (the
 * banner's fill) and `--nms-foreground` (the sentence inside the banner).
 *
 * WHAT TO LOOK FOR IN APP MODE, which is what `apps/web` paints today reached through the
 * new spelling: the chip is `#9aa1ad` when pending, `#46c98b` when in force and `#8a5a12`
 * when unreadable; the progress track is `#262a33` under a `#46c98b` fill; the torn
 * banner is `#f0736a` on `#181b22` with an `#e7e9ee` sentence inside it. A chip that
 * stayed grey on `in force` would mean the total map lost an arm, which is the one failure
 * a base-plus-override cascade could produce and a total map cannot.
 *
 * ── THE CHART CARD AND THE SELECTED-RUNG PANEL (spec #439 S8) ───────────────────────
 * FOUR TOKENS REACH THESE TWO CARDS and all four must visibly move between app mode and
 * themed mode: `--nms-muted-foreground` on the price span, the panel headline's size and
 * its `@`, the exception shelf's term, the mismatch note and the completeness line;
 * `--nms-border` on two of the pill map's four arms and on the completeness line's
 * hairline; `--nms-warn` on the `inferred` pill; `--nms-now` on the `next` badge.
 *
 * WHAT TO LOOK FOR IN APP MODE, which is what `apps/web` paints today reached through the
 * new spelling: `#262a33` edges on `#9aa1ad` text for `state` and `unplaced`, `#8a5a12`
 * for `inferred` and `#e07a4f` for `next`. The `next` badge is NEVER green — green is the
 * colour that means filled, and the next rung is where price is heading. All four arms sit
 * on one rung in the pill row below, which is the only way to see that the map is total:
 * an arm rendering in the inherited text colour is what a lost map entry looks like.
 *
 * THE CHART'S LINES MUST BE VISIBLE, which is the half #445's gate check could not show —
 * it ran before `--nms-now` was minted and the strokes painted nothing. They are here.
 *
 * THE PANEL IS A LIVE REGION, so the probe sits under the same provider and changing the
 * selection while it is mounted is the observation: press a rung and the panel follows.
 * That is the seam's round trip and the panel's `aria-live` in one row.
 *
 * ── THE RUNG LIST, AND THE WHOLE PAGE (spec #439 S9) ────────────────────────────────
 * SIX TOKENS REACH THE LIST and all six must visibly move between app mode and themed
 * mode, INCLUDING THE TWO THAT ONLY EVER APPEAR INSIDE A `color-mix()`. The row's own
 * text and its focus ring read `--nms-foreground`; the tint map mixes `--nms-pos` and
 * `--nms-now` into `--nms-background`; the edge map mixes the same two into
 * `--nms-border`; the gutter, the size figure, a never-placed price, the sub-status and
 * the orphan line all read `--nms-muted-foreground`.
 *
 * WHAT TO LOOK FOR IN APP MODE, which is what `apps/web` paints today reached through the
 * new spelling: the row rests on `#0f1115`, tints toward `#46c98b` when filled and
 * `#e07a4f` when next, edges in `#262a33`, and rings in `#e7e9ee` when selected. A TINT
 * THAT PAINTS NOTHING AT ALL is the failure this row exists to show: a `color-mix()` with
 * one undefined argument computes to transparent while the rule sits present and correct
 * in the stylesheet, so a filled row that looks exactly like a waiting one means half a
 * mix was missed rather than that the tint is subtle.
 *
 * SELECTION IS A RING AND NEVER A FILL, which is why it is staged on a row that is
 * already tinted: a background swap would fight the state tint and could make a waiting
 * rung look filled while the operator inspected it.
 *
 * A RUNG THAT IS `next` AND PARTLY FILLED PRINTS `partly filled · 40%` TWICE — the
 * sub-line beneath `next` and the partial pill beside it. Visible on `partly-walked`'s
 * rung 4. That is what this card has always done; spec #439 is behaviour-preserving, so
 * it crossed unchanged and it is NOT a regression this wave introduced.
 *
 * `FillPathCards` IS THE WHOLE PAGE IN ONE FRAME, in all four ladder states, and it is
 * the first time anyone outside the app has been able to look at it. That is what this
 * wave was for.
 *
 * SYNTHESIZED. The view comes from `fill-path.fixtures.ts` beside the component, derived
 * from a hand-written app fixture whose own tests say so. Nothing here imports from
 * `apps/web`, which `seam-isolation.test.ts` holds, and no real transaction has been
 * near it.
 */

/** A titled band, so a mode switch is read row by row. */
function Row({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="mb-1 text-sm font-medium">{title}</h2>
      <p className="mb-3 text-xs text-foreground/60">{note}</p>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

const VIEW = partlyWalkedView();

/**
 * A CARD, MOUNTED AT A WIDTH. Every card in this module reads its OWN container —
 * `@container/fp-header` on the header, `@container/fp-selected` on the selected-rung
 * panel — so the only thing that decides which layout paints is how wide the card is
 * allowed to be. 320px is the phone the surface is judged on and anything past 380px is
 * the desk. Both are staged because the reflow is a real branch and a fixture that showed
 * one of them would review half a card.
 *
 * ONE HELPER FOR ALL THREE CARDS (spec #439 S8). It arrived with the header and took a
 * `children` slot when the chart and the panel landed, rather than each card re-solving
 * the container problem with a wrapper of its own.
 */
function CardAt({
  view,
  width,
  children,
}: {
  view: FillPathView;
  width: 320 | 560;
  children: React.ReactNode;
}) {
  return (
    <div style={{ width, maxWidth: "100%" }}>
      <FillPathProvider view={view}>{children}</FillPathProvider>
    </div>
  );
}

/** The same card at both widths, so the 380px reflow is one glance rather than two. */
function BothWidths({ view, children }: { view: FillPathView; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <CardAt view={view} width={320}>
        {children}
      </CardAt>
      <CardAt view={view} width={560}>
        {children}
      </CardAt>
    </div>
  );
}

const CHIP_STATES = ["pending", "active", "ended", "unreadable"] as const;

/**
 * ONE RUNG WITH ITS SIZE GENUINELY ABSENT — the key deleted, never set to `undefined`.
 * The package sets `exactOptionalPropertyTypes` and the two are different types; only
 * absence is what a v4 snapshot carrying no rung sizes composes to. The row then prints
 * the em dash and its stated cause and KEEPS the `@ price` beside it, so it still says
 * which rung is missing the figure. There is no branch that could print a `0` here.
 */
function withSizelessRung(view: FillPathView, index: number): FillPathView {
  return {
    ...view,
    rungs: view.rungs.map((rung, at) => {
      if (at !== index) return rung;
      const copy: Record<string, unknown> = { ...rung };
      delete copy["sizeUsd"];
      return copy as unknown as FillPathRungView;
    }),
  };
}

/**
 * THE PAGE AT A WIDTH, AND NO PROVIDER. `FillPathCards` mounts `FillPathProvider` itself
 * — that is what makes it the house arrangement rather than four parts a caller wires —
 * so this wrapper only decides how wide the cards are allowed to be. `CardAt` would nest
 * a second provider around the one already inside.
 */
function PageAt({ view, width }: { view: FillPathView; width: 320 | 560 }) {
  return (
    <div style={{ width, maxWidth: "100%" }}>
      <FillPathCards view={view} />
    </div>
  );
}

/** A list mounted with one rung already selected, through the published `select`. */
function ListOpenedOn({ rungKey }: { rungKey: string }) {
  const { select } = useFillPathSelection();
  useEffect(() => {
    select(rungKey);
  }, [rungKey, select]);
  return <RungList />;
}


/**
 * THE SEAM, MOUNTED AS A CONSUMER WOULD MOUNT IT.
 *
 * Three fields out and one function in, and the round trip is the assertion a human
 * makes by eye: press a rung's button, and the key AND the index both move. The index is
 * the provider's own translation — the hook never receives one — so a key that changed
 * while the index stood still would be the key↔index conversion coming apart, which is
 * the one behaviour this seam exists to own.
 *
 * IT OPENS ON RUNG 4, NOT RUNG 1. The provider derives its default from `isNext` on
 * every render rather than seeding state from the prop; the fixture's next rung is the
 * fourth precisely so that derivation is visible before anything is pressed.
 */
function SelectionProbe({ view = VIEW }: { view?: FillPathView }) {
  const { selected, selectedIndex, select } = useFillPathSelection();
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm tabular-nums">
        selected key <strong>{selected?.key ?? "none"}</strong> · index{" "}
        <strong>{selectedIndex}</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        {view.rungs.map((rung) => (
          <button
            key={rung.key}
            type="button"
            className="rounded border border-foreground/30 px-2 py-1 text-xs"
            onClick={() => select(rung.key)}
          >
            rung {rung.ladderIndex}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * A PANEL OPENED ON ONE RUNG, THROUGH THE PUBLISHED HOOK. `select` is the same function
 * the probe's buttons call and the same one every rung row in the app calls on click and
 * on focus, so this is a real path and not a fixture-only one. The alternative — handing
 * each panel a view with `isNext` moved onto the rung to look at — would have painted a
 * `next` badge on a never-placed rung, which the view module guarantees cannot happen.
 */
function OpenedOn({ rungKey }: { rungKey: string }) {
  const { select } = useFillPathSelection();
  useEffect(() => {
    select(rungKey);
  }, [rungKey, select]);
  return <SelectedRung />;
}

/**
 * ONE PANEL PER TONE, SO THE TOTAL MAP IS ONE GLANCE. No single rung carries all four:
 * `next` rides the heading and suppresses the state pill beneath it, `unplaced` and
 * `state` are mutually exclusive on one rung, and `inferred` needs a resting rung price
 * has passed through. `out-of-order` composes all four between its rungs 6, 7, 8 and 1,
 * which is the other reason that state arrives with this card.
 */
function PillGallery() {
  const view = outOfOrderView();
  return (
    <div className="flex flex-col gap-4">
      {[
        ["fixture-rung-6", "next — the badge on the heading, and no state pill under it"],
        ["fixture-rung-7", "state — a waiting rung that is not the next one"],
        ["fixture-rung-8", "unplaced — greyed AND dashed, because it never entered"],
        ["fixture-rung-1", "inferred — dashed warn, beside the state it qualifies"],
      ].map(([key, note]) => (
        <div key={key}>
          <p className="m-0 mb-1 text-xs text-foreground/60">{note}</p>
          <CardAt view={view} width={560}>
            <OpenedOn rungKey={key!} />
          </CardAt>
        </div>
      ))}
    </div>
  );
}

export default {
  "the seam": (
    <FillPathProvider view={VIEW}>
      <Row
        title="selection, through the published hook"
        note="`useFillPathSelection` hands out exactly `select`, `selected` and `selectedIndex` — never `view`. Press a rung and both readings move together; the index is the provider's own translation of the key."
      >
        <SelectionProbe />
      </Row>
      <Row
        title="the same selection, read twice"
        note="A second probe under the same provider. Both follow one press, which is what makes this a shared selection rather than two components each holding their own."
      >
        <SelectionProbe />
      </Row>
    </FillPathProvider>
  ),

  "the header card, both layouts": (
    <div>
      <Row
        title="the projection layout — day zero"
        note="`view.expected` is set, so Waiting steps out of the tile grid as the hero and the two projections read quieter in colour AND in size. The progress bar is at zero and still drawn: a bar at zero reads as absence, which is the truth here. The chip is `pending`, which is NOT an alarm colour — a declared ladder awaiting its first fill is the normal starting state."
      >
        <BothWidths view={dayZeroView()}>
          <Header />
        </BothWidths>
      </Row>
      <Row
        title="the measured layout — partly walked"
        note="Three measured tiles, the bar at 38%, then the waiting block on the rail. The switch between this and the row above is `view.expected` alone; the card never asks whether the measured figures are absent."
      >
        <BothWidths view={partlyWalkedView()}>
          <Header />
        </BothWidths>
      </Row>
      <Row
        title="the measured layout with no orders sidecar"
        note="`figures` is ABSENT, and this is the distinction one fixture cannot show: all three measured figures are missing here too, and the card still takes the measured layout, because nothing has been established about whether this ladder started. Waiting prints the em dash and its cause — never `$0`."
      >
        <BothWidths view={unreadableSidecarView()}>
          <Header />
        </BothWidths>
      </Row>
    </div>
  ),

  "the state chip, all four arms": (
    <div>
      <Row
        title="a total map, one colour per state"
        note="`pending` and `ended` read `--nms-muted-foreground`, `in force` reads `--nms-pos`, `unreadable` reads `--nms-warn`. The chip's edge is `border-current`, so text and border move together. Two of these four never had a rule of their own before the teardown and were painted by a base that is gone — an arm rendering in the inherited text colour is what a lost map entry looks like."
      >
        {CHIP_STATES.map((state) => (
          <CardAt key={state} view={{ ...dayZeroView(), state }} width={560}>
            <Header />
          </CardAt>
        ))}
      </Row>
    </div>
  ),

  "spot, all three arms": (
    <div>
      <Row
        title="a live price"
        note="The figure reads `--nms-muted-foreground` and the note beside it says `live`. Spot is context, not the answer, which is what leaves Waiting as the one accented number on the card."
      >
        <BothWidths view={partlyWalkedView()}>
          <Header />
        </BothWidths>
      </Row>
      <Row
        title="still reading"
        note="`spotLoading`. An em dash and a stated cause, the same treatment every other missing figure on the page gets. There is no arm here that can print a number the page does not have."
      >
        <BothWidths view={spotLoadingView()}>
          <Header />
        </BothWidths>
      </Row>
      <Row
        title="the fetch failed, and nothing was seen earlier"
        note="`spotUsd` genuinely absent. The second em dash, with `live price unavailable` as its cause."
      >
        <BothWidths view={spotMissingView()}>
          <Header />
        </BothWidths>
      </Row>
      <Row
        title="a last close, said to be one"
        note="A price the session saw earlier, rendered with `last close · live price unavailable` beside it. It must never read as `live`: the chart's now-rule is decided off a live reading only, and this note is the whole of what stops the two being confused."
      >
        <BothWidths view={spotLastCloseView()}>
          <Header />
        </BothWidths>
      </Row>
    </div>
  ),

  "the banner and the warnings": (
    <div>
      <Row
        title="a torn act outstanding"
        note="A `role=alert` block, `--nms-neg` on both the border and the headline, `--nms-card` behind them, and the sentence inside stepped back to `--nms-foreground` so the block does not shout in one colour. The surface is spelled out on this element rather than composed from `CARD_SURFACE`: the shared string draws the ordinary hairline and this edge is the alarm red, and two unvariant `border-color` utilities would race."
      >
        <TornActBanner view={tornOutstandingView()} />
      </Row>
      <Row
        title="nobody looked"
        note="`unchecked` — a quiet line, because silence would claim a check that never ran. All four margin edges are zeroed, which is the deleted rule reproduced."
      >
        <TornActBanner view={tornUncheckedView()} />
      </Row>
      <Row
        title="two certainties, one surface"
        note="Both paragraphs are card-surfaced and only the left edge differs: solid `--nms-neg` for a fact the venue reported, dashed `--nms-warn` for an inference off spot. The dash is on that ONE edge — `border-dashed` would dash the card's other three, and the difference between a fact and a guess must not spill onto the surface they share."
      >
        <UnrecordedWarnings view={unrecordedWarningsView()} />
      </Row>
    </div>
  ),

  "the chart card, and both its absences": (
    <div>
      <Row
        title="a capital curve, with the price span opposite its title"
        note="`priceSpan` takes an explicit min and max rather than the ends of the array, formats through `COMPACT_USD` — the SAME formatter the axis ticks beneath it use — and wears a `~` because compact notation rounds hard enough to disagree with the rung list. The span reads `--nms-muted-foreground`; the title does not. The chart's LINES must be visible here: they read `--nms-pos`, `--nms-muted-foreground` and `--nms-now`, and the check that cleared this wave ran before those were minted and saw nothing."
      >
        <BothWidths view={partlyWalkedView()}>
          <Chart />
        </BothWidths>
      </Row>
      <Row
        title="fills scattered up the ladder"
        note="`out-of-order`. The filled rings interleave with waiting ones instead of running down from the left, which is the shape only the picture carries. Spot is below three resting rungs, so the now-rule sits well to the right — and it is drawn off `chart.nowX`, never off `view.spotUsd`, because a last close is not now."
      >
        <BothWidths view={outOfOrderView()}>
          <Chart />
        </BothWidths>
      </Row>
      <Row
        title="one rung, so no span"
        note="A single rung is a price and not a range, so `priceSpan` returns nothing and the heading row is a title alone. The slider STAYS — it is gated on the ladder having rungs, and one is rungs. The caption is dropped here too, which puts the `sr-only` block in its ABSENT arm, hidden with the caption it stands in for because a sighted reader needs no note that a caption they cannot see is unavailable. Reveal the element in devtools rather than expecting it on screen: `sr-only` clips, and `display: none` here would take the whole picture away from a screen-reader user."
      >
        <BothWidths view={singleRungView()}>
          <Chart />
        </BothWidths>
      </Row>
      <Row
        title="no rungs at all, so no picture"
        note="`view.chart` absent. The stated cause stands where the plot goes — this ladder ships no rung sizes — and THIS is where the slider goes too, because it is gated on the rung count. No `$0`, no empty axes: an absence is rendered and named."
      >
        <BothWidths view={runglessView()}>
          <Chart />
        </BothWidths>
      </Row>
    </div>
  ),

  "the selected-rung panel, and all four pill tones": (
    <div>
      <Row
        title="the panel, following a live selection"
        note="Its own `<section>` rather than `Card`, carrying `CARD_SURFACE` and `aria-live=`polite`` ON the section: a live region is announced from the element that carries it. Press a rung in the probe and the panel follows — the `next` badge rides the heading because `next` answers WHICH rung this is, the same question the heading asks, and the pill row below is left holding only exceptions."
      >
        <FillPathProvider view={outOfOrderView()}>
          <SelectionProbe view={outOfOrderView()} />
          <SelectedRung />
        </FillPathProvider>
      </Row>
      <Row
        title="all four pill tones at once"
        note="The map is total and the map is the thing that could be wrong, so every arm is on screen together: `state` and `unplaced` are `--nms-border` on `--nms-muted-foreground` with the unplaced one dashed and dimmed, `inferred` is dashed `--nms-warn` matching the warning above the chart, and `next` is `--nms-now` — never `--nms-pos`, which is the colour that means filled. An arm rendering in the inherited text colour is a lost map entry."
      >
        <PillGallery />
      </Row>
      <Row
        title="the headline in both arms"
        note="The money committed AT the price it buys at, in one sentence, with no `$` because `USD` is already there. The size is demoted by COLOUR alone at the same type size, and the price prints with `maximumFractionDigits: 2` and no minimum, so a whole rung reads `57,500` and a half-dollar rung reads `57,499.5` rather than being rounded into a price no order was placed at. A v4 snapshot carrying no size falls back to the price alone."
      >
        <BothWidths view={partlyWalkedView()}>
          <SelectedRung />
        </BothWidths>
      </Row>
      <Row
        title="the exception shelf, rendered"
        note="`placedAtUsd` — a declared join whose order sits at another price, honored AND flagged. It is the one row the `dl` ever holds, which is why the list is conditional rather than empty: an empty definition list is a labelled box promising detail it does not have. The term column and the inline note both read `--nms-muted-foreground`, and at 320px the value rails right while past 380px it sits beside its term."
      >
        <BothWidths view={placedAtMismatchView()}>
          <SelectedRung />
        </BothWidths>
      </Row>
      <Row
        title="no rung to select"
        note="An `Absent` inside a plain `Card` — not the live region, because there is no selection for it to announce. The completeness line goes with it."
      >
        <BothWidths view={runglessView()}>
          <SelectedRung />
        </BothWidths>
      </Row>
    </div>
  ),

  "the rung list, every tint and every edge": (
    <div>
      <Row
        title="the ladder, at both widths"
        note="Three tints and three edges across eight rows: `--nms-pos` mixed in on the three filled rungs, `--nms-now` on rung 4 which price reaches next, bare `--nms-background` on the rest, and the two deepest rungs DASHED because they were declared and never placed. All four status tones are here too — muted on the never-placed pair, `--nms-now` on rung 4, `--nms-pos` on the filled three, and NOTHING on the ordinary waiting rungs, whose status inherits the row's colour and whose empty arm in the tone map is deliberate. At 320px the qualifier pills take a full-width line of their own; past 380px they sit in their cell. Rung 4 prints `partly filled · 40%` twice, as the sub-line and as the pill — pre-existing, and left alone."
      >
        <BothWidths view={partlyWalkedView()}>
          <RungList />
        </BothWidths>
      </Row>
      <Row
        title="the fourth edge — a ring on a row that is already tinted"
        note="Selection moves the border to `--nms-foreground` and adds a 1px `box-shadow` in the same colour, and touches the background of NOTHING: the filled rung below keeps its green tint under the ring. A fill here would fight the state tint and could make a waiting rung read as filled while the operator inspected it. The shadow is written as an arbitrary property rather than `shadow-[…]`, because Tailwind's shadow utility composes with its ring and inset variables and the computed value would stop being the deleted rule's."
      >
        <CardAt view={partlyWalkedView()} width={560}>
          <ListOpenedOn rungKey="fixture-rung-1" />
        </CardAt>
      </Row>
      <Row
        title="a never-placed rung, and the same rung selected"
        note="Rungs 7 and 8 are the pair: declared, never placed, dashed, with the price itself muted. On the right, rung 7 is the one under inspection and its dash goes SOLID — which is what the deleted rule's `border-style: solid` did. The muting stays; only the border style and the ring move."
      >
        <CardAt view={partlyWalkedView()} width={560}>
          <RungList />
        </CardAt>
        <CardAt view={partlyWalkedView()} width={560}>
          <ListOpenedOn rungKey="fixture-rung-7" />
        </CardAt>
      </Row>
      <Row
        title="a rung whose size the snapshot does not carry"
        note="The em dash and its cause, never a `0`: a rung with no recorded size has not declared zero capital. The `@ price` stays beside it, so the row still says which rung is missing the figure."
      >
        <BothWidths view={withSizelessRung(partlyWalkedView(), 4)}>
          <RungList />
        </BothWidths>
      </Row>
      <Row
        title="the orphan line, present and absent"
        note="`overfilled` carries two recorded lots no declared rung explains and prints the line with 12px of its own top margin; `partly-walked` carries none and prints nothing. A COUNT, never the lots — the conclusion crosses the wire and the position data does not. Every rung is filled above, so this is also the only state where the tint map's `next` arm is absent from the whole ladder."
      >
        <CardAt view={overfilledView()} width={560}>
          <RungList />
        </CardAt>
        <CardAt view={partlyWalkedView()} width={560}>
          <RungList />
        </CardAt>
      </Row>
    </div>
  ),

  "the whole page, all four ladder states": (
    <div>
      <Row
        title="day zero"
        note="`FillPathCards` — the house arrangement, and the only thing the two ladder routes mount. Six children in the order U's 320px rework fixed: the torn banner, the header, the unrecorded warnings, the chart, the selected-rung panel, the list. Nothing is filled yet, so the header takes the projection layout and every row is waiting."
      >
        <div className="flex flex-wrap items-start gap-6">
          <PageAt view={dayZeroView()} width={320} />
          <PageAt view={dayZeroView()} width={560} />
        </div>
      </Row>
      <Row
        title="partly walked"
        note="The widest state: three filled rungs, one partly filled and next, two waiting, two declared and never placed. Tab down the ladder and the panel above follows — every row selects on FOCUS as well as on click, which is the substitute route ADR-019 chose instead of a navigable chart."
      >
        <div className="flex flex-wrap items-start gap-6">
          <PageAt view={partlyWalkedView()} width={320} />
          <PageAt view={partlyWalkedView()} width={560} />
        </div>
      </Row>
      <Row
        title="out of order"
        note="Fills scattered UP the ladder rather than walked down it. The list reads the same rungs the chart draws, and the two must not say different things about any one of them — that shared three-colour key is the whole reason the tint reuses the chart's palette and no other."
      >
        <div className="flex flex-wrap items-start gap-6">
          <PageAt view={outOfOrderView()} width={320} />
          <PageAt view={outOfOrderView()} width={560} />
        </div>
      </Row>
      <Row
        title="overfilled"
        note="Every rung filled, the bar at 100%, nothing waiting, and two orphan lots under the ladder. Spot is below the deepest rung, so no rung is next and the chart's now-rule sits at the right edge."
      >
        <div className="flex flex-wrap items-start gap-6">
          <PageAt view={overfilledView()} width={320} />
          <PageAt view={overfilledView()} width={560} />
        </div>
      </Row>
    </div>
  ),

  "the shared helpers": (
    <div>
      <Row
        title="a measured figure"
        note="`Figure` in its known arm. The label reads `--nms-muted-foreground`; the figure does not, and the gap between them is the hierarchy."
      >
        <Figure label="Deployed" figure={VIEW.deployed} />
        <Figure label="Units acquired" figure={VIEW.unitsAcquired} render={formatUnits} />
      </Row>
      <Row
        title="a figure that was never measured"
        note="`Figure`'s absent arm, which carries a stated cause and never a zero. The cause renders through `Absent`, whose own read is the same token — so this row moves with the others."
      >
        <Figure
          label="Average entry"
          figure={{ known: false, why: "no fill has been recorded yet" }}
        />
      </Row>
      <Row
        title="a projection, and its `~`"
        note="`Expectation` prints the mark itself rather than taking it from a call site, so a projection cannot lose it. The value is the slice's SECOND read of `--nms-muted-foreground`, on its own 0.95rem string — if this figure stays grey while the labels above move, one of the two rewrites was missed."
      >
        <Expectation label="Expected units" value={0.09623} render={formatUnits} />
        <Expectation label="Expected average entry" value={36372.24} />
      </Row>
    </div>
  ),
};
