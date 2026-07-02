// Behavior locks for the realized-P&L
// closed book (#1) + invalidation watch (#4): the fold keeps a closed position as a
// blotter row with realized = proceeds − cost basis (tier-attributed), that realized
// is DESCRIPTIVE ONLY (never added to NAV), and an InvalidationMarked level drives a
// breach flag latest-wins. Reuses the mixed-tier cash-settlement genesis fixture.
import { describe, expect, it } from "vitest";
import {
  buildCompositionReport,
  foldEvents,
  type FundReviewData,
  type PortfolioEvent,
} from "./index.js";
import { DECISION, genesis } from "./cash-settlement.fixtures.js";

const CLOSE_ALT: PortfolioEvent = {
  id: "close-alt",
  asOf: "2026-06-05",
  type: "PositionClosed",
  positionId: "alt-pos",
  // Cost basis is 400 USD (c1 100 + c2 300); proceeds 360 → realized −40, a loss
  // that falls per Tier on the same 25% / 75% mix it was risked on.
  settlement: { reserveId: "tiered", proceeds: 360 },
};

describe("realized P&L — closed book", () => {
  it("keeps the closed position as a blotter row with realized = proceeds − cost basis", () => {
    const data = foldEvents(genesis(), [CLOSE_ALT]);

    // The open position is retired…
    expect(data.positions.find((p) => p.id === "alt-pos")).toBeUndefined();
    // …but preserved as a finished closed-book row instead of vanishing.
    expect(data.closedPositions).toHaveLength(1);
    const row = data.closedPositions![0]!;
    expect(row.positionId).toBe("alt-pos");
    expect(row.tempo).toBe("Pulse");
    expect(row.closedAsOf).toBe("2026-06-05");
    expect(row.costBasisUsd).toBeCloseTo(400, 6);
    expect(row.proceedsUsd).toBeCloseTo(360, 6);
    expect(row.realizedPnlUsd).toBeCloseTo(-40, 6);
  });

  it("attributes realized per Tier on the closed position's cost-basis mix", () => {
    const data = foldEvents(genesis(), [CLOSE_ALT]);
    const byTier = new Map(
      data.closedPositions![0]!.tierAttribution.map((t) => [t.tier, t]),
    );
    // 25% / 75% split: c1 gets 90 proceeds vs 100 cost (−10); c2 gets 270 vs 300 (−30).
    expect(byTier.get("c1")!.realizedPnlUsd).toBeCloseTo(-10, 6);
    expect(byTier.get("c2")!.realizedPnlUsd).toBeCloseTo(-30, 6);
  });

  it("rolls realized up by Tempo and by Tier in the report blotter", () => {
    const report = buildCompositionReport(foldEvents(genesis(), [CLOSE_ALT]));
    expect(report.closedBook.totalRealizedPnlUsd).toBeCloseTo(-40, 6);
    expect(report.closedBook.byTempo.find((r) => r.key === "Pulse")!.realizedPnlUsd).toBeCloseTo(-40, 6);
    expect(report.closedBook.byTier.find((r) => r.key === "c1")!.realizedPnlUsd).toBeCloseTo(-10, 6);
  });

  it("is descriptive only: realized is NOT added to NAV", () => {
    const data = foldEvents(genesis(), [CLOSE_ALT]);
    const withBook = buildCompositionReport(data).totals.fundValueUsd;
    // Blanking the closed book must not change fund value — it never fed NAV.
    const withoutBook = buildCompositionReport({ ...data, closedPositions: [] }).totals.fundValueUsd;
    expect(withBook).toBeCloseTo(withoutBook, 6);
  });
});

describe("invalidation watch", () => {
  const mark = (price: number): PortfolioEvent => ({
    id: `inval-${price}`,
    asOf: "2026-06-05",
    type: "InvalidationMarked",
    positionId: "alt-pos",
    price,
    direction: "below",
  });

  it("flags THESIS INVALIDATED when the mark breaches the level", () => {
    // alt-pos markPrice 40; a below-45 stop is breached (40 ≤ 45).
    const report = buildCompositionReport(foldEvents(genesis(), [mark(45)]));
    const row = report.invalidationWatch.find((r) => r.positionId === "alt-pos");
    expect(row?.breached).toBe(true);
  });

  it("reads OK when the mark is clear of the level", () => {
    const report = buildCompositionReport(foldEvents(genesis(), [mark(35)]));
    expect(report.invalidationWatch.find((r) => r.positionId === "alt-pos")?.breached).toBe(false);
  });

  it("is latest-wins: a later mark supersedes an earlier one", () => {
    // First clear (35, OK), then revised to 45 (breached) — latest wins.
    const report = buildCompositionReport(foldEvents(genesis(), [mark(35), mark(45)]));
    expect(report.invalidationWatch.find((r) => r.positionId === "alt-pos")?.breached).toBe(true);
  });
});

