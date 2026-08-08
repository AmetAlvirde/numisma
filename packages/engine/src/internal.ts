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

/**
 * True for any non-null object — INCLUDING arrays, DELIBERATELY.
 *
 * Every caller (`parse.ts`, `events/parse.ts`) follows the guard with a read of a NAMED
 * DOMAIN FIELD — `fund`, `id`, `asOf` — and an array answers all of those `undefined`.
 * The checks on those fields then refuse it and SAY WHICH FIELD, which tells the operator
 * more than a blanket "not an object" would, so tightening this predicate would buy
 * nothing here and cost attribution.
 *
 * Where that is NOT true — where the very first field check would misattribute an array
 * to a field problem — use {@link isRecordObject}, which additionally rejects arrays.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * {@link isRecord} plus `!Array.isArray` — the STRICT sibling. The two are separate on
 * purpose; neither is a stale copy of the other.
 *
 * `parseOrderRecord` (`./orders/records.ts`) is the caller that needs the strictness. Its
 * first field check is `id`, so under the loose predicate an array line would fall through
 * and be refused as `id must be a non-empty string` — a message that sends the reader
 * looking for a missing id in a line that never had a place to put one. The strict
 * predicate refuses it up front as `record must be a JSON object`, which is what actually
 * went wrong.
 */
export function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One invalid Lot field, named, with the phrase that says what it should have been. */
export interface LotFieldIssue {
  /** The offending field, for the caller to append to its own path. */
  readonly field: "quantity" | "cost" | "tier" | "entryFx";
  /** Predicate-side phrase, e.g. `must be positive`. Callers add subject and period. */
  readonly detail: string;
}

/**
 * THE definition of a valid Lot — the single answer all three Lot-reading sites give.
 *
 * Audit 2026-08-07 finding 5: this rule used to be hand-rolled three times with three
 * different strictnesses — `typeof === "number"` at the genesis door (`parse.ts`),
 * `isPositiveNumber` at the event door (`events/parse.ts`), `isNonNegativeNumber` at the
 * compose gate (`compose/canonical.ts`). `{ quantity: 10, cost: 0 }` was therefore
 * REJECTED as a `PositionOpened` and ADMITTED UNWARNED as a genesis seed, whose entire
 * market value then read as unrealized gain with nothing on screen saying so. The strict
 * reading won: a Position Lot with no quantity, no cost, or a zero/negative entry FX is
 * not a degenerate lot to be tolerated, it is a lot nobody can price.
 *
 * The two Lot kinds are NOT one rule with a nullable field — they are two rules that
 * belong in one place:
 *
 * - **Position Lot** (`requireCost: true`, the default): `quantity` and `cost` are
 *   strictly positive finite numbers, `tier` is a Capital Tier, and `entryFx` — optional
 *   — is a strictly positive finite number when present.
 * - **Cash (Reserve) Lot** (`requireCost: false`): a SIGNED tier decomposition of the
 *   reserve's `amount`, so only `quantity`-is-a-number and `tier` are structural. A
 *   negative leg is legitimate arithmetic, and whether the legs sum to `amount` is
 *   `buildReserveTierContributions`'s judgment, not the parser's.
 *
 * Returns the issues in field order (`quantity`, `cost`, `tier`, `entryFx`) so a door
 * that reports only the first failure and a gate that reports all of them agree on which
 * failure comes first. Empty array means valid. The caller narrows to a record first —
 * "this is not even an object" is a different message in every caller's vocabulary.
 */
export function invalidLotFields(
  lot: Record<string, unknown>,
  options: { requireCost?: boolean } = {},
): LotFieldIssue[] {
  const issues: LotFieldIssue[] = [];
  const requireCost = options.requireCost ?? true;

  if (requireCost) {
    if (!isPositiveNumber(lot.quantity)) {
      issues.push({ field: "quantity", detail: "must be positive" });
    }
    if (!isPositiveNumber(lot.cost)) {
      issues.push({ field: "cost", detail: "must be positive" });
    }
  } else if (typeof lot.quantity !== "number") {
    issues.push({ field: "quantity", detail: "must be a number" });
  }

  if (lot.tier !== "c1" && lot.tier !== "c2" && lot.tier !== "c3") {
    issues.push({ field: "tier", detail: "must be c1, c2, or c3" });
  }

  if (requireCost && lot.entryFx !== undefined && !isPositiveNumber(lot.entryFx)) {
    issues.push({ field: "entryFx", detail: "must be positive" });
  }

  return issues;
}
