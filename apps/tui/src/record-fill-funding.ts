/**
 * THE CASH LEG AND THE TIER — the second half of the interview `record-fill.ts` used to
 * hold inline (#audit-14).
 *
 * IT LEFT FOR THE REASON `record-fill-ladder-target.ts` LEFT. The host file's header
 * argues a DURABILITY protocol; this decides how much cash the fill debits and which
 * Capital Tier the lot is born into. Neither question moves when the two-file rename order
 * or the rollback argument moves, and the `D1` override guard has changed twice for reasons
 * (#177, #179) that never touched a write.
 *
 * IT TAKES THE PROMPT CHANNEL, NOT THE IO BAG — `ask` and nothing else, the narrowing
 * `declareFunding` (`import-orders-funding-declaration.ts:64`) established. Unlike its
 * ladder-target sibling this needs no `out`: every line it emits is a prompt or a refusal.
 *
 * IT IS HANDED THE RESERVE, NOT ASKED TO FIND ONE. `record-fill.ts` resolves
 * `filled.fundingReserveId` against the fold ONCE and both halves of the interview are
 * handed the result, so `unknown-reserve` stays a single refusal in a single place rather
 * than a duplicated lookup that could drift.
 *
 * REJECTIONS ARE RETURNED, NOT PRINTED, and every message is byte-identical to what the
 * inline code fed `reject(io, …)`. The reason union is declared narrowly here rather than
 * imported from `RecordFillRejection` — no back-edge — and is assignable at the call site.
 *
 * ITS TWO QUESTIONS SPLIT ON #388. The capital tier already refuses anything that is not
 * `c1`/`c2`/`c3`, so an `UNANSWERED` joins the blank there and stays `ambiguous-tier`, message and all.
 * `Cash debited [n]` did not: a blank takes the proposed figure, so an abandoned terminal
 * used to debit a reserve for an amount nobody stated. It abandons now — a fourth arm on
 * the outcome, matching the one `authorLadderTarget` already had, rather than a new reason
 * token, because the operator declined nothing and there is nothing to correct.
 */
import {
  composeAvailableCapital,
  deriveFundingTier,
  type CapitalTier,
  type CommittedRung,
  type FundReviewData,
  type ReserveRecord,
  type RestingOrder,
} from "@numisma/engine";
import { UNANSWERED, type Answer } from "./prompt-channel.js";

export type FundingOutcome =
  | { status: "resolved"; fundingAmount: number; tier: CapitalTier }
  /** A question here went unanswered. The caller has written nothing. */
  | { status: "abandoned"; message: string }
  | {
      status: "rejected";
      reason: "bad-quantity" | "uncovered-override" | "ambiguous-tier";
      message: string;
    };

/**
 * Ask for the cash debited and resolve the lot's tier.
 *
 * `folded` and `resting` are here for ONE reason — `composeAvailableCapital`, which is only
 * reached on an upward override. They are the report's own inputs so the guard weighs the
 * figure the operator was shown, rather than a second implementation of `value − committed`
 * that could drift from it.
 */
