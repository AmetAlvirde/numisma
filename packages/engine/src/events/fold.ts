/**
 * PROTOTYPE (mvi 2026-06-29-portfolio-persistence). Event-sourcing spine — fold.
 *
 * The fold to the read model plus the reserve/tier cash-math seam it and the
 * cross-ref shadow (`./crossref.ts`) share. `foldEvents` replays the genesis seed
 * plus an ordered event log into a plain {@link FundReviewData}, reusing the whole
 * existing `buildCompositionReport`/dashboard downstream. The reserve-delta helpers
 * are pure and exported so the cross-ref sufficiency gate can mirror the same
 * balances before the fold ever runs. See ADR-002 (Tier cost model) and ADR-003.
 */
import type {
  CapitalTier,
  ClosedPositionRecord,
  Close,
  FundReviewData,
  InvalidationLevel,
  PositionLot,
  PositionRecord,
  RealizedTierAttribution,
  ReserveRecord,
} from "../contracts.js";
import { toUsd } from "../internal.js";
import type { PortfolioEvent, TierDelta } from "./types.js";

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
  // Closed book + latest invalidation level per position (mvi 2026-07-01-realized-pnl).
  const closedPositions: ClosedPositionRecord[] = [];
  const latestInvalidation = new Map<string, InvalidationLevel>();
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
          // Carry the open date + strategy so the closed book can tag open/close
          // dates and attribute realized P&L per strategy (mvi 2026-07-01-realized-pnl).
          openedAsOf: event.asOf,
          strategy: event.decision.strategy,
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
          // Realized P&L (mvi 2026-07-01-realized-pnl): compute proceeds − cost
          // basis, tag it, and push a finished row onto the closed book INSTEAD of
          // silently dropping the position. Descriptive only — the profit already
          // landed in the Reserve above; the blotter records how the fund got here.
          const settlementCurrency =
            reserves.get(event.settlement.reserveId)?.currency ?? closing.currency;
          closedPositions.push(
            buildClosedPosition(closing, event.asOf, event.settlement.proceeds, settlementCurrency, usdMxn),
          );
        }
        positions.delete(event.positionId);
        break;
      }
      case "InvalidationMarked":
        // Latest-wins per position: record the newest structured level; it is
        // applied to the surviving position after the fold, alongside the mark.
        latestInvalidation.set(event.positionId, {
          price: event.price,
          direction: event.direction,
        });
        break;
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

  // Apply the latest mark per instrument, and the latest invalidation level per
  // position, to every surviving Position (mvi 2026-07-01-realized-pnl).
  for (const position of positions.values()) {
    const mark = latestMark.get(position.instrumentId);
    if (mark !== undefined) {
      position.markPrice = mark;
    }
    const invalidation = latestInvalidation.get(position.id);
    if (invalidation !== undefined) {
      position.invalidation = { ...invalidation };
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
    closedPositions,
  };
}

/**
 * PROTOTYPE (mvi 2026-07-01-realized-pnl). Build one closed-book row at close time.
 * Realized Trading P&L = proceeds(USD) − Σ(lot USD cost at its entryFx) — one blended
 * number, FX gain/loss baked in (ADR-002's FX-P&L deferral). The per-Tier split
 * mirrors the cash leg: proceeds are apportioned across the closed position's cost-
 * basis Tier mix (`reserveDeltasForClose`), cost basis is grouped by the same Tiers,
 * and realized per Tier is the difference — so the gain/loss falls on the Tier it was
 * risked on. Pure.
 */
function buildClosedPosition(
  closing: PositionRecord,
  closedAsOf: string,
  proceedsNative: number,
  settlementCurrency: PositionRecord["currency"],
  reviewFx: number,
): ClosedPositionRecord {
  const proceedsUsd = toUsd(proceedsNative, settlementCurrency, reviewFx);

  // Cost basis in USD, per Tier: each lot converts at its own entry FX (ADR-002).
  const costUsdByTier = new Map<CapitalTier, number>();
  let costBasisUsd = 0;
  for (const lot of closing.lots) {
    const lotCostUsd = toUsd(lot.quantity * lot.cost, closing.currency, lot.entryFx ?? reviewFx);
    costUsdByTier.set(lot.tier, (costUsdByTier.get(lot.tier) ?? 0) + lotCostUsd);
    costBasisUsd += lotCostUsd;
  }

  // Proceeds apportioned across the same Tier mix the cash leg credited (USD).
  const proceedsByTier = new Map<CapitalTier, number>();
  for (const delta of reserveDeltasForClose(closing.lots, proceedsUsd)) {
    proceedsByTier.set(delta.tier, (proceedsByTier.get(delta.tier) ?? 0) + delta.amount);
  }

  const tierAttribution: RealizedTierAttribution[] = [];
  for (const tier of TIERS) {
    if (!costUsdByTier.has(tier) && !proceedsByTier.has(tier)) {
      continue;
    }
    const tierCost = costUsdByTier.get(tier) ?? 0;
    const tierProceeds = proceedsByTier.get(tier) ?? 0;
    tierAttribution.push({
      tier,
      costBasisUsd: tierCost,
      proceedsUsd: tierProceeds,
      realizedPnlUsd: tierProceeds - tierCost,
    });
  }

  return {
    positionId: closing.id,
    instrumentId: closing.instrumentId,
    tempo: closing.tempo,
    ...(closing.strategy !== undefined ? { strategy: closing.strategy } : {}),
    direction: closing.direction,
    ...(closing.openedAsOf !== undefined ? { openedAsOf: closing.openedAsOf } : {}),
    closedAsOf,
    costBasisUsd,
    proceedsUsd,
    realizedPnlUsd: proceedsUsd - costBasisUsd,
    tierAttribution,
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

export function weightedAverageCost(lots: PositionLot[]): number {
  const totalQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  if (totalQuantity === 0) {
    return 0;
  }
  const totalCost = lots.reduce((sum, lot) => sum + lot.quantity * lot.cost, 0);
  return totalCost / totalQuantity;
}
