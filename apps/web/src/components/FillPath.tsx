import { useState } from "react";
import { formatUsd } from "@numisma/engine/format";
import type {
  FillPathRungView,
  FillPathView,
  MeasuredFigure,
} from "../ladder/fill-path-view.ts";
import { COMPACT_USD } from "../ladder/price-drop-path.ts";
import { PriceDropPathChart } from "./PriceDropPathChart.tsx";

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

/** An em dash is not a zero — and the cause says which absence this is. */
function Absent({ why }: { why: string }) {
  return (
    <span className="absent">
      <span aria-hidden="true">—</span>
      <span className="muted absent-why">{why}</span>
    </span>
  );
}

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
    <div className="fp-tile">
      <span className="fp-tile-label">{label}</span>
      {figure.known ? (
        <strong className="fp-tile-value">{render(figure.value)}</strong>
      ) : (
        <Absent why={figure.why} />
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
    <div className="fp-tile">
      <span className="fp-tile-label">{label}</span>
      <strong className="fp-tile-value fp-expected-value">~{render(value)}</strong>
    </div>
  );
}

/** Units render to 8 places at most — a satoshi is the smallest thing there is. */
function formatUnits(value: number): string {
  return `${value.toFixed(8).replace(/0+$/, "").replace(/\.$/, "")} BTC`;
}

