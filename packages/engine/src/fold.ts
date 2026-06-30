/**
 * PROTOTYPE (mvi 2026-06-29-portfolio-persistence). Event-sourcing spine.
 *
 * The durable source of truth is an append-only event log on top of an
 * immutable genesis seed (today's full `FundReviewData`). Current state and any
 * "as-of" view are a pure FOLD over that log. This module is the pure domain
 * half of the spine and lives in `@numisma/engine` per ADR-001: file IO, inbox
 * detection, dedup persistence, and startup orchestration are access-surface
 * concerns and live in `@numisma/tui`.
 *
 * Three event verbs form the minimum loop:
 *   - PositionOpened — adds a Position; carries the five required decision
 *     fields, enforcing the product coherence signal that a Position cannot open
 *     without them.
 *   - PositionClosed — retires a Position from current composition at `asOf`.
 *   - PriceMarked — sets the latest mark for an instrument (and optional FX) and
 *     appends a Close to the price journey.
 *
 * SHORTCUTS (visible, prototype-only):
 *   - Events are validated structurally but not cross-referenced against genesis
 *     ids (e.g. a PositionClosed for an unknown id is a silent no-op).
 *   - markPrice for a freshly opened Position with no PriceMarked yet falls back
 *     to its volume-weighted average cost, so entry P&L reads as 0 ("frozen at
 *     entry" until the first PriceMarked).
 *   - Decision fields are validated on ingest but NOT carried into the read
 *     model (FundReviewData has no decision slot yet); they are dropped after
 *     the open. Persisting them is reliable-conversion work.
 */
import type {
  Currency,
  Direction,
  ExecutionMode,
  FundReviewData,
  PositionLot,
  PositionRecord,
  Close,
} from "./contracts.js";
import {
  isDirection,
  isExecutionMode,
  isIsoDate,
  isPositiveNumber,
  isRecord,
  isSupportedCurrency,
  requireNonEmptyString,
} from "./internal.js";

export type PortfolioEventType =
  | "PositionOpened"
  | "PositionClosed"
  | "PriceMarked";

/** The five decision fields a Position cannot open without (product coherence). */
export interface PositionDecision {
  entryThesis: string;
  invalidationCondition: string;
  riskBudget: string;
  plannedHoldingHorizon: string;
  strategy: string;
}

interface BaseEvent {
  /** Stable, client-provided dedup identity. Re-dropping the same id = skipped. */
  id: string;
  asOf: string;
  type: PortfolioEventType;
}

export interface PositionOpenedEvent extends BaseEvent {
  type: "PositionOpened";
  position: {
    id: string;
    portfolioId: string;
    tempo: string;
    executionMode: ExecutionMode;
    accountId: string;
    instrumentId: string;
    direction: Direction;
    currency: Currency;
    lots: PositionLot[];
  };
  decision: PositionDecision;
}

export interface PositionClosedEvent extends BaseEvent {
  type: "PositionClosed";
  positionId: string;
}

export interface PriceMarkedEvent extends BaseEvent {
  type: "PriceMarked";
  instrumentId: string;
  price: number;
  /** Optional FX (MXN-per-USD) snapshot at this mark; updates review.usdMxn. */
  usdMxn?: number;
}

export type PortfolioEvent =
  | PositionOpenedEvent
  | PositionClosedEvent
  | PriceMarkedEvent;

export interface EventOk {
  kind: "ok";
  value: PortfolioEvent;
}

export interface EventError {
  kind: "event-error";
  path: string;
  message: string;
}

export type EventParseResult = EventOk | EventError;

const REQUIRED_DECISION_FIELDS: Array<keyof PositionDecision> = [
  "entryThesis",
  "invalidationCondition",
  "riskBudget",
  "plannedHoldingHorizon",
  "strategy",
];

/**
 * Validate one untrusted event record into a typed {@link PortfolioEvent} or an
 * {@link EventError}. Pure: no IO, no cross-event state. The fold trusts only
 * what this gate returns.
 */
