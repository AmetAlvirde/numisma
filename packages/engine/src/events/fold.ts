/**
 * Event-sourcing spine — fold.
 *
 * The fold to the read model plus the reserve/tier cash-math seam. `foldEvents`
 * replays the genesis seed plus an ordered event log into a plain
 * {@link FundReviewData}, reusing the whole existing
 * `buildCompositionReport`/dashboard downstream.
 *
 * SINCE ADR-015 THIS IS ALSO THE INGEST GATE'S WORLD. `crossref.ts` no longer mirrors
 * the transitions below — it projects this function's output — so a change here moves
 * what the gate admits, not just what the dashboard shows. `reserveDeltasForOpen` is
 * still exported for the gate's per-Tier sufficiency arithmetic (it prices a debit the
 * fold has not applied yet), but the BALANCES it checks that debit against come from
 * here. See ADR-002 (Tier cost model), ADR-003 and ADR-015.
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
 * closed position's Tier mix (realized gain/loss falls on the same Tier).
 *
 * The split weights by **native** cost (`quantity * cost`), not USD cost. For lots
 * that share one entry FX — every real close today (pure-c1 / USDT `entryFx=1`) —
 * native and USD weights are proportionally identical, so the split is exact. When
 * `buildClosedPosition` reuses this helper to apportion proceeds against USD cost
 * basis, that native-vs-USD basis mismatch is the source of the documented
 * mixed-`entryFx` per-tier caveat; see that helper's note. Totals stay exact. */
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
  // Positions OPENED in this fold whose `markPrice` is still the entry volume-weighted
  // average cost (the "no PriceMarked yet ⇒ value at VWAC" fallback), NOT a real mark.
  // Genesis positions carry a real standing seed mark and are deliberately excluded, so
  // a scale-in never clobbers their mark. A later PriceMarked supersedes the fallback.
  const entryWacFallback = new Set<string>();
  // Closed book + latest invalidation level per position.
  const closedPositions: ClosedPositionRecord[] = [];
  const latestInvalidation = new Map<string, InvalidationLevel>();
  let usdMxn = genesis.review.usdMxn;
  let latestAsOf = genesis.review.asOf;

  // O(1) lookup of an existing close by (instrument, date). Held ALONGSIDE `closes[]`
  // — the array is the output shape and stays exactly as it was — because the
  // `PriceMarked` arm's same-day lookup used to scan the array, one linear pass per
  // mark over a list that grows one entry per mark. On the durable log's real shape
  // (98.5% `PriceMarked`) that made `foldEvents` quadratic, and ADR-015's ingest budget
  // — a fold per accepted event — multiplies it by the batch size. First-write-wins,
  // matching the `find` it replaces: when two closes share a key the earlier entry is
  // the one the arm resolved, and it is the one the map keeps.
  const closesByKey = new Map<string, Close>();
  const closeKey = (instrumentId: string, asOf: string): string => `${instrumentId}|${asOf}`;
  const pushClose = (close: Close): void => {
    closes.push(close);
    const key = closeKey(close.instrumentId, close.asOf);
    if (!closesByKey.has(key)) {
      closesByKey.set(key, close);
    }
  };
  for (const close of closes) {
    const key = closeKey(close.instrumentId, close.asOf);
    if (!closesByKey.has(key)) {
      closesByKey.set(key, close);
    }
  }

  // Seed a t0 baseline Close per genesis-held instrument so the FIRST PriceMarked
  // already yields a 2-point journey (the journey builder skips single anchors).
  // The anchor is the genesis `markPrice`, NOT cost: that keeps it coherent with
  // the authoritative valuation, so no synthetic `markprice-close-mismatch` fires.
  // `costAnchors` below records ONLY the anchors the fold itself minted, so a
  // scale-in can re-price its own baseline and never recorded history.
  //
  // A GENESIS CLOSE SUPPRESSES THE ANCHOR ONLY IF IT IS DATED `review.asOf` OR LATER.
  // A genesis close dated BEFORE the seed is stale history, not the seed's valuation:
  // suppressing the t0 anchor for it made that older price the instrument's latest
  // close, and since ADR-015 the ingest magnitude guard compares against exactly this
  // array — so a seed carrying `markPrice 150 @ 06-01` plus a `40 @ 05-01` close would
  // have judged the next honest 150 mark as a 275% deviation and stalled the price
  // feed. The rule here is the one the deleted shadow applied (seed every held
  // instrument at `review.asOf`; let a genesis close win only from that date on), which
  // is what makes ADR-015's "with the same genesis seeding" claim true.
  //
  // Multiple genesis positions per instrument are NORMAL (the real seed carries three
  // btc and two eth), so the first-position-wins tie-break below is load-bearing, not
  // hypothetical. It is safe because those positions share one instrument-level
  // `markPrice` in the seed — whichever is first mints the same anchor price — and an
  // instrument whose genesis close already covers `review.asOf` mints no anchor at all.
  // ADR-015 made the ingest magnitude guard read THIS array (`buildEventReference`
  // projects `closes[]` into its `lastClose` map), so the fold anchor and the guard's
  // comparison point are the same value by construction, including after a scale-in
  // re-prices the anchor below. What would need revisiting is only a seed whose two
  // positions on one instrument carried DIFFERENT `markPrice`s.
  const seededInstruments = new Set(closes.map((close) => close.instrumentId));
  const genesisCloseCoversReview = new Set(
    (genesis.closes ?? [])
      .filter((close) => close.asOf >= genesis.review.asOf)
      .map((close) => close.instrumentId),
  );
  // The fold-minted cost baseline per instrument (a genesis `markPrice` seed or an
  // entry VWAC), held by reference so a later scale-in can re-price it in place.
  const costAnchors = new Map<string, Close>();
  for (const position of genesis.positions) {
    if (
      !genesisCloseCoversReview.has(position.instrumentId) &&
      !costAnchors.has(position.instrumentId)
    ) {
      seededInstruments.add(position.instrumentId);
      const anchor: Close = {
        instrumentId: position.instrumentId,
        asOf: genesis.review.asOf,
        price: position.markPrice,
      };
      pushClose(anchor);
      costAnchors.set(position.instrumentId, anchor);
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
          // dates and attribute realized P&L per strategy.
          openedAsOf: event.asOf,
          strategy: event.decision.strategy,
        });
        // markPrice above is the entry-VWAC fallback until a real PriceMarked lands.
        entryWacFallback.add(position.id);
        // Drop an entry-price anchor (coherent with the fallback markPrice) so an
        // instrument first held mid-stream also has a baseline for its journey.
        if (!seededInstruments.has(position.instrumentId)) {
          seededInstruments.add(position.instrumentId);
          const anchor: Close = {
            instrumentId: position.instrumentId,
            asOf: event.asOf,
            price: entryPrice,
          };
          pushClose(anchor);
          costAnchors.set(position.instrumentId, anchor);
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
          // Realized P&L: compute proceeds − cost
          // basis, tag it, and push a finished row onto the closed book INSTEAD of
          // silently dropping the position. Descriptive only — the profit already
          // landed in the Reserve above; the blotter records how the fund got here.
          const settlementCurrency =
            reserves.get(event.settlement.reserveId)?.currency ?? closing.currency;
          closedPositions.push(
            buildClosedPosition(closing, closing.lots, event.asOf, event.settlement.proceeds, settlementCurrency, usdMxn),
          );
        }
        positions.delete(event.positionId);
        break;
      }
      case "PositionTrimmed": {
        // Position Trim: remove the named tier quantities from the OPEN position's
        // lots (pro-rata within each tier), credit the settlement Reserve with the
        // proceeds tiered by the REMOVED mix, and emit a PARTIAL realized closed-book
        // row on the trimmed portion sharing the surviving position's id. Sufficiency
        // and the full-retirement REJECT were both proven at ingest, so the position
        // ALWAYS survives here with reduced lots (the fold never deletes on a trim).
        //
        // NAV honesty (R2/M2): conservation is a settle-AT-mark property, NOT an
        // unconditional claim. When the fill lands at the mark the asset removed at
        // mark equals the cash credited and NAV is conserved; an OFF-mark fill is a
        // real realized gain/loss that legitimately moves NAV. The difference is
        // surfaced on the partial row's `markVsFill` disclosure (built below from the
        // latest mark seen so far), never hidden behind a false neutrality claim.
        const trimming = positions.get(event.positionId);
        if (trimming) {
          let working = trimming.lots;
          const removed: PositionLot[] = [];
          for (const removal of event.removals) {
            const split = splitTierRemoval(working, removal.tier, removal.quantity);
            removed.push(...split.removed);
            working = split.remaining;
          }
          const settlementCurrency =
            reserves.get(event.settlement.reserveId)?.currency ?? trimming.currency;
          // The mark the removed units are valued at for the NAV-honesty disclosure:
          // the latest PriceMarked seen so far, else the position's standing mark.
          const markPrice = latestMark.get(trimming.instrumentId) ?? trimming.markPrice;
          applyToReserve(
            reserves,
            event.settlement.reserveId,
            reserveDeltasForClose(removed, event.settlement.proceeds),
          );
          closedPositions.push(
            buildClosedPosition(
              trimming,
              removed,
              event.asOf,
              event.settlement.proceeds,
              settlementCurrency,
              usdMxn,
              true,
              markPrice,
            ),
          );
          trimming.lots = working;
        }
        break;
      }
      case "PositionAddedTo": {
        // Append the new lot preserving its own entryFx/tier — NEVER weighted-average-
        // merged (ADR-002) — and debit the funding Reserve. No realized P&L. Sufficiency
        // was proven at ingest.
        const adding = positions.get(event.positionId);
        if (adding) {
          adding.lots = [...adding.lots, { ...event.lot }];
          // If this position is still on its entry-VWAC fallback (opened this fold, no
          // real mark yet), refresh that fallback to the new blended VWAC so the scale-in
          // preserves the "no mark ⇒ value at VWAC ⇒ entry P&L ≈ 0" invariant. Leaving
          // the stale pre-add average would value the fresh lot against the OLD price and
          // print a fabricated unrealized P&L. A real mark — a genesis seed mark (never
          // in the fallback set) or any PriceMarked — is left untouched.
          if (entryWacFallback.has(adding.id) && !latestMark.has(adding.instrumentId)) {
            const blended = weightedAverageCost(adding.lots);
            adding.markPrice = blended;
            // Move the display-only Close WITH the fallback mark. The open arm seeds
            // the two together; omitting the refresh here left the stale pre-add
            // anchor as the instrument's latest Close and fired a synthetic
            // `markprice-close-mismatch` on a legitimate scale-in (ADR-003 claims that
            // warning cannot fire on the event path).
            //
            // RE-PRICE, never append. The blend is a COST, not a price observed on the
            // add's date: appending it as a fresh dated point drew a spike the market
            // never printed (open 100 → add 150 → mark 105 rendered a 100/150/105
            // journey with a nonsense changeAbs). So the fold edits its OWN cost
            // baseline in place, keeping that anchor's original date — the journey
            // then carries one restated baseline plus the real marks.
            //
            // The anchor is looked up by identity, not by (instrument, date): only
            // anchors this fold minted are in `costAnchors`, so a genesis-provided
            // Close — which wins by rule, see the seeding block above — is never
            // clobbered. No fold anchor (the instrument's baseline came from genesis)
            // means there is nothing this arm may honestly rewrite, so it leaves the
            // display alone; the mark stays authoritative and any resulting divergence
            // is a real one worth warning about.
            const anchor = costAnchors.get(adding.instrumentId);
            if (anchor) {
              anchor.price = blended;
            }
          }
          applyToReserve(
            reserves,
            event.funding.reserveId,
            reserveDeltasForOpen([event.lot], event.funding.amount),
          );
        }
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
      case "PriceMarked": {
        latestMark.set(event.instrumentId, event.price);
        // A MARK OWNS ITS DAY. `latestCloseByInstrument` breaks an equal-`asOf` tie by
        // keeping the FIRST close it sees, so blind-pushing a twin let a stale same-day
        // anchor — an entry/blend cost baseline, or a superseded earlier mark — outrank
        // the mark that actually sets `markPrice`, firing a synthetic
        // `markprice-close-mismatch`. Overwriting instead makes the display agree with
        // valuation by construction, and makes two marks on one day keep the LAST
        // (matching the latest-wins `markPrice`) rather than the first.
        //
        // The lookup goes through `closesByKey`, not a scan of `closes[]`: this arm runs
        // once per mark and the durable log is overwhelmingly marks, so scanning made
        // the whole fold quadratic in its most common event.
        const sameDay = closesByKey.get(closeKey(event.instrumentId, event.asOf));
        if (sameDay) {
          // The overwritten close may BE the fold's cost anchor for this instrument;
          // it stays registered but is unreachable to a later scale-in, which refuses
          // to blend once `latestMark` holds a real mark for the instrument.
          sameDay.price = event.price;
        } else {
          pushClose({ instrumentId: event.instrumentId, asOf: event.asOf, price: event.price });
        }
        if (event.usdMxn !== undefined) {
          usdMxn = event.usdMxn;
        }
        break;
      }
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
      case "ReserveOpened":
        // Birth an EMPTY Reserve. NAV-neutral BY CONSTRUCTION: the event carries no
        // amount and no lots, so there is nothing here that could move the fund — the
        // zero is not a validated default, it is the only value expressible.
        //
        // `lots: []` is deliberate and is NOT the same as omitting `lots`.
        // `applyReserveDelta` early-returns on a falsy `lots` ("untiered: amount is the
        // whole truth"), so a lots-LESS Reserve would swallow the `tier` of every
        // incoming Deposit/Transfer — laundering exactly the provenance the Transfer
        // verb exists to preserve. An EMPTY ARRAY is truthy, so the first credit pushes
        // a real tier lot. Canonical normalization reads length-0 as untiered, so a
        // Reserve that is born and never funded still rolls up correctly.
        //
        // This switch has no `default` and no return obligation: omitting this arm
        // compiles clean and silently drops the Reserve at fold.
        reserves.set(event.reserve.id, { ...event.reserve, amount: 0, lots: [] });
        break;
      default: {
        // EXHAUSTIVENESS LATCH — compile-time first, fail-loud second. The fold's
        // switch has no return obligation, so a forgotten verb used to compile clean
        // and silently drop the event from the fold — the read path, where a dropped
        // event is invisible rather than loud. The `never` ASSIGNMENT is the latch
        // proper and makes verb eleven a COMPILE ERROR here; `pnpm typecheck` is its
        // proof, and no test can reach this arm while the switch stays exhaustive.
        //
        // It THROWS rather than returning, because the only ways here are a cast, a
        // hand-rolled event object, or a `@ts-expect-error` — and `return _never`
        // then handed `foldEvents`'s callers `undefined`, so the TUI, the web push
        // and the daily price-feed job would each die on an opaque property access
        // far from the cause. Naming the verb at the point of failure is ADR-003's
        // fail-loud posture applied to the one path type-checking cannot cover.
        const _never: never = event;
        throw new Error(
          `foldEvents reached its exhaustiveness latch on event type ` +
            `'${(_never as PortfolioEvent).type}'. A verb exists that this fold does not ` +
            `handle — add its arm to the switch above.`,
        );
      }
    }
  }

  // Apply the latest mark per instrument, and the latest invalidation level per
  // position, to every surviving Position.
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
 * Build one closed-book row at close time.
 * Realized Trading P&L = proceeds(USD) − Σ(lot USD cost at its entryFx) — one blended
 * number, FX gain/loss baked in (ADR-002's FX-P&L deferral). The per-Tier split
 * mirrors the cash leg: proceeds are apportioned across the closed position's cost-
 * basis Tier mix (`reserveDeltasForClose`), cost basis is grouped by the same Tiers,
 * and realized per Tier is the difference — so the gain/loss falls on the Tier it was
 * risked on. Pure.
 *
 * MIXED-`entryFx` PER-TIER CAVEAT (documented, not fixed — see PRD #90 "Out of
 * Scope"). Cost basis below is grouped by Tier in **USD** (each lot at its own
 * `entryFx`), but proceeds are apportioned by `reserveDeltasForClose`, which weights
 * by **native** cost. When a position's lots share one entry FX (all real closes
 * today — pure-c1 / USDT `entryFx=1`) the two bases are proportionally identical and
 * the per-Tier split is exact. When lots carry *different* entry FX the per-Tier
 * split can drift a few cents between Tiers, but `realizedPnlUsd` and every rollup
 * TOTAL stay exact (the drift only moves cents across Tiers, never off the total).
 * A basis-consistent per-Tier fix is deliberately out of boundary here.
 */
