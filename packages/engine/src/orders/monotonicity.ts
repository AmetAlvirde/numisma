/**
 * `D11` — MONOTONICITY, AS A GUARD THAT PROPOSES AND NEVER WRITES.
 *
 * Among buy limits that were resting AT THE SAME TIME, a fill at price L implies the
 * price traded through every rung above L. That inference is useful and it is also the
 * exact place a tracker can invent purchases that never happened, so three conditions
 * keep it honest and all three are enforced below rather than remembered:
 *
 *   1. SIMULTANEOUSLY RESTING. The inference holds only across rungs whose resting
 *      intervals overlap. A rung placed AFTER the moment being reasoned about is not
 *      evidence about it; it is excluded and NAMED in the proposal (`excluded`) so its
 *      absence from the reasoning is visible rather than assumed.
 *   2. PARTIALS WEAKEN IT TO "TOUCHED", NEVER "FILLED". The honest test is
 *      `filled_quantity > 0` — never a `status` column reading `Filled`. A rung the price
 *      merely reached is `touched`; nothing here ever upgrades that to `filled`.
 *   3. A CANCELLED TOP RUNG LETS A LOWER ONE FILL WITH NO FILL ABOVE IT. So a GAP IS NOT
 *      PROOF OF A FILL. `D12` rejects inferring a fill from disappearance outright,
 *      because doing so "silently converts cancellations into phantom purchases."
 *
 * WHAT THIS MODULE MAY AND MAY NOT DO. It PROPOSES a verdict per rung, stamps every one
 * of them `derived`, carries the evidence each was derived from, and FAILS LOUD on a
 * verdict that is impossible. It writes nothing, and it cannot: it is pure (ADR-001) and
 * returns values. `O3` — an inference is never written as an observation — is therefore
 * structural here, and the operator's confirmation is what turns a proposal into a line
 * (see `apps/tui/src/record-fill.ts`).
 *
 * AND WHY THE `orderFilled` LINE IS HONEST IS NOT THIS MODULE. It is `T6`: opening a
 * Position requires five authored decision fields, so a human is already in the loop at
 * the moment of a fill and is authoring a decision regardless. Monotonicity keeps exactly
 * the role it was given — it proposes, and it refuses.
 */
import type { RestingOrder } from "./select.js";

/**
 * Pure float noise floor for comparing observed quantities. NOT a business tolerance:
 * quantities are the venue's own authoritative column and a real partial is orders of
 * magnitude larger than this.
 */
const QUANTITY_EPSILON = 1e-9;

/**
 * What the venue STILL SHOWS for one rung at the observation moment. A rung that was
 * resting and is NOT in this list has DISAPPEARED — which is an absence, not a fill, and
 * is precisely what condition 3 forbids reading as one.
 */
export interface ObservedRungState {
  orderId: string;
  /**
   * The venue's `filled_quantity` for this rung, `0` when untouched. This is the honest
   * test and the ONLY one: a `status` column reading `Filled` is a venue's summary of
   * this number, and summarizing it is where partials get rounded up into whole fills.
   */
  filledQuantity: number;
}

/** One look at the book: when it was taken, and every rung still on it. */
export interface BookObservation {
  /** Second-granular stamp of the look, in `observedAt`'s own format. */
  observedAt: string;
  present: readonly ObservedRungState[];
}

/** The verdict vocabulary. `filled` is only ever PROPOSED, never observed here. */
export type FillVerdict =
  /** Gone from the book with nothing untouched above it — consistent with a fill. */
  | "filled"
  /** Gone from the book with untouched rungs ABOVE it — a fill is contradicted. */
  | "cancelled"
  /** Still on the book with `filled_quantity > 0`. The price reached it. NOT `filled`. */
  | "touched"
  /** Still on the book, untouched. */
  | "resting";

/** Exactly what a verdict was derived FROM, carried so a reader can re-derive it. */
export interface VerdictEvidence {
  /** Was the rung absent from the observation? */
  disappeared: boolean;
  /** The venue's `filled_quantity` for it, or `undefined` when it disappeared. */
  observedFilledQuantity?: number;
  /**
   * Rungs priced ABOVE this one that the observation shows STILL RESTING AND UNTOUCHED.
   * Non-empty is what contradicts a fill: the price could not have reached this rung
   * without reaching those.
   */
  untouchedAbove: string[];
  /** Rungs priced above this one that are gone or touched — consistent with a fill. */
  reachedAbove: string[];
}

/**
 * ONE PROPOSED VERDICT. `provenance` is `"derived"` and is not a parameter — there is no
 * way to construct one of these stamped as an observation, which is `O3` expressed in the
 * type rather than in a convention.
 */
export interface ProposedVerdict {
  orderId: string;
  symbol: string;
  price: number;
  verdict: FillVerdict;
  provenance: "derived";
  evidence: VerdictEvidence;
  /** One sentence naming the rule that produced the verdict, for the operator to read. */
  rationale: string;
}

/** A verdict that cannot be true. Reported; never normalized into a plausible one. */
export interface MonotonicityContradiction {
  kind:
    /**
     * OBSERVED fill evidence below an untouched rung. Note the difference from a mere
     * gap: a gap is ambiguous and resolves to `cancelled`, but `filled_quantity > 0` is
     * the venue stating the price REACHED this rung — which it cannot have done while
     * leaving a higher buy limit untouched.
     */
    | "fill-below-untouched-rung"
    /** The venue reports more filled than the rung still claims. Arithmetic, not policy. */
    | "filled-quantity-exceeds-order"
    /** The observation names a rung that was not resting — nothing to reason over. */
    | "unknown-rung";
  orderId: string;
  message: string;
}

