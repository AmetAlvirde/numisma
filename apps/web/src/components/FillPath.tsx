import { useState } from "react";
import { formatUsd } from "@numisma/engine/format";
import type {
  ChartGeometry,
  FillPathRungView,
  FillPathView,
  MeasuredFigure,
} from "../ladder/fill-path-view.ts";

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
 * ── EVERY ABSENCE IS RENDERED AND NAMED, AND NO `$0` IS REACHABLE ───────────────────
 * The three measured figures are ABSENT on the wire until a fill is recorded (G-D8),
 * not zero, so this file has no branch that could print `$0.00` for them: it is handed a
 * `MeasuredFigure` and the `known: false` arm carries a cause string, never a number.
 * The 0% progress bar stays, because a bar at zero reads as absence — which is the
 * truth — while a zero DOLLAR figure would read as a measurement.
 *
 * ── THE CHART IS PRESENTATION, NOT THE RECORD (§6.3) ────────────────────────────────
 * The `<svg>` is `aria-hidden`. Every per-rung fact it plots is in the rung list below
 * it, and the one thing only the picture carries — the shape of the capital curve — is
 * the generated caption beside it, from `ladder/convexity-caption.ts`. There is no
 * hand-maintained chart description here and there must never be one.
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
      <ProvenanceFooter view={view} />
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

