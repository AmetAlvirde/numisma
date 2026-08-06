/**
 * THE ONE RESERVE ADMISSION POLICY, and the one rule for placing a rung against it.
 *
 * `./committed.ts` owns the one committed FORMULA. This module owns its ARGUMENTS: which
 * reserves may fund anything at all, and which rung belongs to which of them. Both
 * questions are answered here, once, for both surfaces — the `O1` import guard
 * (`./ingest.ts`) and the rendered available-capital report (`./available.ts`).
 *
 * WHY IT IS A MODULE AND NOT A CONVENTION. The two surfaces already shared the formula
 * and still disagreed, because they were handed different arguments (#172): the guard
 * took `data.reserves` straight off the fold via the import CLI, the report took
 * `buildCanonicalState(...).reserveReconciliation`. So a rung against a PAPER-mode or
 * UNSUPPORTED-CURRENCY reserve was FUNDABLE at the import boundary and UNPLACEABLE in the
 * report: the import said yes, and the rendered figure showed the capital as free. Worse,
 * the guard's reserve type carried no currency at all, so it summed a quote-denominated
 * `committed` into a native balance and found slack that does not exist.
 *
 * The fix is structural, not a second check bolted onto the guard: `attributeRungs` takes
 * the FUND, derives the admitted reserves itself, and is the only way either surface
 * learns what a fundable reserve is. There is no reserve-list parameter left for a
 * caller to get wrong — which is the point, because the previous defect was introduced
 * by a caller, not by either surface.
 *
 * ADMISSION IS DELEGATED, NOT RESTATED. The policy is `buildCanonicalState`'s: live
 * execution mode, supported currency, resolvable account reference. A second copy of
 * those rules here would be the same defect one layer down, so this module reads the
 * canonical state's reconciliation lines and adds nothing to them.
 *
 * PURE (ADR-001): no IO, no clock.
 */
import type { Currency, FundReviewData } from "../contracts.js";
import { buildCanonicalState } from "../compose/canonical.js";
import { committedRungs, type CommittedRung } from "./committed.js";
import type { RestingOrder } from "./select.js";

/**
 * A reserve that may fund a resting claim: admitted by the canonical state, and carrying
 * the CURRENCY it is denominated in.
 *
 * The currency is the field whose absence was the money-losing half of #172. It is not
 * optional and there is no constructor for this type outside {@link fundableReserves} —
 * a reserve nobody admitted cannot be spelled into existence by a caller.
 */
export interface FundableReserve {
  reserveId: string;
  /** The venue label the reconciliation line already uses, so the two read alike. */
  venueLabel: string;
  currency: Currency;
  /** The native balance exactly as the fold reported it. Untouched, NAV-safe. */
  balance: number;
  /** The same balance in USD, as `reserveReconciliation` reports it. */
  usdValue: number;
}

/** Why a resting rung could not be placed against any fundable reserve. */
export type UnmatchedReason = "unfundable-reserve" | "currency-mismatch";

/**
 * A rung that cannot be placed. Surfaced rather than dropped: a silently ignored rung is
 * capital reported as free that is not — and, at the import boundary, an accepted write
 * into an append-only file that the report will never be able to substantiate.
 */
export interface UnmatchedRung {
  rung: CommittedRung;
  reason: UnmatchedReason;
}

/** Every resting rung placed against the reserves that may fund it, or refused. */
export interface RungAttribution {
  /** The admitted reserves, in canonical (genesis insertion) order. */
  reserves: FundableReserve[];
  /** Placed rungs, keyed by `reserveId`. A reserve with no rungs is simply absent. */
  rungsByReserve: Map<string, CommittedRung[]>;
  unmatched: UnmatchedRung[];
}