export type MonotonicityProposal =
  | {
      status: "proposed";
      verdicts: ProposedVerdict[];
      /** Rungs excluded from the reasoning for not being SIMULTANEOUSLY resting. */
      excluded: string[];
    }
  | { status: "impossible"; contradictions: MonotonicityContradiction[] };

/**
 * Propose a verdict for every simultaneously-resting BUY rung, or refuse.
 *
 * Sells are out of scope and out of the reasoning: a resting sell encumbers the asset,
 * and the ladder monotonicity argument is about a descending buy ladder. Reasoning is
 * grouped per `symbol`, because a fill on one instrument implies nothing whatever about a
 * rung on another.
 */
export function proposeFillVerdicts(
  resting: readonly RestingOrder[],
  observation: BookObservation,
): MonotonicityProposal {
  const contradictions: MonotonicityContradiction[] = [];

  // CONDITION 1, enforced rather than assumed. A rung placed after the observation was
  // not on the book at that moment and cannot be evidence about it. Excluded rungs are
  // returned by id so the operator sees WHAT the reasoning did not consider.
  const simultaneous = resting.filter(
    (order) => order.placed.side === "buy" && order.placed.observedAt <= observation.observedAt,
  );
  const excluded = resting
    .filter((order) => order.placed.side === "buy" && order.placed.observedAt > observation.observedAt)
    .map((order) => order.placed.id);

  const present = new Map(observation.present.map((state) => [state.orderId, state]));
  const known = new Set(simultaneous.map((order) => order.placed.id));
  for (const state of observation.present) {
    if (!known.has(state.orderId)) {
      contradictions.push({
        kind: "unknown-rung",
        orderId: state.orderId,
        message:
          `the observation shows rung '${state.orderId}', which was not resting at ` +
          `${observation.observedAt}; there is no simultaneously-resting book to reason over`,
      });
    }
  }

  for (const order of simultaneous) {
    const state = present.get(order.placed.id);
    if (state && state.filledQuantity > order.remainingQuantity + QUANTITY_EPSILON) {
      contradictions.push({
        kind: "filled-quantity-exceeds-order",
        orderId: order.placed.id,
        message:
          `rung '${order.placed.id}' is observed with filled_quantity ${state.filledQuantity} ` +
          `against a remaining claim of ${order.remainingQuantity}`,
      });
    }
  }

  const verdicts: ProposedVerdict[] = [];
  for (const order of simultaneous) {
    const id = order.placed.id;
    const state = present.get(id);
    const above = simultaneous.filter(
      (other) =>
        other.placed.symbol === order.placed.symbol && other.placed.price > order.placed.price,
    );
    const untouchedAbove: string[] = [];
    const reachedAbove: string[] = [];
    for (const other of above) {
      const otherState = present.get(other.placed.id);
      if (otherState && otherState.filledQuantity <= QUANTITY_EPSILON) {
        untouchedAbove.push(other.placed.id);
      } else {
        reachedAbove.push(other.placed.id);
      }
    }

    if (state && state.filledQuantity > QUANTITY_EPSILON && untouchedAbove.length > 0) {
      // The IMPOSSIBLE verdict, and the reason it is impossible rather than merely
      // surprising: this is not a gap. The venue is stating the price reached this rung,
      // and a descending buy ladder cannot be reached at a lower rung while a higher one
      // sits untouched. Normalizing it (say, by promoting the untouched rungs to
      // "touched") would manufacture evidence; it fails loud instead.
      contradictions.push({
        kind: "fill-below-untouched-rung",
        orderId: id,
        message:
          `rung '${id}' is observed with filled_quantity ${state.filledQuantity} while ` +
          `${untouchedAbove.join(", ")} rest untouched above it — the price cannot have ` +
          `reached this rung without reaching those`,
      });
      continue;
    }

    const evidence: VerdictEvidence = state
      ? { disappeared: false, observedFilledQuantity: state.filledQuantity, untouchedAbove, reachedAbove }
      : { disappeared: true, untouchedAbove, reachedAbove };

    if (state) {
      const touched = state.filledQuantity > QUANTITY_EPSILON;
      verdicts.push({
        orderId: id,
        symbol: order.placed.symbol,
        price: order.placed.price,
        verdict: touched ? "touched" : "resting",
        provenance: "derived",
        evidence,
        rationale: touched
          ? `still on the book with filled_quantity ${state.filledQuantity} > 0 — the price ` +
            `reached it, which is TOUCHED and never FILLED; the remainder is still claimed`
          : "still on the book with nothing filled against it",
      });
      continue;
    }

    // DISAPPEARED. `D12`: an absence is not a fill. The only thing that can turn a gap
    // into a proposed fill is the ABSENCE OF A CONTRADICTION above it, and even then it
    // is a proposal that the operator must confirm before any line is written.
    verdicts.push({
      orderId: id,
      symbol: order.placed.symbol,
      price: order.placed.price,
      verdict: untouchedAbove.length > 0 ? "cancelled" : "filled",
      provenance: "derived",
      evidence,
      rationale:
        untouchedAbove.length > 0
          ? `gone from the book, but ${untouchedAbove.join(", ")} rest untouched ABOVE it — a ` +
            `fill here would have had to trade through them, so the disappearance is a ` +
            `CANCELLATION, not a purchase`
          : `gone from the book with nothing untouched above it (${
              reachedAbove.length > 0 ? `${reachedAbove.join(", ")} were reached` : "it was the top rung"
            }) — consistent with a fill, and PROPOSED as one`,
    });
  }

  if (contradictions.length > 0) {
    // All-or-nothing on the reasoning too: one impossible verdict discredits the book the
    // others were derived from, so nothing is proposed alongside it.
    return { status: "impossible", contradictions };
  }
  return { status: "proposed", verdicts, excluded };
}
