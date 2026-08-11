/**
 * THE FILL PATH RECONCILIATION (#287) — every spot-independent conclusion the Fill Path
 * surface renders, in ONE pure function: declared rungs × the order stream × the recorded
 * lots.
 *
 * WHY IT LIVES AT THE ENGINE'S TOP LEVEL, BESIDE `plans.ts`, AND NOT IN `compose/`. The
 * placement rule is mechanical: this module imports no `FundReviewData`. It reconciles a
 * declaration against a stream and a set of lots — three things a fund review does not have
 * to exist for — so putting it behind the review's own data shape would make the TUI's later
 * read of it require a fund review it does not want.
 *
 * SPOT IS NOT AN INPUT, IN ANY FORM. The two spot-dependent decorations (the `next` marker
 * and the passed-rung flag) are the web view module's, computed at render. Admitting a
 * moving value here would put the clock inside a historical conclusion: the same events
 * would reconcile differently at 09:00 and at 17:00, and nothing on the surface would say so.
 *
 * PURE (ADR-001): no IO, no clock, no `Date`, no FX lookup. `reviewFx` is a PARAMETER —
 * a rate fetched in here would make the output depend on when it was asked.
 */
import type { Currency, PositionLot } from "./contracts.js";
import { toUsd } from "./internal.js";
import type { TornFillAct } from "./orders/fill.js";
import type { OrderPlacedRecord, OrderRecord } from "./orders/records.js";
import { proposeRungByPrice, type InForceLadder } from "./orders/rung-picks.js";
import { bookedFills, foldOrderStream } from "./orders/select.js";
import type { DcaLadderPlanRecord, DcaRung } from "./plans.js";

/**
 * WHAT THE VENUE SHOWED about a declared rung — folded from the placement line's own
 * `observedFilledQuantity`, every later `orderFillObserved`, and every `orderFilled`, on the
 * one cumulative baseline `orders/select.ts` maintains.
 *
 * `not-placed` is a fact about the FUND, not the venue: the ladder declares the rung and no
 * order was ever placed for it (or the one that was has since been cancelled off the book).
 * That row is the reason a ladder is legible on day zero, when nothing else is.
 */
export type FillVenueAxis = "not-placed" | "resting" | "partly-filled" | "filled";

/**
 * WHAT THE FUND RECORDED — folded from `orderFilled` lines ONLY, because only those have a
 * lot and a cash leg answering for them.
 *
 * MEASURED AGAINST WHAT THE VENUE SHOWED, not against the placed quantity. "The venue filled
 * three of ten and the fund booked all three" is fully recorded; comparing against ten would
 * report a phantom gap on every partial. The gap between THIS axis and {@link FillVenueAxis}
 * is the unrecorded-fill list, as a fact rather than an inference — which is precisely why
 * the two are never collapsed into one state word.
 */
export type FillBookAxis = "not-recorded" | "partly-recorded" | "recorded";

/**
 * How the rung and the order found each other. Carried per rung so the consumer can show
 * its own confidence rather than inheriting ours.
 *
 * `price-matched` is PERMANENT, not transitional: `planId`/`rungId` are optional on
 * `orderPlaced` forever, so a line that carries neither can always recur.
 */
export type RungJoinProvenance = "declared" | "price-matched";

/** The one word an orphan lot carries; see {@link FillPathOrphan}. */
export const ORPHAN_LABEL = "orphan";

/** One declared rung, with both axes and the join that produced them. */
export interface FillPathRung {
  rung: DcaRung;
  venueAxis: FillVenueAxis;
  bookAxis: FillBookAxis;
  /** The rendered word(s) for the two axes together — a convenience, never the contract. */
  label: string;
  /** Absent when no order joined to this rung at all. */
  joinProvenance?: RungJoinProvenance;
  orderId?: string;
  orderPriceUsd?: number;
  /**
   * A DECLARED join whose order price differs from the rung's declared price. HONORED, and
   * flagged: the operator knew something the price match did not — a rung re-placed a tick
   * away, a partial re-entered at the venue. Never a refusal.
   */
  declaredPriceMismatch: boolean;
  placedQuantity?: number;
  venueConsumedQuantity: number;
  bookedQuantity: number;
  /**
   * MEASURED as `consumed / placedQuantity`, never guessed, and not a fourth state — the
   * percentage decorates `partly-filled`, it does not replace it. Absent with no order.
   */
  venueFilledFraction?: number;
  /** Whether the order is still claiming capital: `quantity − consumed > 0`. */
  resting: boolean;
}

/** A recorded lot that no declared rung explains. Reported, never dropped or forced. */
export interface FillPathOrphan {
  lot: PositionLot;
  label: typeof ORPHAN_LABEL;
}

