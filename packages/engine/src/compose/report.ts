// Compose concern — composition report. Ranks the shared canonical line set
// (`./canonical.ts`) into the `CompositionReport` read model: value-sorted
// Portfolio / Tempo / Account / Instrument / Capital-Tier sections, the dashboard
// summary with its largest-slice foci, and the price journeys. The grouping and
// percent-of-fund math live here; canonical-state construction does not.
import type {
  CompositionReport,
  CompositionRow,
  DashboardFocus,
  DashboardRowKind,
  DashboardSummary,
  FundReviewData,
  LoadOutcome,
} from "../contracts.js";
import { percentOfFund, pushWarning } from "../internal.js";
import { buildPriceJourneys } from "../price-journey.js";
import type { CanonicalLine } from "./canonical.js";
import { buildCanonicalState } from "./canonical.js";

interface BuildCompositionReportOptions {
  load?: LoadOutcome;
}

interface GroupAccumulator {
  id: string;
  label: string;
  usdValue: number;
  costBasisUsd: number;
  unrealizedPnlUsd: number;
}

export function buildCompositionReport(
  data: FundReviewData,
  options: BuildCompositionReportOptions = {},
): CompositionReport {
  const { canonicalLines, warnings, excluded, reserveReconciliation } =
    buildCanonicalState(data);

  const fundValueUsd = canonicalLines.reduce((sum, line) => sum + line.usdValue, 0);
  if (fundValueUsd <= 0) {
    pushWarning(
      warnings,
      "non-positive-fund-value",
      "Canonical live Fund value is not positive; percent-of-Fund values may be misleading.",
    );
  }

  const portfolioRows = groupLines(
    canonicalLines,
    "portfolio",
    (line) => line.portfolioId,
    (line) => line.portfolioLabel,
    fundValueUsd,
  );
  const tempoRows = groupLines(
    canonicalLines,
    "tempo",
    (line) => line.tempoId,
    (line) => line.tempoLabel,
    fundValueUsd,
  );
  const accountRows = groupLines(
    canonicalLines,
    "account",
    (line) => line.accountId,
    (line) => line.accountLabel,
    fundValueUsd,
  );
  const instrumentRows = groupLines(
    canonicalLines,
    "instrument",
    (line) => line.instrumentId,
    (line) => line.instrumentLabel,
    fundValueUsd,
  );
  const tierRows = groupTierLines(canonicalLines, fundValueUsd);
  const totalUnrealizedPnlUsd = canonicalLines.reduce(
    (sum, line) => sum + (line.unrealizedPnlUsd ?? 0),
    0,
  );
  const priceJourneys = buildPriceJourneys(data, warnings);

  return {
    totals: {
      baseCurrency: "USD",
      fundValueUsd,
      usdMxn: data.review.usdMxn,
    },
    dashboard: {
      summary: {
        fundName: data.fund.name,
        asOf: data.review.asOf,
        fundValueUsd,
        usdMxn: data.review.usdMxn,
        totalUnrealizedPnlUsd,
        ...optionalSummaryFocus("largestPortfolio", toFocus(portfolioRows[0])),
        ...optionalSummaryFocus("largestTempo", toFocus(tempoRows[0])),
        ...optionalSummaryFocus("largestAccount", toFocus(accountRows[0])),
        ...optionalSummaryFocus("largestInstrument", toFocus(instrumentRows[0])),
        ...optionalSummaryFocus(
          "reserve",
          toFocus(tempoRows.find((row) => row.id === "tempo:Reserve")),
        ),
        dataSafety: {
          nonLiveExcluded: excluded.nonLive,
          invalidExcluded: excluded.invalid,
          shortDeferredExcluded: excluded.shortDeferred,
          hasWarnings: warnings.length > 0,
        },
      },
      sections: [
        {
          id: "portfolios",
          title: "Portfolio Composition",
          rows: portfolioRows,
        },
        {
          id: "tempos",
          title: "Tempo Composition",
          rows: tempoRows,
        },
        {
          id: "accounts",
          title: "Account Composition",
          rows: accountRows,
        },
        {
          id: "instruments",
          title: "Instrument Composition",
          rows: instrumentRows,
        },
        {
          id: "tiers",
          title: "Capital Tier Composition",
          rows: tierRows,
        },
      ],
    },
    priceJourneys,
    reserveReconciliation,
    warnings,
    excluded,
    load: options.load ?? { status: "loaded" },
  };
}

