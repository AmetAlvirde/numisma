// Shared formatters + the CLI composition report renderer. The low-level
// formatters are the engine's ONE exported source of truth for the
// "USD to cents" / padding / precision conventions (context/product.md): the TUI
// imports them from @numisma/engine rather than keeping private copies, so the
// cents-precision rule cannot silently diverge across the CLI and TUI surfaces.
import type {
  Currency,
  ClosedBook,
  CompositionReport,
  CompositionRow,
  DashboardFocus,
  DashboardSectionId,
  InvalidationWatchRow,
  PriceJourney,
  RealizedRollupRow,
  ReserveReconciliationLine,
} from "./contracts.js";
import type { ProfitSplit } from "./compose/profit-split.js";

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

export function formatMaybeUsd(value: number | undefined): string {
  return value === undefined ? "-" : formatUsd(value);
}

export function formatPrice(value: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value);
}

export function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function pad(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, width - 1)}~`
    : value.padEnd(width);
}

export function padLeft(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value.padStart(width);
}

export function divider(): string {
  return "=".repeat(36);
}

export function formatCompositionReport(
  report: CompositionReport,
  profitSplit?: ProfitSplit,
): string {
  const sections = [
    `Numisma Fund Composition Prototype`,
    divider(),
    `Fund: ${report.dashboard.summary.fundName}`,
    `As of: ${report.dashboard.summary.asOf}`,
    "",
    formatWeeklyReviewFocus(report),
    "",
    "Canonical Summary",
    `Fund value: ${formatUsd(report.totals.fundValueUsd)}`,
    `Unrealized P&L: ${formatUsd(report.dashboard.summary.totalUnrealizedPnlUsd)}`,
    `Manual FX: 1 USD = ${report.totals.usdMxn.toFixed(4)} MXN`,
    `Mode filter: live only; ${report.excluded.nonLive} non-live record(s) excluded`,
    `Record safety: ${report.excluded.invalid} invalid record(s) excluded`,
    ...(report.excluded.shortDeferred > 0
      ? [
          `Short direction: ${report.excluded.shortDeferred} deferred short record(s) excluded`,
        ]
      : []),
    "",
    formatRows("Portfolio Composition", sectionRows(report, "portfolios")),
    "",
    formatRows("Tempo Composition", sectionRows(report, "tempos")),
    "",
    formatRows("Account Composition", sectionRows(report, "accounts")),
    "",
    formatRows(
      "Instrument Composition",
      sectionRows(report, "instruments"),
      true,
    ),
    "",
    formatRows(
      "Capital Tier Composition",
      sectionRows(report, "tiers"),
      true,
    ),
    "",
    formatReserveReconciliation(report.reserveReconciliation),
    "",
    formatPriceJourneys(report.priceJourneys),
  ];

  // The closed-book blotter + invalidation watch. Both render nothing when empty,
  // so a fold with no closes / no levels produces byte-for-byte the prior report
  // (existing snapshots stay green).
  const blotter = formatClosedBook(report.closedBook);
  if (blotter) {
    sections.push("", blotter);
  }
  const watch = formatInvalidationWatch(report.invalidationWatch);
  if (watch) {
    sections.push("", watch);
  }
  // The profit-split obligation block: descriptive-only, derived at read time from the
  // closed book + the as-of policy. Empty-guarded (undefined split / no policy / no
  // closes render ""), so a report composed without a policy — every pre-existing #90
  // caller passes no `profitSplit` — is byte-for-byte unchanged. This is the conscious
  // first wiring (PRD #96 C1): the first populated render is a reviewed snapshot lock.
  const profitSplitBlock = formatProfitSplit(profitSplit);
  if (profitSplitBlock) {
    sections.push("", profitSplitBlock);
  }

  if (report.warnings.length > 0) {
    sections.push(
      "",
      "!!! WARNINGS !!!",
      ...report.warnings.map((warning) => `- ${warning.message}`),
    );
  }

  sections.push("", "Keys: q quit | r reload data");
  return sections.join("\n");
}

/**
 * Render the trade blotter: one row per
 * closed position with realized Trading P&L, then realized rolled up by Tempo and by
 * Tier, then the grand total — flagged descriptive-only so it is never mistaken for
 * an addition to NAV. Returns "" when the closed book is empty.
 */
export function formatClosedBook(book: ClosedBook): string {
  if (book.rows.length === 0) {
    return "";
  }
  const title = "Realized P&L — Closed Book (blotter)";
  const header = `${pad("Instrument", 12)} ${pad("Tempo", 10)} ${pad("Strategy", 14)} ${pad("Opened", 11)} ${pad("Closed", 11)} ${padLeft("Cost", 12)} ${padLeft("Proceeds", 12)} ${padLeft("Realized", 12)}`;
  const body = book.rows.map((row) =>
    `${pad(row.instrumentId, 12)} ${pad(row.tempo, 10)} ${pad(row.strategy ?? "—", 14)} ` +
    `${pad(row.openedAsOf ?? "genesis", 11)} ${pad(row.closedAsOf, 11)} ` +
    `${padLeft(formatUsd(row.costBasisUsd), 12)} ${padLeft(formatUsd(row.proceedsUsd), 12)} ` +
    `${padLeft(formatUsd(row.realizedPnlUsd), 12)}`,
  );

  return [
    title,
    "-".repeat(title.length),
    "Descriptive only — realized profit already sits in a Reserve; NOT re-added to NAV.",
    header,
    "-".repeat(header.length),
    ...body,
    "",
    formatRealizedRollup("Realized by Tempo", book.byTempo),
    "",
    formatRealizedRollup("Realized by Tier", book.byTier),
    "",
    `Total realized since genesis: ${formatUsd(book.totalRealizedPnlUsd)}`,
  ].join("\n");
}

function formatRealizedRollup(title: string, rows: RealizedRollupRow[]): string {
  const header = `${pad("Key", 14)} ${padLeft("Cost", 12)} ${padLeft("Proceeds", 12)} ${padLeft("Realized", 12)}`;
  const body = rows.map((row) =>
    `${pad(row.key, 14)} ${padLeft(formatUsd(row.costBasisUsd), 12)} ${padLeft(formatUsd(row.proceedsUsd), 12)} ${padLeft(formatUsd(row.realizedPnlUsd), 12)}`,
  );
  return [title, "-".repeat(title.length), header, ...body].join("\n");
}

/**
 * Render the invalidation watch: one line
 * per OPEN position carrying a structured level, showing its latest mark vs level and
 * whether the thesis is breached. Returns "" when no position carries a level.
 */
export function formatInvalidationWatch(rows: InvalidationWatchRow[]): string {
  if (rows.length === 0) {
    return "";
  }
  const title = "Invalidation Watch";
  const body = rows.map((row) => {
    const status = row.breached ? "⚠ THESIS INVALIDATED" : "OK";
    return (
      `${pad(row.positionId, 20)} ${pad(row.instrumentId, 10)} ` +
      `mark ${formatPrice(row.markPrice, "USD")} ${row.direction} ${formatPrice(row.level, "USD")}  ${status}`
    );
  });
  return [title, "-".repeat(title.length), ...body].join("\n");
}

/**
 * PROTOTYPE (mvi 2026-07-02-partial-close-profit-split). Render the descriptive-only
 * profit-split block: the basis, the exact cumulative net realized (with its peak on
 * the high-water-mark basis), the split OBLIGATION on that basis, and the RESERVE
 * tempo's actual % of NAV vs its target.
 *
 * OBLIGATION-ONLY (PRD #96 R1): absent an explicit routing signal, the block prints
 * ONLY the honestly computable obligation plus the RESERVE %-vs-target line — no
 * inferred "routed into sink" flow and no "unallocated profit" line. EMPTY-GUARDED —
 * returns "" for an undefined split (no policy / no closes), so blanking the block
 * leaves NAV and the rest of the report byte-for-byte unchanged.
 */
export function formatProfitSplit(split: ProfitSplit | undefined): string {
  if (!split) {
    return "";
  }
  const title = "Profit Split — Obligation (descriptive only)";
  const pct = (split.splitFractionReserve * 100).toFixed(0);
  const overUnder = split.reservePctOfNav >= split.reserveTargetPct ? "at/above" : "below";
  return [
    title,
    "-".repeat(title.length),
    `Basis: ${split.basis} (Reserve share ${pct}% of gains)`,
    `Cumulative net realized: ${formatUsd(split.cumulativeNetRealizedUsd)}` +
      (split.basis === "highWaterMark" ? `  (peak ${formatUsd(split.peakCumulativeUsd)})` : ""),
    `Split obligation to Reserve: ${formatUsd(split.obligationUsd)}`,
    `Reserve is ${formatPercent(split.reservePctOfNav)} of NAV vs ${formatPercent(split.reserveTargetPct)} target (${overUnder}).`,
  ].join("\n");
}

function formatWeeklyReviewFocus(report: CompositionReport): string {
  const { summary } = report.dashboard;

  return [
    "Weekly Review Focus",
    "-------------------",
    `Fund now: ${formatUsd(summary.fundValueUsd)} in live canonical records`,
    `Unrealized P&L: ${formatUsd(summary.totalUnrealizedPnlUsd)}`,
    `Largest Portfolio: ${formatRowFocus(summary.largestPortfolio)}`,
    `Largest Tempo: ${formatRowFocus(summary.largestTempo)}`,
    `Largest Account: ${formatRowFocus(summary.largestAccount)}`,
    `Largest Instrument: ${formatRowFocus(summary.largestInstrument)}`,
    `Reserve: ${formatRowFocus(summary.reserve)}`,
    `Data safety: ${formatDataSafety(report)}`,
  ].join("\n");
}

function formatRowFocus(row: DashboardFocus | undefined): string {
  if (!row) return "No live records";
  return `${row.label} ${formatUsd(row.usdValue)} (${formatPercent(row.percentOfFund)})`;
}

function formatDataSafety(report: CompositionReport): string {
  const exclusions = [
    `${report.excluded.nonLive} non-live excluded`,
    `${report.excluded.invalid} invalid excluded`,
    ...(report.excluded.shortDeferred > 0
      ? [`${report.excluded.shortDeferred} short deferred`]
      : []),
  ];
  return report.warnings.length > 0
    ? `${exclusions.join("; ")}; warnings shown below`
    : `${exclusions.join("; ")}; no warnings`;
}

function sectionRows(
  report: CompositionReport,
  sectionId: DashboardSectionId,
): CompositionRow[] {
  return (
    report.dashboard.sections.find((section) => section.id === sectionId)?.rows ?? []
  );
}

function formatRows(
  title: string,
  rows: CompositionRow[],
  includePnl = false,
): string {
  const header = includePnl
    ? `${pad("Name", 28)} ${padLeft("USD Value", 14)} ${padLeft("Fund %", 8)} ${padLeft("Cost", 14)} ${padLeft("Unrl P&L", 14)}`
    : `${pad("Name", 28)} ${padLeft("USD Value", 14)} ${padLeft("Fund %", 8)}`;
  const body = rows.map((row) => {
    const base = `${pad(row.label, 28)} ${padLeft(formatUsd(row.usdValue), 14)} ${padLeft(formatPercent(row.percentOfFund), 8)}`;
    if (!includePnl) return base;
    return `${base} ${padLeft(formatMaybeUsd(row.costBasisUsd), 14)} ${padLeft(formatMaybeUsd(row.unrealizedPnlUsd), 14)}`;
  });

  return [
    title,
    "-".repeat(title.length),
    header,
    "-".repeat(header.length),
    ...(body.length > 0 ? body : ["No live records."]),
  ].join("\n");
}

/**
 * Post-fold Reserve balances (PRD #82 C3): one line per live Reserve, in genesis
 * insertion order (never re-sorted), showing the folded NATIVE balance the venue
 * reports next to its USD value. The operator reads this straight down against the
 * real venue balances to confirm the fold conserved every cash leg.
 */
export function formatReserveReconciliation(
  lines: ReserveReconciliationLine[],
): string {
  const title = "Reserve Reconciliation";
  const header = `${pad("Reserve", 28)} ${pad("Venue", 24)} ${padLeft("Balance", 16)} ${padLeft("USD Value", 14)}`;
  const body = lines.map((line) =>
    `${pad(line.reserveId, 28)} ${pad(line.venueLabel, 24)} ${padLeft(formatPrice(line.balance, line.currency), 16)} ${padLeft(formatUsd(line.usdValue), 14)}`,
  );

  return [
    title,
    "-".repeat(title.length),
    "Post-fold balances to eyeball against the real venues.",
    header,
    "-".repeat(header.length),
    ...(body.length > 0 ? body : ["No live Reserves."]),
  ].join("\n");
}

function formatPriceJourneys(journeys: PriceJourney[]): string {
  const title = "Weekly Price Journey";
  if (journeys.length === 0) {
    return [title, "-".repeat(title.length), "No Close history recorded."].join("\n");
  }

  const body = journeys.map((journey) => {
    const series = journey.points
      .map((point) => `${point.asOf} ${formatPrice(point.price, journey.currency)}`)
      .join(" -> ");
    return `${pad(journey.label, 28)} ${series}  (${formatSignedPercent(journey.changePct)})`;
  });

  return [title, "-".repeat(title.length), ...body].join("\n");
}