/**
 * ABSENT, NEVER ZERO, for the three measured figures. A recorded fill has cost > 0 and
 * quantity > 0 by construction, so a `0` in any of them would be a bug rather than a fact —
 * and the gate below makes that unrepresentable instead of merely stated.
 *
 * The two waiting figures are always present: zero waiting capital is a real answer.
 */
export interface FillPathFigures {
  deployedUsd?: number;
  unitsAcquired?: number;
  avgEntryUsd?: number;
  /**
   * Σ `sizeUsd` of every rung not filled at the venue — KNOWABLE ON DAY ZERO, when there is
   * no order, no lot and no fill to compute anything else from.
   */
  waitingDeclaredUsd: number;
  /**
   * Σ `sizeUsd` of the rungs that actually have an order resting. THE SPLIT IS THE POINT:
   * a rung you meant to place and never did looks nothing like one the venue is holding, and
   * only the difference between these two figures makes hidden encumbrance visible.
   */
  waitingRestingUsd: number;
}

export interface FillPathInput {
  /** The as-of-selected declared ladder. */
  plan: DcaLadderPlanRecord;
  /**
   * THE WHOLE ORDER STREAM, folded here — not `pickRestingOrdersAsOf`'s output, which emits
   * only rungs with `remainingQuantity > 0` and so drops every fully consumed one. Reading
   * the resting view would make `filled at venue` unreachable.
   */
  orders: readonly OrderRecord[];
  /** The position's recorded lots. `cost` is PER UNIT (`fundingAmount / filledQuantity`). */
  lots: readonly PositionLot[];
  /** From `reconcileFillActs`, passed through — this module reports, it does not detect. */
  tornActs: readonly TornFillAct[];
  /** The position's denomination. Absent reads as `USD`, which needs no conversion at all. */
  currency?: Currency;
  /** The per-lot `entryFx` fallback. PASSED, never fetched — see the module header. */
  reviewFx?: number;
}

export interface FillPathView {
  planId: string;
  positionId: string;
  rungs: FillPathRung[];
  figures: FillPathFigures;
  orphans: FillPathOrphan[];
  /**
   * A FUND-LEVEL FACT, reported through. This module does not render it and does not decide
   * what it blocks — the fill flow's refusal to proceed on an outstanding torn act is that
   * flow's rule, and duplicating the judgement here would give it a second home.
   */
  tornActs: readonly TornFillAct[];
}

function label(axis: FillVenueAxis, book: FillBookAxis, fraction: number): string {
  switch (axis) {
    case "not-placed":
      return "declared — not placed";
    case "resting":
      return "waiting";
    case "partly-filled":
      return `partly filled · ${Math.round(fraction * 100)}%`;
    case "filled":
      return book === "recorded"
        ? "filled"
        : book === "not-recorded"
          ? "filled at venue — not recorded"
          : "filled at venue — partly recorded";
  }
}

/**
 * THE JOIN: which order, if any, stands for each declared rung.
 *
 * DECLARED WINS, AND THE TWO PASSES ARE ORDERED FOR THAT REASON. Every declared line claims
 * its rung first; only then does price match get offered what is left. Running them together
 * would let a price-matched order take a rung that a later declared line names, and the
 * operator's statement would silently lose to an inference.
 *
 * `proposeRungByPrice` is the SAME price matcher the import's pick-list proposes with — one
 * matcher, so a rung the import declined to propose is not one this module quietly picks.
 * Its silence on an ambiguous price is carried through unchanged.
 */
function joinOrdersToRungs(
  plan: DcaLadderPlanRecord,
  orders: readonly OrderRecord[],
): Map<string, { placed: OrderPlacedRecord; consumed: number; provenance: RungJoinProvenance }> {
  const folded = foldOrderStream(orders);
  const rungIds = new Set(plan.rungs.map((rung) => rung.id));
  const joined = new Map<
    string,
    { placed: OrderPlacedRecord; consumed: number; provenance: RungJoinProvenance }
  >();
  const claimed = new Set<string>();

  for (const entry of folded.values()) {
    const { planId, rungId } = entry.placed;
    // A line naming ANOTHER ladder, or a rung this one does not declare, is not a join —
    // it is a line about something else, and forcing it onto the nearest rung would be the
    // inference the declared join exists to remove.
    if (planId !== plan.id || rungId === undefined || !rungIds.has(rungId)) {
      continue;
    }
    if (!joined.has(rungId)) {
      joined.set(rungId, { ...entry, provenance: "declared" });
      claimed.add(entry.placed.id);
    }
  }

  const ladder: InForceLadder = {
    planId: plan.id,
    positionId: plan.positionId,
    effectiveAt: plan.effectiveAt,
    rungs: plan.rungs,
  };
  for (const entry of folded.values()) {
    if (claimed.has(entry.placed.id)) {
      continue;
    }
    const pick = proposeRungByPrice([ladder], entry.placed.price);
    if (pick === undefined || joined.has(pick.rungId)) {
      continue;
    }
    joined.set(pick.rungId, { ...entry, provenance: "price-matched" });
    claimed.add(entry.placed.id);
  }
  return joined;
}