describe("closed book — as-of replay (fold invariant)", () => {
  // A position opened mid-stream and closed later, so the blotter GROWS over the
  // timeline: 0 rows before the first close, 1 row after it, 2 rows after the
  // second. Replaying the log to any past date must reproduce the closed book as
  // it stood on that date — "how much has PULSE made since genesis?" is answerable
  // at any point in time, not just now.
  const OPEN_BETA: PortfolioEvent = {
    id: "open-beta",
    asOf: "2026-06-10",
    type: "PositionOpened",
    position: {
      id: "beta-pos",
      portfolioId: "core",
      tempo: "Pulse",
      executionMode: "live",
      accountId: "venue",
      instrumentId: "btc-usd",
      direction: "long",
      currency: "USD",
      // Cost basis 100 USD, pure c1.
      lots: [{ quantity: 10, cost: 10, tier: "c1" }],
    },
    decision: DECISION,
    funding: { reserveId: "tiered", amount: 100 },
  };
  const CLOSE_BETA: PortfolioEvent = {
    id: "close-beta",
    asOf: "2026-06-15",
    type: "PositionClosed",
    positionId: "beta-pos",
    // Proceeds 150 → realized +50, a gain.
    settlement: { reserveId: "tiered", proceeds: 150 },
  };
  // Log order is close-alt (06-05), open-beta (06-10), close-beta (06-15).
  const log: PortfolioEvent[] = [CLOSE_ALT, OPEN_BETA, CLOSE_BETA];

  it("yields an empty blotter as-of before the first close", () => {
    const data = foldEvents(genesis(), log, "2026-06-04");
    // alt-pos is still open on 06-04; nothing has closed yet.
    expect(data.positions.find((p) => p.id === "alt-pos")).toBeDefined();
    expect(data.closedPositions).toHaveLength(0);
  });

  it("reproduces the one-row blotter as-of the first close date", () => {
    const data = foldEvents(genesis(), log, "2026-06-05");
    // Only alt-pos has closed by 06-05; beta-pos is not even open yet.
    expect(data.closedPositions).toHaveLength(1);
    expect(data.closedPositions![0]!.positionId).toBe("alt-pos");
    expect(data.positions.find((p) => p.id === "beta-pos")).toBeUndefined();
    const report = buildCompositionReport(data);
    expect(report.closedBook.totalRealizedPnlUsd).toBeCloseTo(-40, 6);
    expect(report.closedBook.byTempo.find((r) => r.key === "Pulse")!.realizedPnlUsd).toBeCloseTo(-40, 6);
  });

  it("shows beta-pos still open (not yet on the blotter) mid-timeline", () => {
    const data = foldEvents(genesis(), log, "2026-06-12");
    // 06-12: alt-pos closed, beta-pos open but not yet closed.
    expect(data.closedPositions).toHaveLength(1);
    expect(data.positions.find((p) => p.id === "beta-pos")).toBeDefined();
  });

  it("reproduces the full two-row blotter as-of the second close, matching a live fold", () => {
    const asOf = foldEvents(genesis(), log, "2026-06-15");
    // Both closes have landed by 06-15: alt-pos (−40) + beta-pos (+50) = +10 total.
    expect(asOf.closedPositions).toHaveLength(2);
    expect(buildCompositionReport(asOf).closedBook.totalRealizedPnlUsd).toBeCloseTo(10, 6);

    // Replay invariant: folding the whole log with NO as-of (current state) must
    // equal folding as-of the last event date — the blotter is stable once closed.
    const live = foldEvents(genesis(), log);
    expect(buildCompositionReport(live).closedBook.totalRealizedPnlUsd).toBeCloseTo(10, 6);
    expect(live.closedPositions!.map((r) => r.positionId).sort()).toEqual(
      asOf.closedPositions!.map((r) => r.positionId).sort(),
    );
  });
});

