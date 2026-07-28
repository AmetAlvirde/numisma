import type { DashboardSummary } from "@numisma/engine";
import { formatUsd, formatSignedPercent } from "@numisma/engine/format";

/**
 * Read-only summary card. `usdMxn` comes from `totals` (the authoritative
 * fund-level FX rate) per the field mapping.
 *
 * IT CONSULTS THE SUPPRESSION LIST, via `fundValueRendered`, and it must: suppression
 * is a KEY LIST and the suppressed number stays on the wire, so a renderer that does
 * not ask prints it. This card sits directly ABOVE tables that do ask — on a day when
 * every mark is missing, an unguarded card shows a fund value beside a page of em
 * dashes, which reads as the tables being broken rather than the NAV being unknown.
 *
 * The unrealized P&L is withheld by the SAME fact, and deliberately so. It carries no
 * suppression key of its own — nothing upstream could ever withhold it — and it
 * divides by the very NAV being withheld, so rendering it would hand back a wrong
 * numerator over a wrong denominator, and hand back the NAV by inference besides.
 * NAV suppressed ⟹ marks absent ⟹ P&L unsafe, derived here rather than shipped.
 */
export function SummaryCard({
  summary,
  usdMxn,
  fundValueRendered,
}: {
  summary: DashboardSummary;
  usdMxn: number;
  /** False when the push named `summary.fundValueUsd` in `glance.suppressed`. */
  fundValueRendered: boolean;
}) {
  const safety = summary.dataSafety;
  const clean =
    safety.nonLiveExcluded === 0 &&
    safety.invalidExcluded === 0 &&
    safety.shortDeferredExcluded === 0 &&
    !safety.hasWarnings;

  const pnl = summary.totalUnrealizedPnlUsd;
  const pnlPct =
    summary.fundValueUsd > 0 ? (pnl / summary.fundValueUsd) * 100 : 0;

  return (
    <section className="card summary">
      <header className="summary-head">
        <div>
          <h1>{summary.fundName}</h1>
          <p className="muted">as of {summary.asOf}</p>
        </div>
        <DataSafetyBadge
          clean={clean}
          safety={safety}
          fundValueRendered={fundValueRendered}
        />
      </header>

      <dl className="metrics">
        <div>
          <dt>Fund value</dt>
          <dd>{fundValueRendered ? formatUsd(summary.fundValueUsd) : <Absent />}</dd>
        </div>
        <div>
          {/* NOT gated: the FX rate comes from `totals` and does not descend from a
              mark, so an absent mark leaves it perfectly good. Blacking out the whole
              card would be the whole-page blackout that per-key suppression exists to
              avoid. */}
          <dt>USD/MXN</dt>
          <dd>{usdMxn.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Unrealized P&amp;L</dt>
          {fundValueRendered ? (
            <dd className={pnl >= 0 ? "pos" : "neg"}>
              {formatUsd(pnl)} ({formatSignedPercent(pnlPct)})
            </dd>
          ) : (
            <dd>
              <Absent />
            </dd>
          )}
        </div>
      </dl>
    </section>
  );
}

/**
 * An em dash is not a zero — and the cause says which absence this is, the same
 * shape and the same words `GlanceCard` and `SectionTable` use. There is only ONE
 * cause that can reach this card, so it is stated rather than passed: the fund value
 * is withheld exactly when the marks it is summed from did not arrive.
 */
function Absent() {
  return (
    <span className="absent">
      <span aria-hidden="true">—</span>
      <span className="muted absent-why">no current mark</span>
    </span>
  );
}

/**
 * TWO CAUSES, ONE BADGE, AND THEY ARE JOINED ONLY HERE. `clean` answers *did the
 * fold exclude any records?*; `fundValueRendered` answers *did the marks arrive?*
 * Those are genuinely different questions, and they stay apart upstream — folding
 * mark-absence into `dataSafety` would destroy the distinction that makes either
 * useful. But a badge is an ASSERTION, and this one is the card's only global one,
 * so it is the one place that has to speak for both: a green `Data OK` above `Fund
 * value — no current mark` certifies data the same card refuses to state.
 *
 * Mark absence folds into the existing warn state rather than earning a third
 * visual state, because a third colour costs a vocabulary the card does not
 * otherwise need. The causes stay distinguishable where distinctions belong — in
 * the TEXT, which names each one.
 */
function DataSafetyBadge({
  clean,
  safety,
  fundValueRendered,
}: {
  clean: boolean;
  safety: DashboardSummary["dataSafety"];
  fundValueRendered: boolean;
}) {
  if (clean && fundValueRendered) {
    return <span className="badge badge-ok">Data OK</span>;
  }
  const parts: string[] = [];
  if (safety.nonLiveExcluded > 0) {
    parts.push(`${safety.nonLiveExcluded} non-live`);
  }
  if (safety.invalidExcluded > 0) {
    parts.push(`${safety.invalidExcluded} invalid`);
  }
  if (safety.shortDeferredExcluded > 0) {
    parts.push(`${safety.shortDeferredExcluded} short-deferred`);
  }
  if (safety.hasWarnings && parts.length === 0) {
    parts.push("warnings");
  }
  // Last, so the `hasWarnings` fallback above is still judged on the exclusion
  // counts alone — and first in the text, because this is the cause that explains
  // the em dashes directly beneath. The words are `Absent`'s, deliberately: one
  // cause named two ways would read as two.
  if (!fundValueRendered) {
    parts.unshift("no current mark");
  }
  return (
    <span className="badge badge-warn" title="Withheld or excluded data">
      ⚠ {parts.join(" · ")}
    </span>
  );
}
