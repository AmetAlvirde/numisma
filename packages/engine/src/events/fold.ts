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
  FoldedReview,
  FoldSkipReason,
  FundReviewData,
  InvalidationLevel,
  PositionLot,
  PositionRecord,
  RealizedTierAttribution,
  ReserveRecord,
  SkippedFoldEvent,
} from "../contracts.js";
import { toUsd } from "../internal.js";
import type { PortfolioEvent, TierDelta } from "./types.js";

const TIERS: CapitalTier[] = ["c1", "c2", "c3"];

/**
 * FIXED PROSE PER REASON — one string per member of the closed vocabulary, chosen
 * once here rather than composed at each site. Two properties are load-bearing and
 * are pinned by test: no substring of event content (no id, no verb, no target id)
 * and NO FIGURE OF ANY KIND. These lines reach the unattended daily surface and the
 * interactive enumeration; a figure in the prose would put fund detail on channels
 * whose whole value is that they stay stable and quotable. The verb rides its own
 * field on the record, so a reader loses nothing.
 */
const SKIP_DETAIL: Record<FoldSkipReason, string> = {
  "position-absent":
    "The fold has no record of this event's target position — it was never opened in " +
    "this window, or it was already retired — so the event was read and then dropped. " +
    "No state moved.",
  // BOTH CASH-LEG REASONS SAY "THE EVENT", NOT "THE LEG" (#371). The fold drops the
  // whole event on either, so prose naming only the leg understated the discard on
  // exactly the arms where the rest of the event used to carry on.
  //
  // "a reserve" rather than "the reserve": a Transfer names two, and either one being
  // absent raises this.
  "reserve-absent":
    "The fold has no record of a reserve this event's cash leg names, so the event was " +
    "read and then dropped. No state moved.",
  "provenance-absent":
    "This event's cash leg has no cost-basis provenance to inherit — the fold has no " +
    "lots to attribute it across — so the event was read and then dropped. No state moved.",
};

/**
 * Distinct skips by (`eventId`, `reason`), in first-appearance order — the Discard
 * Channel's dedup key (ADR-020; PRD #323 R5).
 *
 * IT EXISTS BECAUSE THE FOLD IS RE-RUN, NOT BECAUSE LISTS ARE LONG. Any caller that
 * folds the same log more than once per run sees the same standing drop once per fold:
 * `walkPendingInbox` re-folds on every accept (ADR-015), so a 13-event batch is 14 folds
 * and one dropped prior arrives 14 times; the legacy migration folds once per line. That
 * is one FINDING reported N times, and N is an artifact of the caller's loop rather than
 * anything about the log. Deduping is therefore structural — without it, an operator
 * counts folds and believes they are counting damage.
 *
 * THE KEY IS THE PAIR, never the id alone: one event can be dropped for two different
 * reasons and that is two findings. A `Transfer` whose BOTH legs name absent reserves is
 * one event dropped twice for ONE reason and collapses to one finding, correctly.
 *
 * FIRST APPEARANCE WINS, so the fold's own deterministic ordering (application order,
 * with the post-loop invalidation records appended) survives the dedup. Pure; the input
 * is never mutated.
 */
export function dedupeFoldSkips(skipped: readonly SkippedFoldEvent[]): SkippedFoldEvent[] {
  const seen = new Set<string>();
  const distinct: SkippedFoldEvent[] = [];
  for (const skip of skipped) {
    const key = `${skip.eventId} ${skip.reason}`;
    if (!seen.has(key)) {
      seen.add(key);
      distinct.push(skip);
    }
  }
  return distinct;
}

/** Cost-basis weight of each Tier in a position's lots (the provenance the cash
 * leg inherits). Returns signed `amount` per present Tier summing exactly to
 * `total`, with any float residual folded into the last Tier so the reserve's
 * authoritative `amount` lands exact.
 *
 * ZERO-COST LOTS get one delta, not a split: with every cost weight zero there is
 * no cost-basis weight to split by, so the whole delta lands on the canonically
 * first Tier that holds a lot (#329).
 *
 * NO LOTS AT ALL RETURNS AN EMPTY LIST — the leg has no provenance to inherit, so
 * there is nothing to attribute and the caller must discard it (#329). */
