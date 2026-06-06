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

export interface CompositionRow {
  label: string;
  usdValue: number;
  percentOfFund: number;
  costBasisUsd?: number;
  unrealizedPnlUsd?: number;
}

export interface CompositionReport {
  fundName: string;
  asOf: string;
  usdMxn: number;
  totalUsd: number;
  warnings: string[];
  excludedNonLiveRecords: number;
  excludedInvalidRecords: number;
  groups: {
    portfolios: CompositionRow[];
    tempos: CompositionRow[];
    accounts: CompositionRow[];
    instruments: CompositionRow[];
  };
}

interface CanonicalLine {
  portfolio: string;
  tempo: string;
  account: string;
  instrument: string;
  usdValue: number;
  costBasisUsd?: number;
  unrealizedPnlUsd?: number;
}

export function parseFundReview(value: unknown): FundReviewData {
  if (!isRecord(value)) {
    throw new Error("Review file must contain a JSON object.");
  }

  const data = value as unknown as FundReviewData;
  const requiredArrays = [
    "portfolios",
    "accounts",
    "instruments",
    "reserves",
    "positions",
  ] as const;
  for (const key of requiredArrays) {
    if (!Array.isArray(data[key])) {
      throw new Error(`Review file is missing array: ${key}`);
    }
  }

  if (!isRecord(data.fund) || data.fund.baseCurrency !== "USD") {
    throw new Error("Prototype only supports a USD base Fund.");
  }

  if (!isRecord(data.review) || !isPositiveNumber(data.review.usdMxn)) {
    throw new Error("review.usdMxn must be a positive MXN-per-USD rate.");
  }

  return data;
}

