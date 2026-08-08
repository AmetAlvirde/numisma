// Parse concern: `parseFundReview` and every `validate*` / `require*` / guard
// that turns untrusted input into a typed `FundReviewData` or a blocking
// `ParseResult`. Cross-concern helpers are imported from the internal kernel,
// never re-copied.
import type {
  DuplicateCapitalRecordId,
  DuplicateReferenceId,
  FundReviewData,
  InvalidJson,
  Ok,
  ParseResult,
} from "./contracts.js";
import {
  invalidLotFields,
  isIsoDate,
  isPositiveNumber,
  isRecord,
  requireNonEmptyString,
  schemaError,
} from "./internal.js";

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

    if (reserve.lots !== undefined) {
      const lotsError = validateLots(reserve.lots, itemPath, { requireCost: false });
      if (lotsError) {
        return lotsError;
      }
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

    // `lots` is the only cost-carrier; a Position must carry at least one Lot.
    const lotsError = validateLots(position.lots, itemPath);
    if (lotsError) {
      return lotsError;
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

function validateLots(
  value: unknown,
  path: string,
  options: { requireCost?: boolean } = {},
): ParseResult | undefined {
  // Position Lots carry a cost; cash (Reserve) Lots are degenerate — value ==
  // face — so they omit `cost`/`entryFx` and only carry `quantity` + `tier`.
  // WHAT makes each kind valid is `invalidLotFields`'s call, shared with the
  // event door and the compose gate (audit finding 5); this door only supplies
  // the path vocabulary and stops at the first issue, as every other
  // `validate*` here does.
  const requireCost = options.requireCost ?? true;
  if (!Array.isArray(value) || value.length === 0) {
    return schemaError(`${path}.lots`, `${path}.lots must be a non-empty array.`);
  }

  for (const [index, lot] of value.entries()) {
    const lotPath = `${path}.lots[${index}]`;
    if (!isRecord(lot)) {
      return schemaError(lotPath, `${lotPath} must be an object.`);
    }

    const [issue] = invalidLotFields(lot, { requireCost });
    if (issue) {
      return schemaError(
        `${lotPath}.${issue.field}`,
        `${lotPath}.${issue.field} ${issue.detail}.`,
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