describe("closed book — mixed-entryFx total-exactness (fold invariant)", () => {
  // A close whose lots carry DIFFERENT entry FX. Native-MXN cost basis converts to
  // USD at each lot's own entryFx, so the per-tier USD cost weights (40 / 60 here)
  // DIVERGE from the native-cost weights (25 / 75) that `reserveDeltasForClose`
  // uses to apportion proceeds. The blended total stays exact; the per-tier split
  // is a documented approximation (see PRD #90 "Out of Scope" and the caveat on
  // `buildClosedPosition` / `reserveDeltasForClose`).
  function mixedFxGenesis(): FundReviewData {
    return {
      fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
      review: { asOf: "2026-06-01", usdMxn: 20 },
      portfolios: [{ id: "core", name: "Core" }],
      accounts: [{ id: "venue", name: "Venue", platform: "BITGET", currency: "USD" }],
      instruments: [{ id: "mx-inst", name: "MexAlt", symbol: "MXA", currency: "MXN" }],
      reserves: [
        {
          id: "usd-reserve",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "venue",
          currency: "USD",
          amount: 1000,
          lots: [
            { quantity: 600, tier: "c1" },
            { quantity: 400, tier: "c2" },
          ],
        },
      ],
      positions: [
        {
          id: "mx-pos",
          portfolioId: "core",
          tempo: "Pulse",
          executionMode: "live",
          accountId: "venue",
          instrumentId: "mx-inst",
          direction: "long",
          markPrice: 40,
          currency: "MXN",
          // Native MXN cost 100 (c1) + 300 (c2) → native weights 25% / 75%.
          // But at differing entry FX the USD cost is 10 (c1 @10) + 15 (c2 @20),
          // i.e. USD weights 40% / 60% — deliberately divergent from native.
          lots: [
            { quantity: 10, cost: 10, tier: "c1", entryFx: 10 },
            { quantity: 10, cost: 30, tier: "c2", entryFx: 20 },
          ],
        },
      ],
    };
  }
  // USD settlement: proceeds 50 USD → realized +25 total (proceeds 50 − cost 25).
  const CLOSE_MX: PortfolioEvent = {
    id: "close-mx",
    asOf: "2026-06-05",
    type: "PositionClosed",
    positionId: "mx-pos",
    settlement: { reserveId: "usd-reserve", proceeds: 50 },
  };

  it("keeps realizedPnlUsd and every rollup total exact despite mixed entry FX", () => {
    const data = foldEvents(mixedFxGenesis(), [CLOSE_MX]);
    const row = data.closedPositions![0]!;
    // Cost basis converts per-lot at its own entryFx: 100/10 + 300/20 = 10 + 15 = 25.
    expect(row.costBasisUsd).toBeCloseTo(25, 6);
    expect(row.proceedsUsd).toBeCloseTo(50, 6);
    expect(row.realizedPnlUsd).toBeCloseTo(25, 6);

    const report = buildCompositionReport(data);
    expect(report.closedBook.totalRealizedPnlUsd).toBeCloseTo(25, 6);
    expect(report.closedBook.byTempo.find((r) => r.key === "Pulse")!.realizedPnlUsd).toBeCloseTo(25, 6);
    // Tier rollups sum back to the exact total, even though each tier is approximate.
    const tierSum = report.closedBook.byTier.reduce((s, r) => s + r.realizedPnlUsd, 0);
    expect(tierSum).toBeCloseTo(25, 6);
  });

  it("splits per Tier by NATIVE cost weight — the documented approximation, not USD-cost-exact", () => {
    const data = foldEvents(mixedFxGenesis(), [CLOSE_MX]);
    const byTier = new Map(
      data.closedPositions![0]!.tierAttribution.map((t) => [t.tier, t]),
    );
    // Proceeds (50 USD) apportioned by NATIVE cost weight (25% / 75%):
    //   c1 → 12.5 proceeds − 10 cost = +2.5 ; c2 → 37.5 − 15 = +22.5.
    // NOT the USD-cost-weighted "honest" split (40% / 60% → c1 +10 / c2 +15).
    // This asserts the documented behavior, not a false-exact per-tier expectation.
    expect(byTier.get("c1")!.proceedsUsd).toBeCloseTo(12.5, 6);
    expect(byTier.get("c1")!.realizedPnlUsd).toBeCloseTo(2.5, 6);
    expect(byTier.get("c2")!.proceedsUsd).toBeCloseTo(37.5, 6);
    expect(byTier.get("c2")!.realizedPnlUsd).toBeCloseTo(22.5, 6);

    // Per-tier realized still sums to the exact blended total — the drift only
    // moves cents BETWEEN tiers, never off the total.
    const perTierRealized =
      byTier.get("c1")!.realizedPnlUsd + byTier.get("c2")!.realizedPnlUsd;
    expect(perTierRealized).toBeCloseTo(row_totalRealized(data), 6);
  });
});

/** The blended realized total of a single-close fold — the exact figure the
 * per-tier split must reconcile to. */
function row_totalRealized(data: FundReviewData): number {
  return data.closedPositions![0]!.realizedPnlUsd;
}
