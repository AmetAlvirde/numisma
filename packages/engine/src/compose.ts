// Compose concern: turns parsed `FundReviewData` into the canonical line set and
// the `CompositionReport` read model — canonical-state construction, grouping,
// Capital-Tier rollup, and dashboard detail drill-down. Cross-concern helpers
// come from the internal kernel; the latest-Close anchor and markPrice/Close
// tolerance come from the price-journey module. Neither is re-copied here.
import type {
  CapitalRecordBase,
  CapitalTier,
  CompositionReport,
  CompositionRow,
  DashboardDetail,
  DashboardFocus,
  DashboardRowKind,
  DashboardSummary,
  DetailRecordKind,
  FundReviewData,
  LoadOutcome,
  NamedRecord,
  ReserveRecord,
  ReserveReconciliationLine,
  TierContribution,
  Warning,
} from "./contracts.js";
import {
  indexById,
  isDirection,
  isExecutionMode,
  isNonNegativeNumber,
  isPositiveNumber,
  isSupportedCurrency,
  percentOfFund,
  pushWarning,
  toUsd,
} from "./internal.js";
import {
  buildPriceJourneys,
  latestCloseByInstrument,
  markPriceCloseTolerance,
} from "./price-journey.js";

/**
 * Reserve Lot face sums are reconciled against `amount` with a hybrid tolerance:
 * `max(absolute floor, relative fraction × amount)`. The floor absorbs cent-level
 * rounding on small balances; the relative term scales the forgiveness with the
 * balance so a hand-rounded provenance split on a large reserve does not trip the
 * warning, while real misallocation (beyond the band) still emits
 * `reserve-lot-sum-mismatch`. `amount` always stays authoritative. Both terms are
 * named and tunable here.
 */
const RESERVE_LOT_SUM_ABS_TOLERANCE = 0.01;
const RESERVE_LOT_SUM_REL_TOLERANCE = 0.001; // 0.1% of amount

/** Hybrid reconciliation tolerance for a reserve of the given face `amount`. */
function reserveLotSumTolerance(amount: number): number {
  return Math.max(
    RESERVE_LOT_SUM_ABS_TOLERANCE,
    RESERVE_LOT_SUM_REL_TOLERANCE * Math.abs(amount),
  );
}

interface CanonicalLine {
  recordId: string;
  recordKind: DetailRecordKind;
  recordLabel: string;
  portfolioId: string;
  portfolioLabel: string;
  tempoId: string;
  tempoLabel: string;
  accountId: string;
  accountLabel: string;
  instrumentId: string;
  instrumentLabel: string;
  usdValue: number;
  costBasisUsd?: number;
  unrealizedPnlUsd?: number;
  tierContributions?: TierContribution[];
}

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

