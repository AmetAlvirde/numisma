// Compose concern — row dependencies. Answers the ONE question a composition row
// cannot answer about itself: *which instruments does this row's number descend
// from?* Built off the same shared canonical line set (`./canonical.ts`) the
// composition report is, so the two can never disagree about what a row is.
import type { FundReviewData } from "../contracts.js";
import { buildCanonicalState } from "./canonical.js";

/**
 * Row id → the instrument ids that row's value descends from, each listed once and
 * sorted. A `ReadonlyMap` rather than a plain object: these keys are data-derived
 * (`tempo:__proto__` is a legal tempo name) and a Map has no prototype to collide
 * with.
 */
export type RowDependencies = ReadonlyMap<string, readonly string[]>;

/**
 * THE ONE ENGINE CHANGE IN PRD #146 (C1, slice #151) — and it is a NEW EXPORT, not a
 * widening. `CompositionReport`, `DashboardSummary` and `CompositionRow` are frozen;
 * nothing here adds a field to any of them.
 *
 * WHY IT HAS TO EXIST. A `CompositionRow` id names either a grouping
 * (`portfolio:core`, `tempo:Wealth`, `account:t1-usd`, `tier:c1`) or an instrument
 * (`instrument:btc`). Only the last kind carries an instrument in its id — 19 of the
 * real fund's rows do not, on every one of the 28 anchors — so a consumer asking *which rows does this
 * instrument's absent mark poison* can either parse the id, which is structurally
 * impossible for the aggregates and actively WRONG for an account someone named after
 * a coin it does not hold, or be handed this map. There is no third option, and a
 * name-prefix guess is wrong in both directions: it suppresses rows whose numbers are
 * fine and, far worse, leaves rows standing whose numbers descend from a mark that
 * never arrived.
 *
 * WHY IT MAY LIVE IN THE ENGINE AT ALL. It is a fact about COMPOSITION, not about a
 * cloud — the engine stays unaware a cloud exists, and the TUI may read this too. The
 * projection's use of it is the thing that must NOT cross the wire: pushing a per-row
 * dependency list would disclose the fund's instrument-to-grouping structure, which
 * is D8 re-opened. The map is computed in the fold and only its CONCLUSIONS (a list
 * of suppressed row ids) ship.
 *
 * PURE, and it must stay pure: no IO, no clock, no filesystem (ADR-004's seam).
 *
 * The map is keyed by exactly the row ids `buildCompositionReport` emits, because
 * both are projections of the same `CanonicalLine[]` — `row-dependencies.test.ts`
 * asserts that correspondence in both directions rather than trusting this sentence.
 *
 * Reserve lines carry the synthetic instrument id `reserve`, which no price feed ever
 * marks. That is correct rather than a gap: cash does not descend from a mark, so a
 * missing mark never suppresses `tempo:Reserve` — while an ACCOUNT holding both cash
 * and a position does depend on that position's instrument, and does suppress.
 */
export function composeRowDependencies(data: FundReviewData): RowDependencies {
  const { canonicalLines } = buildCanonicalState(data);
  const dependencies = new Map<string, Set<string>>();

  const add = (rowId: string, instrumentId: string): void => {
    const existing = dependencies.get(rowId);
    if (existing) existing.add(instrumentId);
    else dependencies.set(rowId, new Set([instrumentId]));
  };

  for (const line of canonicalLines) {
    add(`portfolio:${line.portfolioId}`, line.instrumentId);
    add(`tempo:${line.tempoId}`, line.instrumentId);
    add(`account:${line.accountId}`, line.instrumentId);
    add(`instrument:${line.instrumentId}`, line.instrumentId);
    // The tier rows are the fifth partition and the one built from a DIFFERENT loop
    // upstream (`groupTierLines` walks lot-level `tierContributions`, not lines), so
    // they are the rows a map like this forgets. A line with no tier contributions
    // (a Reserve without a provenance split) contributes to no tier row, exactly as
    // it appears in no tier row.
    for (const contribution of line.tierContributions ?? []) {
      add(`tier:${contribution.tier}`, line.instrumentId);
    }
  }

  return new Map(
    [...dependencies].map(([rowId, ids]) => [rowId, [...ids].sort()]),
  );
}
