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
 * The ingest boundary is two gates: `parseEvent` validates one event's structure
 * in isolation, then `crossReferenceEvent` validates it against the known world —
 * the genesis seed ids plus everything the durable log has already introduced — so
 * an event referencing an instrument/position the seed never knew, or an open whose
 * id collides with an existing record, fails loud instead of folding into a silent
 * no-op or a broken read model. A `PriceMarked` is additionally magnitude-guarded
 * against the instrument's last known close to catch currency-unit / fat-finger
 * entry. Per ADR-001 this is pure validation LOGIC; loading the genesis ids off disk
 * and orchestrating the inbox loop are access-surface concerns in `@numisma/tui`.
 *
 * SHORTCUTS (visible, prototype-only):
 *   - Decision fields are validated on ingest but NOT carried into the read
 *     model (FundReviewData has no decision slot yet); they are dropped after
 *     the open. Persisting them is reliable-conversion work.
 */
import type {
  CapitalTier,
  Currency,
  Direction,
  ExecutionMode,
  FundReviewData,
  PositionLot,
  PositionRecord,
  ReserveRecord,
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
  | "PriceMarked"
  | "Deposit"
  | "Withdraw"
  | "Transfer";

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

/**
 * The cash leg of an open: the Reserve that funded the buy, and the actual cash
 * debited (net of fees). The debit is split across the funded Tiers in proportion
 * to the position lots' own cost-basis weights (cash carries its provenance).
 */
export interface OpenFunding {
  reserveId: string;
  amount: number;
}

/**
 * The cash leg of a close: the Reserve that received the sale, and the actual cash
 * received (net of fees). Proceeds inherit the closed position's Tier mix
 * proportionally — the realized gain/loss falls on the same Tier it was risked on.
 */
export interface CloseSettlement {
  reserveId: string;
  proceeds: number;
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
  /** Cash leg: debit this Reserve. The asset leg cannot be opened without it. */
  funding: OpenFunding;
}

export interface PositionClosedEvent extends BaseEvent {
  type: "PositionClosed";
  positionId: string;
  /** Cash leg: credit this Reserve. The asset leg cannot be retired without it. */
  settlement: CloseSettlement;
}

/** External capital arriving into a Reserve, classified at arrival by `tier`. */
export interface DepositEvent extends BaseEvent {
  type: "Deposit";
  reserveId: string;
  amount: number;
  tier: CapitalTier;
}

/** Capital leaving a Reserve to the outside world, drawn from the named `tier`. */
export interface WithdrawEvent extends BaseEvent {
  type: "Withdraw";
  reserveId: string;
  amount: number;
  tier: CapitalTier;
}

/**
 * Same-currency cash moved between two venue Reserves. One atomic event conserves
 * NAV; `tier` rides across so moving cash cannot launder its provenance. FX
 * conversions are modeled as Withdraw + Deposit at the executed rate, not Transfer.
 */
export interface TransferEvent extends BaseEvent {
  type: "Transfer";
  fromReserveId: string;
  toReserveId: string;
  amount: number;
  tier: CapitalTier;
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
  | PriceMarkedEvent
  | DepositEvent
  | WithdrawEvent
  | TransferEvent;

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
    case "Deposit":
      return parseReserveMove(input, id, asOf, "Deposit");
    case "Withdraw":
      return parseReserveMove(input, id, asOf, "Withdraw");
    case "Transfer":
      return parseTransfer(input, id, asOf);
    default:
      return eventError("type", `Unsupported event type: ${String(input.type)}`);
  }
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
    return eventError("funding", "PositionOpened requires a funding object.");
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
    return eventError("settlement", "PositionClosed requires a settlement object.");
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
 * The deviation past which a `PriceMarked` is treated as an implausible fat-finger
 * / currency-unit mistake (e.g. an MXN-denominated price entered as USD) rather
 * than a real move, and rejected at ingest. Relative: `|new / lastClose - 1|`. A
 * tunable constant, NOT itself ADR-worthy (ADR-003 records the decision to guard
 * magnitude at ingest; this is the dial). 0.5 = ±50% from the instrument's last
 * known close — wide enough to pass any plausible weekly move, narrow enough to
 * catch a ~20× FX-unit slip.
 */
export const PRICE_MARK_MAGNITUDE_THRESHOLD = 0.5;

/**
 * The deviation past which a close's `settlement.proceeds` is treated as an
 * implausible entry (order-of-magnitude typo, sign/unit slip) rather than a real
 * fill, and rejected at ingest. The proceeds analog of
 * {@link PRICE_MARK_MAGNITUDE_THRESHOLD}: relative to expected ≈ closed quantity ×
 * the instrument's last close. Reuses the same ±50% dial for now (an AAR open
 * question — real fills vs mark may want a wider band); kept a SEPARATE constant so
 * the two can diverge without a code change to either guard.
 */
export const SETTLEMENT_MAGNITUDE_THRESHOLD = 0.5;

/**
 * A signed change to one Capital Tier's slice of a Reserve. Positive = cash in,
 * negative = cash out. The atomic unit every cash move decomposes into, so the
 * zero-drift invariant (amount stays authoritative, lots track provenance) lives
 * in one place — {@link applyReserveDelta}.
 */
export interface TierDelta {
  tier: CapitalTier;
  amount: number;
}

const TIERS: CapitalTier[] = ["c1", "c2", "c3"];

/** Cost-basis weight of each Tier in a position's lots (the provenance the cash
 * leg inherits). Returns signed `amount` per present Tier summing exactly to
 * `total`, with any float residual folded into the last Tier so the reserve's
 * authoritative `amount` lands exact. */
function tierWeightedDeltas(lots: PositionLot[], total: number, sign: 1 | -1): TierDelta[] {
  const costByTier = new Map<CapitalTier, number>();
  let totalCost = 0;
  for (const lot of lots) {
    const cost = lot.quantity * lot.cost;
    costByTier.set(lot.tier, (costByTier.get(lot.tier) ?? 0) + cost);
    totalCost += cost;
  }
  const present = TIERS.filter((tier) => costByTier.has(tier));
  if (present.length === 0 || totalCost === 0) {
    // Degenerate (zero-cost lots): attribute everything to the first lot's Tier.
    return [{ tier: lots[0]?.tier ?? "c1", amount: sign * total }];
  }
  const deltas: TierDelta[] = [];
  let allocated = 0;
  present.forEach((tier, index) => {
    const isLast = index === present.length - 1;
    const share = isLast ? total - allocated : (total * (costByTier.get(tier) ?? 0)) / totalCost;
    allocated += share;
    deltas.push({ tier, amount: sign * share });
  });
  return deltas;
}

/** Open → debit the funding Reserve by the cash leaving, split across the
 * position lots' own Tiers (each Tier pays for what it bought). */
export function reserveDeltasForOpen(lots: PositionLot[], amount: number): TierDelta[] {
  return tierWeightedDeltas(lots, amount, -1);
}

/** Close → credit the settlement Reserve with the proceeds, split across the
 * closed position's Tier mix (realized gain/loss falls on the same Tier). */
export function reserveDeltasForClose(lots: PositionLot[], proceeds: number): TierDelta[] {
  return tierWeightedDeltas(lots, proceeds, 1);
}

/**
 * THE SEAM. Apply signed per-Tier deltas to one Reserve, in place. `amount` is
 * always authoritative (moves by the delta sum); when the Reserve carries cash
 * Lots they track provenance per Tier (a credit grows or mints a Tier lot, a debit
 * shrinks it). An untiered Reserve (no Lots, e.g. `reserve-binance-usdt`) just moves
 * its `amount`. Deposit/Withdraw/Transfer and both trade legs are all thin callers,
 * so the zero-drift rule lives here once.
 */
export function applyReserveDelta(reserve: ReserveRecord, deltas: TierDelta[]): void {
  const sum = deltas.reduce((total, delta) => total + delta.amount, 0);
  reserve.amount += sum;
  if (!reserve.lots) {
    return; // Untiered: amount is the whole truth.
  }
  for (const delta of deltas) {
    const lot = reserve.lots.find((candidate) => candidate.tier === delta.tier);
    if (lot) {
      lot.quantity += delta.amount;
    } else if (delta.amount > 0) {
      reserve.lots.push({ quantity: delta.amount, tier: delta.tier });
    }
    // A debit against an absent Tier is caught at the cross-ref sufficiency gate
    // before the fold ever runs, so a missing-Tier debit is unreachable here.
  }
}

/**
 * The known world an event is cross-referenced against: every id the genesis seed
 * and the durable log have introduced, plus the last known close per instrument
 * for the magnitude guard. Built from genesis (and optionally the existing log) by
 * {@link buildEventReference}; extended in-place by {@link applyEventToReference}
 * as a batch is accepted, so an event opened earlier in the same inbox can be
 * referenced by a later one. Per ADR-001 the TUI owns loading these ids off disk;
 * this engine code owns the validation logic that consumes them.
 */
export interface EventReference {
  positionIds: Set<string>;
  reserveIds: Set<string>;
  portfolioIds: Set<string>;
  accountIds: Set<string>;
  instrumentIds: Set<string>;
  /** Latest known close per instrument: the magnitude guard's comparison point. */
  lastClose: Map<string, { price: number; asOf: string }>;
  /**
   * Running Reserve balances the cross-ref sufficiency gate checks a debit
   * against (a withdraw/transfer/open-funding can't exceed available, per Tier).
   * `tiers` is null for an untiered Reserve — only its `amount` is checked. Updated
   * in-place by {@link applyEventToReference} as a batch is accepted, mirroring the
   * fold's {@link applyReserveDelta}, so a deposit earlier in the inbox funds a
   * later withdraw.
   */
  reserveBalances: Map<string, { amount: number; tiers: Map<CapitalTier, number> | null }>;
  /**
   * Closed/open position lots the settlement-magnitude gate reads to compute a
   * close's expected proceeds (quantity × last close) and the Tier mix proceeds
   * inherit. Mirrors `lastClose` existing solely to feed the PriceMarked guard.
   */
  positionLots: Map<string, { instrumentId: string; lots: PositionLot[] }>;
}

/**
 * Build the cross-reference world from the immutable genesis seed and, optionally,
 * the events already in the durable log. The last-close seed mirrors the fold: a
 * genesis-held instrument's `markPrice` at the genesis date is its t0 close, any
 * genesis-provided closes win, and prior log events advance it. Pure.
 */
export function buildEventReference(
  genesis: FundReviewData,
  priorEvents: PortfolioEvent[] = [],
): EventReference {
  const reference: EventReference = {
    positionIds: new Set(genesis.positions.map((position) => position.id)),
    reserveIds: new Set(genesis.reserves.map((reserve) => reserve.id)),
    portfolioIds: new Set(genesis.portfolios.map((portfolio) => portfolio.id)),
    accountIds: new Set(genesis.accounts.map((account) => account.id)),
    instrumentIds: new Set(genesis.instruments.map((instrument) => instrument.id)),
    lastClose: new Map(),
    reserveBalances: new Map(
      genesis.reserves.map((reserve) => [
        reserve.id,
        {
          amount: reserve.amount,
          tiers: reserve.lots
            ? new Map(reserve.lots.map((lot) => [lot.tier, lot.quantity]))
            : null,
        },
      ]),
    ),
    positionLots: new Map(
      genesis.positions.map((position) => [
        position.id,
        { instrumentId: position.instrumentId, lots: position.lots },
      ]),
    ),
  };

  // Seed last-close at the genesis date from each held instrument's markPrice, then
  // let any genesis-provided Close (its own asOf) override when at least as recent.
  for (const position of genesis.positions) {
    noteClose(reference, position.instrumentId, position.markPrice, genesis.review.asOf);
  }
  for (const close of genesis.closes ?? []) {
    noteClose(reference, close.instrumentId, close.price, close.asOf);
  }

  for (const event of priorEvents) {
    applyEventToReference(reference, event);
  }
  return reference;
}

/**
 * Fold one already-accepted event into the reference so subsequent events in the
 * same batch see its effects: an open introduces its position id (and an entry
 * close for a mid-stream instrument), a mark advances the last close. Mutates in
 * place. A close leaves the id known — it existed, and the domain's close-and-
 * reopen rule mints a fresh id rather than reusing the retired one.
 */
export function applyEventToReference(reference: EventReference, event: PortfolioEvent): void {
  switch (event.type) {
    case "PositionOpened":
      reference.positionIds.add(event.position.id);
      reference.positionLots.set(event.position.id, {
        instrumentId: event.position.instrumentId,
        lots: event.position.lots,
      });
      noteClose(
        reference,
        event.position.instrumentId,
        weightedAverageCost(event.position.lots),
        event.asOf,
      );
      applyDeltasToBalance(
        reference,
        event.funding.reserveId,
        reserveDeltasForOpen(event.position.lots, event.funding.amount),
      );
      break;
    case "PriceMarked":
      noteClose(reference, event.instrumentId, event.price, event.asOf);
      break;
    case "PositionClosed": {
      const closed = reference.positionLots.get(event.positionId);
      if (closed) {
        applyDeltasToBalance(
          reference,
          event.settlement.reserveId,
          reserveDeltasForClose(closed.lots, event.settlement.proceeds),
        );
      }
      break;
    }
    case "Deposit":
      applyDeltasToBalance(reference, event.reserveId, [
        { tier: event.tier, amount: event.amount },
      ]);
      break;
    case "Withdraw":
      applyDeltasToBalance(reference, event.reserveId, [
        { tier: event.tier, amount: -event.amount },
      ]);
      break;
    case "Transfer":
      applyDeltasToBalance(reference, event.fromReserveId, [
        { tier: event.tier, amount: -event.amount },
      ]);
      applyDeltasToBalance(reference, event.toReserveId, [
        { tier: event.tier, amount: event.amount },
      ]);
      break;
  }
}

/**
 * Mirror {@link applyReserveDelta} on the cross-ref reserve-balance shadow, so the
 * sufficiency gate sees the same running balances the fold will produce. Untiered
 * reserves track only `amount`.
 */
function applyDeltasToBalance(
  reference: EventReference,
  reserveId: string,
  deltas: TierDelta[],
): void {
  const balance = reference.reserveBalances.get(reserveId);
  if (!balance) {
    return; // Unknown reserve — the existence gate rejects before this runs.
  }
  for (const delta of deltas) {
    balance.amount += delta.amount;
    if (balance.tiers) {
      balance.tiers.set(delta.tier, (balance.tiers.get(delta.tier) ?? 0) + delta.amount);
    }
  }
}

function noteClose(
  reference: EventReference,
  instrumentId: string,
  price: number,
  asOf: string,
): void {
  const current = reference.lastClose.get(instrumentId);
  if (!current || asOf >= current.asOf) {
    reference.lastClose.set(instrumentId, { price, asOf });
  }
}

/**
 * Second ingest gate (after {@link parseEvent}): validate a structurally-sound
 * event against the known world. Rejects an open whose id collides with an
 * existing position/reserve or that cites an unknown portfolio/account/instrument;
 * a close/mark for an id the seed and log never introduced; and a mark deviating
 * beyond {@link PRICE_MARK_MAGNITUDE_THRESHOLD} from the instrument's last close.
 * Pure: it reads `reference` but never mutates it. On success returns the event
 * unchanged so callers can chain `parseEvent` → `crossReferenceEvent`.
 */
export function crossReferenceEvent(
  event: PortfolioEvent,
  reference: EventReference,
  options?: { magnitudeThreshold?: number; settlementThreshold?: number },
): EventParseResult {
  switch (event.type) {
    case "PositionOpened":
      return crossReferenceOpen(event, reference);
    case "PositionClosed":
      return crossReferenceClose(event, reference, options?.settlementThreshold);
    case "PriceMarked":
      return crossReferenceMark(event, reference, options?.magnitudeThreshold);
    case "Deposit":
      return crossReferenceDeposit(event, reference);
    case "Withdraw":
      return crossReferenceWithdraw(event, reference);
    case "Transfer":
      return crossReferenceTransfer(event, reference);
  }
}

/**
 * Reserve existence + per-Tier sufficiency for a debit. Returns null on success.
 * `amount` here is the cash leaving; an untiered reserve is checked against its
 * total balance, a tiered one against the named Tier's available quantity. Fails
 * loud rather than letting a debit drive a balance silently negative.
 */
function checkDebit(
  reference: EventReference,
  reserveId: string,
  tier: CapitalTier,
  amount: number,
  path: string,
): EventError | null {
  const balance = reference.reserveBalances.get(reserveId);
  if (!balance) {
    return eventError(
      path,
      `references reserve id '${reserveId}', which neither the genesis seed nor the log contains.`,
    );
  }
  const available = balance.tiers ? balance.tiers.get(tier) ?? 0 : balance.amount;
  // Tolerance absorbs float dust from prior proportional splits; a real overdraft
  // is far larger than this.
  if (amount > available + 1e-6) {
    return eventError(
      path,
      `debits ${amount} from reserve '${reserveId}'${
        balance.tiers ? ` tier ${tier}` : ""
      }, which holds only ${available}.`,
    );
  }
  return null;
}

function crossReferenceClose(
  event: PositionClosedEvent,
  reference: EventReference,
  threshold = SETTLEMENT_MAGNITUDE_THRESHOLD,
): EventParseResult {
  if (!reference.positionIds.has(event.positionId)) {
    return eventError(
      "positionId",
      `PositionClosed references position id '${event.positionId}', which neither ` +
        `the genesis seed nor the log contains.`,
    );
  }
  if (!reference.reserveBalances.has(event.settlement.reserveId)) {
    return eventError(
      "settlement.reserveId",
      `PositionClosed settles into reserve id '${event.settlement.reserveId}', which neither ` +
        `the genesis seed nor the log contains.`,
    );
  }
  // Settlement-magnitude gate: the proceeds analog of the PriceMarked guard.
  // Expected ≈ closed quantity × the instrument's last known close; a gross
  // deviation (order-of-magnitude typo, sign/unit slip) is rejected at ingest.
  const closed = reference.positionLots.get(event.positionId);
  const last = closed ? reference.lastClose.get(closed.instrumentId) : undefined;
  if (closed && last !== undefined) {
    const quantity = closed.lots.reduce((sum, lot) => sum + lot.quantity, 0);
    const expected = quantity * last.price;
    if (expected > 0) {
      const deviation = Math.abs(event.settlement.proceeds / expected - 1);
      if (deviation > threshold) {
        return eventError(
          "settlement.proceeds",
          `PositionClosed proceeds ${event.settlement.proceeds} deviate ` +
            `${(deviation * 100).toFixed(1)}% from expected ${expected.toFixed(2)} ` +
            `(${quantity} × last close ${last.price} for '${closed.instrumentId}'), beyond ` +
            `the ${(threshold * 100).toFixed(0)}% settlement sanity threshold.`,
        );
      }
    }
  }
  return { kind: "ok", value: event };
}

function crossReferenceDeposit(event: DepositEvent, reference: EventReference): EventParseResult {
  if (!reference.reserveBalances.has(event.reserveId)) {
    return eventError(
      "reserveId",
      `Deposit references reserve id '${event.reserveId}', which the genesis seed does not contain.`,
    );
  }
  return { kind: "ok", value: event };
}

function crossReferenceWithdraw(event: WithdrawEvent, reference: EventReference): EventParseResult {
  const error = checkDebit(reference, event.reserveId, event.tier, event.amount, "amount");
  if (error) {
    return { ...error, message: `Withdraw ${error.message}` };
  }
  return { kind: "ok", value: event };
}

function crossReferenceTransfer(event: TransferEvent, reference: EventReference): EventParseResult {
  if (!reference.reserveBalances.has(event.toReserveId)) {
    return eventError(
      "toReserveId",
      `Transfer targets reserve id '${event.toReserveId}', which the genesis seed does not contain.`,
    );
  }
  const error = checkDebit(reference, event.fromReserveId, event.tier, event.amount, "fromReserveId");
  if (error) {
    return { ...error, message: `Transfer ${error.message}` };
  }
  return { kind: "ok", value: event };
}

function crossReferenceOpen(
  event: PositionOpenedEvent,
  reference: EventReference,
): EventParseResult {
  const { position } = event;
  if (reference.positionIds.has(position.id)) {
    return eventError(
      "position.id",
      `PositionOpened id '${position.id}' collides with an existing position id.`,
    );
  }
  if (reference.reserveIds.has(position.id)) {
    return eventError(
      "position.id",
      `PositionOpened id '${position.id}' collides with an existing reserve id.`,
    );
  }
  if (!reference.portfolioIds.has(position.portfolioId)) {
    return eventError(
      "position.portfolioId",
      `PositionOpened references portfolio id '${position.portfolioId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  if (!reference.accountIds.has(position.accountId)) {
    return eventError(
      "position.accountId",
      `PositionOpened references account id '${position.accountId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  if (!reference.instrumentIds.has(position.instrumentId)) {
    return eventError(
      "position.instrumentId",
      `PositionOpened references instrument id '${position.instrumentId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  // Cash leg: the funding reserve must exist and hold enough, per Tier, to cover
  // the debit — so an open cannot drive a reserve silently negative.
  if (!reference.reserveBalances.has(event.funding.reserveId)) {
    return eventError(
      "funding.reserveId",
      `PositionOpened funds from reserve id '${event.funding.reserveId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  for (const delta of reserveDeltasForOpen(position.lots, event.funding.amount)) {
    const error = checkDebit(
      reference,
      event.funding.reserveId,
      delta.tier,
      -delta.amount,
      "funding.amount",
    );
    if (error) {
      return { ...error, message: `PositionOpened ${error.message}` };
    }
  }
  return { kind: "ok", value: event };
}

function crossReferenceMark(
  event: PriceMarkedEvent,
  reference: EventReference,
  threshold = PRICE_MARK_MAGNITUDE_THRESHOLD,
): EventParseResult {
  if (!reference.instrumentIds.has(event.instrumentId)) {
    return eventError(
      "instrumentId",
      `PriceMarked references instrument id '${event.instrumentId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  const last = reference.lastClose.get(event.instrumentId);
  if (last !== undefined) {
    const deviation = Math.abs(event.price / last.price - 1);
    if (deviation > threshold) {
      return eventError(
        "price",
        `PriceMarked price ${event.price} deviates ` +
          `${(deviation * 100).toFixed(1)}% from instrument '${event.instrumentId}'` +
          ` last close ${last.price}, beyond the ${(threshold * 100).toFixed(0)}% ` +
          `sanity threshold.`,
      );
    }
  }
  return { kind: "ok", value: event };
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
 *
 * As-of-before-genesis is guarded, not silently degenerate: the genesis seed is
 * t0, the start of recorded history, so an `asOf` strictly before
 * `genesis.review.asOf` has no honest answer (folding it would relabel the full
 * genesis composition with a date on which it did not yet exist). Such a request
 * throws rather than returning a misleading snapshot. `asOf === genesis.review.asOf`
 * is valid — it is the genesis state itself.
 *
 * FX-at-entry P&L: a freshly opened Position with no PriceMarked yet takes its
 * volume-weighted average cost as `markPrice`. That "freezes" it at entry in
 * native units, but the resulting P&L is only 0 when cost and value convert at
 * the same FX (USD, or a lot whose `entryFx` equals `review.usdMxn`). When a
 * lot's `entryFx` differs from the review FX, cost basis converts at entry FX
 * and market value at review FX, so the frozen-at-entry P&L is a pure
 * FX-translation gain/loss — not 0. The fold preserves `entryFx` per lot so
 * `buildCompositionReport` attributes that correctly (ADR-002).
 *
 * The returned read model shares no mutable state with `genesis`: the seed's
 * `fund`/`portfolios`/`accounts`/`instruments`/`reserves` sub-objects are deep-
 * cloned, so a consumer mutating the fold output can never reach back into the
 * immutable seed.
 */
export function foldEvents(
  genesis: FundReviewData,
  events: PortfolioEvent[],
  asOf?: string,
): FundReviewData {
  if (asOf !== undefined && asOf < genesis.review.asOf) {
    throw new Error(
      `Cannot fold as-of ${asOf}: it precedes the genesis seed date ` +
        `${genesis.review.asOf}. Genesis is the start of recorded history; ` +
        `there is no portfolio state before it.`,
    );
  }

  const positions = new Map<string, PositionRecord>(
    genesis.positions.map((position) => [position.id, structuredClone(position)]),
  );
  // Reserves are now mutated by the cash leg of every capital move (the seam
  // `applyReserveDelta`), so they are folded into a mutable working copy here
  // rather than cloned untouched at the tail.
  const reserves = new Map<string, ReserveRecord>(
    genesis.reserves.map((reserve) => [reserve.id, structuredClone(reserve)]),
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
  //
  // First-position-wins here: if two genesis positions ever shared an instrument
  // with different `markPrice`, this seeds the t0 anchor from the FIRST while the
  // magnitude guard's `buildEventReference`/`noteClose` keeps the LAST (equal-asOf
  // overwrite), so the fold anchor and the guard seed could diverge. Unreachable
  // today (one position per instrument); revisit this tie-break if that changes.
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
        // Cash leg: debit the funding reserve. Sufficiency was proven at ingest.
        applyToReserve(reserves, event.funding.reserveId, reserveDeltasForOpen(position.lots, event.funding.amount));
        break;
      }
      case "PositionClosed": {
        const closing = positions.get(event.positionId);
        // Cash leg: credit the settlement reserve with proceeds, tiered by the
        // closed position's mix, BEFORE retiring the asset leg. Honest-by-
        // construction: the asset cannot be removed without recording the cash.
        if (closing) {
          applyToReserve(
            reserves,
            event.settlement.reserveId,
            reserveDeltasForClose(closing.lots, event.settlement.proceeds),
          );
        }
        positions.delete(event.positionId);
        break;
      }
      case "PriceMarked":
        latestMark.set(event.instrumentId, event.price);
        closes.push({ instrumentId: event.instrumentId, asOf: event.asOf, price: event.price });
        if (event.usdMxn !== undefined) {
          usdMxn = event.usdMxn;
        }
        break;
      case "Deposit":
        applyToReserve(reserves, event.reserveId, [{ tier: event.tier, amount: event.amount }]);
        break;
      case "Withdraw":
        applyToReserve(reserves, event.reserveId, [{ tier: event.tier, amount: -event.amount }]);
        break;
      case "Transfer":
        applyToReserve(reserves, event.fromReserveId, [{ tier: event.tier, amount: -event.amount }]);
        applyToReserve(reserves, event.toReserveId, [{ tier: event.tier, amount: event.amount }]);
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

  // Deep-clone the shared genesis sub-objects so the fold output is fully
  // independent of the immutable seed: `positions`, `closes`, and `reserves` are
  // already freshly built above (reserves cloned per-record then mutated by the
  // cash legs), but `fund`/`portfolios`/`accounts`/`instruments` would otherwise be
  // shared by reference via the seed.
  return {
    fund: structuredClone(genesis.fund),
    review: { asOf: asOf ?? latestAsOf, usdMxn },
    portfolios: structuredClone(genesis.portfolios),
    accounts: structuredClone(genesis.accounts),
    instruments: structuredClone(genesis.instruments),
    reserves: [...reserves.values()],
    positions: [...positions.values()],
    closes,
  };
}

/** Apply per-Tier deltas to a folded reserve by id via the seam, if it exists.
 * A missing reserve is a no-op here — the cross-ref existence gate rejects an
 * unknown reserve before the fold ever runs. */
function applyToReserve(
  reserves: Map<string, ReserveRecord>,
  reserveId: string,
  deltas: TierDelta[],
): void {
  const reserve = reserves.get(reserveId);
  if (reserve) {
    applyReserveDelta(reserve, deltas);
  }
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
