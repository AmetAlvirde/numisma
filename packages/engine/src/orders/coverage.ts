/**
 * The `O1` FUNDING-COVERAGE GUARD: no order may encumber a reserve that cannot fund it.
 *
 * PURE (ADR-001). Split out of `./ingest.ts` because it changes with RESERVE-ADMISSION
 * POLICY while the rest of ingest changes with the venue's row shape — #172, #179 and #183
 * each touched this block and nothing else around it. Every fold-derived symbol the guard
 * needs (`FundReviewData`, `attributeRungs`, `isNegativeSlack`, `RestingOrder`) is imported
 * HERE and nowhere else in ingest, which turns "the venue-neutral half of ingest never
 * touches the fold" into a fact about imports rather than a claim in prose.
 *
 * It sits beside `./attribution.ts` on purpose: that module owns WHICH reserves may fund
 * anything and WHICH rung belongs to which, and this one owns the verdict weighed on top.
 */
import type { FundReviewData } from "../contracts.js";
import { attributeRungs, type UnmatchedRung } from "./attribution.js";
import { isNegativeSlack } from "./committed.js";
import type { RestingOrder } from "./select.js";

/**
 * `ReserveBalance` USED TO LIVE HERE — `{ id, amount }`, built by the caller. It is gone
 * on purpose (#172). It carried no currency, so this guard summed a quote-denominated
 * `committed` into a native balance; and because the CALLER built it, the import CLI
 * handed over `data.reserves` straight off the fold, including reserves the report
 * refuses to place. The successor is `FundableReserve` in `./attribution.js`, which
 * carries `currency` and which only `fundableReserves(data)` can produce. This guard
 * takes the FUND now, so there is no list left to hand it wrongly.
 */

/** One reserve that cannot fund what has been attributed to it. */
export interface FundingShortfall {
  fundingReserveId: string;
  balance: number;
  committed: number;
  /** `balance − committed`. Negative here by construction: the impossible state. */
  slack: number;
}

/**
 * THREE ARMS, AND THEY ARE THE REAL STRUCTURE: attribution succeeds or it does not, and
 * coverage is only weighable when it does.
 *
 * `unattributed` carries the report's OWN `UnmatchedRung[]` — the identical array from
 * the identical {@link attributeRungs} call the rendered available-capital report makes.
 * That is what finishes #172's thesis: parity is no longer legible in a pair of
 * hand-mirrored arm names, it is an IDENTITY, because there is only one list and both
 * surfaces return it.
 *
 * IT USED TO BE FOUR, AND THE FOURTH MASKED THE THIRD (#179). The arm pair
 * `unfundable-reserve` / `currency-mismatch` mirrored `UnmatchedReason` one level up, so
 * a batch wrong in BOTH ways could only report the class that happened to be tested
 * first: the operator fixed it, re-ran, and was refused again for the other. The reasons
 * were all computed on the first pass and then thrown away. `UnmatchedReason` itself
 * SURVIVES untouched — it is the per-RUNG reason, and it is what both the report
 * (`./available.js`) and the import boundary's refusal message render from.
 *
 * `over-committed` is NOT folded in with them and stays a separate later pass: an
 * unplaceable rung has no honest balance to be compared against, so there is nothing to
 * weigh it with until every rung is placeable.
 *
 * The arm is named after the PHASE that failed rather than after a reason, because it is
 * a class of reasons — and it is that phase's failure which is precisely why
 * `over-committed` could not be computed.
 */
export type FundingCoverage =
  | { status: "ok" }
  // `readonly`, because "the identical array, narrowed by nobody" is a claim about the
  // list the caller receives too: a consumer that spliced its own class out of it would
  // re-create #179's masking one layer down, and the surfaces that render it already take
  // `readonly UnmatchedRung[]`.
  | { status: "unattributed"; unmatched: readonly UnmatchedRung[] }
  | { status: "over-committed"; shortfalls: FundingShortfall[] };

