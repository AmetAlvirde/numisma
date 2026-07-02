// PROTOTYPE (mvi 2026-07-01-realized-pnl). Behavior locks for the realized-P&L
// closed book (#1) + invalidation watch (#4): the fold keeps a closed position as a
// blotter row with realized = proceeds − cost basis (tier-attributed), that realized
// is DESCRIPTIVE ONLY (never added to NAV), and an InvalidationMarked level drives a
// breach flag latest-wins. Reuses the mixed-tier cash-settlement genesis fixture.
import { describe, expect, it } from "vitest";
import { buildCompositionReport, foldEvents, type PortfolioEvent } from "./index.js";
import { genesis } from "./cash-settlement.fixtures.js";

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
