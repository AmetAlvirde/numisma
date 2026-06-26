export type Currency = "USD" | "MXN";
export type ExecutionMode = "live" | "paper" | "back-test" | "forward-test";
export type Direction = "long" | "short";
export type CapitalTier = "c1" | "c2" | "c3";

/**
 * A Lot preserves Capital Tier attribution inside a Position. It binds
 * `(quantity, cost, tier, entryFx)` together so per-tier P&L stays correct even
 * when two tiers of the same instrument were acquired at different costs.
 */
export interface Lot {
  quantity: number;
  cost: number;
  tier: CapitalTier;
  /** MXN-per-USD rate at acquisition; cost basis converts at this rate. */
  entryFx?: number;
}

export interface FundReviewData {
  fund: {
    id: string;
    name: string;
    baseCurrency: "USD";
  };
  review: {
    asOf: string;
    usdMxn: number;
  };
  portfolios: NamedRecord[];
  accounts: Array<NamedRecord & { platform: string; currency: Currency }>;
  instruments: Array<NamedRecord & { symbol: string; currency: Currency }>;
  reserves: ReserveRecord[];
  positions: PositionRecord[];
  /** Periodic per-instrument price snapshots; the spine of the price journey. */
  closes?: Close[];
}

/**
 * Close — an immutable periodic price snapshot for one instrument at one anchor.
 * A series of Closes per instrument yields the weekly valuation history.
 */
export interface Close {
  instrumentId: string;
  asOf: string;
  price: number;
}

interface NamedRecord {
  id: string;
  name: string;
}

interface CapitalRecordBase {
  id: string;
  portfolioId: string;
  tempo: string;
  executionMode: ExecutionMode;
  accountId: string;
  currency: Currency;
}

export interface ReserveRecord extends CapitalRecordBase {
  amount: number;
}

export interface PositionRecord extends CapitalRecordBase {
  instrumentId: string;
  direction: Direction;
  markPrice: number;
  /** Lot-grained cost + Capital Tier attribution. Canonical going forward. */
  lots?: Lot[];
  /**
   * Prototype back-compat: single-tier shorthand. When `lots` is absent these
   * normalize to one `c1` Lot. The reliable increment drops this shim.
   */
  quantity?: number;
  averageCost?: number;
}

export interface Ok {
  kind: "ok";
  value: FundReviewData;
}

export interface InvalidJson {
  kind: "invalid-json";
  severity: "blocking";
  message: string;
  detail: string;
}

export interface SchemaError {
  kind: "schema-error";
  severity: "blocking";
  path: string;
  message: string;
}

export interface UnsupportedBaseCurrency {
  kind: "unsupported-base-currency";
  severity: "blocking";
  baseCurrency: unknown;
  message: string;
}

export interface InvalidFxRate {
  kind: "invalid-fx-rate";
  severity: "blocking";
  path: "review.usdMxn";
  value: unknown;
  message: string;
}

export interface InvalidAsOf {
  kind: "invalid-as-of";
  severity: "blocking";
  path: "review.asOf";
  value: unknown;
  message: string;
}

export interface DuplicateReferenceId {
  kind: "duplicate-reference-id";
  severity: "blocking";
  recordType: "portfolio" | "account" | "instrument";
  id: string;
  message: string;
}

export interface DuplicateCapitalRecordId {
  kind: "duplicate-capital-record-id";
  severity: "blocking";
  id: string;
  message: string;
}

export type ParseResult =
  | Ok
  | InvalidJson
  | SchemaError
  | UnsupportedBaseCurrency
  | InvalidFxRate
  | InvalidAsOf
  | DuplicateReferenceId
  | DuplicateCapitalRecordId;

export type ValidationSeverity = "blocking" | "warning";

export interface LoadedOutcome {
  status: "loaded";
  sourcePath?: string;
  loadedAt?: string;
}

export interface LoadFailedOutcome {
  status: "load-failed";
  sourcePath?: string;
  loadedAt?: string;
  message: string;
}

export type LoadOutcome = LoadedOutcome | LoadFailedOutcome;

