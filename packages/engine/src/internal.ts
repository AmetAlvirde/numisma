// Internal kernel: the cross-concern helpers used by parse, compose, AND
// price-journey. They live here exactly once so the engine decomposition does
// not recreate the duplication one level down. These are package-internal —
// exported for sibling modules to import, but intentionally NOT re-exported from
// index.ts, so they stay off the public surface.
import type {
  Currency,
  ExecutionMode,
  Direction,
  NamedRecord,
  SchemaError,
  WarningCode,
  Warning,
} from "./contracts.js";

export function toUsd(amount: number, currency: Currency, usdMxn: number): number {
  return currency === "USD" ? amount : amount / usdMxn;
}

export function percentOfFund(usdValue: number, fundValueUsd: number): number {
  if (fundValueUsd === 0) return 0;
  return roundNumber((usdValue / fundValueUsd) * 100, 12);
}

export function roundNumber(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export function indexById<T extends NamedRecord>(
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

export function requireNonEmptyString(value: unknown, path: string): SchemaError | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return schemaError(path, `${path} must be a non-empty string.`);
  }

  return undefined;
}

export function isIsoDate(value: string): boolean {
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

export function pushWarning(
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

export function schemaError(path: string, message: string): SchemaError {
  return {
    kind: "schema-error",
    severity: "blocking",
    path,
    message,
  };
}

export function isSupportedCurrency(currency: unknown): currency is Currency {
  return currency === "USD" || currency === "MXN";
}

export function isExecutionMode(value: unknown): value is ExecutionMode {
  return (
    value === "live" ||
    value === "paper" ||
    value === "back-test" ||
    value === "forward-test"
  );
}

export function isDirection(value: unknown): value is Direction {
  return value === "long" || value === "short";
}

export function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
