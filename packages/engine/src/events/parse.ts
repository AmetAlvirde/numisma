/**
 * PROTOTYPE (mvi 2026-06-29-portfolio-persistence). Event-sourcing spine — parse.
 *
 * The FIRST ingest gate: validate one untrusted event record's structure in
 * isolation into a typed {@link PortfolioEvent} or an {@link EventError}. Pure — no
 * IO, no cross-event state (that is `./crossref.ts`, the second gate). Also the home
 * of the durable-log schema-version guard and the one-shot legacy-record migration.
 * Per ADR-001 this is pure validation LOGIC; loading ids off disk lives in the TUI.
 * See ADR-003 (and its cash-leg amendment) for the versioning/migration contract.
 */
import type { CapitalTier, PositionLot } from "../contracts.js";
import {
  isDirection,
  isExecutionMode,
  isIsoDate,
  isPositiveNumber,
  isRecord,
  isSupportedCurrency,
  requireNonEmptyString,
} from "../internal.js";
import type {
  CloseSettlement,
  EventError,
  EventParseResult,
  OpenFunding,
  PositionDecision,
  PositionOpenedEvent,
  PriceMarkedEvent,
} from "./types.js";
import { eventError } from "./types.js";

const REQUIRED_DECISION_FIELDS: Array<keyof PositionDecision> = [
  "entryThesis",
  "invalidationCondition",
  "riskBudget",
  "plannedHoldingHorizon",
  "strategy",
];

/**
 * The durable-log record schema version this build writes and understands.
 *
 *   - v1 — the pre-cash-leg 3-verb shape: `PositionOpened`/`PositionClosed` with NO
 *     cash leg, plus `PriceMarked`.
 *   - v2 — this increment: the mandatory `funding`/`settlement` cash leg riding
 *     atomically on the trade leg, plus the `Deposit`/`Withdraw`/`Transfer` verbs.
 *
 * New and migrated records are stamped with this on write (a storage-layer marker;
 * it is NOT carried into the domain event). Parse is version-AWARE: a record tagged
 * NEWER than this build refuses to load — a forward-compatibility guard so a future
 * shape is never silently misread by an old binary — and a legacy (v1) open/close
 * missing its cash leg fails loud with a pointer to the one-shot migration rather
 * than being silently dropped from the fold. See the ADR-003 amendment (durable-log
 * migration/versioning contract).
 */
export const EVENT_SCHEMA_VERSION = 2;

/**
 * Forward-compatibility guard on the optional `schemaVersion` marker. An absent
 * marker is fine (legacy records and freshly authored inbox events carry none — the
 * per-verb shape gates decide their fate); a marker newer than this build
 * understands fails loud rather than risking a misread of a shape written by a newer
 * Numisma. Returns null when the marker is acceptable or absent.
 */
function checkSchemaVersion(value: unknown): EventError | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return eventError("schemaVersion", "schemaVersion, when present, must be a positive integer.");
  }
  if (value > EVENT_SCHEMA_VERSION) {
    return eventError(
      "schemaVersion",
      `record schemaVersion ${value} is newer than this build supports (${EVENT_SCHEMA_VERSION}); ` +
        `upgrade Numisma to read it rather than risk misreading a newer record shape.`,
    );
  }
  return null;
}

/**
 * The loud remedy appended to a legacy open/close parse failure. The cash leg is not
 * in the old record and cannot be reconstructed by code (the settling Reserve and
 * the proceeds/funding split are the operator's real-world facts), so the honest
 * behavior is to fail loud and point at the one-shot migration — never to default a
 * fabricated cash movement, which would reintroduce the exact NAV drift this MVI
 * eliminates. See the ADR-003 amendment.
 */
const LEGACY_CASH_LEG_REMEDY =
  " If this is a legacy (pre-cash-leg / schemaVersion 1) record, migrate it with the " +
  "one-shot log migration (`migrateLegacyEvent`, supplying the real cash leg) — the cash " +
  "leg cannot be reconstructed automatically; see the ADR-003 amendment.";

/**
 * Validate one untrusted event record into a typed {@link PortfolioEvent} or an
 * {@link EventError}. Pure: no IO, no cross-event state. The fold trusts only
 * what this gate returns.
 */