export function buildCompositionReport(
  data: FundReviewData,
): CompositionReport {
  const warnings: string[] = [];
  const portfolios = indexById(data.portfolios, "portfolio");
  const accounts = indexById(data.accounts, "account");
  const instruments = indexById(data.instruments, "instrument");
  const canonicalLines: CanonicalLine[] = [];
  let excludedNonLiveRecords = 0;
  let excludedInvalidRecords = 0;

  for (const reserve of data.reserves) {
    validateCapitalBase(reserve, portfolios, accounts, warnings);

    if (!isExecutionMode(reserve.executionMode)) {
      warnings.push(
        `Reserve ${reserve.id} uses unsupported Execution Mode ${String(reserve.executionMode)} and was excluded.`,
      );
      excludedInvalidRecords += 1;
      continue;
    }

    if (!isSupportedCurrency(reserve.currency)) {
      warnings.push(
        `Reserve ${reserve.id} uses unsupported Currency ${String(reserve.currency)} and was excluded.`,
      );
      excludedInvalidRecords += 1;
      continue;
    }

    if (!isNonNegativeNumber(reserve.amount)) {
      warnings.push(
        `Reserve ${reserve.id} has invalid amount and was excluded.`,
      );
      excludedInvalidRecords += 1;
      continue;
    }

    if (reserve.executionMode !== "live") {
      excludedNonLiveRecords += 1;
      continue;
    }

    canonicalLines.push({
      portfolio:
        portfolios.get(reserve.portfolioId)?.name ?? reserve.portfolioId,
      tempo: reserve.tempo,
      account: accountLabel(accounts.get(reserve.accountId), reserve.accountId),
      instrument: "Reserve",
      usdValue: toUsd(reserve.amount, reserve.currency, data.review.usdMxn),
    });
  }

  for (const position of data.positions) {
    validateCapitalBase(position, portfolios, accounts, warnings);

    if (!isExecutionMode(position.executionMode)) {
      warnings.push(
        `Position ${position.id} uses unsupported Execution Mode ${String(position.executionMode)} and was excluded.`,
      );
      excludedInvalidRecords += 1;
      continue;
    }

    if (!isSupportedCurrency(position.currency)) {
      warnings.push(
        `Position ${position.id} uses unsupported Currency ${String(position.currency)} and was excluded.`,
      );
      excludedInvalidRecords += 1;
      continue;
    }

    if (!isDirection(position.direction)) {
      warnings.push(
        `Position ${position.id} uses unsupported Direction ${String(position.direction)} and was excluded.`,
      );
      excludedInvalidRecords += 1;
      continue;
    }

    const invalidNumericFields = [
      ["quantity", position.quantity],
      ["averageCost", position.averageCost],
      ["markPrice", position.markPrice],
    ].filter(([, value]) => !isNonNegativeNumber(value));
    if (invalidNumericFields.length > 0) {
      warnings.push(
        `Position ${position.id} has invalid ${invalidNumericFields.map(([field]) => field).join(", ")} and was excluded.`,
      );
      excludedInvalidRecords += 1;
      continue;
    }

    const instrument = instruments.get(position.instrumentId);
    if (!instrument) {
      warnings.push(
        `Position ${position.id} references missing Instrument ${position.instrumentId}.`,
      );
    }

    if (position.executionMode !== "live") {
      excludedNonLiveRecords += 1;
      continue;
    }

    const directionSign = position.direction === "short" ? -1 : 1;
    const marketValue = directionSign * position.quantity * position.markPrice;
    const costBasis = position.quantity * position.averageCost;
    const unrealizedPnl =
      position.direction === "short"
        ? (position.averageCost - position.markPrice) * position.quantity
        : (position.markPrice - position.averageCost) * position.quantity;

    canonicalLines.push({
      portfolio:
        portfolios.get(position.portfolioId)?.name ?? position.portfolioId,
      tempo: position.tempo,
      account: accountLabel(
        accounts.get(position.accountId),
        position.accountId,
      ),
      instrument: instrument
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

  const totalUsd = canonicalLines.reduce((sum, line) => sum + line.usdValue, 0);
  if (totalUsd <= 0) {
    warnings.push(
      "Canonical live Fund value is not positive; percent-of-Fund values may be misleading.",
    );
  }

  return {
    fundName: data.fund.name,
    asOf: data.review.asOf,
    usdMxn: data.review.usdMxn,
    totalUsd,
    warnings,
    excludedNonLiveRecords,
    excludedInvalidRecords,
    groups: {
      portfolios: groupLines(canonicalLines, "portfolio", totalUsd),
      tempos: groupLines(canonicalLines, "tempo", totalUsd),
      accounts: groupLines(canonicalLines, "account", totalUsd),
      instruments: groupLines(canonicalLines, "instrument", totalUsd),
    },
  };
}

export function formatCompositionReport(report: CompositionReport): string {
  const sections = [
    `Numisma Fund Composition Prototype`,
    divider(),
    `Fund: ${report.fundName}`,
    `As of: ${report.asOf}`,
    "",
    formatWeeklyReviewFocus(report),
    "",
    "Canonical Summary",
    `Fund value: ${formatUsd(report.totalUsd)}`,
    `Manual FX: 1 USD = ${report.usdMxn.toFixed(4)} MXN`,
    `Mode filter: live only; ${report.excludedNonLiveRecords} non-live record(s) excluded`,
    `Record safety: ${report.excludedInvalidRecords} invalid record(s) excluded`,
    "",
    formatRows("Portfolio Composition", report.groups.portfolios),
    "",
    formatRows("Tempo Composition", report.groups.tempos),
    "",
    formatRows("Account Composition", report.groups.accounts),
    "",
    formatRows("Instrument Composition", report.groups.instruments, true),
  ];

  if (report.warnings.length > 0) {
    sections.push(
      "",
      "!!! WARNINGS !!!",
      ...report.warnings.map((warning) => `- ${warning}`),
    );
  }

  sections.push("", "Keys: q quit | r reload data");
  return sections.join("\n");
}

function formatWeeklyReviewFocus(report: CompositionReport): string {
  const portfolio = report.groups.portfolios[0];
  const tempo = report.groups.tempos[0];
  const account = report.groups.accounts[0];
  const instrument = report.groups.instruments[0];
  const reserve = report.groups.tempos.find(
    (row) => row.label === "Reserve",
  );

  return [
    "Weekly Review Focus",
    "-------------------",
    `Fund now: ${formatUsd(report.totalUsd)} in live canonical records`,
    `Largest Portfolio: ${formatRowFocus(portfolio)}`,
    `Largest Tempo: ${formatRowFocus(tempo)}`,
    `Largest Account: ${formatRowFocus(account)}`,
    `Largest Instrument: ${formatRowFocus(instrument)}`,
    `Reserve: ${formatRowFocus(reserve)}`,
    `Data safety: ${formatDataSafety(report)}`,
  ].join("\n");
}

function formatRowFocus(row: CompositionRow | undefined): string {
  if (!row) return "No live records";
  return `${row.label} ${formatUsd(row.usdValue)} (${formatPercent(row.percentOfFund)})`;
}

function formatDataSafety(report: CompositionReport): string {
  const exclusions = [
    `${report.excludedNonLiveRecords} non-live excluded`,
    `${report.excludedInvalidRecords} invalid excluded`,
  ];
  return report.warnings.length > 0
    ? `${exclusions.join("; ")}; warnings shown below`
    : `${exclusions.join("; ")}; no warnings`;
}

function groupLines(
  lines: CanonicalLine[],
  key: keyof CanonicalLine,
  totalUsd: number,
): CompositionRow[] {
  const rows = new Map<string, Omit<CompositionRow, "percentOfFund">>();

  for (const line of lines) {
    const label = String(line[key]);
    const existing = rows.get(label) ?? {
      label,
      usdValue: 0,
      costBasisUsd: 0,
      unrealizedPnlUsd: 0,
    };
    existing.usdValue += line.usdValue;
    existing.costBasisUsd =
      (existing.costBasisUsd ?? 0) + (line.costBasisUsd ?? 0);
    existing.unrealizedPnlUsd =
      (existing.unrealizedPnlUsd ?? 0) + (line.unrealizedPnlUsd ?? 0);
    rows.set(label, existing);
  }

  return [...rows.values()]
    .map((row) => {
      const result: CompositionRow = {
        label: row.label,
        usdValue: row.usdValue,
        percentOfFund: totalUsd === 0 ? 0 : (row.usdValue / totalUsd) * 100,
      };

      if (row.costBasisUsd !== undefined && row.costBasisUsd !== 0) {
        result.costBasisUsd = row.costBasisUsd;
      }
      if (row.unrealizedPnlUsd !== undefined && row.unrealizedPnlUsd !== 0) {
        result.unrealizedPnlUsd = row.unrealizedPnlUsd;
      }

      return result;
    })
    .sort((a, b) => Math.abs(b.usdValue) - Math.abs(a.usdValue));
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

  return [title, "-".repeat(title.length), header, "-".repeat(header.length), ...(body.length > 0 ? body : ["No live records."])].join("\n");
}

function divider(): string {
  return "=".repeat(36);
}

function toUsd(amount: number, currency: Currency, usdMxn: number): number {
  return currency === "USD" ? amount : amount / usdMxn;
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
  warnings: string[],
): void {
  if (!portfolios.has(record.portfolioId)) {
    warnings.push(
      `${record.id} references missing Portfolio ${record.portfolioId}.`,
    );
  }
  if (!accounts.has(record.accountId)) {
    warnings.push(
      `${record.id} references missing Account ${record.accountId}.`,
    );
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