export async function resolveFunding(
  ask: (question: string) => Promise<Answer>,
  folded: FundReviewData,
  resting: readonly RestingOrder[],
  reserve: ReserveRecord,
  filled: CommittedRung,
  filledQuantity: number,
): Promise<FundingOutcome> {
  const proposedFunding = filled.price * filledQuantity;
  const cashReply = await ask(`Cash debited [${proposedFunding}]: `);
  // THE `[n]` DEFAULT IS AN ANSWER THE OPERATOR GIVES BY PRESSING ENTER, and an
  // unanswered question gives nothing. Taking the proposal here would debit a reserve on
  // a keystroke nobody made.
  if (cashReply === UNANSWERED) {
    return {
      status: "abandoned",
      message: `nobody answered the cash debited for this fill, and ${proposedFunding} is a proposal, not an answer`,
    };
  }
  const fundingAnswer = cashReply.trim();
  const fundingAmount = fundingAnswer === "" ? proposedFunding : Number(fundingAnswer);
  if (!Number.isFinite(fundingAmount) || fundingAmount <= 0) {
    return {
      status: "rejected",
      reason: "bad-quantity",
      message: `'${fundingAnswer}' is not a positive cash amount`,
    };
  }

  // `D1` (#177) — THE ACT IS EXEMPT; THE OVERRIDE IS GUARDED, and only upward.
  //
  // The arithmetic decides where the guard goes. `available = value − committed`, and this
  // act moves BOTH terms: the `orderFilled` line drops `committed` by `price × quantity`
  // and the cash leg drops `value` by the amount debited. So
  //
  //     Δavailable = price × quantity − cash debited
  //
  // and the DEFAULT answer — `proposedFunding`, the two multiplied — is exactly
  // available-neutral BY CONSTRUCTION. The fill itself therefore cannot break the
  // `available ≥ 0` invariant no matter what shape the book is in, which is why this flow
  // does NOT call `checkFundingCoverage`: that guard weighs the WHOLE book and refuses it
  // if ANY rung anywhere in it is unplaceable (#179), so one stale `fundingReserveId` on
  // an unrelated rung would refuse a fill that really happened at the venue. A fill is an
  // observed fact; the flow does not get to disbelieve it.
  //
  // The override is not an observed fact. It is the operator asserting a figure nothing at
  // the venue vouches for, and it is the ONLY input in this act that can drive a reserve
  // negative. What is weighed is the EXCESS over the neutral figure — never "post-act
  // available ≥ 0", which would brick every fill, neutral ones included, on any book that
  // already sits negative from some other cause. A downward correction FREES availability
  // and never reaches this branch.
  const excess = fundingAmount - proposedFunding;
  if (excess > 0) {
    // The report's own arithmetic, over the report's own admission policy — not a second
    // implementation of `value − committed` that could drift from the rendered figure.
    const capital = composeAvailableCapital(folded, resting);
    const funder = capital.reserves.find((entry) => entry.reserveId === reserve.id);
    if (!funder) {
      return {
        status: "rejected",
        reason: "uncovered-override",
        message:
          `you asked to debit ${fundingAmount} against '${reserve.id}' — ${excess} more than the ` +
          `${proposedFunding} this fill accounts for — but the available-capital report does ` +
          `not place that reserve (paper execution mode, an unsupported currency, a dangling ` +
          `account reference), so the excess cannot be weighed against anything. The fill ` +
          `itself is recordable at the default figure`,
      };
    }
    if (excess > funder.available) {
      return {
        status: "rejected",
        reason: "uncovered-override",
        message:
          `you asked to debit ${fundingAmount} against '${reserve.id}', ${excess} more than the ` +
          `${proposedFunding} this fill accounts for, and '${reserve.id}' has only ` +
          `${funder.available} available (${funder.value} balance less ${funder.committed} ` +
          `committed). The fill's own arithmetic is available-neutral; only the extra is ` +
          `spending capital that is not there, and a negative available is an IMPOSSIBLE ` +
          `state rather than a warning. Record the fill at ${proposedFunding}, or record the ` +
          `fee or funding difference as its own act`,
      };
    }
  }

  const fundingTier = deriveFundingTier(reserve);
  if (fundingTier.status === "derived") {
    return { status: "resolved", fundingAmount, tier: fundingTier.tier };
  }
  if (fundingTier.status === "ambiguous") {
    // `T4` — the tier ordering was applied ONCE, at Transfer time. Asking here would
    // re-decide it, which is the one thing this increment must not do.
    return {
      status: "rejected",
      reason: "ambiguous-tier",
      message:
        `'${reserve.id}' holds ${fundingTier.tiers.join(" and ")}; the tier ordering was decided ` +
        `at Transfer time and this act does not get to re-decide it`,
    };
  }
  // A QUESTION THAT ALREADY REFUSED, AND IT KEEPS ITS REFUSAL WORD FOR WORD. A blank is
  // not a capital tier and neither is a question nobody answered, so the sentinel reads as
  // the empty string here rather than earning an arm of its own. That collapse is safe
  // ONLY because this prompt advertises no default; `Cash debited [n]` above does, which
  // is why it checks the sentinel itself.
  const tierAnswer = await ask("  Capital tier for this lot (c1/c2/c3): ");
  const answer = tierAnswer === UNANSWERED ? "" : tierAnswer.trim();
  if (answer !== "c1" && answer !== "c2" && answer !== "c3") {
    return {
      status: "rejected",
      reason: "ambiguous-tier",
      message: `'${answer}' is not a capital tier`,
    };
  }
  return { status: "resolved", fundingAmount, tier: answer };
}