export function parseEvent(input: unknown): EventParseResult {
  if (!isRecord(input)) {
    return eventError("$", "Event must be a JSON object.");
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
    default:
      return eventError("type", `Unsupported event type: ${String(input.type)}`);
  }
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
  return {
    kind: "ok",
    value: { id, asOf, type: "PositionClosed", positionId: input.positionId as string },
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

/**
 * Fold the genesis seed plus an ordered event log into the read model as of a
 * date. Pure. `state(asOf ≤ D) = genesis, then apply events with asOf ≤ D`;
 * mark price = the latest PriceMarked ≤ D per instrument. With no `asOf`, every
 * event applies (current state). Output is a plain {@link FundReviewData} so the
 * existing `buildCompositionReport` and the whole dashboard are reused unchanged.
 *
 * Events apply in (asOf, then log order) — a stable sort keeps same-day events
 * in the order they were appended to the log.
 */
export function foldEvents(
  genesis: FundReviewData,
  events: PortfolioEvent[],
  asOf?: string,
): FundReviewData {
  const positions = new Map<string, PositionRecord>(
    genesis.positions.map((position) => [position.id, structuredClone(position)]),
  );
  const closes: Close[] = (genesis.closes ?? []).map((close) => ({ ...close }));
  const latestMark = new Map<string, number>();
  let usdMxn = genesis.review.usdMxn;
  let latestAsOf = genesis.review.asOf;

  // Seed a t0 baseline Close per genesis-held instrument so the FIRST PriceMarked
  // already yields a 2-point journey (the journey builder skips single anchors).
  // The anchor is the genesis `markPrice`, NOT cost: that keeps it coherent with
  // the authoritative valuation, so no synthetic `markprice-close-mismatch` fires.
  // Genesis-provided closes win — we only fill instruments that have none.
  const seededInstruments = new Set(closes.map((close) => close.instrumentId));
  for (const position of genesis.positions) {
    if (!seededInstruments.has(position.instrumentId)) {
      seededInstruments.add(position.instrumentId);
      closes.push({
        instrumentId: position.instrumentId,
        asOf: genesis.review.asOf,
        price: position.markPrice,
      });
    }
  }

  const applicable = events
    .map((event, order) => ({ event, order }))
    .filter(({ event }) => !asOf || event.asOf <= asOf)
    .sort((a, b) => (a.event.asOf === b.event.asOf ? a.order - b.order : a.event.asOf < b.event.asOf ? -1 : 1));

  for (const { event } of applicable) {
    if (event.asOf > latestAsOf) {
      latestAsOf = event.asOf;
    }
    switch (event.type) {
      case "PositionOpened": {
        const { position } = event;
        const entryPrice = weightedAverageCost(position.lots);
        positions.set(position.id, {
          id: position.id,
          portfolioId: position.portfolioId,
          tempo: position.tempo,
          executionMode: position.executionMode,
          accountId: position.accountId,
          currency: position.currency,
          instrumentId: position.instrumentId,
          direction: position.direction,
          lots: position.lots.map((lot) => ({ ...lot })),
          markPrice: entryPrice,
        });
        // Drop an entry-price anchor (coherent with the fallback markPrice) so an
        // instrument first held mid-stream also has a baseline for its journey.
        if (!seededInstruments.has(position.instrumentId)) {
          seededInstruments.add(position.instrumentId);
          closes.push({ instrumentId: position.instrumentId, asOf: event.asOf, price: entryPrice });
        }
        break;
      }
      case "PositionClosed":
        positions.delete(event.positionId);
        break;
      case "PriceMarked":
        latestMark.set(event.instrumentId, event.price);
        closes.push({ instrumentId: event.instrumentId, asOf: event.asOf, price: event.price });
        if (event.usdMxn !== undefined) {
          usdMxn = event.usdMxn;
        }
        break;
    }
  }

  // Apply the latest mark per instrument to every surviving Position.
  for (const position of positions.values()) {
    const mark = latestMark.get(position.instrumentId);
    if (mark !== undefined) {
      position.markPrice = mark;
    }
  }

  return {
    ...genesis,
    review: { asOf: asOf ?? latestAsOf, usdMxn },
    positions: [...positions.values()],
    closes,
  };
}

function weightedAverageCost(lots: PositionLot[]): number {
  const totalQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  if (totalQuantity === 0) {
    return 0;
  }
  const totalCost = lots.reduce((sum, lot) => sum + lot.quantity * lot.cost, 0);
  return totalCost / totalQuantity;
}

function eventError(path: string, message: string): EventError {
  return { kind: "event-error", path, message };
}
