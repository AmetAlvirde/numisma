// Compose concern — dashboard detail. Drill-down for one composition row: locates
// the row in an already-built `CompositionReport`, rebuilds the shared canonical
// line set (`./canonical.ts`), and filters it to the records that roll up into that
// row. Instrument and tier rows have no honest drill-down and return undefined.
import type {
  CompositionReport,
  CompositionRow,
  DashboardDetail,
  FundReviewData,
} from "../contracts.js";
import type { CanonicalLine } from "./canonical.js";
import { buildCanonicalState } from "./canonical.js";

export function buildDashboardDetail(
  data: FundReviewData,
  report: CompositionReport,
  rowId: string,
): DashboardDetail | undefined {
  const row = findDashboardRow(report, rowId);
  if (!row || row.kind === "instrument" || row.kind === "tier") {
    return undefined;
  }

  const { canonicalLines } = buildCanonicalState(data);
  return {
    rowId: row.id,
    kind: row.kind,
    label: row.label,
    rows: detailLinesForRow(canonicalLines, row).map((line) => ({
      recordId: line.recordId,
      kind: line.recordKind,
      recordLabel: line.recordLabel,
      portfolioLabel: line.portfolioLabel,
      tempoLabel: line.tempoLabel,
      accountLabel: line.accountLabel,
      usdValue: line.usdValue,
      ...(line.tierContributions
        ? { tierContributions: line.tierContributions }
        : {}),
    })),
  };
}

function findDashboardRow(
  report: CompositionReport,
  rowId: string,
): CompositionRow | undefined {
  for (const section of report.dashboard.sections) {
    const row = section.rows.find((candidate) => candidate.id === rowId);
    if (row) {
      return row;
    }
  }
  return undefined;
}

function detailLinesForRow(
  canonicalLines: CanonicalLine[],
  row: CompositionRow,
): CanonicalLine[] {
  const rawId = row.id.slice(row.id.indexOf(":") + 1);

  if (row.kind === "portfolio") {
    return canonicalLines.filter(
      (line) => line.recordKind === "position" && line.portfolioId === rawId,
    );
  }

  if (row.kind === "tempo") {
    return canonicalLines.filter((line) => line.tempoId === rawId);
  }

  const accountLines = canonicalLines.filter((line) => line.accountId === rawId);
  if (accountLines.some((line) => line.recordKind === "reserve")) {
    return accountLines;
  }

  return accountLines.filter((line) => line.recordKind === "position");
}
