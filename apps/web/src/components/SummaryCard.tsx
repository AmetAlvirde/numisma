import type { DashboardSummary } from "@numisma/engine";
import { formatUsd, formatSignedPercent } from "@numisma/engine/format";

/**
 * Read-only summary card. `usdMxn` comes from `totals` (the authoritative
 * fund-level FX rate) per the field mapping.
 */
export function SummaryCard({
  summary,
  usdMxn,
}: {
  summary: DashboardSummary;
  usdMxn: number;
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
        <DataSafetyBadge clean={clean} safety={safety} />
      </header>

      <dl className="metrics">
        <div>
          <dt>Fund value</dt>
          <dd>{formatUsd(summary.fundValueUsd)}</dd>
        </div>
        <div>
          <dt>USD/MXN</dt>
          <dd>{usdMxn.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Unrealized P&amp;L</dt>
          <dd className={pnl >= 0 ? "pos" : "neg"}>
            {formatUsd(pnl)} ({formatSignedPercent(pnlPct)})
          </dd>
        </div>
      </dl>
    </section>
  );
}

function DataSafetyBadge({
  clean,
  safety,
}: {
  clean: boolean;
  safety: DashboardSummary["dataSafety"];
}) {
  if (clean) {
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
  return (
    <span className="badge badge-warn" title="Excluded / flagged records">
      ⚠ {parts.join(" · ")}
    </span>
  );
}