function buildClosedPosition(
  closing: PositionRecord,
  lots: PositionLot[],
  closedAsOf: string,
  proceedsNative: number,
  settlementCurrency: PositionRecord["currency"],
  reviewFx: number,
  partial = false,
  markPrice?: number,
): ClosedPositionRecord {
  const proceedsUsd = toUsd(proceedsNative, settlementCurrency, reviewFx);

  // Cost basis in USD, per Tier: each lot converts at its own entry FX (ADR-002).
  // `lots` is the CLOSED subset — the whole position on a full close, or just the
  // removed lots on a partial trim (which preserve their blended entryFx/tier).
  const costUsdByTier = new Map<CapitalTier, number>();
  let costBasisUsd = 0;
  for (const lot of lots) {
    const lotCostUsd = toUsd(lot.quantity * lot.cost, closing.currency, lot.entryFx ?? reviewFx);
    costUsdByTier.set(lot.tier, (costUsdByTier.get(lot.tier) ?? 0) + lotCostUsd);
    costBasisUsd += lotCostUsd;
  }

  // Proceeds (USD) apportioned across the same Tier mix the cash leg credited.
  // The apportionment weights by NATIVE cost (see `reserveDeltasForClose`), which
  // differs from the USD-cost grouping above only when lots carry mixed entry FX —
  // the documented per-Tier caveat in this function's doc comment. Totals stay exact.
  const proceedsByTier = new Map<CapitalTier, number>();
  for (const delta of reserveDeltasForClose(lots, proceedsUsd)) {
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

  // NAV-honesty disclosure (R2/M2), partial rows only: value the removed units at the
  // latest mark and surface the fill-vs-mark delta. `deltaUsd ≈ 0` ⇒ settle-at-mark
  // (NAV conserved); `deltaUsd ≠ 0` ⇒ an off-mark fill that legitimately moved NAV.
  const markVsFill =
    partial && markPrice !== undefined
      ? (() => {
          const removedQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
          const markValueUsd = toUsd(removedQuantity * markPrice, closing.currency, reviewFx);
          return { markValueUsd, proceedsUsd, deltaUsd: proceedsUsd - markValueUsd };
        })()
      : undefined;

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
    ...(partial ? { partial: true } : {}),
    ...(markVsFill ? { markVsFill } : {}),
  };
}