export function FillPathCards({ view }: { view: FillPathView }) {
  // The inspected rung. Defaults to the one price will reach next, because that is the
  // rung the operator opened the page about; with no live spot it falls back to the top
  // of the ladder rather than to nothing.
  const fallback = view.rungs.find((rung) => rung.isNext) ?? view.rungs[0];
  const [selectedKey, setSelectedKey] = useState<string | undefined>(undefined);
  const selected =
    view.rungs.find((rung) => rung.key === selectedKey) ?? fallback;
  const selectedIndex = selected
    ? view.rungs.findIndex((rung) => rung.key === selected.key)
    : 0;

  return (
    <>
      <TornActBanner view={view} />
      <HeaderCard view={view} />
      <UnrecordedWarnings view={view} />
      <ChartCard
        view={view}
        selectedIndex={selectedIndex}
        onSelectIndex={(index) => setSelectedKey(view.rungs[index]?.key)}
      />
      <SelectedRungCard rung={selected} view={view} />
      <RungListCard view={view} selected={selected} onSelect={setSelectedKey} />
    </>
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
function TornActBanner({ view }: { view: FillPathView }) {
  if (view.tornActs.status === "outstanding") {
    return (
      <div className="card notice fp-torn" role="alert">
        <strong>
          {view.tornActs.count} torn fill{" "}
          {view.tornActs.count === 1 ? "act" : "acts"} outstanding
        </strong>
        <p>
          Recording is blocked until this is repaired — <code>pnpm orders:fill</code>{" "}
          will refuse while a half-written act is open. Repair it at the desk.
        </p>
      </div>
    );
  }
  if (view.tornActs.status === "unchecked") {
    return (
      <p className="muted fp-unchecked">
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
function HeaderCard({ view }: { view: FillPathView }) {
  // `expected` is only ever set on a reconciled row, so `figures` is present with it;
  // pairing them here is what lets the row below take both non-optional.
  const projection =
    view.expected !== undefined && view.figures !== undefined
      ? { expected: view.expected, figures: view.figures }
      : undefined;

  return (
    <section className="card fp-header">
      {/* WHAT THIS IS, AND WHERE PRICE IS — the two things the operator reads before
          anything else, on one row. Spot used to sit in the provenance footer, four
          cards down, which put the only number that moves while you look at it below
          every number that does not. */}
      <div className="fp-header-head">
        <div className="fp-header-id">
          <h1>{view.title}</h1>
          {/* THE STATE IS A BADGE, NOT A SENTENCE. It used to ride a `Price ladder ·
              pending · all figures in USD` sub-line, which spent two rows of a 320px
              card on one word the operator actually reads. The kind is already told by
              the ladder below, and every figure on this card carries its own `$` or its
              own unit, so the currency note was restating what the numbers say. */}
          <span className={`fp-badge fp-badge-${view.state}`}>
            {view.state === "active" ? "in force" : view.state}
          </span>
        </div>
        <SpotReadout view={view} />
      </div>

      {projection ? (
        <ExpectedRow expected={projection.expected} figures={projection.figures} />
      ) : (
        <div className="fp-tiles">
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
        <div className="fp-progress">
          {/* A BAR AT ZERO IS THE TRUTH and stays: it reads as absence, which is what
              day zero is. A zero-dollar figure would read as a measurement instead. */}
          <div
            className="fp-progress-track"
            role="img"
            aria-label={`${view.progress.filledRungs} of ${view.progress.totalRungs} rungs filled`}
          >
            <div
              className="fp-progress-fill"
              style={{ width: `${view.progress.percent}%` }}
            />
          </div>
          <p className="muted">
            {view.progress.filledRungs} of {view.progress.totalRungs} rungs walked
          </p>
        </div>
      ) : null}

      {projection ? null : <Waiting figures={view.figures} />}
    </section>
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
    <p className="fp-spot">
      <span className="fp-tile-label">Spot</span>
      {view.spotLoading ? (
        <Absent why="reading spot…" />
      ) : view.spotUsd === undefined ? (
        <Absent why="live price unavailable" />
      ) : (
        <>
          <strong className="fp-spot-value">{formatUsd(view.spotUsd)}</strong>
          <span className="muted fp-spot-note">
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
    <div className="fp-expected">
      {/* WAITING IS THE PROTAGONIST and is built to look like it: out of the tile grid
          entirely, label over figure, at the card's largest type. The two projections
          below it stay in the row form at a smaller size — muted alone did not carry
          the hierarchy, because the projected strings are the LONGEST on the card and
          at equal size length reads as importance. */}
      <div className="fp-hero">
        <span className="fp-tile-label">Waiting</span>
        <strong className="fp-hero-value">{formatUsd(figures.waitingDeclaredUsd)}</strong>
      </div>
      <div className="fp-tiles fp-tiles-quiet">
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
      <div className="fp-waiting">
        <span className="fp-tile-label">Waiting</span>
        <strong className="fp-tile-value">—</strong>
        <p className="muted fp-waiting-sub">
          The orders sidecar could not be read for this ladder, so nothing here is a
          measurement — this is NOT "nothing is waiting".
        </p>
      </div>
    );
  }
  return (
    <div className="fp-waiting">
      <span className="fp-tile-label">Waiting</span>
      <strong className="fp-tile-value">{formatUsd(figures.waitingDeclaredUsd)}</strong>
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
function UnrecordedWarnings({ view }: { view: FillPathView }) {
  return (
    <>
      {view.warnings.filledNotRecorded > 0 ? (
        <p className="card fp-warn fp-warn-certain">
          <span aria-hidden="true">⚠ </span>
          {view.warnings.filledNotRecorded} filled at the venue —{" "}
          {view.warnings.filledNotRecorded === 1 ? "it is" : "they are"} not recorded.
          The venue reported this; the fund's book has no lot for it.
        </p>
      ) : null}
      {view.warnings.pricePassedNoFill > 0 ? (
        <p className="card fp-warn fp-warn-inferred">
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

/** Card 2 — the chart, its generated caption, and the inspect slider. */
function ChartCard({
  view,
  selectedIndex,
  onSelectIndex,
}: {
  view: FillPathView;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
}) {
  const span = priceSpan(view.rungs);
  return (
    <section className="card fp-chart-card">
      {/* THE SPAN SITS OPPOSITE THE TITLE, not in the chart. It is the one number the
          picture cannot state exactly — an axis tick is a rounded gridline, and the
          reader who wants "how deep does this ladder go" should not have to measure. */}
      <div className="fp-chart-head">
        <h2>Price Drop Path</h2>
        {span === undefined ? null : <span className="fp-chart-range">{span}</span>}
      </div>
      {view.chart ? (
        <PriceDropPathChart
          rungs={view.rungs}
          selectedKey={view.rungs[selectedIndex]?.key}
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
          `.sr-only` is therefore load-bearing here — see the rule in `styles.css`.

          THE ABSENT ARM IS HIDDEN WITH IT. It stands in the same slot and speaks to the
          same reader: a sighted user needs no note that a caption they cannot see is
          unavailable, and its absence is already visible as a chart with no rings. */}
      <div className="sr-only">
        {view.caption ? (
          <p className="fp-caption">{view.caption}</p>
        ) : (
          <p>
            <Absent why="the ladder's shape is unavailable" />
          </p>
        )}
      </div>

      {view.rungs.length > 0 ? (
        <label className="fp-inspect">
          <span className="fp-tile-label">Inspect rung</span>
          <input
            type="range"
            min={0}
            max={view.rungs.length - 1}
            step={1}
            value={selectedIndex}
            onChange={(event) => onSelectIndex(Number(event.target.value))}
          />
        </label>
      ) : null}
    </section>
  );
}

/** Card 3 — everything known about the one rung under inspection. */
function SelectedRungCard({
  rung,
  view,
}: {
  rung: FillPathRungView | undefined;
  view: FillPathView;
}) {
  if (rung === undefined) {
    return (
      <section className="card">
        <h2>Selected rung</h2>
        <p>
          <Absent why="this ladder declares no rungs" />
        </p>
      </section>
    );
  }
  return (
    <section className="card fp-selected" aria-live="polite">
      {/* THE BADGE RIDES THE HEADING, because "next" answers WHICH RUNG THIS IS — the
          same question the heading asks — and not what state it is in. Down among the
          pills it read as one status among several; up here it qualifies the identity
          it belongs to, and the pill row below is left holding only exceptions. */}
      <h2>
        Rung {rung.ladderIndex} of {view.rungs.length}
        {rung.isNext ? <span className="fp-pill fp-pill-next">next</span> : null}
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
        <dl className="fp-detail">
          <dt>Order placed at</dt>
          {/* A DECLARED join whose order sits elsewhere is honored AND flagged: the
              operator said these belong together, and they do — at a different price. */}
          <dd>
            {formatUsd(rung.placedAtUsd)}{" "}
            <span className="muted">differs from the declared rung</span>
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
    return <p className="fp-selected-price">{formatUsd(rung.priceUsd)}</p>;
  }
  return (
    <p className="fp-selected-price">
      {/* THE PRICE TAKES THE ACCENT, NOT THE SIZE. This card is one stop on a ladder and
          the ladder's axis is PRICE — it is what the chart above plots vertically, what
          the rung list is ordered by, and the number the operator is deciding against.
          The size is what happens WHEN price gets here; it reads second by design. */}
      <span className="fp-selected-size">
        {SIZE_PLAIN.format(rung.sizeUsd)} <span className="fp-unit">USD</span>{" "}
      </span>
      <span className="fp-selected-at">@</span> {PRICE_PLAIN.format(rung.priceUsd)}
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
    <p className="muted fp-recorded">
      {/* NO `<strong>` ON THE DATE. The paragraph is `.muted` because the whole sentence
          is a provenance footnote, and bolding the date inside it pulled the loudest
          thing on the card down to its quietest line — the reader's eye landed on a
          cutoff before it landed on the rung. It is a boundary, not a headline. */}
      Fills recorded at {view.recordedThrough}
    </p>
  );
}

/**
 * THE ENGINE'S WORD FOR A RESTING RUNG, matched exactly — `packages/engine/src/fill-path.ts`
 * emits it for `axis === "resting"` and for nothing else. See `Pills` for what turns on it.
 */
const WAITING_LABEL = "waiting";

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
 * DROPPED ONLY AGAINST THE EXACT WAITING LABEL, THOUGH — never on `isNext` alone. `label`
 * is engine-authored and a next rung may still carry `declared — not placed`, `cancelled —
 * fills recorded against it`, or `fill state unavailable` on an unreconciled snapshot.
 * None of those is implied by "next", and all of them still print. The comparison is the
 * narrow claim; `isNext` alone would have been the wrong one and would have swallowed an
 * unplaced next rung's whole warning.
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
  const stateIsRedundant = rung.isNext && rung.label === WAITING_LABEL;
  const pills = [
    rung.notPlaced ? (
      <span key="state" className="fp-pill fp-pill-unplaced">
        declared — not placed
      </span>
    ) : stateIsRedundant ? null : (
      <span key="state" className="fp-pill">
        {rung.label}
      </span>
    ),
    rung.pricePassedUnconfirmed ? (
      <span key="unconfirmed" className="fp-pill fp-pill-inferred">
        waiting · price passed, unconfirmed
      </span>
    ) : null,
    rung.filledPercent === undefined ? null : (
      <span key="partial" className="fp-pill">
        partly filled · {rung.filledPercent}%
      </span>
    ),
  ].filter((pill) => pill !== null);

  // An empty pill row is still a row: it holds its own margin and opens a gap under the
  // headline that reads as something failing to load. The ordinary rung has no pills.
  if (pills.length === 0) return null;
  return <p className="fp-pills">{pills}</p>;
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
function RungListCard({
  view,
  selected,
  onSelect,
}: {
  view: FillPathView;
  selected: FillPathRungView | undefined;
  onSelect: (key: string) => void;
}) {
  return (
    <section className="card fp-list">
      <h2>Rungs</h2>
      <ul>
        {view.rungs.map((rung) => (
          <li key={rung.key}>
            <button
              type="button"
              className={
                "fp-row" +
                (rung.filled ? " is-filled" : "") +
                (rung.isNext ? " is-next" : "") +
                (rung.key === selected?.key ? " is-selected" : "") +
                (rung.notPlaced ? " is-unplaced" : "")
              }
              aria-current={rung.key === selected?.key ? "true" : undefined}
              onClick={() => onSelect(rung.key)}
              onFocus={() => onSelect(rung.key)}
            >
              <span className="fp-row-index">R{rung.ladderIndex}</span>
              {/* ONE LINE, THE SAME SENTENCE THE INSPECT CARD LEADS WITH — see
                  `RungHeadline`. It was two stacked figures, `$57,500.00` over `$149.96`,
                  which made the reader pair them and printed a `$` eight times down a
                  column that is USD throughout. No unit mark here at all: the inspect card
                  says `USD` once for the ladder and the header card says it again.

                  ABSENT IS STILL THE EM-DASH AND ITS CAUSE, never a `0`: a rung whose size
                  the snapshot does not carry has not declared zero capital. It keeps the
                  `@ price` beside it, so the row still says which rung is missing it. */}
              <span className="fp-row-figures">
                <span className="fp-row-price">
                  {/* MUTED, FOR THE SAME REASON AS THE INSPECT CARD'S — the column is
                      ordered by price and scanned by price, so price carries the weight
                      and the size trails it. Keeping both at accent weight made every
                      row two competing headlines. */}
                  <span className="fp-row-size">
                    {rung.sizeUsd === undefined ? (
                      <Absent why="size not carried" />
                    ) : (
                      SIZE_PLAIN.format(rung.sizeUsd)
                    )}{" "}
                    <span className="fp-row-at">@</span>
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
        <p className="muted fp-orphans">
          {view.orphanLots} recorded {view.orphanLots === 1 ? "lot" : "lots"} that no
          declared rung explains.
        </p>
      ) : null}
    </section>
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
 * The suppression is against the engine's exact `waiting` literal (`WAITING_LABEL`),
 * never against `rung.waiting` — see `Pills` for why that distinction is load-bearing.
 * `declared — not placed`, `cancelled — fills recorded against it`, every `filled` variant
 * and `fill state unavailable` all still print, in the same place, unchanged.
 *
 * `next` IS PROMOTED OVER THE LABEL, NOT SUBSTITUTED FOR IT. Being next is the fact the
 * operator opened the page about, so it takes the strong line; but `next` is a fact about
 * SPOT and the label is a fact about the VENUE, and one cannot stand in for the other — a
 * rung can be next AND partly filled, or next AND never placed. So a non-waiting label
 * still rides the line beneath. What is dropped is only the `waiting` sub-line under
 * `next`, which the view module already guarantees is implied.
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
 * THE UNPLACED PILL IS GONE because `label` already reads `declared — not placed` for
 * exactly that rung; the pill was the same sentence twice. The row's dashed border still
 * carries it visually, per G-D12.
 */
function RowState({ rung }: { rung: FillPathRungView }) {
  const labelIsDefault = rung.label === WAITING_LABEL;
  const status = rung.isNext ? "next" : labelIsDefault ? undefined : rung.label;
  const substatus = rung.isNext && !labelIsDefault ? rung.label : undefined;
  const hasQuals =
    rung.pricePassedUnconfirmed || rung.filledPercent !== undefined;

  // NOT AN EMPTY SPAN — the column is a grid cell with its own spacing, and an empty one
  // still claims the width it would need for a status that is not there.
  if (status === undefined && !hasQuals) return null;

  return (
    <span className="fp-row-state">
      {status === undefined ? null : (
        <span className="fp-row-status">{status}</span>
      )}
      {substatus === undefined ? null : (
        <span className="fp-row-substatus">{substatus}</span>
      )}
      {hasQuals ? (
        <span className="fp-row-quals">
          {rung.pricePassedUnconfirmed ? (
            <span className="fp-pill fp-pill-inferred">price passed, unconfirmed</span>
          ) : null}
          {rung.filledPercent === undefined ? null : (
            <span className="fp-pill">partly filled · {rung.filledPercent}%</span>
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