export function parseEvent(input: unknown): EventParseResult {
  if (!isRecord(input)) {
    return eventError("$", "Event must be a JSON object.");
  }

  const versionError = checkSchemaVersion(input.schemaVersion);
  if (versionError) {
    return versionError;
  }

  const idError = requireNonEmptyString(input.id, "id");
  if (idError) {
    return eventError("id", idError.message);
  }
  if (typeof input.asOf !== "string" || !isIsoDate(input.asOf)) {
    return eventError("asOf", "Event asOf must be an ISO date (YYYY-MM-DD).");
  }
  const id = input.id as string;
  const asOf = input.asOf;

  switch (input.type) {
    case "PositionOpened":
      return parsePositionOpened(input, id, asOf);
    case "PositionClosed":
      return parsePositionClosed(input, id, asOf);
    case "PriceMarked":
      return parsePriceMarked(input, id, asOf);
    case "Deposit":
      return parseReserveMove(input, id, asOf, "Deposit");
    case "Withdraw":
      return parseReserveMove(input, id, asOf, "Withdraw");
    case "Transfer":
      return parseTransfer(input, id, asOf);
    case "InvalidationMarked":
      return parseInvalidationMarked(input, id, asOf);
    default:
      return eventError("type", `Unsupported event type: ${String(input.type)}`);
  }
}

/**
 * The cash leg an operator supplies to migrate one legacy (v1) open/close record to
 * the v2 cash-leg shape: a funding leg for an open, a settlement leg for a close.
 */
export type SuppliedCashLeg = { funding: OpenFunding } | { settlement: CloseSettlement };

/**
 * One-shot migration of a single legacy (pre-cash-leg / v1) open or close record to
 * the v2 shape by grafting an operator-supplied cash leg onto it, then re-validating
 * through {@link parseEvent}. Pure and honest: it does NOT invent the cash leg (the
 * settling Reserve and the proceeds/funding split are real-world facts only the
 * operator holds); it grafts what is supplied and lets the same v2 gate that guards
 * every event decide the result. A record that is not a legacy open/close, or whose
 * supplied leg does not match its verb, is rejected loud. This is the codified
 * one-shot reconstruction ADR-003's amendment sanctions — NOT a runtime append path.
 */
export function migrateLegacyEvent(record: unknown, cashLeg: SuppliedCashLeg): EventParseResult {
  if (!isRecord(record)) {
    return eventError("$", "Legacy record must be a JSON object.");
  }
  if (record.type === "PositionOpened" && "funding" in cashLeg) {
    return parseEvent({ ...record, funding: cashLeg.funding });
  }
  if (record.type === "PositionClosed" && "settlement" in cashLeg) {
    return parseEvent({ ...record, settlement: cashLeg.settlement });
  }
  return eventError(
    "type",
    "migrateLegacyEvent expects a legacy PositionOpened paired with a funding leg, " +
      "or a legacy PositionClosed paired with a settlement leg.",
  );
}

/** Narrow an untrusted value to a {@link CapitalTier} at the given path. */
function parseTier(value: unknown, path: string): { tier: CapitalTier } | EventError {
  if (value !== "c1" && value !== "c2" && value !== "c3") {
    return eventError(path, "tier must be c1, c2, or c3.");
  }
  return { tier: value };
}

/** Deposit and Withdraw share the same `{ reserveId, amount, tier }` cash shape. */
function parseReserveMove(
  input: Record<string, unknown>,
  id: string,
  asOf: string,
  type: "Deposit" | "Withdraw",
): EventParseResult {
  const reserveError = requireNonEmptyString(input.reserveId, "reserveId");
  if (reserveError) {
    return eventError("reserveId", reserveError.message);
  }
  if (!isPositiveNumber(input.amount)) {
    return eventError("amount", `${type} amount must be a positive number.`);
  }
  const tier = parseTier(input.tier, "tier");
  if ("kind" in tier) {
    return tier;
  }
  return {
    kind: "ok",
    value: { id, asOf, type, reserveId: input.reserveId as string, amount: input.amount, tier: tier.tier },
  };
}

