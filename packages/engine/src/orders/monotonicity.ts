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
   * CUMULATIVE SINCE THE RUNG WAS PLACED — the venue's running `filled_quantity` total for
   * it, `0` when untouched. NOT the quantity filled since the last record; NOT a delta.
   * ONE basis, stated here rather than left to each caller (#176).
   *
   * CUMULATIVE, because that is the only basis a producer can honestly supply. The venue
   * prints a running total in its own column, and an operator reading it off the screen
   * cannot compute a delta without knowing what this file already recorded. Asking for a
   * number nobody can look up is how the two bases got mixed in the first place: the
   * prompt asked for the venue's column while the rung being recorded pushed its own
   * fill's delta, a few lines apart in the same function.
   *
   * WHAT IT IS COMPARED AGAINST, AND WHY THAT IS NOT `remainingQuantity`. A cumulative
   * total belongs beside the rung's ORIGINAL `placed.quantity`. `RestingOrder.
   * remainingQuantity` has already had every recorded fill netted out of it (`./select.ts`
   * — and, since #173, the placement line's own `observedFilledQuantity` too), so
   * comparing the two subtracts the same fills twice: a rung placed for 10 with 7 recorded
   * shows a remainder of 3, and an honest venue reading of 7 would read as `7 > 3` — an
   * "arithmetic, not policy" contradiction raised against the truth.
   *
   * It is still the honest partial-fill test and the ONLY one: a `status` column reading
   * `Filled` is a venue's summary of this number, and summarizing it is where partials get
   * rounded up into whole fills.
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
    /**
     * The venue reports more filled than the rung was EVER PLACED FOR. Arithmetic, not
     * policy — and measured against the original quantity, because the observation is a
     * cumulative total. It used to be measured against `remainingQuantity`, which is net
     * of the very fills the cumulative figure counts (#176).
     */
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
 * CONDITION 1, as ONE predicate rather than two that have to be kept in step. A rung
 * placed after the moment being reasoned about was not on the book then and cannot be
 * evidence about it. Both the proposal below and {@link scopeBookForFill} — which is what
 * a caller gathers its evidence over — partition with this, so "asked about" and
 * "reasoned over" cannot drift apart (#175).
 */
function partitionByMoment(
  resting: readonly RestingOrder[],
  observedAt: string,
): { simultaneous: RestingOrder[]; later: RestingOrder[] } {
  const simultaneous: RestingOrder[] = [];
  const later: RestingOrder[] = [];
  for (const order of resting) {
    // Sells are out of scope and out of the reasoning: a resting sell encumbers the ASSET,
    // and the ladder monotonicity argument is about a descending buy ladder.
    if (order.placed.side !== "buy") {
      continue;
    }
    (order.placed.observedAt <= observedAt ? simultaneous : later).push(order);
  }
  return { simultaneous, later };
}

/** The one rung set an act observes AND reasons over, split by what may be asked about. */
export interface ScopedBook {
  /**
   * Every BUY rung on the fill's own symbol, LATER ONES INCLUDED — the argument list for
   * {@link proposeFillVerdicts}. A later rung belongs here so it surfaces in `excluded`,
   * named, rather than being silently dropped.
   */
  sameSymbol: RestingOrder[];
  /**
   * Of those, the ones actually resting at the moment: the ONLY rungs there is any point
   * asking the operator about. Asking about a later one puts a rung into the observation
   * that condition 1 then refuses to know — `unknown-rung`, on a truthful answer.
   */
  observable: RestingOrder[];
}

/**
 * The rung set ONE fill act is about: same instrument, resting at the fill's moment.
 *
 * This exists because the two halves of the act used to disagree. The caller asked the
 * operator about same-symbol rungs and then handed the WHOLE resting book to the proposal,
 * so every rung it had declined to ask about arrived as an ABSENCE — and an absence with
 * nothing untouched above it derives `filled`. A second open ladder was therefore proposed
 * as a purchase, which is precisely the conversion of cancellations into phantom purchases
 * `D12` refuses to make (#175). The scope is computed once, here, and both halves take it.
 */
export function scopeBookForFill(
  resting: readonly RestingOrder[],
  symbol: string,
  observedAt: string,
): ScopedBook {
  const sameSymbol = resting.filter((order) => order.placed.symbol === symbol);
  return { sameSymbol, observable: partitionByMoment(sameSymbol, observedAt).simultaneous };
}

/**
 * Propose a verdict for every simultaneously-resting BUY rung, or refuse.
 *
 * Sells are out of scope and out of the reasoning: a resting sell encumbers the asset,
 * and the ladder monotonicity argument is about a descending buy ladder.
 *
 * WHAT IS GROUPED PER `symbol` IS THE `above` COMPARISON, AND ONLY THAT. This function
 * reasons over exactly the book it is handed: every buy rung in `resting` that was resting
 * at `observation.observedAt` gets a verdict, whatever instrument it names. So a caller
 * that wants "a fill on one instrument implies nothing whatever about a rung on another"
 * must hand over one instrument's rungs — {@link scopeBookForFill} is that, and the
 * observation must be gathered over the same set. Handing over more than was asked about
 * is #175, and it was the whole defect: absence is the input `D12` forbids inferring from.
 */
export function proposeFillVerdicts(
  resting: readonly RestingOrder[],
  observation: BookObservation,
): MonotonicityProposal {
  const contradictions: MonotonicityContradiction[] = [];

  // CONDITION 1, enforced rather than assumed. Excluded rungs are returned by id so the
  // operator sees WHAT the reasoning did not consider.
  const { simultaneous, later } = partitionByMoment(resting, observation.observedAt);
  const excluded = later.map((order) => order.placed.id);

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
    // LIKE WITH LIKE. `state.filledQuantity` is cumulative since placement, so the only
    // number it can contradict is what the rung was placed for. Against
    // `remainingQuantity` — already net of those same fills — an honest reading past the
    // halfway point would refuse the operator's whole act.
    if (state && state.filledQuantity > order.placed.quantity + QUANTITY_EPSILON) {
      contradictions.push({
        kind: "filled-quantity-exceeds-order",
        orderId: order.placed.id,
        message:
          `rung '${order.placed.id}' is observed with a cumulative filled_quantity of ` +
          `${state.filledQuantity} against the ${order.placed.quantity} it was placed for`,
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
