/**
 * Event-sourcing spine — cross-ref.
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
  ReserveOpenedEvent,
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
 * One Reserve as the cross-reference gate sees it: the running balance shadow the
 * sufficiency gate checks debits against, plus the two facts that make the Reserve
 * itself checkable — the currency it is denominated in, and the date it was born.
 */
export interface ReserveShadow {
  amount: number;
  tiers: Map<CapitalTier, number> | null;
  currency: Currency;
  /** `genesis.review.asOf` for a seeded Reserve; the `ReserveOpened`'s `asOf` otherwise. */
  bornAsOf: string;
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
  /**
   * Every genesis account id → the currency that account is denominated in.
   *
   * Widened from a bare id `Set` for `ReserveOpened`: a Reserve whose currency
   * disagrees with its account is EXCLUDED by canonical normalization
   * (`compose/canonical.ts`, `currency-mismatch`), so admitting one at ingest would
   * mint a Reserve that silently never appears in the read model. Existence checks
   * read `.has()` on this map exactly as they read the old Set, so the widening is
   * source-compatible for every other verb.
   */
  accountCurrencies: Map<string, Currency>;
  instrumentIds: Set<string>;
  /**
   * The genesis review's own date — the instant the whole known world begins.
   *
   * Read by {@link crossReferenceReserveOpened} to reject a Reserve born BEFORE the
   * seed it is born into: the container-side twin of a movement dated before its
   * Reserve. Added for `ReserveOpened`, the first verb whose events can predate a
   * record they depend on; the `accountCurrencies` widening is the precedent that says
   * widening this type is cheap here (all consumption is in-repo and narrow).
   */
  genesisAsOf: string;
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
   *
   * `bornAsOf` is the date the Reserve came into existence — `genesis.review.asOf`
   * for a seeded Reserve, the `ReserveOpened`'s own `asOf` for a log-born one. It is
   * what makes "does this Reserve exist" answerable AS OF A DATE; see
   * {@link requireReserveBornBy}.
   */
  reserveBalances: Map<string, ReserveShadow>;
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
    accountCurrencies: new Map(genesis.accounts.map((account) => [account.id, account.currency])),
    instrumentIds: new Set(genesis.instruments.map((instrument) => instrument.id)),
    // Genesis positions are all open; the log fills this via `PositionClosed` below.
    closedPositionIds: new Set(),
    lastClose: new Map(),
    genesisAsOf: genesis.review.asOf,
    reserveBalances: new Map(
      genesis.reserves.map((reserve) => [
        reserve.id,
        {
          amount: reserve.amount,
          tiers: reserve.lots
            ? new Map(reserve.lots.map((lot) => [lot.tier, lot.quantity]))
            : null,
          currency: reserve.currency,
          // A seeded Reserve exists from the instant the world does.
          bornAsOf: genesis.review.asOf,
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
        // A trim ALWAYS leaves the position open: a full-retirement trim is rejected
        // at the gate (`crossReferenceTrim`), so `working` is never empty here and the
        // id is never retired — the position survives with reduced lots.
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
    case "ReserveOpened":
      // LOAD-BEARING, and the one arm whose omission compiles clean: this switch has
      // no return obligation, so forgetting `ReserveOpened` here would silently no-op
      // and a same-batch `[ReserveOpened, Transfer→it]` — the whole point of the verb —
      // would fail cross-reference with a bogus "reserve does not exist".
      //
      // Register in BOTH id sets the gates read: `reserveIds` (collision checks) and
      // `reserveBalances` (existence + sufficiency). Born at zero with an EMPTY tier
      // map — not `null` — so the shadow matches the fold's empty `lots: []`: the
      // Reserve is untiered-because-empty, and the first credit gives it real tiers.
      //
      // `bornAsOf` is the event's OWN date, and it is the third thing this arm
      // registers: cross-ref validates in LOG order while the fold applies in
      // (asOf, then log) order, so without a birth date a movement dated EARLIER
      // than the birth passes the gate and then sorts ahead of it at fold, where
      // `applyToReserve` silently skips the not-yet-born destination and the cash
      // leaves the fund. See {@link requireReserveBornBy}.
      reference.reserveIds.add(event.reserve.id);
      reference.reserveBalances.set(event.reserve.id, {
        amount: 0,
        tiers: new Map(),
        currency: event.reserve.currency,
        bornAsOf: event.asOf,
      });
      break;
    default: {
      // EXHAUSTIVENESS LATCH (no runtime surface, by design). This switch has no
      // return obligation, so before this arm existed a forgotten verb compiled
      // clean and silently no-opped — the event would never register its ids and a
      // same-batch reference to it would fail with a bogus "does not exist". The
      // `never` assignment makes verb eleven a COMPILE ERROR here instead. Nothing
      // reaches this arm at runtime; no test can observe it. `pnpm typecheck` is
      // its only proof.
      const _never: never = event;
      return _never;
    }
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
    case "ReserveOpened":
      return crossReferenceReserveOpened(event, reference);
  }
}

/**
 * A `ReserveOpened` must mint a genuinely new id (colliding with neither an
 * existing Reserve nor an existing Position — capital ids share one namespace),
 * be `live`, cite a portfolio and an account the genesis seed knows, and be
 * denominated in THAT ACCOUNT'S currency.
 *
 * THE EXECUTION-MODE CHECK IS THE SAME REJECT AS THE CURRENCY ONE, ONLY WORSE
 * UNGUARDED. `compose/canonical.ts` drops a non-live Reserve with
 * `excluded.nonLive += 1` and NO warning, where a currency mismatch at least emits
 * one. Measured: `[ReserveOpened(paper), Transfer 400 into it]` against a 1000-unit
 * genesis passed both gates, moved the cash, took NAV to 600, and reported
 * `warnings: []`. This is NEW with this verb — every genesis reserve is `live`, so
 * a non-live Reserve was previously unmintable.
 *
 * THE GATE GOES AT THE MINT, NOT AT THE MOVEMENT. `crossReferenceTransfer` skips
 * `executionMode` too, but once no non-live Reserve can be minted the movement path
 * has nothing left to catch; a redundant gate at every movement site would defend
 * against a state that can no longer exist.
 *
 * The currency check is a HARD REJECT, not a warning, and it is the reason
 * {@link EventReference.accountCurrencies} carries currencies at all. Canonical
 * normalization already excludes a currency-mismatched Reserve with a
 * `currency-mismatch` warning; without this gate the new verb would be the one path
 * that admits such a Reserve into the durable log, where it would fold into a
 * record the read model then silently drops. Rejecting at ingest keeps the tenth
 * verb inside ADR-003's fail-loud posture — the log never holds a Reserve the
 * dashboard cannot show.
 *
 * There is deliberately no balance/NAV check: the event carries no amount and no
 * lots, so NAV-neutrality is structural, not something a rule here could violate.
 * Pure: reads `reference`, never mutates it.
 */
function crossReferenceReserveOpened(
  event: ReserveOpenedEvent,
  reference: EventReference,
): EventParseResult {
  const { reserve } = event;
  // D4 — the birth cannot predate the world it is born into. This is
  // `requireReserveBornBy`'s question asked of the CONTAINER instead of the movement:
  // the genesis seed is the fund at t0, so a Reserve dated before it would sort ahead
  // of the seed at fold and describe a world that did not exist.
  if (event.asOf < reference.genesisAsOf) {
    return eventError(
      "asOf",
      `ReserveOpened is dated ${event.asOf}, before the genesis review at ` +
        `${reference.genesisAsOf}. The seed IS the fund at t0; a Reserve cannot be born ` +
        `before it. Date the event ${reference.genesisAsOf} or later.`,
    );
  }
  if (reference.reserveIds.has(reserve.id)) {
    return eventError(
      "reserve.id",
      `ReserveOpened id '${reserve.id}' collides with an existing reserve id.`,
    );
  }
  if (reference.positionIds.has(reserve.id)) {
    return eventError(
      "reserve.id",
      `ReserveOpened id '${reserve.id}' collides with an existing position id.`,
    );
  }
  if (reserve.executionMode !== "live") {
    return eventError(
      "reserve.executionMode",
      `ReserveOpened opens reserve '${reserve.id}' in ${reserve.executionMode} mode. ` +
        `Canonical normalization DROPS a non-live Reserve outright — counted in ` +
        `excluded.nonLive with NO warning at all, unlike a currency mismatch, which at ` +
        `least warns — so it would be durably logged and then never reach the read ` +
        `model. Cash transferred into it would leave the fund's NAV silently. Open it ` +
        `in live mode.`,
    );
  }
  if (!reference.portfolioIds.has(reserve.portfolioId)) {
    return eventError(
      "reserve.portfolioId",
      `ReserveOpened references portfolio id '${reserve.portfolioId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  const accountCurrency = reference.accountCurrencies.get(reserve.accountId);
  if (accountCurrency === undefined) {
    return eventError(
      "reserve.accountId",
      `ReserveOpened references account id '${reserve.accountId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  if (accountCurrency !== reserve.currency) {
    return eventError(
      "reserve.currency",
      `ReserveOpened opens a ${reserve.currency} reserve '${reserve.id}' on account ` +
        `'${reserve.accountId}', which is denominated in ${accountCurrency}. A ` +
        `currency-mismatched Reserve is excluded by canonical normalization, so it ` +
        `would never reach the read model. Open it in ${accountCurrency}, or open it ` +
        `on an account denominated in ${reserve.currency}.`,
    );
  }
  return { kind: "ok", value: event };
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

/** {@link requireReserveBornBy}'s answer: the Reserve, or the reason there isn't one. */
type ReserveLookup =
  | { kind: "ok"; balance: ReserveShadow }
  | { kind: "event-error"; error: EventError };

/**
 * THE ONE PLACE THAT ANSWERS "DOES THIS RESERVE EXIST AS OF THIS DATE."
 *
 * Every reserve-existence check in this gate routes through here; none asks
 * `reserveBalances.has()`/`.get()` directly. Before `ReserveOpened` the eight sites
 * that asked could each own half the question safely, because every cross-ref-approved
 * reserve id was a genesis reserve present in the fold from t0 — existence was TOTAL.
 * `ReserveOpened` makes it PARTIAL, and the two halves then disagree: this gate walks
 * the batch in LOG order, while `foldEvents` applies it in (`asOf`, then log) order.
 *
 * Measured, on `[ReserveOpened asOf 06-15, Transfer asOf 06-10 into it]`: both events
 * passed both gates, the Transfer sorted FIRST at fold, `applyToReserve` silently
 * skipped the destination that did not exist yet, and cash went 1000 → 600 with
 * `warnings: []` while the new Reserve reported a balance of 0. Rejecting here makes
 * the batch fail all-or-nothing and loud, at ingest, per ADR-003.
 *
 * Deliberately NOT fixed at the fold. `foldEvents` is the READ path for the TUI, the
 * web push and the daily price-feed job; throwing there would turn an ingest-time
 * defect into a total dashboard outage and re-validate every already-durable log on
 * every read. `applyToReserve`'s silent skip stays, as a named leftover.
 */
function requireReserveBornBy(
  reference: EventReference,
  reserveId: string,
  asOf: string,
  path: string,
): ReserveLookup {
  const balance = reference.reserveBalances.get(reserveId);
  if (!balance) {
    return {
      kind: "event-error",
      error: eventError(
        path,
        `references reserve id '${reserveId}', which neither the genesis seed nor the log contains.`,
      ),
    };
  }
  if (asOf < balance.bornAsOf) {
    // The remedy branches on WHICH KIND of Reserve this is, because one of the two
    // fixes is impossible for a seeded one. A genesis-seeded Reserve is born at
    // `genesis.review.asOf` — it has no `ReserveOpened` to move, so "open the Reserve
    // earlier" would send the operator hunting for an event that does not exist (and
    // nine of the fund's ten reserves are seeded, so that is the COMMON case). Only a
    // log-born Reserve has a birth the operator can actually redate.
    const seeded = balance.bornAsOf === reference.genesisAsOf;
    const remedy = seeded
      ? `Date it on or after the genesis review date, ${balance.bornAsOf}.`
      : `Date it ${balance.bornAsOf} or later, or open the Reserve earlier.`;
    return {
      kind: "event-error",
      error: eventError(
        path,
        `references reserve '${reserveId}' as of ${asOf}, but that Reserve is not born ` +
          `until ${balance.bornAsOf}. The fold applies events in date order, so this one ` +
          `would run BEFORE the Reserve exists and its cash leg would vanish silently. ` +
          remedy,
      ),
    };
  }
  return { kind: "ok", balance };
}

/**
 * Per-Tier SUFFICIENCY for a debit, and nothing else. Returns null on success.
 * `amount` here is the cash leaving; an untiered reserve is checked against its
 * total balance, a tiered one against the named Tier's available quantity. Fails
 * loud rather than letting a debit drive a balance silently negative.
 *
 * Takes an ALREADY-RESOLVED {@link ReserveShadow}, not a reserve id: existence —
 * including the as-of-this-date half — is {@link requireReserveBornBy}'s job and
 * only its job, and every caller has already asked it. Re-resolving here duplicated
 * that lookup once per tier delta inside the open/add funding loops, and split one
 * question across two functions. `reserveId` is carried only to name the reserve in
 * the message.
 */
function checkDebit(
  balance: ReserveShadow,
  reserveId: string,
  tier: CapitalTier,
  amount: number,
  path: string,
): EventError | null {
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
  const settlesInto = requireReserveBornBy(
    reference,
    event.settlement.reserveId,
    event.asOf,
    "settlement.reserveId",
  );
  if (settlesInto.kind === "event-error") {
    return { ...settlesInto.error, message: `PositionClosed ${settlesInto.error.message}` };
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
 * Cross-reference a `PositionTrimmed`. The settlement cash leg is a CREDIT (it can
 * never overdraw a
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
  const trimSettlesInto = requireReserveBornBy(
    reference,
    event.settlement.reserveId,
    event.asOf,
    "settlement.reserveId",
  );
  if (trimSettlesInto.kind === "event-error") {
    return { ...trimSettlesInto.error, message: `PositionTrimmed ${trimSettlesInto.error.message}` };
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
  // Full-retirement REJECT (user-ratified rule): a trim whose removals would empty
  // the position fails loud here — a trim must leave the position OPEN. The trader is
  // pointed at `PositionClosed` instead. Enforced at the gate so the fold never
  // reaches `positions.delete`; the position ALWAYS survives a trim. `totalHeld` and
  // `totalRequested` are computed from the (batch-shrunk) running lots, so the check
  // is exact even after earlier trims in the same batch. Reaching here guarantees the
  // position holds lots (an empty tier would have tripped the sufficiency gate above).
  const totalHeld = [...availableByTier.values()].reduce((sum, quantity) => sum + quantity, 0);
  const totalRequested = [...requestedByTier.values()].reduce((sum, quantity) => sum + quantity, 0);
  if (totalHeld - totalRequested <= 1e-9) {
    return eventError(
      "removals",
      `PositionTrimmed would remove every lot of position '${event.positionId}' ` +
        `(${totalRequested} of ${totalHeld} held) — a full retirement. A trim must leave the ` +
        `position open; use PositionClosed to fully close it.`,
    );
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
 * Cross-reference a `PositionAddedTo`: the position must exist and be open, and the
 * funding Reserve
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
  const addFundedBy = requireReserveBornBy(
    reference,
    event.funding.reserveId,
    event.asOf,
    "funding.reserveId",
  );
  if (addFundedBy.kind === "event-error") {
    return { ...addFundedBy.error, message: `PositionAddedTo ${addFundedBy.error.message}` };
  }
  for (const delta of reserveDeltasForOpen([event.lot], event.funding.amount)) {
    const error = checkDebit(
      addFundedBy.balance,
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
  const into = requireReserveBornBy(reference, event.reserveId, event.asOf, "reserveId");
  if (into.kind === "event-error") {
    return { ...into.error, message: `Deposit ${into.error.message}` };
  }
  return { kind: "ok", value: event };
}

function crossReferenceWithdraw(event: WithdrawEvent, reference: EventReference): EventParseResult {
  // EXPLICIT, and load-bearing: `checkDebit` used to be this verb's ONLY existence and
  // birth check, so it is the one call site where dropping the id-based lookup from
  // `checkDebit` would silently delete the gate rather than merely de-duplicate it.
  // Keeps the `"amount"` path this verb has always reported for a bad reserve.
  const outOf = requireReserveBornBy(reference, event.reserveId, event.asOf, "amount");
  if (outOf.kind === "event-error") {
    return { ...outOf.error, message: `Withdraw ${outOf.error.message}` };
  }
  const error = checkDebit(outOf.balance, event.reserveId, event.tier, event.amount, "amount");
  if (error) {
    return { ...error, message: `Withdraw ${error.message}` };
  }
  return { kind: "ok", value: event };
}

function crossReferenceTransfer(event: TransferEvent, reference: EventReference): EventParseResult {
  // BOTH legs must exist AS OF THE TRANSFER'S OWN DATE. The destination is the leg the
  // audit measured: a Transfer dated before the `ReserveOpened` that mints its target
  // passed this gate in log order, then sorted ahead of the birth at fold, where the
  // credit silently evaporated and the debit did not.
  const to = requireReserveBornBy(reference, event.toReserveId, event.asOf, "toReserveId");
  if (to.kind === "event-error") {
    return { ...to.error, message: `Transfer ${to.error.message}` };
  }
  const from = requireReserveBornBy(reference, event.fromReserveId, event.asOf, "fromReserveId");
  if (from.kind === "event-error") {
    return { ...from.error, message: `Transfer ${from.error.message}` };
  }
  // Same-currency invariant (M2): a Transfer moves the raw `amount` reserve-to-reserve
  // with no FX conversion, so a cross-currency move would silently distort NAV — the
  // exact bug class this MVI eliminates. Reject it loud here, before the log. (An FX
  // conversion is modeled as Withdraw + Deposit at the executed rate, not a Transfer.)
  if (from.balance.currency !== to.balance.currency) {
    return eventError(
      "toReserveId",
      `Transfer moves ${from.balance.currency} from reserve '${event.fromReserveId}' into ` +
        `${to.balance.currency} reserve '${event.toReserveId}'; a Transfer must be same-currency. ` +
        `Model an FX conversion as a Withdraw + Deposit at the executed rate.`,
    );
  }
  const error = checkDebit(
    from.balance,
    event.fromReserveId,
    event.tier,
    event.amount,
    "fromReserveId",
  );
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
  if (!reference.accountCurrencies.has(position.accountId)) {
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
  const fundedBy = requireReserveBornBy(
    reference,
    event.funding.reserveId,
    event.asOf,
    "funding.reserveId",
  );
  if (fundedBy.kind === "event-error") {
    return { ...fundedBy.error, message: `PositionOpened ${fundedBy.error.message}` };
  }
  for (const delta of reserveDeltasForOpen(position.lots, event.funding.amount)) {
    const error = checkDebit(
      fundedBy.balance,
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