/**
 * THE FIGURES, and the arithmetic is the fold's own (`compose/canonical.ts`) rather than a
 * second formulation of it: `PositionLot.cost` is COST PER UNIT, so deployed capital is
 * `Σ (quantity × cost)` converted at each lot's own `entryFx` with `reviewFx` as the
 * fallback. `Σ cost` would sum per-unit prices as if they were amounts, and the spine test
 * — deployed reconciling exactly with the fold's `costBasisUsd` — could not pass.
 *
 * ORPHAN LOTS ARE INCLUDED, deliberately. The fold values every lot the position holds, so
 * excluding the ones no rung explains would break that reconciliation on exactly the fixture
 * where it matters most. An orphan is a JOIN failure, not a capital one.
 */
function measure(
  lots: readonly PositionLot[],
  currency: Currency,
  reviewFx: number | undefined,
): Pick<FillPathFigures, "deployedUsd" | "unitsAcquired" | "avgEntryUsd"> {
  let deployedUsd = 0;
  let unitsAcquired = 0;
  for (const lot of lots) {
    deployedUsd += toUsd(lot.quantity * lot.cost, currency, lot.entryFx ?? (reviewFx as number));
    unitsAcquired += lot.quantity;
  }
  // THE ABSENT-NEVER-ZERO GATE. Present means positive; anything else means no fill was
  // recorded (or none could be valued, with a non-USD lot and no rate to value it at), and
  // an omitted figure says that where a `0` would assert a measurement nobody made.
  if (!(deployedUsd > 0) || !(unitsAcquired > 0) || !Number.isFinite(deployedUsd)) {
    return {};
  }
  return { deployedUsd, unitsAcquired, avgEntryUsd: deployedUsd / unitsAcquired };
}

/**
 * Reconcile ONE declared ladder against the order stream and the recorded lots.
 *
 * Rungs come back in the ladder's own declared order — the order the operator authored them
 * in, which is the order every surface shows them in.
 */
export function reconcileFillPath(input: FillPathInput): FillPathView {
  const { plan, orders, lots, tornActs, currency = "USD", reviewFx } = input;
  const joined = joinOrdersToRungs(plan, orders);

  const rungs: FillPathRung[] = [];
  let waitingDeclaredUsd = 0;
  let waitingRestingUsd = 0;
  // The prices a lot may have been acquired at and still be explained: what each rung
  // DECLARED, and what its order was actually PLACED at — which differ exactly when a
  // declared join was honored over a price mismatch.
  const explainedPrices = new Set<number>();

  for (const rung of plan.rungs) {
    const entry = joined.get(rung.id);
    if (entry === undefined) {
      rungs.push({
        rung,
        venueAxis: "not-placed",
        bookAxis: "not-recorded",
        label: label("not-placed", "not-recorded", 0),
        declaredPriceMismatch: false,
        venueConsumedQuantity: 0,
        bookedQuantity: 0,
        resting: false,
      });
      waitingDeclaredUsd += rung.sizeUsd;
      explainedPrices.add(rung.priceUsd);
      continue;
    }

    const { placed, consumed, provenance } = entry;
    const booked = bookedFills(orders, placed.id);
    const venueAxis: FillVenueAxis =
      consumed <= 0 ? "resting" : consumed >= placed.quantity ? "filled" : "partly-filled";
    const bookAxis: FillBookAxis =
      booked <= 0 ? "not-recorded" : booked >= consumed ? "recorded" : "partly-recorded";
    const fraction = consumed / placed.quantity;
    const resting = placed.quantity - consumed > 0;

    rungs.push({
      rung,
      venueAxis,
      bookAxis,
      label: label(venueAxis, bookAxis, fraction),
      joinProvenance: provenance,
      orderId: placed.id,
      orderPriceUsd: placed.price,
      declaredPriceMismatch: provenance === "declared" && placed.price !== rung.priceUsd,
      placedQuantity: placed.quantity,
      venueConsumedQuantity: consumed,
      bookedQuantity: booked,
      venueFilledFraction: fraction,
      resting,
    });
    if (venueAxis !== "filled") {
      waitingDeclaredUsd += rung.sizeUsd;
    }
    if (resting) {
      waitingRestingUsd += rung.sizeUsd;
    }
    explainedPrices.add(rung.priceUsd);
    explainedPrices.add(placed.price);
  }

  const orphans: FillPathOrphan[] = lots
    .filter((lot) => !explainedPrices.has(lot.cost))
    .map((lot) => ({ lot, label: ORPHAN_LABEL }));

  return {
    planId: plan.id,
    positionId: plan.positionId,
    rungs,
    figures: { ...measure(lots, currency, reviewFx), waitingDeclaredUsd, waitingRestingUsd },
    orphans,
    tornActs,
  };
}
