/**
 * THE ONE COMMITTED FORMULA. Everything that needs to know how much of a reserve is
 * encumbered by resting claims comes through this module — the `O1` funding-coverage
 * guard (`checkFundingCoverage`, `./coverage.ts`) and the rendered available-capital
 * report (`./available.ts`) both call it, and neither computes it itself.
 *
 * WHY THAT IS THE POINT OF THE FILE. Two independently-maintained committed formulas
 * that silently drift is precisely the class of defect this increment exists to remove.
 * A rendered `available` that disagreed with the guard which ACCEPTED the orders would
 * be worse than today's honest silence: today the fund is quietly wrong about free cash
 * and everyone knows the number is unexamined, whereas two disagreeing figures would
 * each look examined. So there is exactly one place the arithmetic happens, and
 * `available.test.ts` asserts the two callers cannot part company ABOUT THE ARITHMETIC.
 *
 * THIS FILE DOES NOT OWN THE ARGUMENTS, AND SAYING SO IS THE CORRECTION. An earlier
 * version of this docstring claimed the two callers simply "cannot part company". That
 * was false, and #172 is what it cost: the two shared this formula and were handed
 * DIFFERENT reserve sets — the guard `data.reserves` straight off the fold, the report
 * only the reserves `buildCanonicalState` admits — and the guard's reserve type carried
 * no currency at all. Same formula, divergent arguments, a rung fundable at import and
 * unplaceable in the report.
 *
 * WHICH SURFACE OWNS THE DERIVATION: `./attribution.js`, and neither caller. It answers
 * both argument questions — which reserves may fund anything (delegated to
 * `buildCanonicalState`, never restated), and which rung is placed against which — and
 * the guard and the report each call it rather than deriving anything themselves. The
 * pairing is the invariant: this module is the one FORMULA, `./attribution.js` is the one
 * ARGUMENT SET, and `funding-parity.test.ts` drives BOTH surfaces from a single fund
 * fixture so neither claim can rot into prose again.
 *
 * PURE (ADR-001): no IO, no clock. The input is what `pickRestingOrdersAsOf` returned.
 */
import type { Currency } from "../contracts.js";
import type { OrderSide } from "./records.js";
import type { RestingOrder } from "./select.js";

/**
 * Pure IEEE noise floor for `slack = balance − committed`. NOT a business tolerance: the
 * fund's own ladder sums to a fraction of a cent more than a whole-cent transfer, and
 * that difference is REAL and must stay VISIBLE. This absorbs only the ~1e-17 residue of
 * summing decimal products in binary floating point, so a balance of `0.3` against three
 * rungs of `0.1 × 1` is coverage, not a shortfall.
 *
 * It lives HERE, beside the one committed formula, for the same reason that formula
 * does: the `O1` funding-coverage guard (`checkFundingCoverage`, `./coverage.ts`) and
 * the rendered report
 * (`../format.ts`) must not be able to drift about what counts as negative. They did:
 * the guard ACCEPTED float residue while the report shouted "available is NEGATIVE" over
 * every input the epsilon exists to admit. One constant, two callers, no second copy.
 */
export const SLACK_EPSILON = 1e-9;

/**
 * Is this slack GENUINELY negative — the impossible state — rather than float residue?
 *
 * A predicate rather than a bare constant so neither caller has to remember the sign of
 * the comparison. It answers only about the TRIGGER; the number itself is never clamped
 * or rounded by anyone, because a real sub-cent residue is information the operator is
 * owed.
 */
export function isNegativeSlack(slack: number): boolean {
  return slack < -SLACK_EPSILON;
}

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
  /**
   * The size the rung was PLACED for, before anything filled against it. Carried beside
   * the remainder because a CUMULATIVE venue reading is compared against this and never
   * against the remainder — the two are on different bases, and conflating them is what
   * #176 was.
   */
  quantity: number;
  /**
   * What is STILL claimed: `quantity − consumed`, per `./select.ts`.
   *
   * A REPORT, NOT AN AUTHORIZATION, and it carries {@link RestingOrder.remainingQuantity}'s
   * warning unchanged because flattening the row does not flatten the meaning. `consumed`
   * is NOT MONOTONIC, so this figure can go UP as well as down and a retired rung can
   * reappear with a positive remainder. Encumbrance is what it answers for — the committed
   * figure below is derived from it and is right. A caller asking instead "how much may I
   * still BOOK against this rung" must apply the booked-fills ceiling at its own boundary
   * (`bookedFills`, `./select.ts`); this number alone would let a backwards observation
   * authorize a second lot and cash leg against capital already spent.
   */
  remainingQuantity: number;
  fundingReserveId: string;
  /** `price × remainingQuantity` — the encumbrance, in `currency`. */
  committed: number;
}

/**
 * The encumbrance of ONE resting claim: `price × (quantity − filled_quantity)`.
 *
 * THE REMAINDER RULE IS NOW WHAT ACTUALLY RUNS ON EVERY PATH, AND SAYING SO IS THE
 * CORRECTION (#173). An earlier version of this docstring named the remainder rule as the
 * correction to `price × quantity` while the import path computed `price × quantity` — the
 * venue's `filled_quantity` was parsed, validated and then dropped, so no imported rung
 * could satisfy `remainingQuantity`'s own definition. The file named its own defect and
 * did not have it. It has it now: the partial rides on the placement line
 * (`OrderPlacedRecord.observedFilledQuantity`) and `pickRestingOrdersAsOf` nets it out
 * before anything reaches here.
 *
 * STILL UNVERIFIED AGAINST THE REAL VENUE, and that part stands (spec Open Questions):
 * nothing has partially filled yet, so the rule has never been checked against a real
 * venue's behaviour — including whether its own partial spelling is one this build reads.
 * The first real partial is the verification event. The rule is written this way rather
 * than `price × quantity` because the alternative is knowably wrong in the direction that
 * matters — it would over-state committed and under-state available, i.e. hide capital the
 * fund actually has.
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
      quantity: order.placed.quantity,
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