function toFocus(row: CompositionRow | undefined): DashboardFocus | undefined {
  if (!row) return undefined;
  return {
    rowId: row.id,
    kind: row.kind,
    label: row.label,
    usdValue: row.usdValue,
    percentOfFund: row.percentOfFund,
  };
}

function optionalSummaryFocus<
  Key extends
    | "largestPortfolio"
    | "largestTempo"
    | "largestAccount"
    | "largestInstrument"
    | "reserve",
>(
  key: Key,
  value: DashboardSummary[Key],
): Pick<DashboardSummary, Key> | Record<string, never> {
  return value === undefined ? {} : ({ [key]: value } as Pick<DashboardSummary, Key>);
}

function groupLines(
  lines: CanonicalLine[],
  kind: DashboardRowKind,
  idSelector: (line: CanonicalLine) => string,
  labelSelector: (line: CanonicalLine) => string,
  fundValueUsd: number,
): CompositionRow[] {
  const rows = new Map<string, GroupAccumulator>();

  for (const line of lines) {
    const rawId = idSelector(line);
    const label = labelSelector(line);
    const id = `${kind}:${rawId}`;
    const existing = rows.get(id) ?? {
      id,
      label,
      usdValue: 0,
      costBasisUsd: 0,
      unrealizedPnlUsd: 0,
    };
    existing.usdValue += line.usdValue;
    existing.costBasisUsd += line.costBasisUsd ?? 0;
    existing.unrealizedPnlUsd += line.unrealizedPnlUsd ?? 0;
    rows.set(id, existing);
  }

  return [...rows.values()]
    .map((row) => {
      const result: CompositionRow = {
        id: row.id,
        kind,
        label: row.label,
        usdValue: row.usdValue,
        percentOfFund: percentOfFund(row.usdValue, fundValueUsd),
      };

      if (row.costBasisUsd !== 0) {
        result.costBasisUsd = row.costBasisUsd;
      }
      if (row.unrealizedPnlUsd !== 0) {
        result.unrealizedPnlUsd = row.unrealizedPnlUsd;
      }

      return result;
    })
    .sort(
      (a, b) =>
        Math.abs(b.usdValue) - Math.abs(a.usdValue) || a.label.localeCompare(b.label),
    );
}

function groupTierLines(
  lines: CanonicalLine[],
  fundValueUsd: number,
): CompositionRow[] {
  const rows = new Map<string, GroupAccumulator>();

  for (const line of lines) {
    if (!line.tierContributions) continue;
    for (const contribution of line.tierContributions) {
      const id = `tier:${contribution.tier}`;
      const existing = rows.get(id) ?? {
        id,
        label: contribution.tier,
        usdValue: 0,
        costBasisUsd: 0,
        unrealizedPnlUsd: 0,
      };
      existing.usdValue += contribution.usdValue;
      existing.costBasisUsd += contribution.costBasisUsd;
      existing.unrealizedPnlUsd += contribution.unrealizedPnlUsd;
      rows.set(id, existing);
    }
  }

  return [...rows.values()]
    .map((row) => {
      const result: CompositionRow = {
        id: row.id,
        kind: "tier",
        label: row.label,
        usdValue: row.usdValue,
        percentOfFund: percentOfFund(row.usdValue, fundValueUsd),
      };
      if (row.costBasisUsd !== 0) {
        result.costBasisUsd = row.costBasisUsd;
      }
      if (row.unrealizedPnlUsd !== 0) {
        result.unrealizedPnlUsd = row.unrealizedPnlUsd;
      }
      return result;
    })
    .sort(
      (a, b) =>
        Math.abs(b.usdValue) - Math.abs(a.usdValue) || a.label.localeCompare(b.label),
    );
}