/**
 * The reserves that may fund a resting claim — the canonical state's reconciliation
 * lines, and nothing else.
 *
 * A paper reserve, an unsupported currency or a dangling account reference is excluded
 * here for exactly the reasons it is excluded from the composition, with no second
 * admission policy to keep in step.
 *
 * WHAT EXCLUSION MEANS, and it is why {@link UnmatchedReason}'s first member is spelled
 * `unfundable-reserve`. Every one of those three exclusions describes a reserve the
 * operator can plainly SEE in the fund file: it exists, it is spelled correctly, and it
 * still may not fund a live claim. This function answers "can this fund anything?", never
 * "does this exist?" — so a rung refused against its output is unfundable, not unknown.
 */
export function fundableReserves(data: FundReviewData): FundableReserve[] {
  return buildCanonicalState(data).reserveReconciliation.map((line) => ({
    reserveId: line.reserveId,
    venueLabel: line.venueLabel,
    currency: line.currency,
    balance: line.balance,
    usdValue: line.usdValue,
  }));
}

/**
 * Place every resting BUY rung against the reserve it DECLARES, or refuse it with the
 * reason.
 *
 * A rung matches only if its declared `fundingReserveId` names an admitted reserve AND
 * the currencies agree. The currency check is not ceremony: `committed` is denominated in
 * the rung's QUOTE currency, and adding a differently-denominated sum into a native
 * balance would produce a confidently wrong number rather than an obviously missing one.
 * Cross-currency funding is not designed; it is refused, identically, on both sides.
 *
 * Rung order is preserved within a reserve, and the refusal order is the rungs' own — so
 * the guard and the report name THE SAME RUNGS WITH THE SAME REASONS, because they name
 * them off THIS list. The `unmatched` array returned here is the one `checkFundingCoverage`
 * hands back verbatim on its `unattributed` arm (`./ingest.js`) and the one
 * `composeAvailableCapital` renders (`./available.js`); neither filters it, dedups it or
 * re-derives it.
 *
 * IT NO LONGER SAYS "IN THE SAME ORDER", AND THAT WORDING WAS FALSE BEFORE #179 AS WELL
 * AS AFTER IT. Before: the guard's message named a deduped SET of reserve ids for one
 * class while the report named every rung of both, so a mixed batch had no common order
 * to preserve. After: both receive this list in the rungs' own order, but the import
 * boundary's message GROUPS it — unfundable rungs under their reserve id, mismatched
 * rungs per rung — because one class's remedy is per reserve and the other's is per rung.
 * The grouping is stable, so the rungs' own order survives inside each group; across
 * groups an interleaved batch is deliberately reordered. Order was never the property
 * worth promising. Sameness of the rungs and their reasons is, and that one is now an
 * identity rather than an assertion.
 */
export function attributeRungs(
  data: FundReviewData,
  resting: readonly RestingOrder[],
): RungAttribution {
  const reserves = fundableReserves(data);
  const currencyOf = new Map(reserves.map((entry) => [entry.reserveId, entry.currency]));

  const rungsByReserve = new Map<string, CommittedRung[]>();
  const unmatched: UnmatchedRung[] = [];

  for (const rung of committedRungs(resting)) {
    const currency = currencyOf.get(rung.fundingReserveId);
    if (currency === undefined) {
      // A reserve {@link fundableReserves} did not admit is refused rather than read as a
      // zero balance: an unadmitted reserve would otherwise render the whole ladder as
      // "over-committed", or worse, be silently attributed capacity nobody granted it.
      // The id usually EXISTS in the operator's own fund file — it is the admission that
      // is missing, which is why the reason is `unfundable-reserve` and not a claim that
      // the reserve is unknown (#180).
      unmatched.push({ rung, reason: "unfundable-reserve" });
      continue;
    }
    if (currency !== rung.currency) {
      unmatched.push({ rung, reason: "currency-mismatch" });
      continue;
    }
    const existing = rungsByReserve.get(rung.fundingReserveId);
    if (existing) existing.push(rung);
    else rungsByReserve.set(rung.fundingReserveId, [rung]);
  }

  return { reserves, rungsByReserve, unmatched };
}
