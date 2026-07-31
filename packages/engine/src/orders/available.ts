/**
 * `S7` — committed vs available, per reserve, with the rungs that substantiate it.
 *
 * A NEW EXPORT, NOT A WIDENING. `CompositionReport`, `DashboardSummary` and
 * `CompositionRow` are frozen; nothing here adds a field to any of them, and the engine
 * contract diff for this slice is empty. The precedent is `composeRowDependencies`,
 * which states the same rule in its own docstring and, like this, stands on
 * `buildCanonicalState` rather than on the report the dashboard renders — so the two
 * can never disagree about what a reserve is.
 *
 * WHY IT MAY NOT BE A WIDENING. `D4`: **a resting order encumbers AVAILABILITY, never
 * VALUE.** Available is a THIRD number, not a modification of an existing one. That is
 * the entire reason this increment stays off the cost model, off the fold and off NAV —
 * and it is only structurally true if the number is computed OVER the canonical state
 * instead of INSIDE it. A field on `CompositionRow` would be one refactor away from
 * being summed into a total; a separate export cannot be.
 *
 * PURE (ADR-001): no IO, no clock. The caller supplies the fund data and the orders
 * that were resting at the boundary it cares about (`pickRestingOrdersAsOf`). The two
 * files are joined HERE, at read time, and never merged.
 */
import type { Currency, FundReviewData } from "../contracts.js";
import { attributeRungs, type UnmatchedRung } from "./attribution.js";
import type { CommittedRung } from "./committed.js";
import type { RestingOrder } from "./select.js";

export type { UnmatchedReason, UnmatchedRung } from "./attribution.js";

/** The three numbers, for one live reserve, plus what substantiates the middle one. */
export interface ReserveCapital {
  reserveId: string;
  /** The venue label the reconciliation line already uses, so the two read alike. */
  venueLabel: string;
  currency: Currency;
  /**
   * VALUE — the reserve's native balance exactly as the fold reported it. Untouched,
   * NAV-safe, byte-identical to what it is without this module. It is repeated here
   * rather than left for the caller to fetch so a renderer cannot pair a committed
   * figure with a balance from a different read.
   */
  value: number;
  /** The same balance in USD, as `reserveReconciliation` reports it. */
  usdValue: number;
  /** COMMITTED — `Σ price × (quantity − filled_quantity)` over this reserve's rungs. */
  committed: number;
  /**
   * AVAILABLE — `value − committed`. This is also `T4`'s `slack`, under the name the
   * operator reads it by; the invariant is that it is `≥ 0`, ALWAYS, and the direction
   * carries the meaning: a negative value is an IMPOSSIBLE state, not a warning. The
   * venue would not have accepted orders the account could not fund, so it means the
   * attribution is wrong. It is REJECTED at the import boundary (`checkFundingCoverage`,
   * the only path that writes) rather than here — this module renders what is, and a
   * renderer that quietly clamped a negative to zero would hide the very defect the
   * invariant exists to expose.
   */
  available: number;
  /**
   * The rungs behind `committed`, summing to it exactly. They ship because the repo's
   * own ceiling rule says below the tap may hold only what SUBSTANTIATES a renderable
   * verdict — a committed figure with no rungs behind it is an unsubstantiated verdict —
   * and because this is the reconciliation surface `ReserveReconciliationLine` already
   * set the pattern for: rendered so the operator can eyeball it against the real venue.
   */
  rungs: CommittedRung[];
}

// `UnmatchedReason` and `UnmatchedRung` are RE-EXPORTED from `./attribution.js` (see the
// import above) rather than declared here. They are the vocabulary of the placement
// rule, and that rule is now shared with the import guard — two declarations of the same
// two reasons is exactly the drift #172 was about.

export interface AvailableCapitalReport {
  /** One entry per LIVE reserve the canonical state admitted, in its order. */
  reserves: ReserveCapital[];
  unmatched: UnmatchedRung[];
}

/**
 * Compose the three numbers, per reserve, over the SHARED attribution (`./attribution.js`).
 *
 * Neither the reserve set nor the placement rule lives here any more. Both come from
 * `attributeRungs`, which the `O1` import guard also calls — so the report cannot admit a
 * reserve the guard would refuse, and cannot refuse a rung the guard would fund. That
 * symmetry used to be a claim in a docstring; it is now the only code path there is.
 *
 * What remains here is the ARITHMETIC and the rendering shape: value, committed,
 * available, and the rungs that substantiate the middle one.
 */
export function composeAvailableCapital(
  data: FundReviewData,
  resting: readonly RestingOrder[],
): AvailableCapitalReport {
  const { reserves: fundable, rungsByReserve, unmatched } = attributeRungs(data, resting);

  const reserves = fundable.map((line) => {
    const rungs = rungsByReserve.get(line.reserveId) ?? [];
    // Summed from the rung rows themselves, so the list the operator reads and the
    // figure above it are the same arithmetic, not two agreeing implementations.
    const committed = rungs.reduce((total, rung) => total + rung.committed, 0);
    return {
      reserveId: line.reserveId,
      venueLabel: line.venueLabel,
      currency: line.currency,
      value: line.balance,
      usdValue: line.usdValue,
      committed,
      available: line.balance - committed,
      rungs,
    };
  });

  return { reserves, unmatched };
}