function tierWeightedDeltas(lots: PositionLot[], total: number, sign: 1 | -1): TierDelta[] {
  const costByTier = new Map<CapitalTier, number>();
  let totalCost = 0;
  for (const lot of lots) {
    const cost = lot.quantity * lot.cost;
    costByTier.set(lot.tier, (costByTier.get(lot.tier) ?? 0) + cost);
    totalCost += cost;
  }
  const present = TIERS.filter((tier) => costByTier.has(tier));
  if (present.length === 0) {
    // NO LOTS ⇒ NO PROVENANCE ⇒ NO DELTA. Any lot at all puts a key in `costByTier`,
    // so this arm is reachable only when `lots` is empty. It used to return
    // `[{ tier: lots[0]?.tier ?? "c1", … }]`, which — the `lots[0]` being undefined by
    // construction — ALWAYS took the `?? "c1"` fallback and minted a full-magnitude c1
    // delta for a cash movement carrying no provenance whatsoever; `applyToReserve`
    // then booked it as real c1 capital. Not a bad attribution: an invented one. The
    // empty list is the discard, and the caller records it (#329).
    return [];
  }
  if (totalCost === 0) {
    // Zero-cost lots: no cost-basis weight to split by, so the whole delta goes to
    // `present[0]` — the canonically first Tier holding a lot, in c1/c2/c3 order.
    // Keying on `lots[0].tier` instead made attribution depend on ARRAY INSERTION
    // ORDER, so two callers with the same lots ordered differently credited
    // different Tiers (#329). An even split across `present` was rejected: with
    // every weight zero it would invent a weighting the data does not carry.
    // `present[0]` is order-independent and matches the old answer whenever
    // exactly one Tier holds lots — the common shape.
    return [{ tier: present[0]!, amount: sign * total }];
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
 * position lots' own Tiers (each Tier pays for what it bought).
 *
 * RETURNS `[]` FOR A LOT-LESS OPEN — no lots, no provenance, nothing to attribute.
 * Callers must treat the empty list as a discard, never as a no-op worth booking. */
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
 * mixed-`entryFx` per-tier caveat; see that helper's note. Totals stay exact.
 *
 * RETURNS `[]` FOR A LOT-LESS CLOSE — no lots, no provenance, nothing to attribute.
 * Callers must treat the empty list as a discard, never as a no-op worth booking. */
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
 *
 * THE RETURN IS AN ENVELOPE, NOT THE READ MODEL (PRD #323, implementing #293).
 * `{data, skipped}`: `data` is exactly what this function has always returned, and
 * `skipped` is every event the fold read and then could not apply — a target position
 * or a cash-leg reserve it has no record of. Before the envelope, such an event was
 * indistinguishable from one that was never written. This is the Discard Channel:
 * REPORT, NEVER REFUSE. A dropped event never fails the fold, and the fold never
 * decides what the drop means — the locator (`eventId` + input `index`) goes to whoever
 * can judge. It never extinguishes either: the log is append-only, so a fold diagnostic
 * is a standing fact rather than an errand.
 */
export function foldEvents(
  genesis: FundReviewData,
  events: PortfolioEvent[],
  asOf?: string,
): FoldedReview {
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
  // Latest-wins per position. The VALUE CARRIES THE MARKING EVENT'S LOCATOR alongside
  // the level, because `InvalidationMarked` is the one drop kind with no branch to hang
  // a diagnostic on — it is detected after the loop, BY ABSENCE, and by then the event
  // itself is long out of scope. Latest-wins keeps the latest marker's locator. The
  // `asOf` rides along for the same reason: the post-loop pass dates the mark against
  // its target's retirement date, and that comparison is unmakeable from the level.
  const latestInvalidation = new Map<
    string,
    { level: InvalidationLevel; eventId: string; index: number; asOf: string }
  >();
  const skipped: SkippedFoldEvent[] = [];
  /** Record one drop with the event's own locator. Never refuses, never throws. */
  const recordSkip = (event: PortfolioEvent, index: number, reason: FoldSkipReason): void => {
    skipped.push({
      eventId: event.id,
      index,
      verb: event.type,
      reason,
      detail: SKIP_DETAIL[reason],
    });
  };
  /**
   * Apply one LOT-DERIVED cash leg. RETURNS WHETHER THE REST OF THE EVENT MAY RUN.
   *
   * THE DISCARD IS TOTAL, WHICH IS WHY THIS IS A GATE AND NOT A VOID CALL. A cash leg
   * the fold cannot apply — for EITHER reason it can report — drops the whole event:
   * no closed-book row, no retirement, no lot mutation, no registration. `false` means
   * the arm must do nothing at all.
   * Recording the drop and then letting the arm carry on would raise realized P&L by
   * the full proceeds while crediting NO reserve — the cash would simply vanish, which
   * is strictly worse than the invented-`c1` attribution this replaced (that at least
   * conserved the money). The `position-absent` `else` branches in these same arms
   * already discard the whole event; this is deliberately the SAME semantics, not a
   * second kind of discard.
   *
   * PRECEDENCE IS A DECISION: `provenance-absent` wins and the reserve is never
   * consulted. With no deltas there is nothing to apply, so whether the reserve exists
   * is moot — recording `reserve-absent` as well would report a reserve miss that never
   * happened. One event, one finding, on this path.
   *
   * AND THE COST IS MEASURABLE, NOT MERELY SEMANTIC: `dedupeFoldSkips` keys on
   * (`eventId`, `reason`), so two reasons for one event are two DISTINCT records that
   * both survive dedupe — inflating `discardedEventCount` and emitting two
   * `formatFoldDiscards` lines for a single drop. The channel would over-report the
   * very thing it exists to report exactly once.
   *
   * A RESERVE MISS IS ALSO A TOTAL DISCARD and returns `false` (#371). It did not use
   * to: a missing reserve let the arm carry on, so a close booked its row and retired
   * the position, a trim booked its partial row and mutated the lots, an open
   * registered a position, and an add grew one — every one of them against a reserve
   * that never moved. The vocabulary said `reserve-absent` at four other sites where
   * it meant "nothing applied", and nothing in the type or the prose told a reader
   * which sense was in force. Both gates now mean the same thing, so the reason codes
   * describe WHAT WAS MISSING and the fold's answer to any of them is uniform.
   *
   * Reachability is unchanged and remains migration-shaped: the cross-ref existence
   * gate rejects an unknown reserve before the fold ever runs, so on the gated path a
   * reserve miss cannot happen. It is reachable through callers that fold the durable
   * log directly, bypassing both gates — `loadFoldedReview` in `event-store.ts`.
   *
   * Only lot-derived legs route through here. The explicit-tier legs (`Deposit`,
   * `Withdraw`, both `Transfer` legs) call `applyToReserve` directly: their tiers come
   * from the event itself rather than from lots, so they have no provenance that could
   * be missing, and routing them here would imply a discard that cannot occur.
   */
  const applyTieredLeg = (
    reserveId: string,
    deltas: TierDelta[],
    event: PortfolioEvent,
    order: number,
  ): boolean => {
    if (deltas.length === 0) {
      recordSkip(event, order, "provenance-absent");
      return false;
    }
    if (!applyToReserve(reserves, reserveId, deltas)) {
      recordSkip(event, order, "reserve-absent");
      return false;
    }
    return true;
  };
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

  // `order` is the event's 0-BASED INDEX IN THE CALLER'S ARRAY, not its position in
  // this sorted view — it is the locator half a reader uses to find the line, so it must
  // survive the sort.
  for (const { event, order } of applicable) {
    if (event.asOf > latestAsOf) {
      latestAsOf = event.asOf;
    }
    switch (event.type) {
      case "PositionOpened": {
        const { position } = event;
        // Cash leg FIRST, because it gates the arm. Sufficiency was proven at ingest.
        // A lot-less open has no provenance for the debit to inherit, and the discard
        // is total: no registration, no cost anchor, no entry-VWAC fallback mark. The
        // reserve and the position/close maps are disjoint, so hoisting the leg above
        // the registration changes nothing an observer can see on the applying path —
        // it only makes the drop able to stop the arm before it starts.
        if (
          !applyTieredLeg(
            event.funding.reserveId,
            reserveDeltasForOpen(position.lots, event.funding.amount),
            event,
            order,
          )
        ) {
          break;
        }
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
        break;
      }
      case "PositionClosed": {
        const closing = positions.get(event.positionId);
        if (!closing) {
          recordSkip(event, order, "position-absent");
          break;
        }
        // Cash leg: credit the settlement reserve with proceeds, tiered by the
        // closed position's mix, BEFORE retiring the asset leg. Honest-by-
        // construction: the asset cannot be removed without recording the cash.
        //
        // AND IT GATES THE REST OF THE ARM. A lot-less position has no provenance for
        // the proceeds to inherit, so the close is discarded WHOLE — the position stays
        // open, no row is booked, nothing is retired. Booking the row while the cash
        // leg dropped would raise realized P&L by the full proceeds against a reserve
        // that never moved: the R8 failure below, in its other direction.
        if (
          !applyTieredLeg(
            event.settlement.reserveId,
            reserveDeltasForClose(closing.lots, event.settlement.proceeds),
            event,
            order,
          )
        ) {
          break;
        }
        // Realized P&L: compute proceeds − cost
        // basis, tag it, and push a finished row onto the closed book INSTEAD of
        // silently dropping the position. Descriptive only — the profit already
        // landed in the Reserve above; the blotter records how the fund got here.
        const settlementCurrency =
          reserves.get(event.settlement.reserveId)?.currency ?? closing.currency;
        closedPositions.push(
          buildClosedPosition(closing, closing.lots, event.asOf, event.settlement.proceeds, settlementCurrency, usdMxn),
        );
        // R8 (ledger item 19): THE DELETE LIVES INSIDE THE APPLYING PATH, not after the
        // block — reached only once BOTH gates above have passed. The arm is a clean
        // pair: either the close applies IN FULL (cash leg, closed-book row,
        // retirement) or it is recorded as discarded and NOTHING happens. Announcing
        // the drop and then acting on its behalf — pushing the row, retiring the asset
        // — is the shape this guards against, whichever gate did the announcing.
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
          // Cash leg, AND the gate on the rest of the arm. `splitTierRemoval` yields no
          // removed lots when the removal names a tier the position holds nothing in, so
          // the proceeds have no provenance to inherit and the trim is discarded WHOLE:
          // no partial row, and `trimming.lots` is left exactly as it was. Pushing the
          // row while the credit dropped would book realized P&L against a reserve that
          // never moved; mutating the lots on top of that would retire the asset for
          // cash the fund never received.
          if (
            !applyTieredLeg(
              event.settlement.reserveId,
              reserveDeltasForClose(removed, event.settlement.proceeds),
              event,
              order,
            )
          ) {
            break;
          }
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
        } else {
          recordSkip(event, order, "position-absent");
        }
        break;
      }
      case "PositionAddedTo": {
        // Append the new lot preserving its own entryFx/tier — NEVER weighted-average-
        // merged (ADR-002) — and debit the funding Reserve. No realized P&L. Sufficiency
        // was proven at ingest.
        const adding = positions.get(event.positionId);
        if (adding) {
          // CASH LEG FIRST, BECAUSE IT GATES THE ARM — the same hoist the open arm
          // makes, for the same reason (#371). `provenance-absent` still cannot fire
          // here: `[event.lot]` is a one-element array literal, so
          // `reserveDeltasForOpen` always yields exactly one delta. `reserve-absent`
          // CAN, and it is why the leg moved above the append and why the return is
          // now honored rather than ignored. Appending the lot and then dropping the
          // debit grew the position by a lot no reserve paid for — the fund gained an
          // asset for free, which is NAV invention rather than mere misattribution.
          //
          // The deltas do not read `adding.lots`, only `event.lot`, so the hoist
          // changes nothing an observer can see on the applying path.
          //
          // It stays routed through the gate rather than calling `applyToReserve`
          // directly because this IS a lot-derived leg: its tier comes from
          // `event.lot.tier`, so it belongs on the lot-derived path by kind, not by
          // whether today's argument happens to be non-empty. The explicit-tier path
          // would quietly lose the provenance check the day this site learns to add
          // more than one lot.
          if (
            !applyTieredLeg(
              event.funding.reserveId,
              reserveDeltasForOpen([event.lot], event.funding.amount),
              event,
              order,
            )
          ) {
            break;
          }
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
        } else {
          recordSkip(event, order, "position-absent");
        }
        break;
      }
      case "InvalidationMarked":
        // Latest-wins per position: record the newest structured level; it is
        // applied to the surviving position after the fold, alongside the mark.
        latestInvalidation.set(event.positionId, {
          level: { price: event.price, direction: event.direction },
          eventId: event.id,
          index: order,
          asOf: event.asOf,
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
        if (!applyToReserve(reserves, event.reserveId, [{ tier: event.tier, amount: event.amount }])) {
          recordSkip(event, order, "reserve-absent");
        }
        break;
      case "Withdraw":
        if (!applyToReserve(reserves, event.reserveId, [{ tier: event.tier, amount: -event.amount }])) {
          recordSkip(event, order, "reserve-absent");
        }
        break;
      case "Transfer": {
        // BOTH LEGS OR NEITHER (#371). A Transfer names two reserves and moves one
        // amount between them, so a missing reserve on either side means the movement
        // cannot complete. This arm USED TO apply each leg independently and report per
        // leg, which let a Transfer whose destination was absent still debit the source:
        // cash left and never arrived, and the reserves were left quietly unbalanced.
        // That is the silent-and-unbalanced state the Discard Channel exists to end, not
        // a state worth reaching in order to report it. So both reserves are checked
        // BEFORE either leg applies, and a miss applies neither.
        //
        // ONE RECORD PER EVENT, not per leg. `dedupeFoldSkips` keys on
        // (`eventId`, `reason`), so two `reserve-absent` records for a single Transfer
        // would BOTH survive dedupe — inflating `discardedEventCount` and emitting two
        // `formatFoldDiscards` lines for one drop. The channel would over-report the
        // very thing it exists to report exactly once. This is the same precedence
        // reasoning `applyTieredLeg` makes for `provenance-absent` over `reserve-absent`.
        //
        // The existence check is deliberately separate from `applyToReserve`'s own
        // boolean: that boolean reports whether a leg APPLIED, and by the time it could
        // answer for the second leg the first has already moved.
        if (!reserves.has(event.fromReserveId) || !reserves.has(event.toReserveId)) {
          recordSkip(event, order, "reserve-absent");
          break;
        }
        applyToReserve(reserves, event.fromReserveId, [{ tier: event.tier, amount: -event.amount }]);
        applyToReserve(reserves, event.toReserveId, [{ tier: event.tier, amount: event.amount }]);
        break;
      }
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
      position.invalidation = { ...invalidation.level };
    }
  }

  // KIND 5, DETECTED BY ABSENCE. `InvalidationMarked` sets a key and moves no state, so
  // unlike the other four drops it has no branch to hang a diagnostic on: the arm above
  // cannot tell a mark on a live position from a mark on a position that never existed.
  // The only place the difference is visible is here, after the loop.
  //
  // THE TEST IS "ABSENT FROM BOTH BOOKS", AND THAT IS THE WHOLE POINT. The naive form —
  // keys absent from the surviving `positions` map — false-positives on every position
  // that carried a mark and was then LEGITIMATELY CLOSED: the mark sets the key, the
  // close deletes the position, and this loop sees only survivors. That alarm would
  // print daily, forever, on a fund doing nothing wrong, and a channel that cries wolf
  // is worth less than no channel. An id in NEITHER the surviving positions NOR the
  // closed book never had a target in this fold at all.
  //
  // A CLOSED ID IS NOT AUTOMATICALLY INNOCENT (#297). "In the closed book" answers only
  // that the id existed; it does not answer whether the MARK found it. Dating the mark
  // against the retirement date does, and exactly — not by heuristic:
  //   • mark BEFORE the retiring close  → applied while the position was live. No drop.
  //   • mark AFTER  the retiring close  → landed on an id the fold had already deleted.
  //     The level vanished, and because an `InvalidationMarked` moves no observable
  //     state, NOTHING ELSE anywhere can say so. Unobservable is the reason to report
  //     it, not the reason to stay quiet.
  // Both operands are state this pass already holds, which is what makes this a decision
  // rather than an inference — and what keeps it clear of the cry-wolf failure above.
  //
  // RESIDUALS, NAMED AND ACCEPTED — TWO drops still pass this pass in silence. Detection
  // here is deliberately only the exactly-decidable sub-case (#297); these two are not it,
  // and naming them is the point. Widening to cover either is #329's business, not this
  // pass's — but the comment must not assert a boundary the code does not hold.
  //
  //   1. A SUPERSEDED POST-RETIREMENT MARK. `latestInvalidation` is latest-wins per
  //      position (A3's documented property), so when two marks both land after the
  //      close only the later one is even visible here. The earlier one was dropped by
  //      the fold and leaves no record at all — one drop reported, two drops taken.
  //   2. THE SAME-DATE TIE: a mark dated ON its position's retirement date. The fold
  //      breaks an equal-`asOf` tie by log index, so this IS decidable — and, to be
  //      exact about why it is nevertheless undecided: the index is not missing state.
  //      `order` is in scope in the `PositionClosed` arm above, right where the row is
  //      pushed; carrying it in a fold-local map instead of re-deriving retirement from
  //      `closedPositions` after the loop would settle the tie outright. What is missing
  //      is only the CLOSED BOOK's carriage of it — a consequence of where this
  //      derivation is SITED, a choice, not a constraint that binds this function.
  //      Rather than widen the ruled sub-case, the comparison stays STRICTLY later and
  //      the tie stays silent.
  //
  // Every other same-day sibling verb (close, trim, add on the retired id) is caught by
  // the arms above; these two are the honest edge of detect-by-date.
  const closedBookIds = new Set(closedPositions.map((record) => record.positionId));
  // Retirement dates, from the FULL-close rows only — a partial row is a trim, and the
  // fold never deletes on a trim. LATEST wins: an id that is absent from `positions` at
  // the end of the fold was retired by its LAST full close, so that is the date "was the
  // position still live?" has to be asked against.
  //
  // DO NOT "ALIGN" THIS WITH `crossReferenceInvalidation`'s `closedPositionAsOf`
  // (`crossref.ts`, A2), which is EARLIEST-wins. The two maps look alike and answer
  // opposite questions, so harmonising them would break one of them:
  //   • A2 is a GATE looking FORWARD — "from what date on is this id retired, so which
  //     incoming verbs must I refuse?" Earliest is the conservative bound there; it errs
  //     toward REFUSING, which is the safe direction for a gate.
  //   • This is a REPORT looking BACKWARD — "on the mark's date, was the id already
  //     gone for good?" Earliest errs toward ALARMING here: on a reused id (closed,
  //     reopened, closed again — two full-close rows) a mark placed during the SECOND
  //     live period post-dates the FIRST close and would be reported as a drop, flatly
  //     contradicting this pass's own rule that a mark applied while the position was
  //     live is no drop. That is the cry-wolf failure the guard above exists to prevent.
  // Latest-wins errs the other way — a mark landing in the dead gap between two live
  // periods stays silent — which is a miss, not a false alarm, and this channel is built
  // to prefer silence over crying wolf. A gated log cannot produce two full-close rows
  // for one id (`crossReferenceOpen` refuses a duplicate id), but ungated `foldEvents`
  // callers — the legacy migration and pre-rule history — can, and they are exactly the
  // population this channel exists for.
  const retiredAsOf = new Map<string, string>();
  for (const record of closedPositions) {
    if (record.partial) continue;
    const existing = retiredAsOf.get(record.positionId);
    if (existing === undefined || record.closedAsOf > existing) {
      retiredAsOf.set(record.positionId, record.closedAsOf);
    }
  }
  const orphanedMarks = [...latestInvalidation.entries()]
    .filter(([positionId, mark]) => {
      if (positions.has(positionId)) return false;
      if (!closedBookIds.has(positionId)) return true;
      const retired = retiredAsOf.get(positionId);
      return retired !== undefined && mark.asOf > retired;
    })
    .map(([, mark]) => mark)
    // Appended AFTER the in-loop records (they are found after the loop), ordered among
    // themselves by input index — deterministic without pretending to an application
    // order this pass never observed.
    .sort((a, b) => a.index - b.index);
  for (const mark of orphanedMarks) {
    skipped.push({
      eventId: mark.eventId,
      index: mark.index,
      verb: "InvalidationMarked",
      reason: "position-absent",
      detail: SKIP_DETAIL["position-absent"],
    });
  }

  // Deep-clone the shared genesis sub-objects so the fold output is fully
  // independent of the immutable seed: `positions`, `closes`, and `reserves` are
  // already freshly built above (reserves cloned per-record then mutated by the
  // cash legs), but `fund`/`portfolios`/`accounts`/`instruments` would otherwise be
  // shared by reference via the seed.
  return {
    data: {
      fund: structuredClone(genesis.fund),
      review: { asOf: asOf ?? latestAsOf, usdMxn },
      portfolios: structuredClone(genesis.portfolios),
      accounts: structuredClone(genesis.accounts),
      instruments: structuredClone(genesis.instruments),
      reserves: [...reserves.values()],
      positions: [...positions.values()],
      closes,
      closedPositions,
    },
    skipped,
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
 *
 * RETURNS WHETHER IT APPLIED. A missing reserve is still a no-op on the read model —
 * the cross-ref existence gate rejects an unknown reserve before the fold ever runs,
 * for everything that arrived through the gate — but it is no longer a SILENT one.
 * The boolean is how the helper signals its miss back to the calling arm, which owns
 * the event and therefore owns the locator; the helper itself sees only a reserve id
 * and could not name the event that named it. Every one of the eight call sites —
 * open funding, close settlement, trim settlement, add funding, `Deposit`, `Withdraw`,
 * and BOTH `Transfer` legs — must record on a `false`, one record per miss. */
function applyToReserve(
  reserves: Map<string, ReserveRecord>,
  reserveId: string,
  deltas: TierDelta[],
): boolean {
  const reserve = reserves.get(reserveId);
  if (!reserve) {
    return false;
  }
  applyReserveDelta(reserve, deltas);
  return true;
}

export function weightedAverageCost(lots: PositionLot[]): number {
  const totalQuantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  if (totalQuantity === 0) {
    return 0;
  }
  const totalCost = lots.reduce((sum, lot) => sum + lot.quantity * lot.cost, 0);
  return totalCost / totalQuantity;
}
