import {
  type CompositionReport,
  type DashboardDetail,
  type DashboardRowKind,
  type LoadFailedOutcome,
  type LoadOutcome,
} from "@numisma/engine";

export type DashboardAction =
  | {
      type: "open-detail";
      rowId: string;
    }
  | {
      type: "collapse-detail";
      rowId: string;
    };

export interface DashboardLine {
  content: string;
  selectable: boolean;
  warning?: boolean;
  action?: DashboardAction;
}

export function buildDashboardLines(
  report: CompositionReport,
  detail: DashboardDetail | undefined,
): DashboardLine[] {
  const lines: DashboardLine[] = [
    { content: "Numisma Fund Composition Prototype", selectable: false },
    { content: divider(), selectable: false },
    { content: `Fund: ${report.dashboard.summary.fundName}`, selectable: false },
    { content: `As of: ${report.dashboard.summary.asOf}`, selectable: false },
    { content: "", selectable: false },
    { content: "Weekly Review Focus", selectable: false },
    { content: "-------------------", selectable: false },
    {
      content: `Fund now: ${formatUsd(report.dashboard.summary.fundValueUsd)} in live canonical records`,
      selectable: false,
    },
    {
      content: `Largest Portfolio: ${formatRowFocus(report.dashboard.summary.largestPortfolio)}`,
      selectable: false,
    },
    {
      content: `Largest Tempo: ${formatRowFocus(report.dashboard.summary.largestTempo)}`,
      selectable: false,
    },
    {
      content: `Largest Account: ${formatRowFocus(report.dashboard.summary.largestAccount)}`,
      selectable: false,
    },
    {
      content: `Largest Instrument: ${formatRowFocus(report.dashboard.summary.largestInstrument)}`,
      selectable: false,
    },
    {
      content: `Reserve: ${formatRowFocus(report.dashboard.summary.reserve)}`,
      selectable: false,
    },
    {
      content: `Data safety: ${formatDataSafety(report)}`,
      selectable: false,
    },
    { content: "", selectable: false },
    { content: "Canonical Summary", selectable: false },
    {
      content: `Fund value: ${formatUsd(report.totals.fundValueUsd)}`,
      selectable: false,
    },
    {
      content: `Manual FX: 1 USD = ${report.totals.usdMxn.toFixed(4)} MXN`,
      selectable: false,
    },
    {
      content: `Mode filter: live only; ${report.excluded.nonLive} non-live record(s) excluded`,
      selectable: false,
    },
    {
      content: `Record safety: ${report.excluded.invalid} invalid record(s) excluded`,
      selectable: false,
    },
    ...(report.excluded.shortDeferred > 0
      ? [
          {
            content: `Short direction: ${report.excluded.shortDeferred} deferred short record(s) excluded`,
            selectable: false,
          } satisfies DashboardLine,
        ]
      : []),
  ];

  for (const section of report.dashboard.sections) {
    lines.push(
      { content: "", selectable: false },
      { content: section.title, selectable: false },
      { content: "-".repeat(section.title.length), selectable: false },
      {
        content:
          section.id === "instruments"
            ? `${pad("Name", 28)} ${padLeft("USD Value", 14)} ${padLeft("Fund %", 8)} ${padLeft("Cost", 14)} ${padLeft("Unrl P&L", 14)}`
            : `${pad("Name", 28)} ${padLeft("USD Value", 14)} ${padLeft("Fund %", 8)}`,
        selectable: false,
      },
      {
        content: "-".repeat(section.id === "instruments" ? 82 : 53),
        selectable: false,
      },
    );

    if (section.rows.length === 0) {
      lines.push({ content: "No live records.", selectable: false });
      continue;
    }

    for (const row of section.rows) {
      const selectable = isDetailSelectable(row.kind);
      const rowLine: DashboardLine = selectable
        ? {
            content: `${formatSectionRow(row, section.id === "instruments")}  [enter details]`,
            selectable: true,
            action: { type: "open-detail", rowId: row.id },
          }
        : {
            content: formatSectionRow(row, section.id === "instruments"),
            selectable: false,
          };
      lines.push(rowLine);

      if (detail?.rowId === row.id) {
        lines.push(...buildDetailLines(detail));
      }
    }
  }

  if (report.warnings.length > 0) {
    lines.push(
      { content: "", selectable: false },
      { content: "!!! WARNINGS !!!", selectable: false, warning: true },
      ...report.warnings.map((warning) => ({
        content: `- ${warning.message}`,
        selectable: false,
        warning: true,
      })),
    );
  }

  lines.push(
    { content: "", selectable: false },
    {
      content: "Navigation: j/down next | k/up previous | enter open row | r reload | q quit",
      selectable: true,
    },
  );

  return lines;
}

export function renderDashboardText(
  lines: DashboardLine[],
  load: LoadOutcome,
): string {
  return `${lines.map((line) => line.content).join("\n")}\n\n${renderLoadFooter(load)}`;
}