function parseTransfer(
  input: Record<string, unknown>,
  id: string,
  asOf: string,
): EventParseResult {
  for (const field of ["fromReserveId", "toReserveId"] as const) {
    const error = requireNonEmptyString(input[field], field);
    if (error) {
      return eventError(field, error.message);
    }
  }
  if (input.fromReserveId === input.toReserveId) {
    return eventError("toReserveId", "Transfer fromReserveId and toReserveId must differ.");
  }
  if (!isPositiveNumber(input.amount)) {
    return eventError("amount", "Transfer amount must be a positive number.");
  }
  const tier = parseTier(input.tier, "tier");
  if ("kind" in tier) {
    return tier;
  }
  return {
    kind: "ok",
    value: {
      id,
      asOf,
      type: "Transfer",
      fromReserveId: input.fromReserveId as string,
      toReserveId: input.toReserveId as string,
      amount: input.amount,
      tier: tier.tier,
    },
  };
}

function parsePositionOpened(
  input: Record<string, unknown>,
  id: string,
  asOf: string,
): EventParseResult {
  const position = input.position;
  if (!isRecord(position)) {
    return eventError("position", "PositionOpened requires a position object.");
  }

  for (const field of ["id", "portfolioId", "tempo", "accountId", "instrumentId"] as const) {
    const error = requireNonEmptyString(position[field], `position.${field}`);
    if (error) {
      return eventError(`position.${field}`, error.message);
    }
  }
  if (!isExecutionMode(position.executionMode)) {
    return eventError("position.executionMode", "Unsupported executionMode.");
  }
  if (!isDirection(position.direction)) {
    return eventError("position.direction", "Direction must be long or short.");
  }
  if (!isSupportedCurrency(position.currency)) {
    return eventError("position.currency", "Unsupported currency.");
  }

  const lots = parseLots(position.lots);
  if (lots.kind === "event-error") {
    return lots;
  }

  // Coherence signal: a Position cannot open without the five decision fields.
  const decision = input.decision;
  if (!isRecord(decision)) {
    return eventError("decision", "PositionOpened requires a decision object.");
  }
  const decisionValues = {} as PositionDecision;
  for (const field of REQUIRED_DECISION_FIELDS) {
    const error = requireNonEmptyString(decision[field], `decision.${field}`);
    if (error) {
      return eventError(`decision.${field}`, error.message);
    }
    decisionValues[field] = (decision[field] as string).trim();
  }

  // Cash leg (atomic): an open cannot be recorded without naming the funding
  // Reserve and the cash debited, so a buy can never silently skip the debit.
  const funding = input.funding;
  if (!isRecord(funding)) {
    return eventError(
      "funding",
      `PositionOpened is missing its required funding cash leg.${LEGACY_CASH_LEG_REMEDY}`,
    );
  }
  const fundingReserveError = requireNonEmptyString(funding.reserveId, "funding.reserveId");
  if (fundingReserveError) {
    return eventError("funding.reserveId", fundingReserveError.message);
  }
  if (!isPositiveNumber(funding.amount)) {
    return eventError("funding.amount", "funding.amount must be a positive number.");
  }

  const value: PositionOpenedEvent = {
    id,
    asOf,
    type: "PositionOpened",
    position: {
      id: position.id as string,
      portfolioId: position.portfolioId as string,
      tempo: position.tempo as string,
      executionMode: position.executionMode,
      accountId: position.accountId as string,
      instrumentId: position.instrumentId as string,
      direction: position.direction,
      currency: position.currency,
      lots: lots.value,
    },
    decision: decisionValues,
    funding: { reserveId: funding.reserveId as string, amount: funding.amount },
  };
  return { kind: "ok", value };
}

