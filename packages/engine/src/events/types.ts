/**
 * PROTOTYPE (mvi 2026-06-29-portfolio-persistence). Event-sourcing spine — types.
 *
 * The leaf of the event-sourcing spine: the durable event verbs, the parse-result
 * shape, and the small shared `eventError` constructor. Depends only on the
 * package's canonical-state contracts, so `parse`, `crossref`, and `fold` can all
 * import from here without a cycle. See ADR-003 for the append-only-log design and
 * `./fold.ts` for the fold to the read model.
 */
import type {
  CapitalTier,
  Currency,
  Direction,
  ExecutionMode,
  PositionLot,
} from "../contracts.js";

export type PortfolioEventType =
  | "PositionOpened"
  | "PositionClosed"
  | "PositionTrimmed"
  | "PositionAddedTo"
  | "PriceMarked"
  | "Deposit"
  | "Withdraw"
  | "Transfer"
  | "InvalidationMarked";

/**
 * The side a price must cross to breach a
 * Position's structured invalidation level. `below` = a long's stop (breached when
 * the mark falls to/through the level); `above` = a short's stop (breached when the
 * mark rises to/through it). The prose `invalidationCondition` on `PositionOpened`
 * stays; this is the structured, comparable form the dashboard watches.
 */
export type InvalidationDirection = "below" | "above";

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

/**
 * PROTOTYPE (mvi 2026-07-02-partial-close-profit-split). One tier-directed removal
 * on a trim: take `quantity` out of the named `tier`'s lots (pro-rata across the
 * lots within that tier, preserving each lot's blended entryFx). Trader-directed
 * BETWEEN tiers, pro-rata WITHIN a tier.
 */
export interface TierRemoval {
  tier: CapitalTier;
  quantity: number;
}

/**
 * PROTOTYPE (mvi 2026-07-02-partial-close-profit-split). Partially close a Position:
 * remove `removals` from the named tiers (the asset leg) and credit the atomic
 * `settlement` cash leg into a Reserve — the partial-close analog of
 * {@link PositionClosedEvent}. The position stays OPEN with reduced lots (a
 * full-retirement trim is rejected at ingest — use {@link PositionClosedEvent}); the
 * fold emits a PARTIAL {@link ClosedPositionRecord} on the sold portion sharing the
 * surviving position's id. NAV conservation is a settle-AT-mark property: when the
 * fill lands at the mark, asset out = cash in; an off-mark fill legitimately moves
 * NAV and is disclosed via the partial row's `markVsFill` (R2).
 */
export interface PositionTrimmedEvent extends BaseEvent {
  type: "PositionTrimmed";
  positionId: string;
  removals: TierRemoval[];
  /** Cash leg: credit this Reserve with the proceeds of the removed portion. */
  settlement: CloseSettlement;
}

/**
 * PROTOTYPE (mvi 2026-07-02-partial-close-profit-split). Add to an OPEN Position:
 * APPEND a new {@link PositionLot} (its own entryFx/tier preserved — NEVER
 * weighted-average-merged, ADR-002) funded atomically by the `funding` cash leg.
 * Produces no realized P&L. NAV is conserved when funding = lot market value.
 */
export interface PositionAddedToEvent extends BaseEvent {
  type: "PositionAddedTo";
  positionId: string;
  lot: PositionLot;
  /** Cash leg: debit this Reserve to fund the new lot. */
  funding: OpenFunding;
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

/**
 * Sets (or revises) the structured
 * invalidation level of an OPEN Position — the price + direction the thesis breaks
 * on. Latest-wins per `positionId`, exactly parallel to how `PriceMarked` is
 * latest-wins per instrument; the user can revise it after open (a later mark
 * supersedes an earlier one). The dashboard derives breach at compose time
 * (latest mark vs latest level). Opening a Position with a structured stop is two
 * events: `PositionOpened` + `InvalidationMarked`.
 */
export interface InvalidationMarkedEvent extends BaseEvent {
  type: "InvalidationMarked";
  positionId: string;
  price: number;
  direction: InvalidationDirection;
}

export type PortfolioEvent =
  | PositionOpenedEvent
  | PositionClosedEvent
  | PositionTrimmedEvent
  | PositionAddedToEvent
  | PriceMarkedEvent
  | DepositEvent
  | WithdrawEvent
  | TransferEvent
  | InvalidationMarkedEvent;

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

export function eventError(path: string, message: string): EventError {
  return { kind: "event-error", path, message };
}
