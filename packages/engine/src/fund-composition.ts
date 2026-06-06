export type Currency = "USD" | "MXN";
export type ExecutionMode = "live" | "paper" | "back-test" | "forward-test";
export type Direction = "long" | "short";

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
  quantity: number;
  averageCost: number;
  markPrice: number;
}

export interface Ok {
  kind: "ok";
  value: FundReviewData;
}

export interface InvalidJson {
  kind: "invalid-json";
  message: string;
  detail: string;
}

export interface SchemaError {
  kind: "schema-error";
  path: string;
  message: string;
}

export interface UnsupportedBaseCurrency {
  kind: "unsupported-base-currency";
  baseCurrency: unknown;
  message: string;
}

export interface InvalidFxRate {
  kind: "invalid-fx-rate";
  path: "review.usdMxn";
  value: unknown;
  message: string;
}

export type ParseResult =
  | Ok
  | InvalidJson
  | SchemaError
  | UnsupportedBaseCurrency
  | InvalidFxRate;

export interface LoadOutcome {
  status: "loaded";
  sourcePath?: string;
  loadedAt?: string;
}

export type WarningCode =
  | "missing-portfolio"
  | "missing-account"
  | "missing-instrument"
  | "unsupported-execution-mode"
  | "unsupported-currency"
  | "unsupported-direction"
  | "invalid-amount"
  | "invalid-position-number"
  | "non-positive-fund-value";

export interface Warning {
  code: WarningCode;
  message: string;
  recordId?: string;
}

export type DashboardRowKind = "portfolio" | "tempo" | "account" | "instrument";
export type DashboardSectionId =
  | "portfolios"
  | "tempos"
  | "accounts"
  | "instruments";

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

export interface CompositionReport {
  totals: {
    baseCurrency: "USD";
    fundValueUsd: number;
    usdMxn: number;
  };
  dashboard: DashboardModel;
  warnings: Warning[];
  excluded: {
    nonLive: number;
    invalid: number;
    shortDeferred: number;
  };
  load: LoadOutcome;
}

interface CanonicalLine {
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

  if (value.fund.baseCurrency !== "USD") {
    return {
      kind: "unsupported-base-currency",
      baseCurrency: value.fund.baseCurrency,
      message: "Prototype only supports a USD base Fund.",
    };
  }

  if (!isRecord(value.review)) {
    return schemaError("review", "Review file must contain review details.");
  }

  if (!isPositiveNumber(value.review.usdMxn)) {
    return {
      kind: "invalid-fx-rate",
      path: "review.usdMxn",
      value: value.review.usdMxn,
      message: "review.usdMxn must be a positive MXN-per-USD rate.",
    };
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
    validateCapitalBase(reserve, portfolios, accounts, warnings);

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

    if (reserve.executionMode !== "live") {
      excluded.nonLive += 1;
      continue;
    }

    canonicalLines.push({
      portfolioId: reserve.portfolioId,
      portfolioLabel: portfolios.get(reserve.portfolioId)?.name ?? reserve.portfolioId,
      tempoId: reserve.tempo,
      tempoLabel: reserve.tempo,
      accountId: reserve.accountId,
      accountLabel: accountLabel(accounts.get(reserve.accountId), reserve.accountId),
      instrumentId: "reserve",
      instrumentLabel: "Reserve",
      usdValue: toUsd(reserve.amount, reserve.currency, data.review.usdMxn),
    });
  }

  for (const position of data.positions) {
    validateCapitalBase(position, portfolios, accounts, warnings);

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

    if (position.executionMode !== "live") {
      excluded.nonLive += 1;
      continue;
    }

    if (position.direction === "short") {
      excluded.shortDeferred += 1;
      continue;
    }

    const invalidNumericFields = [
      ["quantity", position.quantity],
      ["averageCost", position.averageCost],
      ["markPrice", position.markPrice],
    ].filter(([, value]) => !isNonNegativeNumber(value));
    if (invalidNumericFields.length > 0) {
      pushWarning(
        warnings,
        "invalid-position-number",
        `Position ${position.id} has invalid ${invalidNumericFields.map(([field]) => field).join(", ")} and was excluded.`,
        position.id,
      );
      excluded.invalid += 1;
      continue;
    }

    const instrument = instruments.get(position.instrumentId);
    if (!instrument) {
      pushWarning(
        warnings,
        "missing-instrument",
        `Position ${position.id} references missing Instrument ${position.instrumentId}.`,
        position.id,
      );
    }

    const marketValue = position.quantity * position.markPrice;
    const costBasis = position.quantity * position.averageCost;
    const unrealizedPnl = (position.markPrice - position.averageCost) * position.quantity;

    canonicalLines.push({
      portfolioId: position.portfolioId,
      portfolioLabel: portfolios.get(position.portfolioId)?.name ?? position.portfolioId,
      tempoId: position.tempo,
      tempoLabel: position.tempo,
      accountId: position.accountId,
      accountLabel: accountLabel(accounts.get(position.accountId), position.accountId),
      instrumentId: position.instrumentId,
      instrumentLabel: instrument
        ? `${instrument.symbol} (${instrument.name})`
        : position.instrumentId,
      usdValue: toUsd(marketValue, position.currency, data.review.usdMxn),
      costBasisUsd: toUsd(costBasis, position.currency, data.review.usdMxn),
      unrealizedPnlUsd: toUsd(
        unrealizedPnl,
        position.currency,
        data.review.usdMxn,
      ),
    });
  }

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
      ],
    },
    warnings,
    excluded,
    load: options.load ?? { status: "loaded" },
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
): void {
  if (!portfolios.has(record.portfolioId)) {
    pushWarning(
      warnings,
      "missing-portfolio",
      `${record.id} references missing Portfolio ${record.portfolioId}.`,
      record.id,
    );
  }
  if (!accounts.has(record.accountId)) {
    pushWarning(
      warnings,
      "missing-account",
      `${record.id} references missing Account ${record.accountId}.`,
      record.id,
    );
  }
}

function pushWarning(
  warnings: Warning[],
  code: WarningCode,
  message: string,
  recordId?: string,
): void {
  warnings.push(recordId ? { code, message, recordId } : { code, message });
}

function schemaError(path: string, message: string): SchemaError {
  return {
    kind: "schema-error",
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
