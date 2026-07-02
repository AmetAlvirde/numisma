/**
 * PROTOTYPE (mvi 2026-06-29-portfolio-persistence). Event-sourcing spine — cross-ref.
 *
 * The SECOND ingest gate (after `./parse.ts`): validate a structurally-sound event
 * against the known world — the {@link EventReference} built from the immutable
 * genesis seed plus everything the durable log has already introduced. Rejects an
 * open colliding with or citing unknown ids, a close/mark for an unknown id, a
 * cross-currency Transfer, an insufficient debit, and a mark/settlement deviating
 * beyond its magnitude threshold. Pure validation LOGIC (ADR-001); it shadows the
 * fold's reserve math (`./fold.ts`) so the sufficiency gate sees the running
 * balances the fold will produce. See ADR-003.
 */
import type { CapitalTier, Currency, FundReviewData, PositionLot } from "../contracts.js";
import type {
  DepositEvent,
  EventError,
  EventParseResult,
  InvalidationMarkedEvent,
  PortfolioEvent,
  PositionAddedToEvent,
  PositionClosedEvent,
  PositionOpenedEvent,
  PositionTrimmedEvent,
  PriceMarkedEvent,
  TierDelta,
  TransferEvent,
  WithdrawEvent,
} from "./types.js";
import { eventError } from "./types.js";
import {
  reserveDeltasForClose,
  reserveDeltasForOpen,
  splitTierRemoval,
  weightedAverageCost,
} from "./fold.js";

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
  /**
   * Position ids the log has retired via a `PositionClosed`. A closed id stays in
   * {@link positionIds} (it existed, and close-and-reopen mints a fresh id rather
   * than reusing the retired one), but is additionally flagged here so the ingest
   * gate can reject a post-close `InvalidationMarked` — a level on a retired
   * position can never fold (breach is derived per OPEN position), so accepting it
   * would silently drop the mark at fold. See {@link crossReferenceInvalidation}
   * and ADR-003 (fail-loud-at-ingest).
   */
  closedPositionIds: Set<string>;
  /** Latest known close per instrument: the magnitude guard's comparison point. */
  lastClose: Map<string, { price: number; asOf: string }>;
  /**
   * Running Reserve balances the cross-ref sufficiency gate checks a debit
   * against (a withdraw/transfer/open-funding can't exceed available, per Tier).
   * `tiers` is null for an untiered Reserve — only its `amount` is checked. Updated
   * in-place by {@link applyEventToReference} as a batch is accepted, mirroring the
   * fold's {@link applyReserveDelta}, so a deposit earlier in the inbox funds a
   * later withdraw. `currency` is the Reserve's own denomination, read by the
   * same-currency Transfer guard (a cross-currency move is FX, not a Transfer).
   */
  reserveBalances: Map<
    string,
    { amount: number; tiers: Map<CapitalTier, number> | null; currency: Currency }
  >;
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
    // Genesis positions are all open; the log fills this via `PositionClosed` below.
    closedPositionIds: new Set(),
    lastClose: new Map(),
    reserveBalances: new Map(
      genesis.reserves.map((reserve) => [
        reserve.id,
        {
          amount: reserve.amount,
          tiers: reserve.lots
            ? new Map(reserve.lots.map((lot) => [lot.tier, lot.quantity]))
            : null,
          currency: reserve.currency,
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
 * reopen rule mints a fresh id rather than reusing the retired one — but records
 * it in {@link EventReference.closedPositionIds} so the ingest gate can reject a
 * post-close `InvalidationMarked` on it.
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
      // Flag the id retired so a later post-close InvalidationMarked fails loud.
      reference.closedPositionIds.add(event.positionId);
      break;
    }
    case "PositionTrimmed": {
      // Credit the settlement reserve (tiered by the removed mix) and REDUCE the
      // running per-tier position lots so a later trim in the same batch sees the
      // shrunk balance — the shadow the position-lot-sufficiency gate reads.
      const trimmed = reference.positionLots.get(event.positionId);
      if (trimmed) {
        let working = trimmed.lots;
        const removed: PositionLot[] = [];
        for (const removal of event.removals) {
          const split = splitTierRemoval(working, removal.tier, removal.quantity);
          removed.push(...split.removed);
          working = split.remaining;
        }
        reference.positionLots.set(event.positionId, {
          instrumentId: trimmed.instrumentId,
          lots: working,
        });
        applyDeltasToBalance(
          reference,
          event.settlement.reserveId,
          reserveDeltasForClose(removed, event.settlement.proceeds),
        );
        // A trim that empties the position retires the id (parallels a full close).
        if (working.length === 0) {
          reference.closedPositionIds.add(event.positionId);
        }
      }
      break;
    }
    case "PositionAddedTo": {
      // Append the new lot to the running position lots and debit the funding reserve.
      const added = reference.positionLots.get(event.positionId);
      if (added) {
        reference.positionLots.set(event.positionId, {
          instrumentId: added.instrumentId,
          lots: [...added.lots, event.lot],
        });
      }
      applyDeltasToBalance(
        reference,
        event.funding.reserveId,
        reserveDeltasForOpen([event.lot], event.funding.amount),
      );
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
    case "InvalidationMarked":
      // No id or balance effect: the position id already exists and no cash moves.
      // The level is a compose-time concern (breach derivation), not a reference one.
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
 * Second ingest gate (after `parseEvent`): validate a structurally-sound
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
    case "PositionTrimmed":
      return crossReferenceTrim(event, reference, options?.settlementThreshold);
    case "PositionAddedTo":
      return crossReferenceAddedTo(event, reference);
    case "PriceMarked":
      return crossReferenceMark(event, reference, options?.magnitudeThreshold);
    case "Deposit":
      return crossReferenceDeposit(event, reference);
    case "Withdraw":
      return crossReferenceWithdraw(event, reference);
    case "Transfer":
      return crossReferenceTransfer(event, reference);
    case "InvalidationMarked":
      return crossReferenceInvalidation(event, reference);
  }
}

/**
 * An `InvalidationMarked` must reference a
 * position the seed or log introduced — marking a level on an unknown id is a
 * dangling reference. Latest-wins revision needs no magnitude guard here (the mark
 * is a thesis level, not a valuation); breach is derived at compose.
 *
 * POST-CLOSE MARK (ADR-003 fail-loud, PRD #90 R4). A mark on an already-closed
 * position is rejected at ingest, not accepted as a silent no-op. The close retired
 * the id (a fresh id is minted on reopen), breach is derived only per OPEN position,
 * so the level could never fold to anything — accepting it would silently drop the
 * mark at fold, the exact drift class this ledger eliminates. Rejecting keeps the
 * 7th verb inside ADR-003's fail-loud-at-ingest posture. The distinct
 * `positionId` message names the closed case so the operator can tell it from a
 * genuine dangling reference.
 */
function crossReferenceInvalidation(
  event: InvalidationMarkedEvent,
  reference: EventReference,
): EventParseResult {
  if (!reference.positionIds.has(event.positionId)) {
    return eventError(
      "positionId",
      `InvalidationMarked references position id '${event.positionId}', which neither ` +
        `the genesis seed nor the log contains.`,
    );
  }
  if (reference.closedPositionIds.has(event.positionId)) {
    return eventError(
      "positionId",
      `InvalidationMarked targets position id '${event.positionId}', which is already ` +
        `closed; a thesis level on a retired position can never be watched. Mark the ` +
        `level before the close, or open a fresh position.`,
    );
  }
  return { kind: "ok", value: event };
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

/**
 * PROTOTYPE (mvi 2026-07-02-partial-close-profit-split). Cross-reference a
 * `PositionTrimmed`. The settlement cash leg is a CREDIT (it can never overdraw a
 * Reserve), so the sufficiency concern moves to the POSITION LOTS: for each
 * `{ tier, quantity }` the position's lots in that tier must sum to ≥ quantity, else
 * fail loud (the position-lot-sufficiency gate, parallel to reserve `checkDebit`).
 * The settlement-magnitude gate is reused on the REMOVED subset (Σ removed quantity ×
 * the instrument's last close). Pure: reads `reference`, never mutates it.
 */
function crossReferenceTrim(
  event: PositionTrimmedEvent,
  reference: EventReference,
  threshold = SETTLEMENT_MAGNITUDE_THRESHOLD,
): EventParseResult {
  if (!reference.positionIds.has(event.positionId)) {
    return eventError(
      "positionId",
      `PositionTrimmed references position id '${event.positionId}', which neither ` +
        `the genesis seed nor the log contains.`,
    );
  }
  if (reference.closedPositionIds.has(event.positionId)) {
    return eventError(
      "positionId",
      `PositionTrimmed targets position id '${event.positionId}', which is already closed.`,
    );
  }
  if (!reference.reserveBalances.has(event.settlement.reserveId)) {
    return eventError(
      "settlement.reserveId",
      `PositionTrimmed settles into reserve id '${event.settlement.reserveId}', which neither ` +
        `the genesis seed nor the log contains.`,
    );
  }
  const held = reference.positionLots.get(event.positionId);
  const availableByTier = new Map<CapitalTier, number>();
  for (const lot of held?.lots ?? []) {
    availableByTier.set(lot.tier, (availableByTier.get(lot.tier) ?? 0) + lot.quantity);
  }
  // Position-lot-sufficiency gate: aggregate the requested removal per tier (a batch
  // may name a tier twice) and reject when it exceeds the tier's available lots.
  const requestedByTier = new Map<CapitalTier, number>();
  for (const removal of event.removals) {
    requestedByTier.set(
      removal.tier,
      (requestedByTier.get(removal.tier) ?? 0) + removal.quantity,
    );
  }
  for (const [tier, requested] of requestedByTier) {
    const available = availableByTier.get(tier) ?? 0;
    if (requested > available + 1e-9) {
      return eventError(
        "removals",
        `PositionTrimmed removes ${requested} from position '${event.positionId}' tier ${tier}, ` +
          `which holds only ${available}.`,
      );
    }
  }
  // Settlement-magnitude gate on the removed subset: expected ≈ Σ removed quantity ×
  // the instrument's last close; a gross deviation is a fat-finger, rejected loud.
  const last = held ? reference.lastClose.get(held.instrumentId) : undefined;
  if (held && last !== undefined) {
    const removedQuantity = event.removals.reduce((sum, removal) => sum + removal.quantity, 0);
    const expected = removedQuantity * last.price;
    if (expected > 0) {
      const deviation = Math.abs(event.settlement.proceeds / expected - 1);
      if (deviation > threshold) {
        return eventError(
          "settlement.proceeds",
          `PositionTrimmed proceeds ${event.settlement.proceeds} deviate ` +
            `${(deviation * 100).toFixed(1)}% from expected ${expected.toFixed(2)} ` +
            `(${removedQuantity} × last close ${last.price} for '${held.instrumentId}'), beyond ` +
            `the ${(threshold * 100).toFixed(0)}% settlement sanity threshold.`,
        );
      }
    }
  }
  return { kind: "ok", value: event };
}

/**
 * PROTOTYPE (mvi 2026-07-02-partial-close-profit-split). Cross-reference a
 * `PositionAddedTo`: the position must exist and be open, and the funding Reserve
 * must exist and hold enough (per tier) to cover the debit — so an add cannot drive
 * a Reserve silently negative. Pure.
 */
function crossReferenceAddedTo(
  event: PositionAddedToEvent,
  reference: EventReference,
): EventParseResult {
  if (!reference.positionIds.has(event.positionId)) {
    return eventError(
      "positionId",
      `PositionAddedTo references position id '${event.positionId}', which neither ` +
        `the genesis seed nor the log contains.`,
    );
  }
  if (reference.closedPositionIds.has(event.positionId)) {
    return eventError(
      "positionId",
      `PositionAddedTo targets position id '${event.positionId}', which is already closed.`,
    );
  }
  if (!reference.reserveBalances.has(event.funding.reserveId)) {
    return eventError(
      "funding.reserveId",
      `PositionAddedTo funds from reserve id '${event.funding.reserveId}', which neither ` +
        `the genesis seed nor the log contains.`,
    );
  }
  for (const delta of reserveDeltasForOpen([event.lot], event.funding.amount)) {
    const error = checkDebit(
      reference,
      event.funding.reserveId,
      delta.tier,
      -delta.amount,
      "funding.amount",
    );
    if (error) {
      return { ...error, message: `PositionAddedTo ${error.message}` };
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
  const to = reference.reserveBalances.get(event.toReserveId);
  if (!to) {
    return eventError(
      "toReserveId",
      `Transfer targets reserve id '${event.toReserveId}', which the genesis seed does not contain.`,
    );
  }
  // Same-currency invariant (M2): a Transfer moves the raw `amount` reserve-to-reserve
  // with no FX conversion, so a cross-currency move would silently distort NAV — the
  // exact bug class this MVI eliminates. Reject it loud here, before the log. (An FX
  // conversion is modeled as Withdraw + Deposit at the executed rate, not a Transfer.)
  // Guarded on `from` existing so a missing source still surfaces as checkDebit's
  // existence error below rather than being masked here.
  const from = reference.reserveBalances.get(event.fromReserveId);
  if (from && from.currency !== to.currency) {
    return eventError(
      "toReserveId",
      `Transfer moves ${from.currency} from reserve '${event.fromReserveId}' into ` +
        `${to.currency} reserve '${event.toReserveId}'; a Transfer must be same-currency. ` +
        `Model an FX conversion as a Withdraw + Deposit at the executed rate.`,
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
