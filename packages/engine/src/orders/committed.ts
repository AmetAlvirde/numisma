/**
 * THE ONE COMMITTED FORMULA. Everything that needs to know how much of a reserve is
 * encumbered by resting claims comes through this module — the `O1` import-boundary
 * guard (`./ingest.ts`) and the rendered available-capital report (`./available.ts`)
 * both call it, and neither computes it itself.
 *
 * WHY THAT IS THE POINT OF THE FILE. Two independently-maintained committed formulas
 * that silently drift is precisely the class of defect this increment exists to remove.
 * A rendered `available` that disagreed with the guard which ACCEPTED the orders would
 * be worse than today's honest silence: today the fund is quietly wrong about free cash
 * and everyone knows the number is unexamined, whereas two disagreeing figures would
 * each look examined. So there is exactly one place the arithmetic happens, and
 * `available.test.ts` asserts the two callers cannot part company.
 *
 * PURE (ADR-001): no IO, no clock. The input is what `pickRestingOrdersAsOf` returned.
 */
import type { Currency } from "../contracts.js";
import type { OrderSide } from "./records.js";
import type { RestingOrder } from "./select.js";

/**
 * One resting claim, with the encumbrance it represents made explicit.
 *
 * This is the reconciliation row the TUI lists beneath the committed figure, and it is
 * what slice 6's fill prompt renders from — deliberately a flat, self-describing row
 * rather than a `RestingOrder` the caller must re-derive `committed` from, so the two
 * surfaces cannot arrive at different numbers for the same rung.
 */
export interface CommittedRung {
  /** The synthesized order id — readable, so it can be eyeballed against the venue. */
  orderId: string;
  observedAt: string;
  currency: Currency;
  symbol: string;
  side: OrderSide;
  price: number;
  /** What is STILL claimed: `quantity − filled_quantity`, per `./select.ts`. */
  remainingQuantity: number;
  fundingReserveId: string;
  /** `price × remainingQuantity` — the encumbrance, in `currency`. */
  committed: number;
}

/**
 * The encumbrance of ONE resting claim: `price × (quantity − filled_quantity)`.
 *
 * UNVERIFIED, and named as such (spec Open Questions): the remainder rule is believed
 * right but nothing has partially filled yet, so it has never been checked against a
 * real venue's behaviour. The first real partial is the verification event. It is
 * written this way rather than `price × quantity` because the alternative is knowably
 * wrong in the direction that matters — it would over-state committed and under-state
 * available, i.e. hide capital the fund actually has.
 */
function encumbranceOf(order: RestingOrder): number {
  return order.placed.price * order.remainingQuantity;
}

/**
 * Every resting claim that encumbers CASH, as a flat rung row, in the order given.
 *
 * Only BUY claims are here. A resting sell encumbers the ASSET, not the cash reserve —
 * the sign-flipped case is named, not designed, and summing it into a cash balance it
 * does not draw on would be a wrong number rather than a missing one.
 */
export function committedRungs(resting: readonly RestingOrder[]): CommittedRung[] {
  const rungs: CommittedRung[] = [];
  for (const order of resting) {
    if (order.placed.side !== "buy") {
      continue;
    }
    rungs.push({
      orderId: order.placed.id,
      observedAt: order.placed.observedAt,
      currency: order.placed.currency,
      symbol: order.placed.symbol,
      side: order.placed.side,
      price: order.placed.price,
      remainingQuantity: order.remainingQuantity,
      fundingReserveId: order.placed.fundingReserveId,
      committed: encumbranceOf(order),
    });
  }
  return rungs;
}

/**
 * Committed, summed per declared funding reserve — a FOLD of {@link committedRungs},
 * never a second pass over the orders. That is what makes "the rungs sum to the
 * committed figure" true by construction rather than by a test's goodwill.
 *
 * The map is keyed by `fundingReserveId` and carries no notion of whether that reserve
 * exists: resolving the id against the fold is the caller's job, and the two callers
 * refuse an unknown id in their own way (the guard rejects the import; the report lists
 * the rung as unmatched). Reading an unknown id as a zero balance here would render the
 * whole ladder as "over-committed" on a typo, or worse, silently attribute it nowhere.
 */
export function committedByReserve(resting: readonly RestingOrder[]): Map<string, number> {
  const byReserve = new Map<string, number>();
  for (const rung of committedRungs(resting)) {
    byReserve.set(rung.fundingReserveId, (byReserve.get(rung.fundingReserveId) ?? 0) + rung.committed);
  }
  return byReserve;
}