export type WarningCode =
  | "missing-portfolio"
  | "missing-account"
  | "missing-instrument"
  | "unsupported-execution-mode"
  | "unsupported-currency"
  | "unsupported-direction"
  | "currency-mismatch"
  | "invalid-amount"
  | "invalid-position-number"
  | "non-positive-fund-value";

export type ValidationCode =
  | Exclude<ParseResult["kind"], "ok">
  | WarningCode
  | "short-deferred";

export const validationSeverityByCode: Record<ValidationCode, ValidationSeverity> = {
  "invalid-json": "blocking",
  "schema-error": "blocking",
  "unsupported-base-currency": "blocking",
  "invalid-fx-rate": "blocking",
  "invalid-as-of": "blocking",
  "duplicate-reference-id": "blocking",
  "duplicate-capital-record-id": "blocking",
  "missing-portfolio": "warning",
  "missing-account": "warning",
  "missing-instrument": "warning",
  "unsupported-execution-mode": "warning",
  "unsupported-currency": "warning",
  "unsupported-direction": "warning",
  "currency-mismatch": "warning",
  "invalid-amount": "warning",
  "invalid-position-number": "warning",
  "non-positive-fund-value": "warning",
  "short-deferred": "warning",
};

export interface Warning {
  code: WarningCode;
  severity: "warning";
  message: string;
  recordId?: string;
}

export type DashboardRowKind =
  | "portfolio"
  | "tempo"
  | "account"
  | "instrument"
  | "tier";
export type DashboardSectionId =
  | "portfolios"
  | "tempos"
  | "accounts"
  | "instruments"
  | "tiers";

export interface CompositionRow {
  id: string;
  kind: DashboardRowKind;
  label: string;
  usdValue: number;
  percentOfFund: number;
  costBasisUsd?: number;
  unrealizedPnlUsd?: number;
}

export interface DashboardFocus {
  rowId: string;
  kind: DashboardRowKind;
  label: string;
  usdValue: number;
  percentOfFund: number;
}

export interface DashboardSummary {
  fundName: string;
  asOf: string;
  fundValueUsd: number;
  usdMxn: number;
  totalUnrealizedPnlUsd: number;
  largestPortfolio?: DashboardFocus;
  largestTempo?: DashboardFocus;
  largestAccount?: DashboardFocus;
  largestInstrument?: DashboardFocus;
  reserve?: DashboardFocus;
  dataSafety: {
    nonLiveExcluded: number;
    invalidExcluded: number;
    shortDeferredExcluded: number;
    hasWarnings: boolean;
  };
}

export interface DashboardSection {
  id: DashboardSectionId;
  title: string;
  rows: CompositionRow[];
}

export interface DashboardModel {
  summary: DashboardSummary;
  sections: DashboardSection[];
}

export interface PriceJourneyPoint {
  asOf: string;
  price: number;
}

export interface PriceJourney {
  instrumentId: string;
  label: string;
  currency: Currency;
  points: PriceJourneyPoint[];
  firstPrice: number;
  latestPrice: number;
  changeAbs: number;
  changePct: number;
}

export interface CompositionReport {
  totals: {
    baseCurrency: "USD";
    fundValueUsd: number;
    usdMxn: number;
  };
  dashboard: DashboardModel;
  priceJourneys: PriceJourney[];
  warnings: Warning[];
  excluded: {
    nonLive: number;
    invalid: number;
    shortDeferred: number;
  };
  load: LoadOutcome;
}

export type DetailRecordKind = "reserve" | "position";

export interface DashboardDetailRow {
  kind: DetailRecordKind;
  recordLabel: string;
  portfolioLabel: string;
  tempoLabel: string;
  accountLabel: string;
  usdValue: number;
}