export function renderLoadFailureText(load: LoadFailedOutcome): string {
  return [
    "Unsafe render blocked by engine validation.",
    "",
    load.message,
    "",
    renderLoadFooter(load),
    "",
    "Keys: q quit | r retry",
  ].join("\n");
}

export function renderLoadFooter(load: LoadOutcome): string {
  return formatLoadState(load);
}

function buildDetailLines(detail: DashboardDetail): DashboardLine[] {
  const usesTypedRows = detail.kind === "tempo" || detail.rows.some((row) => row.kind === "reserve");
  const header = usesTypedRows
    ? `${pad("Type", 10)} ${pad("Record", 26)} ${pad("Portfolio", 16)} ${pad(detail.kind === "account" ? "Tempo" : "Account", 24)} ${padLeft("USD Value", 14)}`
    : `${pad("Position", 26)} ${pad(detail.kind === "portfolio" ? "Tempo" : "Portfolio", 16)} ${pad(detail.kind === "portfolio" ? "Account" : "Tempo", 24)} ${padLeft("USD Value", 14)}`;
  const body = detail.rows.map<DashboardLine>((row) => {
    if (usesTypedRows) {
      return {
        content: `${pad(row.kind === "reserve" ? "Reserve" : "Position", 10)} ${pad(row.recordLabel, 26)} ${pad(row.portfolioLabel, 16)} ${pad(detail.kind === "account" ? row.tempoLabel : row.accountLabel, 24)} ${padLeft(formatUsd(row.usdValue), 14)}`,
        selectable: false,
      };
    }

    return {
      content: `${pad(row.recordLabel, 26)} ${pad(detail.kind === "portfolio" ? row.tempoLabel : row.portfolioLabel, 16)} ${pad(detail.kind === "portfolio" ? row.accountLabel : row.tempoLabel, 24)} ${padLeft(formatUsd(row.usdValue), 14)}`,
      selectable: false,
    };
  });

  return [
    { content: "", selectable: false },
    {
      content: "Selected Row Detail  [enter collapse]",
      selectable: true,
      action: { type: "collapse-detail", rowId: detail.rowId },
    },
    { content: "-------------------", selectable: false },
    { content: detailTitle(detail), selectable: false },
    {
      content:
        detail.rows.some((row) => row.kind === "reserve")
          ? "Live Records"
          : "Live Positions",
      selectable: false,
    },
    { content: header, selectable: false },
    { content: "-".repeat(header.length), selectable: false },
    ...(body.length > 0
      ? body
      : [{ content: emptyDetailMessage(detail), selectable: false }]),
  ];
}

function detailTitle(detail: DashboardDetail): string {
  if (detail.kind === "portfolio") {
    return `Portfolio: ${detail.label}`;
  }
  if (detail.kind === "tempo") {
    return `Tempo: ${detail.label}`;
  }
  return `Account: ${detail.label}`;
}

function emptyDetailMessage(detail: DashboardDetail): string {
  if (detail.kind === "portfolio") {
    return "No live Positions in this Portfolio.";
  }
  if (detail.kind === "tempo") {
    return "No live records in this Tempo.";
  }
  return detail.rows.some((row) => row.kind === "reserve")
    ? "No live records in this Account."
    : "No live Positions in this Account.";
}

function formatSectionRow(
  row: CompositionReport["dashboard"]["sections"][number]["rows"][number],
  includePnl: boolean,
): string {
  const base = `${pad(row.label, 28)} ${padLeft(formatUsd(row.usdValue), 14)} ${padLeft(formatPercent(row.percentOfFund), 8)}`;
  if (!includePnl) {
    return base;
  }
  return `${base} ${padLeft(formatMaybeUsd(row.costBasisUsd), 14)} ${padLeft(formatMaybeUsd(row.unrealizedPnlUsd), 14)}`;
}

function formatLoadState(load: LoadOutcome): string {
  const lines = [];
  if (load.loadedAt) {
    lines.push(
      `${load.status === "loaded" ? "Loaded" : "Load failed"}: ${formatLoadTime(load.loadedAt)}`,
    );
  }
  if (load.sourcePath) {
    lines.push(`Data file: ${load.sourcePath}`);
  }
  return lines.join("\n");
}

function formatRowFocus(
  row:
    | CompositionReport["dashboard"]["summary"]["largestPortfolio"]
    | undefined,
): string {
  if (!row) {
    return "No live records";
  }
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

function isDetailSelectable(kind: DashboardRowKind): boolean {
  return kind === "portfolio" || kind === "tempo" || kind === "account";
}

function divider(): string {
  return "=".repeat(36);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);
}

function formatMaybeUsd(value: number | undefined): string {
  return value === undefined ? "-" : formatUsd(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function pad(value: string, width: number): string {
  return value.length > width
    ? `${value.slice(0, width - 1)}~`
    : value.padEnd(width);
}

function padLeft(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value.padStart(width);
}

function formatLoadTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}
