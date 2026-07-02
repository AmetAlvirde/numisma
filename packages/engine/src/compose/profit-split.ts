/**
 * PROTOTYPE (mvi 2026-07-02-partial-close-profit-split). The profit-split layer —
 * DERIVED, DESCRIPTIVE-ONLY (no new verb; mirrors PRD #90's closed book).
 *
 * The fund's flagship split rule is COMPUTABLE from the realized closed book plus a
 * PREFERENCES policy that lives in a time-stamped sidecar DECOUPLED from the event log
 * (see `pickPolicyAsOf`). Composition happens at READ time as a second input:
 *
 *   composeProfitSplit(foldEvents(genesis, log, asOf), pickPolicyAsOf(prefs, asOf), genesis, reservePctOfNav)
 *
 * so the log folds standalone to the pure #90 book with ZERO preferences, and the
 * obligation is layered on top faithfully as-of. Nothing here is added to NAV —
 * blanking this block leaves NAV unchanged (extends #90's descriptive-only lock).
 */
import type { ClosedPositionRecord, FundReviewData, ReserveRecord } from "../contracts.js";
import { toUsd } from "../internal.js";

/**
 * Loss behavior of the split obligation. `highWaterMark` (default): the obligation
 * basis is the PEAK cumulative net realized — drawdowns must be recovered before new
 * obligation accrues, and there is NO clawback. `perClose`: the obligation accrues on
 * each winning close's realized gain, losses ignored. Selectable so toggling proves
 * the behavior is CONFIGURATION, not code.
 */
export type SplitBasis = "highWaterMark" | "perClose";

/**
 * The fund's profit-split policy. `split` is the x/y routing ratio (this fund:
 * wealth 60 / reserve 40 — configurable, never hardcoded outside the sidecar
 * default). `routingReserveId` is the profit-sink Reserve routing is INFERRED against
 * (no Transfer purpose-tag). `reserveTargetPct` is the Reserve's target share of NAV.
 */
export interface ProfitPolicy {
  split: { wealth: number; reserve: number };
  splitBasis: SplitBasis;
  routingReserveId: string;
  reserveTargetPct: number;
}

/** One append-only sidecar entry: a policy stamped with the date it takes effect. */
export interface ProfitPolicyEntry extends ProfitPolicy {
  effectiveAt: string;
}

/**
 * PURE selector: the latest sidecar entry whose `effectiveAt ≤ asOf` (or the latest
 * entry overall when `asOf` is omitted). This gives faithful policy time-travel —
 * replaying an as-of date shows the policy that was in effect then — without ever
 * polluting the event log. Returns undefined when no entry is yet in effect.
 */
export function pickPolicyAsOf(
  prefs: ProfitPolicyEntry[],
  asOf?: string,
): ProfitPolicyEntry | undefined {
  const eligible = prefs
    .filter((entry) => asOf === undefined || entry.effectiveAt <= asOf)
    .sort((a, b) => (a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : 0));
  return eligible.at(-1);
}

/** The computed, descriptive-only profit-split view for the dashboard block. */
export interface ProfitSplit {
  basis: SplitBasis;
  /** Fraction of gains obligated to the Reserve = reserve / (wealth + reserve). */
  splitFractionReserve: number;
  /** Exact cumulative TOTAL realized (net of losses) across the closed book, USD. */
  cumulativeNetRealizedUsd: number;
  /** Peak cumulative net realized ever reached — the high-water mark, USD. */
  peakCumulativeUsd: number;
  /** The split obligation to the Reserve on the chosen basis, USD. */
  obligationUsd: number;
  /** Cash already routed into the sink Reserve (net inflow since genesis), USD. */
  routedFlowUsd: number;
  /** Obligation not yet covered by routed flow, USD (never negative). */
  unallocatedUsd: number;
  /** The Reserve's actual % of total NAV (from the dashboard's Reserve focus). */
  reservePctOfNav: number;
  reserveTargetPct: number;
}

function reserveUsd(reserve: ReserveRecord | undefined, usdMxn: number): number {
  return reserve ? toUsd(reserve.amount, reserve.currency, usdMxn) : 0;
}

/**
 * Compose the profit-split view from the folded read model and the as-of policy.
 * Returns undefined (the empty-guard) when there is no policy or no realized closes,
 * so the dashboard block renders nothing and NAV is untouched.
 *
 * The obligation is computed on the EXACT cumulative TOTAL realized (not the
 * approximate per-tier split — it inherits #90's per-tier caveat honestly).
 * `routedFlowUsd` is INFERRED by the destination Reserve: its net USD inflow since
 * genesis (folded balance − genesis balance). That is the descriptive approximation
 * this prototype makes — every dollar in the sink counts as routed profit — rather
 * than tagging a Transfer purpose.
 */
export function composeProfitSplit(
  data: FundReviewData,
  policy: ProfitPolicy | undefined,
  genesis: FundReviewData,
  reservePctOfNav: number,
): ProfitSplit | undefined {
  const rows = data.closedPositions ?? [];
  if (!policy || rows.length === 0) {
    return undefined;
  }

  const denominator = policy.split.wealth + policy.split.reserve;
  const splitFractionReserve = denominator === 0 ? 0 : policy.split.reserve / denominator;

  // Order the closed book by close date (then a stable tie-break) so the running
  // cumulative — and its high-water mark — replay in the order profit was realized.
  const ordered = [...rows].sort((a, b) =>
    a.closedAsOf < b.closedAsOf
      ? -1
      : a.closedAsOf > b.closedAsOf
        ? 1
        : a.positionId.localeCompare(b.positionId),
  );

  let cumulative = 0;
  let peak = 0;
  let winningSum = 0;
  for (const row of ordered) {
    cumulative += row.realizedPnlUsd;
    if (cumulative > peak) {
      peak = cumulative;
    }
    if (row.realizedPnlUsd > 0) {
      winningSum += row.realizedPnlUsd;
    }
  }

  const basisAmount = policy.splitBasis === "perClose" ? winningSum : Math.max(0, peak);
  const obligationUsd = splitFractionReserve * basisAmount;

  const routedFlowUsd =
    reserveUsd(
      data.reserves.find((reserve) => reserve.id === policy.routingReserveId),
      data.review.usdMxn,
    ) -
    reserveUsd(
      genesis.reserves.find((reserve) => reserve.id === policy.routingReserveId),
      genesis.review.usdMxn,
    );

  return {
    basis: policy.splitBasis,
    splitFractionReserve,
    cumulativeNetRealizedUsd: cumulative,
    peakCumulativeUsd: peak,
    obligationUsd,
    routedFlowUsd,
    unallocatedUsd: Math.max(0, obligationUsd - routedFlowUsd),
    reservePctOfNav,
    reserveTargetPct: policy.reserveTargetPct,
  };
}

/** A convenient default: this fund's locked 60/40 high-water-mark policy. */
export function defaultProfitPolicyEntry(effectiveAt: string, routingReserveId: string): ProfitPolicyEntry {
  return {
    effectiveAt,
    split: { wealth: 60, reserve: 40 },
    splitBasis: "highWaterMark",
    routingReserveId,
    reserveTargetPct: 10,
  };
}