export interface DashboardDetail {
  rowId: string;
  kind: Exclude<DashboardRowKind, "instrument">;
  label: string;
  rows: DashboardDetailRow[];
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

interface TierContribution {
  tier: CapitalTier;
  usdValue: number;
  costBasisUsd: number;
  unrealizedPnlUsd: number;
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
}

export function parseFundReview(input: unknown): ParseResult {
  const parsed = parseReviewInput(input);
  if (parsed.kind !== "ok") {
    return parsed;
  }

  const value = parsed.value;
  if (!isRecord(value)) {
    return schemaError("$", "Review file must contain a JSON object.");
  }

  const requiredArrays = [
    "portfolios",
    "accounts",
    "instruments",
    "reserves",
    "positions",
  ] as const;
  for (const key of requiredArrays) {
    if (!Array.isArray(value[key])) {
      return schemaError(key, `Review file is missing array: ${key}`);
    }
  }

  if (!isRecord(value.fund)) {
    return schemaError("fund", "Review file must contain fund details.");
  }

  const fundIdError = requireNonEmptyString(value.fund.id, "fund.id");
  if (fundIdError) {
    return fundIdError;
  }

  const fundNameError = requireNonEmptyString(value.fund.name, "fund.name");
  if (fundNameError) {
    return fundNameError;
  }

  if (value.fund.baseCurrency !== "USD") {
    return {
      kind: "unsupported-base-currency",
      severity: "blocking",
      baseCurrency: value.fund.baseCurrency,
      message: "Prototype only supports a USD base Fund.",
    };
  }

  if (!isRecord(value.review)) {
    return schemaError("review", "Review file must contain review details.");
  }

  const asOfTypeError = requireNonEmptyString(value.review.asOf, "review.asOf");
  if (asOfTypeError) {
    return asOfTypeError;
  }

  if (!isIsoDate(value.review.asOf)) {
    return {
      kind: "invalid-as-of",
      severity: "blocking",
      path: "review.asOf",
      value: value.review.asOf,
      message: "review.asOf must be a valid YYYY-MM-DD date.",
    };
  }

  if (!isPositiveNumber(value.review.usdMxn)) {
    return {
      kind: "invalid-fx-rate",
      severity: "blocking",
      path: "review.usdMxn",
      value: value.review.usdMxn,
      message: "review.usdMxn must be a positive MXN-per-USD rate.",
    };
  }

  const portfolioError = validateNamedRecords(value.portfolios, "portfolios", "portfolio");
  if (portfolioError) {
    return portfolioError;
  }

  const accountError = validateAccounts(value.accounts);
  if (accountError) {
    return accountError;
  }

  const instrumentError = validateInstruments(value.instruments);
  if (instrumentError) {
    return instrumentError;
  }

  const reserveError = validateReserves(value.reserves);
  if (reserveError) {
    return reserveError;
  }

  const positionError = validatePositions(value.positions);
  if (positionError) {
    return positionError;
  }

  if (value.closes !== undefined) {
    const closesError = validateCloses(value.closes);
    if (closesError) {
      return closesError;
    }
  }

  const duplicateCapitalIdError = validateCapitalRecordIds(
    value.reserves,
    value.positions,
  );
  if (duplicateCapitalIdError) {
    return duplicateCapitalIdError;
  }

  return {
    kind: "ok",
    value: value as FundReviewData,
  };
}

export function buildCompositionReport(
  data: FundReviewData,
  options: BuildCompositionReportOptions = {},
): CompositionReport {
  const { canonicalLines, warnings, excluded } = buildCanonicalState(data);

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
  const priceJourneys = buildPriceJourneys(data);

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
    warnings,
    excluded,
    load: options.load ?? { status: "loaded" },
  };
}

