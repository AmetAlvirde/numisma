/**
 * THE PURE HALF OF THE DECLARED JOIN (#286): which ladders an import may propose
 * against, what a price match proposes over them, and what a pick declares.
 *
 * WHY THE JOIN IS DECLARED AT ALL. Until this slice a fill could only be joined to its
 * rung by matching prices — an INFERENCE, made after the fact, on an append-only file
 * that has no second chance to carry a key nobody wrote. `planId` + `rungId` on the
 * placement line make the join a thing the operator SAID; price match stays as the
 * permanent fallback for every line that carries neither, and that fallback is exactly
 * why the plan loader now refuses a ladder with two rungs at one price.
 *
 * PURE (ADR-001): no IO, no clock, no prompt. The sidecar arrives loaded, the as-of date
 * arrives from the caller's own stamp, and the operator's ratification is the TUI's half.
 */
import { listPlansAsOf, type DcaRung, type IsoDate, type LoadedPlans } from "../plans.js";

/**
 * ONE in-force ladder, as the pick-list needs it: the id it will WRITE, and the content
 * it will SHOW.
 *
 * `planId` — the foreign-key name for the ladder's own `id`, because here the field names
 * SOMEONE ELSE'S identity. The operator never sees it: a ladder is presented by position,
 * effective date, and its rungs' prices and sizes. Carrying it through from the loaded
 * plan is the whole mechanism by which a UUID never becomes an operator-facing string.
 */
export interface InForceLadder {
  planId: string;
  positionId: string;
  effectiveAt: IsoDate;
  rungs: DcaRung[];
}

/** One order's declared join: which ladder, and which rung of it. Two facts, never one. */
export interface RungPick {
  planId: string;
  rungId: string;
}

/**
 * Born-ness, deliberately EMPTY — and this is the reason the module needs no fold.
 *
 * `pickPlanAsOf` splits an in-force plan into `pending` (the position does not exist yet)
 * and `active` (it does) purely by this set. BOTH are in force — a ladder resting above
 * an unborn Position is exactly the fund's live state on day zero — so the accepted set
 * is IDENTICAL whatever is passed, and passing nothing keeps this a pure function of the
 * sidecar and a date. If the two arms ever stop being treated alike here, this constant
 * is the line that has to change, and it will be obvious.
 */
const BORNNESS_IS_IRRELEVANT: ReadonlySet<string> = new Set<string>();

/**
 * The `dcaLadder` plans in force at `asOf` — one per position, superseded lines and
 * terminated ladders excluded, in the sidecar's own first-mention order.
 *
 * A `dcaTime` plan is omitted rather than refused: it declares an amount and a cadence,
 * so it has no rung for an order to name. An unreadable or ended position simply
 * contributes nothing — a pick-list is an offer, not a diagnostic surface, and the plans
 * command is where a broken line is reported.
 */
export function inForceLadders(loaded: LoadedPlans, asOf: IsoDate): InForceLadder[] {
  const ladders: InForceLadder[] = [];
  for (const row of listPlansAsOf(loaded, asOf, BORNNESS_IS_IRRELEVANT).positions) {
    const { lookup } = row;
    if (lookup.status !== "pending" && lookup.status !== "active") {
      continue;
    }
    if (lookup.plan.kind !== "dcaLadder") {
      continue;
    }
    ladders.push({
      planId: lookup.plan.id,
      positionId: lookup.plan.positionId,
      effectiveAt: lookup.plan.effectiveAt,
      rungs: lookup.plan.rungs.map((rung) => ({ ...rung })),
    });
  }
  return ladders;
}

/**
 * The PROPOSAL: the one rung, across every in-force ladder, declared at this price.
 *
 * A SUGGESTION THE OPERATOR RATIFIES, never a decision. Two rungs at one price WITHIN a
 * ladder cannot arise — the plan loader refuses that declaration — but two LADDERS may
 * legitimately declare a rung at the same price, and then the honest answer is nothing at
 * all: an ambiguous match dressed as a match is worse than no proposal, because the
 * operator ratifies proposals in a batch.
 *
 * Exact equality on the parsed number, matching the loader's own comparison. A near-miss
 * is not a match: the operator can still pick the rung by hand, and that pick is then
 * something they SAID rather than something a tolerance decided.
 */
export function proposeRungByPrice(
  ladders: readonly InForceLadder[],
  price: number,
): RungPick | undefined {
  const matches = matchRungsByPrice(ladders, price);
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * EVERY rung declared at this price, so a caller can tell the two silences apart.
 *
 * `proposeRungByPrice` answers `undefined` both when NOTHING declares the price and when
 * TWO ladders do, and it is right to: neither is a proposal. But a prompt rendering both
 * as "no rung declared at this price" tells the operator there is nothing to override in
 * exactly the case where they most need to override — so the count is available here,
 * from the one matcher, rather than by a second traversal that could disagree with it.
 */
export function matchRungsByPrice(
  ladders: readonly InForceLadder[],
  price: number,
): RungPick[] {
  const found: RungPick[] = [];
  for (const ladder of ladders) {
    for (const rung of ladder.rungs) {
      if (rung.priceUsd === price) {
        found.push({ planId: ladder.planId, rungId: rung.id });
      }
    }
  }
  return found;
}

/**
 * What the PICKED rung declares — the figure the import report compares against the
 * order's own price.
 *
 * A pick whose declared price differs from the order's price is ACCEPTED: the operator is
 * allowed to know something the price match does not (a rung re-placed a tick away, a
 * partial re-entered at the venue). The difference is flagged, never refused. `undefined`
 * means no in-force declaration names that rung, so there is nothing to compare.
 */
export function declaredRungPrice(
  ladders: readonly InForceLadder[],
  pick: RungPick,
): number | undefined {
  return ladders
    .find((ladder) => ladder.planId === pick.planId)
    ?.rungs.find((rung) => rung.id === pick.rungId)?.priceUsd;
}