/** Card 1 — the figures, the progress bar, and the waiting split. */
function HeaderCard({ view }: { view: FillPathView }) {
  return (
    <section className="card fp-header">
      <h1>{view.title}</h1>
      <p className="muted fp-sub">
        Price ladder · {view.state === "active" ? "in force" : view.state} · all figures
        in USD
      </p>

      <div className="fp-tiles">
        <Figure label="Deployed" figure={view.deployed} />
        <Figure label="Units acquired" figure={view.unitsAcquired} render={formatUnits} />
        <Figure label="Average entry" figure={view.avgEntry} />
      </div>

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

      <div className="fp-waiting">
        <span className="fp-tile-label">Waiting</span>
        <strong className="fp-tile-value">
          {formatUsd(view.figures.waitingDeclaredUsd)}
        </strong>
        {/* THE SPLIT IS "DECLARED BUT NEVER PLACED", and the copy says exactly that.
            For any rung that HAS an order, resting and unfilled are the same predicate
            by construction, so calling this "unfilled vs. still-open" would assert a
            distinction that does not exist. */}
        {view.figures.neverPlacedUsd > 0 ? (
          <p className="muted fp-waiting-sub">
            {formatUsd(view.figures.waitingRestingUsd)} is resting at the venue;{" "}
            {formatUsd(view.figures.neverPlacedUsd)} is declared but never placed.
          </p>
        ) : (
          <p className="muted fp-waiting-sub">
            All of it is resting at the venue — nothing declared is unplaced.
          </p>
        )}
      </div>
    </section>
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

/** Card 2 — the hand-rolled chart, its generated caption, and the inspect slider. */
function ChartCard({
  view,
  selectedIndex,
  onSelectIndex,
}: {
  view: FillPathView;
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
}) {
  return (
    <section className="card fp-chart-card">
      <h2>Price Drop Path</h2>
      {view.chart ? (
        <Chart chart={view.chart} selectedKey={view.rungs[selectedIndex]?.key} />
      ) : (
        <p>
          <Absent why="this ladder ships no rung sizes — there is no capital curve to plot" />
        </p>
      )}

      {/* THE CHART'S ACCESSIBLE SUBSTITUTE (§6.3b) — generated, never hand-written. */}
      {view.caption ? (
        <p className="fp-caption">{view.caption}</p>
      ) : (
        <p>
          <Absent why="the ladder's shape is unavailable" />
        </p>
      )}

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

/**
 * HAND-ROLLED SVG (§6.2) — a polyline, one circle per rung, and a "now" line. No chart
 * library: the repo has none and adds none, and at this fidelity one would buy nothing.
 *
 * `aria-hidden` PER §6.3a. It is presentation. Every fact it draws is in the rung list,
 * and the shape it alone conveys is in the caption above.
 */
function Chart({
  chart,
  selectedKey,
}: {
  chart: ChartGeometry;
  selectedKey: string | undefined;
}) {
  return (
    <svg
      className="fp-chart"
      viewBox={`0 0 ${chart.width} ${chart.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <polyline className="fp-chart-line" points={chart.points} />
      {chart.nowX === undefined ? null : (
        <line
          className="fp-chart-now"
          x1={chart.nowX}
          x2={chart.nowX}
          y1={0}
          y2={chart.height}
        />
      )}
      {chart.circles.map((circle) => (
        <circle
          key={circle.key}
          cx={circle.cx}
          cy={circle.cy}
          r={circle.key === selectedKey ? 5 : 3.5}
          className={
            "fp-chart-dot" +
            (circle.filled ? " is-filled" : "") +
            (circle.next ? " is-next" : "") +
            (circle.key === selectedKey ? " is-selected" : "")
          }
        />
      ))}
    </svg>
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
      <h2>
        Rung {rung.ladderIndex} of {view.rungs.length}
      </h2>
      <p className="fp-selected-price">{formatUsd(rung.priceUsd)}</p>
      <Pills rung={rung} />
      <dl className="fp-detail">
        <dt>Declared size</dt>
        <dd>
          {rung.sizeUsd === undefined ? (
            <Absent why="not carried by this snapshot" />
          ) : (
            formatUsd(rung.sizeUsd)
          )}
        </dd>
        {rung.placedAtUsd === undefined ? null : (
          <>
            <dt>Order placed at</dt>
            {/* A DECLARED join whose order sits elsewhere is honored AND flagged: the
                operator said these belong together, and they do — at a different price. */}
            <dd>
              {formatUsd(rung.placedAtUsd)}{" "}
              <span className="muted">differs from the declared rung</span>
            </dd>
          </>
        )}
        <dt>State</dt>
        <dd>{rung.label}</dd>
      </dl>
    </section>
  );
}

/** The pills — the surface showing its own confidence about each rung. */
function Pills({ rung }: { rung: FillPathRungView }) {
  return (
    <p className="fp-pills">
      {rung.notPlaced ? (
        <span className="fp-pill fp-pill-unplaced">declared — not placed</span>
      ) : (
        <span className="fp-pill">{rung.label}</span>
      )}
      {rung.pricePassedUnconfirmed ? (
        <span className="fp-pill fp-pill-inferred">
          waiting · price passed, unconfirmed
        </span>
      ) : null}
      {rung.isNext ? <span className="fp-pill fp-pill-next">next</span> : null}
      {rung.filledPercent === undefined ? null : (
        <span className="fp-pill">partly filled · {rung.filledPercent}%</span>
      )}
      {rung.matchedByPrice ? (
        <span className="fp-pill-caption muted">matched by price</span>
      ) : null}
    </p>
  );
}

/**
 * Card 4 — the ladder itself, and the record for everything the chart draws.
 *
 * EVERY ROW IS A BUTTON, selecting on click and on FOCUS. That is §6.3c: the slider is
 * one path to the inspect panel and this is the other, so a keyboard or a screen reader
 * walks the ladder and the panel follows without touching the chart.
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
                (rung.key === selected?.key ? " is-selected" : "") +
                (rung.notPlaced ? " is-unplaced" : "")
              }
              aria-current={rung.key === selected?.key ? "true" : undefined}
              onClick={() => onSelect(rung.key)}
              onFocus={() => onSelect(rung.key)}
            >
              <span className="fp-row-index">{rung.ladderIndex}</span>
              <span className="fp-row-price">{formatUsd(rung.priceUsd)}</span>
              <span className="fp-row-state">
                <Pills rung={rung} />
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* THE ORPHAN BUCKET — recorded lots no declared rung explains. A count, never
          the lots: the conclusion crosses the wire and the position data does not. */}
      {view.orphanLots > 0 ? (
        <p className="muted fp-orphans">
          {view.orphanLots} recorded {view.orphanLots === 1 ? "lot" : "lots"} that no
          declared rung explains.
        </p>
      ) : null}
    </section>
  );
}

/**
 * PRECISION AND COMPLETENESS, STATED SEPARATELY (G-D5c) — they are different claims and
 * a single "as of" sentence collapses them. Precision says how exact the numbers are;
 * completeness says how much of reality they have seen.
 *
 * THE DATE IS THE ANCHOR'S OWN `asOf`, passed through by the view module: the boundary
 * of what this row could have known. No clock is read anywhere on this page, the `dca`
 * branch carries no date of its own (three invariants depend on that), and no fill
 * timestamp is on the wire to read. THE HEADER CARRIES NO DATE — it lives here, per
 * G-D11, and spot reads `· live` up there instead.
 */
function ProvenanceFooter({ view }: { view: FillPathView }) {
  return (
    <section className="card fp-provenance">
      <p>
        <strong>Precision.</strong> Deployed capital and units are measured from the
        lots the fund recorded — exact, not estimated. Waiting capital is the sizes the
        operator declared.
      </p>
      <p>
        <strong>Completeness.</strong> Fills recorded through{" "}
        <strong>{view.recordedThrough}</strong>. Anything the venue filled after that is
        not in these figures, and neither is anything filled but never recorded.
      </p>
      <p className="fp-spot">
        Spot{" "}
        {view.spotLoading ? (
          <Absent why="reading spot…" />
        ) : view.spotUsd === undefined ? (
          <Absent why="live price unavailable" />
        ) : (
          <>
            <strong>{formatUsd(view.spotUsd)}</strong>{" "}
            {view.spotUnavailable ? (
              <span className="muted">· last close · live price unavailable</span>
            ) : (
              <span className="muted">· live</span>
            )}
          </>
        )}
      </p>
    </section>
  );
}