function buildPriceJourneys(data: FundReviewData): PriceJourney[] {
  if (!Array.isArray(data.closes) || data.closes.length === 0) {
    return [];
  }

  const instruments = indexById(data.instruments, "instrument");
  const byInstrument = new Map<string, PriceJourneyPoint[]>();
  for (const close of data.closes) {
    // Prototype shortcut: silently skip Closes referencing unknown instruments
    // or carrying invalid scalars, rather than emitting a warning vocabulary.
    const instrument = instruments.get(close.instrumentId);
    if (!instrument) continue;
    if (!isIsoDate(close.asOf) || !isNonNegativeNumber(close.price)) continue;
    const points = byInstrument.get(close.instrumentId) ?? [];
    points.push({ asOf: close.asOf, price: close.price });
    byInstrument.set(close.instrumentId, points);
  }

  const journeys: PriceJourney[] = [];
  for (const [instrumentId, points] of byInstrument) {
    if (points.length < 2) continue; // a single anchor is not a journey
    const sorted = [...points].sort((a, b) => a.asOf.localeCompare(b.asOf));
    const firstPrice = sorted[0]!.price;
    const latestPrice = sorted[sorted.length - 1]!.price;
    const instrument = instruments.get(instrumentId)!;
    journeys.push({
      instrumentId,
      label: `${instrument.symbol} (${instrument.name})`,
      currency: instrument.currency,
      points: sorted,
      firstPrice,
      latestPrice,
      changeAbs: latestPrice - firstPrice,
      changePct:
        firstPrice === 0
          ? 0
          : roundNumber(((latestPrice - firstPrice) / firstPrice) * 100, 12),
    });
  }

  return journeys.sort(
    (a, b) => b.points.length - a.points.length || a.label.localeCompare(b.label),
  );
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
      kind: line.recordKind,
      recordLabel: line.recordLabel,
      portfolioLabel: line.portfolioLabel,
      tempoLabel: line.tempoLabel,
      accountLabel: line.accountLabel,
      usdValue: line.usdValue,
    })),
  };
}

export function formatCompositionReport(report: CompositionReport): string {
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
    formatPriceJourneys(report.priceJourneys),
  ];

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