function parsePositionClosed(
  input: Record<string, unknown>,
  id: string,
  asOf: string,
): EventParseResult {
  const error = requireNonEmptyString(input.positionId, "positionId");
  if (error) {
    return eventError("positionId", error.message);
  }
  // Cash leg (atomic): a close cannot be recorded without naming the settlement
  // Reserve and the proceeds received — the bug this increment fixes (a close that
  // retired the asset but credited the cash nowhere) becomes structurally impossible.
  const settlement = input.settlement;
  if (!isRecord(settlement)) {
    return eventError(
      "settlement",
      `PositionClosed is missing its required settlement cash leg.${LEGACY_CASH_LEG_REMEDY}`,
    );
  }
  const settlementReserveError = requireNonEmptyString(settlement.reserveId, "settlement.reserveId");
  if (settlementReserveError) {
    return eventError("settlement.reserveId", settlementReserveError.message);
  }
  if (!isPositiveNumber(settlement.proceeds)) {
    return eventError("settlement.proceeds", "settlement.proceeds must be a positive number.");
  }
  return {
    kind: "ok",
    value: {
      id,
      asOf,
      type: "PositionClosed",
      positionId: input.positionId as string,
      settlement: { reserveId: settlement.reserveId as string, proceeds: settlement.proceeds },
    },
  };
}

/**
 * Validate an `InvalidationMarked` in
 * isolation: a non-empty `positionId`, a positive `price`, and a `below`/`above`
 * `direction`. Existence of the position is the cross-ref gate's job, not parse's.
 */
function parseInvalidationMarked(
  input: Record<string, unknown>,
  id: string,
  asOf: string,
): EventParseResult {
  const error = requireNonEmptyString(input.positionId, "positionId");
  if (error) {
    return eventError("positionId", error.message);
  }
  if (!isPositiveNumber(input.price)) {
    return eventError("price", "InvalidationMarked price must be a positive number.");
  }
  if (input.direction !== "below" && input.direction !== "above") {
    return eventError("direction", "InvalidationMarked direction must be 'below' or 'above'.");
  }
  return {
    kind: "ok",
    value: {
      id,
      asOf,
      type: "InvalidationMarked",
      positionId: input.positionId as string,
      price: input.price,
      direction: input.direction,
    },
  };
}

function parsePriceMarked(
  input: Record<string, unknown>,
  id: string,
  asOf: string,
): EventParseResult {
  const error = requireNonEmptyString(input.instrumentId, "instrumentId");
  if (error) {
    return eventError("instrumentId", error.message);
  }
  if (!isPositiveNumber(input.price)) {
    return eventError("price", "PriceMarked price must be a positive number.");
  }
  if (input.usdMxn !== undefined && !isPositiveNumber(input.usdMxn)) {
    return eventError("usdMxn", "PriceMarked usdMxn must be a positive number.");
  }
  const value: PriceMarkedEvent = {
    id,
    asOf,
    type: "PriceMarked",
    instrumentId: input.instrumentId as string,
    price: input.price,
    ...(input.usdMxn !== undefined ? { usdMxn: input.usdMxn } : {}),
  };
  return { kind: "ok", value };
}

function parseLots(input: unknown): { kind: "ok"; value: PositionLot[] } | EventError {
  if (!Array.isArray(input) || input.length === 0) {
    return eventError("position.lots", "Position requires at least one lot.");
  }
  const lots: PositionLot[] = [];
  for (const [index, raw] of input.entries()) {
    if (!isRecord(raw)) {
      return eventError(`position.lots[${index}]`, "Lot must be an object.");
    }
    if (!isPositiveNumber(raw.quantity)) {
      return eventError(`position.lots[${index}].quantity`, "Lot quantity must be positive.");
    }
    if (!isPositiveNumber(raw.cost)) {
      return eventError(`position.lots[${index}].cost`, "Lot cost must be positive.");
    }
    if (raw.tier !== "c1" && raw.tier !== "c2" && raw.tier !== "c3") {
      return eventError(`position.lots[${index}].tier`, "Lot tier must be c1, c2, or c3.");
    }
    const lot: PositionLot = { quantity: raw.quantity, cost: raw.cost, tier: raw.tier };
    if (raw.entryFx !== undefined) {
      if (!isPositiveNumber(raw.entryFx)) {
        return eventError(`position.lots[${index}].entryFx`, "Lot entryFx must be positive.");
      }
      lot.entryFx = raw.entryFx;
    }
    lots.push(lot);
  }
  return { kind: "ok", value: lots };
}
