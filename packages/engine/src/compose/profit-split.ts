/**
 * The profit-split layer — DERIVED, DESCRIPTIVE-ONLY (no new verb; mirrors the
 * realized-P&L closed book).
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
import type { FundReviewData } from "../contracts.js";

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
 * default). `routingReserveId` names the RESERVE-tempo profit sink (the target of the
 * deferred routing fast-follow; v1 is obligation-only and does not infer flow into it).
 * `reserveTargetPct` is the Reserve's target share of NAV.
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
  /** The Reserve's actual % of total NAV (from the dashboard's Reserve focus). */
  reservePctOfNav: number;
  reserveTargetPct: number;
}

/**
 * Compose the profit-split view from the folded read model and the as-of policy.
 * Returns undefined (the empty-guard) when there is no policy or no realized closes,
 * so the dashboard block renders nothing and NAV is untouched.
 *
 * The obligation is computed on the EXACT cumulative TOTAL realized (not the
 * approximate per-tier split — it inherits #90's per-tier caveat honestly).
 *
 * OBLIGATION-ONLY (PRD #96 R1): the view carries only the honestly computable
 * obligation plus the RESERVE %-of-NAV-vs-target context. It deliberately does NOT
 * infer a routed-flow / unallocated balance from the sink Reserve's inflow — that
 * destination inference is discarded, not shipped; the running "unallocated until
 * routed" balance is a deferred fast-follow requiring an explicit routing signal.
 *
 * `_genesis` is retained positionally for call-site compatibility (the routed-flow
 * inference that once needed the genesis Reserve balance is gone).
 */
export function composeProfitSplit(
  data: FundReviewData,
  policy: ProfitPolicy | undefined,
  _genesis: FundReviewData,
  reservePctOfNav: number,
): ProfitSplit | undefined {
  const rows = data.closedPositions ?? [];
  if (!policy || rows.length === 0) {
    return undefined;
  }

  const denominator = policy.split.wealth + policy.split.reserve;
  const splitFractionReserve = denominator === 0 ? 0 : policy.split.reserve / denominator;

  // Order the closed book by close date so the running cumulative — and its high-water
  // mark — replay in the order profit was realized. Same-day closes keep their INPUT
  // order (the fold pushes rows in realization/event order): a `localeCompare` tie-break
  // on positionId would make the peak — and thus the HWM obligation — depend on id
  // spelling rather than on when profit was realized. `sort` is stable, so returning 0
  // for equal dates preserves that realization order.
  const ordered = [...rows].sort((a, b) =>
    a.closedAsOf < b.closedAsOf ? -1 : a.closedAsOf > b.closedAsOf ? 1 : 0,
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

  return {
    basis: policy.splitBasis,
    splitFractionReserve,
    cumulativeNetRealizedUsd: cumulative,
    peakCumulativeUsd: peak,
    obligationUsd,
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