function buildCanonicalState(data: FundReviewData): CanonicalState {
  const warnings: Warning[] = [];
  const portfolios = indexById(data.portfolios, "portfolio");
  const accounts = indexById(data.accounts, "account");
  const instruments = indexById(data.instruments, "instrument");
  const canonicalLines: CanonicalLine[] = [];
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
      usdValue: toUsd(reserve.amount, reserve.currency, data.review.usdMxn),
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

    const lots = normalizePositionLots(position);
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
  }

  return {
    canonicalLines,
    warnings,
    excluded,
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

function normalizePositionLots(position: PositionRecord): Lot[] {
  if (Array.isArray(position.lots) && position.lots.length > 0) {
    return position.lots;
  }
  if (
    typeof position.quantity === "number" &&
    typeof position.averageCost === "number"
  ) {
    return [{ quantity: position.quantity, cost: position.averageCost, tier: "c1" }];
  }
  return [];
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

function formatPrice(value: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(value);
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

function divider(): string {
  return "=".repeat(36);
}

function toUsd(amount: number, currency: Currency, usdMxn: number): number {
  return currency === "USD" ? amount : amount / usdMxn;
}

function percentOfFund(usdValue: number, fundValueUsd: number): number {
  if (fundValueUsd === 0) return 0;
  return roundNumber((usdValue / fundValueUsd) * 100, 12);
}

function roundNumber(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
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

function accountLabel(
  account: (NamedRecord & { platform: string }) | undefined,
  fallback: string,
): string {
  return account ? `${account.platform}: ${account.name}` : fallback;
}

function indexById<T extends NamedRecord>(
  records: T[],
  label: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (const record of records) {
    if (!record.id) {
      throw new Error(`Found ${label} without id.`);
    }
    if (result.has(record.id)) {
      throw new Error(`Duplicate ${label} id: ${record.id}`);
    }
    result.set(record.id, record);
  }
  return result;
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

function validateNamedRecords(
  value: unknown,
  path: string,
  recordType: DuplicateReferenceId["recordType"],
): ParseResult | undefined {
  if (!Array.isArray(value)) {
    return schemaError(path, `Review file is missing array: ${path}`);
  }

  const ids = new Set<string>();
  for (const [index, record] of value.entries()) {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(record)) {
      return schemaError(itemPath, `${itemPath} must be an object.`);
    }

    const idError = requireNonEmptyString(record.id, `${itemPath}.id`);
    if (idError) {
      return idError;
    }

    const nameError = requireNonEmptyString(record.name, `${itemPath}.name`);
    if (nameError) {
      return nameError;
    }

    const id = record.id as string;
    if (ids.has(id)) {
      return {
        kind: "duplicate-reference-id",
        severity: "blocking",
        recordType,
        id,
        message: `Duplicate ${recordType} id: ${id}`,
      };
    }

    ids.add(id);
  }

  return undefined;
}

function validateAccounts(value: unknown): ParseResult | undefined {
  const namedError = validateNamedRecords(value, "accounts", "account");
  if (namedError) {
    return namedError;
  }

  const accounts = value as Array<Record<string, unknown>>;
  for (const [index, account] of accounts.entries()) {
    const itemPath = `accounts[${index}]`;
    const platformError = requireNonEmptyString(account.platform, `${itemPath}.platform`);
    if (platformError) {
      return platformError;
    }

    const currencyError = requireNonEmptyString(account.currency, `${itemPath}.currency`);
    if (currencyError) {
      return currencyError;
    }
  }

  return undefined;
}

function validateInstruments(value: unknown): ParseResult | undefined {
  const namedError = validateNamedRecords(value, "instruments", "instrument");
  if (namedError) {
    return namedError;
  }

  const instruments = value as Array<Record<string, unknown>>;
  for (const [index, instrument] of instruments.entries()) {
    const itemPath = `instruments[${index}]`;
    const symbolError = requireNonEmptyString(instrument.symbol, `${itemPath}.symbol`);
    if (symbolError) {
      return symbolError;
    }

    const currencyError = requireNonEmptyString(instrument.currency, `${itemPath}.currency`);
    if (currencyError) {
      return currencyError;
    }
  }

  return undefined;
}

function validateReserves(value: unknown): ParseResult | undefined {
  if (!Array.isArray(value)) {
    return schemaError("reserves", "Review file is missing array: reserves");
  }

  const reserves = value as Array<Record<string, unknown>>;
  for (const [index, reserve] of reserves.entries()) {
    const itemPath = `reserves[${index}]`;
    const baseError = validateCapitalRecordShape(reserve, itemPath);
    if (baseError) {
      return baseError;
    }

    if (typeof reserve.amount !== "number") {
      return schemaError(`${itemPath}.amount`, `${itemPath}.amount must be a number.`);
    }
  }

  return undefined;
}

function validatePositions(value: unknown): ParseResult | undefined {
  if (!Array.isArray(value)) {
    return schemaError("positions", "Review file is missing array: positions");
  }

  const positions = value as Array<Record<string, unknown>>;
  for (const [index, position] of positions.entries()) {
    const itemPath = `positions[${index}]`;
    const baseError = validateCapitalRecordShape(position, itemPath);
    if (baseError) {
      return baseError;
    }

    const instrumentIdError = requireNonEmptyString(
      position.instrumentId,
      `${itemPath}.instrumentId`,
    );
    if (instrumentIdError) {
      return instrumentIdError;
    }

    const directionError = requireNonEmptyString(position.direction, `${itemPath}.direction`);
    if (directionError) {
      return directionError;
    }

    if (typeof position.markPrice !== "number") {
      return schemaError(
        `${itemPath}.markPrice`,
        `${itemPath}.markPrice must be a number.`,
      );
    }

    if (position.lots !== undefined) {
      const lotsError = validateLots(position.lots, itemPath);
      if (lotsError) {
        return lotsError;
      }
    } else {
      for (const field of ["quantity", "averageCost"] as const) {
        if (typeof position[field] !== "number") {
          return schemaError(
            `${itemPath}.${field}`,
            `${itemPath}.${field} must be a number.`,
          );
        }
      }
    }
  }

  return undefined;
}

function validateCloses(value: unknown): ParseResult | undefined {
  if (!Array.isArray(value)) {
    return schemaError("closes", "closes must be an array when present.");
  }

  for (const [index, close] of value.entries()) {
    const itemPath = `closes[${index}]`;
    if (!isRecord(close)) {
      return schemaError(itemPath, `${itemPath} must be an object.`);
    }

    const instrumentIdError = requireNonEmptyString(
      close.instrumentId,
      `${itemPath}.instrumentId`,
    );
    if (instrumentIdError) {
      return instrumentIdError;
    }

    const asOfError = requireNonEmptyString(close.asOf, `${itemPath}.asOf`);
    if (asOfError) {
      return asOfError;
    }

    if (typeof close.price !== "number") {
      return schemaError(`${itemPath}.price`, `${itemPath}.price must be a number.`);
    }
  }

  return undefined;
}

function validateLots(value: unknown, path: string): ParseResult | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return schemaError(`${path}.lots`, `${path}.lots must be a non-empty array.`);
  }

  for (const [index, lot] of value.entries()) {
    const lotPath = `${path}.lots[${index}]`;
    if (!isRecord(lot)) {
      return schemaError(lotPath, `${lotPath} must be an object.`);
    }

    for (const field of ["quantity", "cost"] as const) {
      if (typeof lot[field] !== "number") {
        return schemaError(
          `${lotPath}.${field}`,
          `${lotPath}.${field} must be a number.`,
        );
      }
    }

    if (lot.tier !== "c1" && lot.tier !== "c2" && lot.tier !== "c3") {
      return schemaError(
        `${lotPath}.tier`,
        `${lotPath}.tier must be one of c1, c2, c3.`,
      );
    }

    if (lot.entryFx !== undefined && typeof lot.entryFx !== "number") {
      return schemaError(
        `${lotPath}.entryFx`,
        `${lotPath}.entryFx must be a number when present.`,
      );
    }
  }

  return undefined;
}

function validateCapitalRecordShape(
  value: unknown,
  path: string,
): ParseResult | undefined {
  if (!isRecord(value)) {
    return schemaError(path, `${path} must be an object.`);
  }

  for (const field of [
    "id",
    "portfolioId",
    "tempo",
    "executionMode",
    "accountId",
    "currency",
  ] as const) {
    const error = requireNonEmptyString(value[field], `${path}.${field}`);
    if (error) {
      return error;
    }
  }

  return undefined;
}

function validateCapitalRecordIds(
  reserves: unknown[],
  positions: unknown[],
): DuplicateCapitalRecordId | undefined {
  const ids = new Set<string>();

  for (const record of [...reserves, ...positions]) {
    if (!isRecord(record) || typeof record.id !== "string") {
      continue;
    }

    if (ids.has(record.id)) {
      return {
        kind: "duplicate-capital-record-id",
        severity: "blocking",
        id: record.id,
        message: `Duplicate capital record id: ${record.id}`,
      };
    }

    ids.add(record.id);
  }

  return undefined;
}

function requireNonEmptyString(value: unknown, path: string): SchemaError | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return schemaError(path, `${path} must be a non-empty string.`);
  }

  return undefined;
}

function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function pushWarning(
  warnings: Warning[],
  code: WarningCode,
  message: string,
  recordId?: string,
): void {
  warnings.push(
    recordId
      ? { code, severity: "warning", message, recordId }
      : { code, severity: "warning", message },
  );
}

function schemaError(path: string, message: string): SchemaError {
  return {
    kind: "schema-error",
    severity: "blocking",
    path,
    message,
  };
}

function parseReviewInput(input: unknown): Ok | InvalidJson {
  if (typeof input !== "string") {
    return {
      kind: "ok",
      value: input as FundReviewData,
    };
  }

  try {
    return {
      kind: "ok",
      value: JSON.parse(input) as FundReviewData,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      kind: "invalid-json",
      severity: "blocking",
      message: "Review file contains invalid JSON.",
      detail,
    };
  }
}

function isSupportedCurrency(currency: unknown): currency is Currency {
  return currency === "USD" || currency === "MXN";
}

function isExecutionMode(value: unknown): value is ExecutionMode {
  return (
    value === "live" ||
    value === "paper" ||
    value === "back-test" ||
    value === "forward-test"
  );
}

function isDirection(value: unknown): value is Direction {
  return value === "long" || value === "short";
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