/**
 * `O1` — no order may encumber a reserve that cannot fund it.
 *
 * The invariant is `slack = reserve.amount − committed ≥ 0`, and the direction carries
 * the meaning: `slack < 0` is an IMPOSSIBLE state, not a warning. The venue would not
 * have accepted orders the account could not fund, so a negative slack means the
 * ATTRIBUTION is wrong — and writing it would put a wrong claim into an append-only
 * file, where correcting it costs a compensating line forever.
 *
 * The caller passes the orders STILL RESTING (`pickRestingOrdersAsOf` over the sidecar's
 * existing records plus the incoming batch), so the check covers the whole book against
 * the reserve rather than one import's slice of it, and a partially-filled rung
 * encumbers only its remainder. Re-importing an unchanged export changes nothing here:
 * the ids are deterministic, so the selector counts each rung once.
 *
 * Committed comes from the SHARED formula in `./committed.ts`, and its ARGUMENTS — which
 * reserves may fund anything, and which rung belongs to which — from the SHARED
 * attribution in `./attribution.js`. Both are the same calls the rendered
 * available-capital report makes. Sharing only the formula was not enough and is the
 * defect this signature exists to close (#172): the guard took a reserve list from its
 * CALLER, and the caller handed it reserves the report refuses to place, plus no
 * currency to check against. It takes the FUND now. There is no list to get wrong.
 *
 * A rendered `available` that contradicted the check which ACCEPTED the orders would be
 * worse than the fund's present honest silence. Only BUY claims encumber a cash reserve,
 * and that rule lives in `./committed.ts` rather than being restated here.
 *
 * SCOPE — THE GUARD WEIGHS THE RUNGS IT IS HANDED (#183). `resting` is not a sample of
 * the venue's book; it IS this function's scope. The question answered is "are THESE
 * rungs covered?", and over the rungs handed in, `ok` is honest. Whether that set is the
 * WHOLE book is the CALLER's to own, and the caller cannot always say yes: a row the
 * export's parser skipped never became a record, so it never reaches `resting` and is
 * never in `committed`. The guard cannot see it and does not claim to. The surface that
 * carries that gap is the import boundary's `imported-partial` outcome
 * (`apps/tui/src/import-orders.ts`), whose operator line names the money direction —
 * rungs nobody could weigh make `available` read HIGH — and whose count runs through
 * `leavesRungUnweighed` so a `not-resting` row, read completely and found to encumber
 * nothing, raises no false alarm (#184).
 *
 * The verdict is deliberately NOT qualified with that gap, and #183 decided so against
 * its own leading candidate. This is a pure function of its arguments: the incompleteness
 * lives in the ARGUMENT, not in the verdict, and a fifth arm apologizing for the caller's
 * inputs moves the caller's problem into the callee's type. It would harden `ok` against
 * a caller that does not exist — one non-test call site, and `record-fill.ts` names this
 * function only in a comment saying why it deliberately does not call it. It would also
 * break #172's parity property, which lives in `funding-parity.test.ts` under *"no
 * verdict the guard accepts leaves the report with an unplaceable rung"* — cited BY NAME,
 * because line numbers drift and these two citations already had. A qualifying arm falls
 * to that property's `else`, which asserts `report.unmatched` is EMPTY for every verdict
 * other than `unattributed` — so a fifth arm would assert a non-empty unmatched list
 * against an empty one, on the ACCEPT path, which is the path a qualified verdict lives
 * on.
 *
 * The property was RESTATED by #179 and the change was deliberate: it used to compare
 * this function's status token against `report.unmatched[0]?.reason` — the FIRST entry
 * only, which is the very blindness #179 removed — and it now relates the whole
 * `unattributed` list to the whole report list, over all three arms. #183's conclusion
 * above is untouched by that; only these citations are.
 *
 * KNOWINGLY OPEN, recorded in ADR-014 — A SKIPPED EXPORT ROW IS NEVER PERSISTED. The gap
 * was argued and accepted on #183, which is CLOSED because what it owed was a decision;
 * the citations above are to that decision and stay pointed at it. This one is different:
 * it names a cost still being PAID, so it points at the durable record of the accepted
 * cost — `context/adr/ADR-014-a-skipped-export-row-not-persisted-because-it-could-never-be-retired.md`, which
 * carries the re-trigger that would re-open it. It is an ADR and not an issue because an
 * issue's affordance is CLOSING, and there is nothing here to close. `OrderRecord` is four
 * kinds — `orderPlaced`, `orderCancelled`, `orderFilled` and `orderFillObserved`
 * (`OrderRecord` in `./records.ts`, cited BY NAME for the reason the paragraph above
 * gives; that line number had already drifted once) — and `appendOrders`
 * (in `@numisma/preferences`, cited BY NAME for the same reason) writes fresh `orderPlaced` and
 * `orderFillObserved` rows. NEITHER ADDITION GIVES THE SKIP A HOME, which is the first
 * thing a reader who counts four kinds will want ruled out: an observation restates a rung
 * ALREADY placed and finds it BY ID, so it is reachable only for a row that parsed. There
 * is no record for "line N of the export could not be read": the skip reaches stderr and
 * the returned outcome, then dies with the process. So `orders.jsonl` carries no trace
 * that the rung exists, and every later reader — tomorrow's available-capital report, any
 * adherence question about that date — sees a book that looks complete, with nothing to
 * warn it otherwise. Persisting the gap was CONSIDERED AND REJECTED: a skipped row has no
 * id, because the id is synthesized from venue, pair, side, price and submitted-at
 * (`synthesizeOrderId` in `./ingest.ts`, cited BY NAME now that it is across a module
 * boundary) and those are the very tokens that failed to parse. An un-idable durable
 * "something was here" could never be matched to a later import and so could never be
 * RETIRED — a permanent blot on every future report with no verb to close it.
 */