interface CanonicalState {
  canonicalLines: CanonicalLine[];
  warnings: Warning[];
  excluded: CompositionReport["excluded"];
  reserveReconciliation: ReserveReconciliationLine[];
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

function buildCanonicalState(data: FundReviewData): CanonicalState {
  const warnings: Warning[] = [];
  const portfolios = indexById(data.portfolios, "portfolio");
  const accounts = indexById(data.accounts, "account");
  const instruments = indexById(data.instruments, "instrument");
  const latestCloses = latestCloseByInstrument(data.closes);
  const canonicalLines: CanonicalLine[] = [];
  // Reconciliation lines are collected as each live Reserve is admitted below, so
  // they inherit `data.reserves` insertion order (never re-sorted like the
  // value-ranked composition sections). This is the FOLDED reserves array the fold
  // mutated (C2) — the report can never eyeball a stale genesis balance.
  const reserveReconciliation: ReserveReconciliationLine[] = [];
  const excluded = {
    nonLive: 0,
    invalid: 0,
    shortDeferred: 0,
  };

  for (const reserve of data.reserves) {
    if (!isExecutionMode(reserve.executionMode)) {
      pushWarning(
        warnings,
        "unsupported-execution-mode",
        `Reserve ${reserve.id} uses unsupported Execution Mode ${String(reserve.executionMode)} and was excluded.`,
        reserve.id,
      );
      excluded.invalid += 1;
      continue;
    }

    if (reserve.executionMode !== "live") {
      excluded.nonLive += 1;
      continue;
    }

    if (!isSupportedCurrency(reserve.currency)) {
      pushWarning(
        warnings,
        "unsupported-currency",
        `Reserve ${reserve.id} uses unsupported Currency ${String(reserve.currency)} and was excluded.`,
        reserve.id,
      );
      excluded.invalid += 1;
      continue;
    }

    const reserveHasMissingReference = validateCapitalBase(
      reserve,
      portfolios,
      accounts,
      warnings,
    );
    if (reserveHasMissingReference) {
      excluded.invalid += 1;
      continue;
    }

    const reserveAccount = accounts.get(reserve.accountId);
    if (reserveAccount && reserveAccount.currency !== reserve.currency) {
      pushWarning(
        warnings,
        "currency-mismatch",
        `Reserve ${reserve.id} currency ${reserve.currency} does not match Account ${reserve.accountId} currency ${reserveAccount.currency} and was excluded.`,
        reserve.id,
      );
      excluded.invalid += 1;
      continue;
    }

    if (!isNonNegativeNumber(reserve.amount)) {
      pushWarning(
        warnings,
        "invalid-amount",
        `Reserve ${reserve.id} has invalid amount and was excluded.`,
        reserve.id,
      );
      excluded.invalid += 1;
      continue;
    }

    // Cash Lots attribute the reserve's face to Capital Tiers (cost == value,
    // Price P&L == 0). `amount` stays the line's authoritative USD value; the
    // tier contributions are an independent overlay consumed only by the tier
    // rollup, so untiered reserves and every other section stay unchanged.
    const tierContributions = buildReserveTierContributions(
      reserve,
      data.review.usdMxn,
      warnings,
    );

    const reserveUsdValue = toUsd(reserve.amount, reserve.currency, data.review.usdMxn);

    canonicalLines.push({
      recordId: reserve.id,
      recordKind: "reserve",
      recordLabel: "Reserve",
      portfolioId: reserve.portfolioId,
      portfolioLabel: portfolios.get(reserve.portfolioId)?.name ?? reserve.portfolioId,
      tempoId: reserve.tempo,
      tempoLabel: reserve.tempo,
      accountId: reserve.accountId,
      accountLabel: accountLabel(reserveAccount, reserve.accountId),
      instrumentId: "reserve",
      instrumentLabel: "Reserve",
      usdValue: reserveUsdValue,
      ...(tierContributions ? { tierContributions } : {}),
    });

    // The reconciliation line reports the folded NATIVE balance (`reserve.amount`,
    // what the venue shows) alongside its USD value, so the operator can compare
    // each venue's real figure against the ledger after the fold applied every cash
    // leg.
    reserveReconciliation.push({
      reserveId: reserve.id,
      venueLabel: accountLabel(reserveAccount, reserve.accountId),
      currency: reserve.currency,
      balance: reserve.amount,
      usdValue: reserveUsdValue,
    });
  }

  for (const position of data.positions) {
    if (!isExecutionMode(position.executionMode)) {
      pushWarning(
        warnings,
        "unsupported-execution-mode",
        `Position ${position.id} uses unsupported Execution Mode ${String(position.executionMode)} and was excluded.`,
        position.id,
      );
      excluded.invalid += 1;
      continue;
    }

    if (position.executionMode !== "live") {
      excluded.nonLive += 1;
      continue;
    }

    if (!isSupportedCurrency(position.currency)) {
      pushWarning(
        warnings,
        "unsupported-currency",
        `Position ${position.id} uses unsupported Currency ${String(position.currency)} and was excluded.`,
        position.id,
      );
      excluded.invalid += 1;
      continue;
    }

    if (!isDirection(position.direction)) {
      pushWarning(
        warnings,
        "unsupported-direction",
        `Position ${position.id} uses unsupported Direction ${String(position.direction)} and was excluded.`,
        position.id,
      );
      excluded.invalid += 1;
      continue;
    }

    if (position.direction === "short") {
      excluded.shortDeferred += 1;
      continue;
    }

    let invalidRecord = validateCapitalBase(position, portfolios, accounts, warnings);

    const instrument = instruments.get(position.instrumentId);
    if (!instrument) {
      pushWarning(
        warnings,
        "missing-instrument",
        `Position ${position.id} references missing Instrument ${position.instrumentId} and was excluded.`,
        position.id,
      );
      invalidRecord = true;
    }

    const account = accounts.get(position.accountId);
    if (account && account.currency !== position.currency) {
      pushWarning(
        warnings,
        "currency-mismatch",
        `Position ${position.id} currency ${position.currency} does not match Account ${position.accountId} currency ${account.currency} and was excluded.`,
        position.id,
      );
      invalidRecord = true;
    }

    if (instrument && instrument.currency !== position.currency) {
      pushWarning(
        warnings,
        "currency-mismatch",
        `Position ${position.id} currency ${position.currency} does not match Instrument ${position.instrumentId} currency ${instrument.currency} and was excluded.`,
        position.id,
      );
      invalidRecord = true;
    }

    if (invalidRecord) {
      excluded.invalid += 1;
      continue;
    }

    const lots = position.lots;
    const invalidNumericFields: string[] = [];
    if (!isNonNegativeNumber(position.markPrice)) {
      invalidNumericFields.push("markPrice");
    }
    if (lots.length === 0) {
      invalidNumericFields.push("lots");
    }
    for (const lot of lots) {
      if (!isNonNegativeNumber(lot.quantity)) invalidNumericFields.push("quantity");
      if (!isNonNegativeNumber(lot.cost)) invalidNumericFields.push("cost");
      if (lot.entryFx !== undefined && !isPositiveNumber(lot.entryFx)) {
        invalidNumericFields.push("entryFx");
      }
    }
    if (invalidNumericFields.length > 0) {
      pushWarning(
        warnings,
        "invalid-position-number",
        `Position ${position.id} has invalid ${[...new Set(invalidNumericFields)].join(", ")} and was excluded.`,
        position.id,
      );
      excluded.invalid += 1;
      continue;
    }

    // Market value converts at the current review FX; each Lot's cost basis
    // converts at its own entry FX (falling back to the review FX). P&L is the
    // per-Lot join of (quantity, cost, tier, entryFx) against one instrument
    // markPrice, then aggregated by Capital Tier.
    const reviewFx = data.review.usdMxn;
    let marketValueUsd = 0;
    let costBasisUsd = 0;
    const tierTotals = new Map<CapitalTier, TierContribution>();
    for (const lot of lots) {
      const lotMarketUsd = toUsd(lot.quantity * position.markPrice, position.currency, reviewFx);
      const lotCostUsd = toUsd(lot.quantity * lot.cost, position.currency, lot.entryFx ?? reviewFx);
      marketValueUsd += lotMarketUsd;
      costBasisUsd += lotCostUsd;
      const existing = tierTotals.get(lot.tier) ?? {
        tier: lot.tier,
        usdValue: 0,
        costBasisUsd: 0,
        unrealizedPnlUsd: 0,
      };
      existing.usdValue += lotMarketUsd;
      existing.costBasisUsd += lotCostUsd;
      existing.unrealizedPnlUsd += lotMarketUsd - lotCostUsd;
      tierTotals.set(lot.tier, existing);
    }

    canonicalLines.push({
      recordId: position.id,
      recordKind: "position",
      recordLabel: `${instrument!.symbol} (${instrument!.name})`,
      portfolioId: position.portfolioId,
      portfolioLabel: portfolios.get(position.portfolioId)?.name ?? position.portfolioId,
      tempoId: position.tempo,
      tempoLabel: position.tempo,
      accountId: position.accountId,
      accountLabel: accountLabel(account, position.accountId),
      instrumentId: position.instrumentId,
      instrumentLabel: `${instrument!.symbol} (${instrument!.name})`,
      usdValue: marketValueUsd,
      costBasisUsd,
      unrealizedPnlUsd: marketValueUsd - costBasisUsd,
      tierContributions: [...tierTotals.values()],
    });

    // Per-position coherence check (non-blocking, valuation already committed
    // above): a position's authoritative `markPrice` and its instrument's latest
    // display-only Close should agree within tolerance. Running per-position
    // incidentally surfaces cross-position divergence of the same instrument.
    // markPrice and Close share the instrument's native units (currency is
    // reconciled above), so they compare directly without FX conversion.
    const latestClose = latestCloses.get(position.instrumentId);
    if (
      latestClose &&
      Math.abs(position.markPrice - latestClose.price) >
        markPriceCloseTolerance(latestClose.price)
    ) {
      pushWarning(
        warnings,
        "markprice-close-mismatch",
        `Position ${position.id} markPrice ${position.markPrice} disagrees with Instrument ${position.instrumentId} latest Close ${latestClose.price} (as of ${latestClose.asOf}) beyond tolerance; markPrice stays the authoritative P&L input and Close stays display-only.`,
        position.id,
      );
    }
  }

  return {
    canonicalLines,
    warnings,
    excluded,
    reserveReconciliation,
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

function buildReserveTierContributions(
  reserve: ReserveRecord,
  reviewFx: number,
  warnings: Warning[],
): TierContribution[] | undefined {
  const lots = reserve.lots;
  if (!Array.isArray(lots) || lots.length === 0) {
    return undefined; // untiered = excluded from the tier rollup (back-compat)
  }

  // A bad scalar slipped past schema typing leaves the reserve untiered rather
  // than poisoning the rollup with NaN; `amount` still counts toward the fund.
  // The drop is surfaced, never silent.
  if (lots.some((lot) => !isNonNegativeNumber(lot.quantity))) {
    pushWarning(
      warnings,
      "invalid-reserve-lot-quantity",
      `Reserve ${reserve.id} has a Lot with a negative or non-finite quantity; the Reserve stays untiered and amount stays authoritative.`,
      reserve.id,
    );
    return undefined;
  }

  const tierTotals = new Map<CapitalTier, TierContribution>();
  let faceSum = 0;
  for (const lot of lots) {
    const lotUsd = toUsd(lot.quantity, reserve.currency, reviewFx);
    faceSum += lot.quantity;
    const existing = tierTotals.get(lot.tier) ?? {
      tier: lot.tier,
      usdValue: 0,
      costBasisUsd: 0,
      unrealizedPnlUsd: 0,
    };
    existing.usdValue += lotUsd;
    existing.costBasisUsd += lotUsd; // cash: cost == face, so Price P&L == 0
    tierTotals.set(lot.tier, existing);
  }

  if (Math.abs(faceSum - reserve.amount) > reserveLotSumTolerance(reserve.amount)) {
    pushWarning(
      warnings,
      "reserve-lot-sum-mismatch",
      `Reserve ${reserve.id} Lot tiers sum to ${faceSum} ${reserve.currency} but amount is ${reserve.amount} ${reserve.currency}; amount stays authoritative and the tier split is taken as-given.`,
      reserve.id,
    );
  }

  return [...tierTotals.values()];
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

function accountLabel(
  account: (NamedRecord & { platform: string }) | undefined,
  fallback: string,
): string {
  return account ? `${account.platform}: ${account.name}` : fallback;
}

function validateCapitalBase(
  record: CapitalRecordBase,
  portfolios: Map<string, NamedRecord>,
  accounts: Map<string, NamedRecord>,
  warnings: Warning[],
): boolean {
  let hasMissingReference = false;
  if (!portfolios.has(record.portfolioId)) {
    pushWarning(
      warnings,
      "missing-portfolio",
      `${record.id} references missing Portfolio ${record.portfolioId} and was excluded.`,
      record.id,
    );
    hasMissingReference = true;
  }
  if (!accounts.has(record.accountId)) {
    pushWarning(
      warnings,
      "missing-account",
      `${record.id} references missing Account ${record.accountId} and was excluded.`,
      record.id,
    );
    hasMissingReference = true;
  }
  return hasMissingReference;
}
