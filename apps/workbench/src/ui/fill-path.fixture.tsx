import { FillPathProvider, useFillPathSelection } from "@numisma/components";
import {
  Expectation,
  Figure,
  formatUnits,
  Header,
  TornActBanner,
  UnrecordedWarnings,
} from "@numisma/components/ui/fill-path.tsx";
import type { FillPathView } from "@numisma/components";
import {
  dayZeroView,
  partlyWalkedView,
  spotLastCloseView,
  spotLoadingView,
  spotMissingView,
  tornOutstandingView,
  tornUncheckedView,
  unreadableSidecarView,
  unrecordedWarningsView,
} from "@numisma/components/ui/fill-path.fixtures.ts";

/**
 * THE FILL PATH'S HEADER CARD, ITS SELECTION SEAM, AND THE SHARED HELPERS
 * (spec #439 S6 and S7).
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
 * THE CARD, MOUNTED AT A WIDTH. `Header` reads its own container, so the only thing that
 * decides which layout paints is how wide the card is allowed to be — 320px is the phone
 * the surface is judged on, and anything past 380px is the desk. Both are staged because
 * the reflow is a real branch and a fixture that showed one of them would review half a
 * card.
 */
function HeaderAt({ view, width }: { view: FillPathView; width: 320 | 560 }) {
  return (
    <div style={{ width, maxWidth: "100%" }}>
      <FillPathProvider view={view}>
        <Header />
      </FillPathProvider>
    </div>
  );
}

/** The same card at both widths, so the 380px reflow is one glance rather than two. */
function BothWidths({ view }: { view: FillPathView }) {
  return (
    <div className="flex flex-wrap items-start gap-6">
      <HeaderAt view={view} width={320} />
      <HeaderAt view={view} width={560} />
    </div>
  );
}

const CHIP_STATES = ["pending", "active", "ended", "unreadable"] as const;


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
function SelectionProbe() {
  const { selected, selectedIndex, select } = useFillPathSelection();
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-sm tabular-nums">
        selected key <strong>{selected?.key ?? "none"}</strong> · index{" "}
        <strong>{selectedIndex}</strong>
      </p>
      <div className="flex flex-wrap gap-2">
        {VIEW.rungs.map((rung) => (
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
        <BothWidths view={dayZeroView()} />
      </Row>
      <Row
        title="the measured layout — partly walked"
        note="Three measured tiles, the bar at 38%, then the waiting block on the rail. The switch between this and the row above is `view.expected` alone; the card never asks whether the measured figures are absent."
      >
        <BothWidths view={partlyWalkedView()} />
      </Row>
      <Row
        title="the measured layout with no orders sidecar"
        note="`figures` is ABSENT, and this is the distinction one fixture cannot show: all three measured figures are missing here too, and the card still takes the measured layout, because nothing has been established about whether this ladder started. Waiting prints the em dash and its cause — never `$0`."
      >
        <BothWidths view={unreadableSidecarView()} />
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
          <HeaderAt key={state} view={{ ...dayZeroView(), state }} width={560} />
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
        <BothWidths view={partlyWalkedView()} />
      </Row>
      <Row
        title="still reading"
        note="`spotLoading`. An em dash and a stated cause, the same treatment every other missing figure on the page gets. There is no arm here that can print a number the page does not have."
      >
        <BothWidths view={spotLoadingView()} />
      </Row>
      <Row
        title="the fetch failed, and nothing was seen earlier"
        note="`spotUsd` genuinely absent. The second em dash, with `live price unavailable` as its cause."
      >
        <BothWidths view={spotMissingView()} />
      </Row>
      <Row
        title="a last close, said to be one"
        note="A price the session saw earlier, rendered with `last close · live price unavailable` beside it. It must never read as `live`: the chart's now-rule is decided off a live reading only, and this note is the whole of what stops the two being confused."
      >
        <BothWidths view={spotLastCloseView()} />
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