export function checkFundingCoverage(
  resting: readonly RestingOrder[],
  data: FundReviewData,
): FundingCoverage {
  const { reserves, rungsByReserve, unmatched } = attributeRungs(data, resting);

  // Refuse before summing anything. An unplaceable rung has no honest balance to be
  // compared against — reading it as a zero balance would render the ladder as
  // "over-committed" on a typo, and summing it into a foreign-denominated balance would
  // produce the confidently wrong slack that #172 was about.
  //
  // EVERY unplaceable rung goes back, of both classes, in the rungs' own order (#179).
  // This used to filter twice and return on the first non-empty filter, so a batch wrong
  // in both ways reported only one class and the operator paid a second full pass to
  // learn the other. Nothing here is recomputed and nothing is deduped: the list is
  // `attributeRungs`' own, and dedup — where it is right at all, which is per RESERVE for
  // `unfundable-reserve` and never for `currency-mismatch` — belongs at render time,
  // where the remedy is.
  if (unmatched.length > 0) {
    return { status: "unattributed", unmatched };
  }

  const balanceById = new Map(reserves.map((reserve) => [reserve.reserveId, reserve.balance]));
  const shortfalls: FundingShortfall[] = [];
  for (const [fundingReserveId, rungs] of rungsByReserve) {
    // Summed from the same rung rows the report lists, so the figure in the refusal
    // message and the figure the operator reads afterwards are one arithmetic.
    const committed = rungs.reduce((total, rung) => total + rung.committed, 0);
    const balance = balanceById.get(fundingReserveId) ?? 0;
    const slack = balance - committed;
    if (isNegativeSlack(slack)) {
      shortfalls.push({ fundingReserveId, balance, committed, slack });
    }
  }

  return shortfalls.length > 0 ? { status: "over-committed", shortfalls } : { status: "ok" };
}