/**
 * THE PARTIAL-REMOVAL SEAM. Take `quantity` out of the lots that belong to `tier`,
 * PRO-RATA across those lots
 * by their own quantity — so a removal preserves each lot's blended entryFx/cost
 * attribution rather than picking one lot arbitrarily. Returns the removed sub-lots
 * (each a copy carrying its parent's cost/entryFx/tier) and the surviving lots
 * (untouched lots plus the shrunk remainders). Lot order is preserved. The last
 * in-tier lot absorbs the float residual so `Σ removed.quantity === quantity` exact,
 * mirroring {@link tierWeightedDeltas}. Pure. The caller guarantees sufficiency
 * (the cross-ref position-lot gate); a degenerate empty tier is a safe no-op.
 */
export function splitTierRemoval(
  lots: PositionLot[],
  tier: CapitalTier,
  quantity: number,
): { removed: PositionLot[]; remaining: PositionLot[] } {
  const inTier = lots.filter((lot) => lot.tier === tier);
  const tierTotal = inTier.reduce((sum, lot) => sum + lot.quantity, 0);
  const removed: PositionLot[] = [];
  const remaining: PositionLot[] = [];
  if (tierTotal === 0) {
    return { removed, remaining: lots.map((lot) => ({ ...lot })) };
  }
  let allocated = 0;
  let seenInTier = 0;
  for (const lot of lots) {
    if (lot.tier !== tier) {
      remaining.push({ ...lot });
      continue;
    }
    const isLast = seenInTier === inTier.length - 1;
    seenInTier += 1;
    const take = isLast ? quantity - allocated : (quantity * lot.quantity) / tierTotal;
    allocated += take;
    removed.push({ ...lot, quantity: take });
    const left = lot.quantity - take;
    if (left > 1e-12) {
      remaining.push({ ...lot, quantity: left });
    }
  }
  return { removed, remaining };
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
