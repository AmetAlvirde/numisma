// Locks the trim/add/profit-split seams: (A) PositionTrimmed partial close (pro-rata
// within tier, partial closed-book
// row, NAV conserved, reserve credited); (B) PositionAddedTo lot append (never merged,
// ADR-002); the position-lot-sufficiency ingest gate; and (C) the derived,
// descriptive-only profit-split layer with its preferences-sidecar policy selector.
import {
  buildCompositionReport,
  buildEventReference,
  composeProfitSplit,
  crossReferenceEvent,
  foldEvents,
  parseEvent,
  pickPolicyAsOf,
  splitTierRemoval,
  type FundReviewData,
  type PortfolioEvent,
  type ProfitPolicyEntry,
} from "./index.js";
import { describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";

function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "binance-usd", name: "Desk", platform: "BINANCE", currency: "USD" }],
    instruments: [{ id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" }],
    reserves: [
      {
        id: "trade-usdt",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "binance-usd",
        currency: "USD",
        amount: 1000,
        lots: [{ quantity: 1000, tier: "c1" }],
      },
      {
        id: "sink-usdt",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "binance-usd",
        currency: "USD",
        amount: 100,
      },
    ],
    positions: [
      {
        id: "btc-pos",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        markPrice: 100,
        currency: "USD",
        lots: [
          { quantity: 4, cost: 50, tier: "c1" },
          { quantity: 2, cost: 60, tier: "c2" }, // two c2 lots -> pro-rata within tier
          { quantity: 2, cost: 80, tier: "c2" },
        ],
      },
    ],
  };
}

function accept(seed: FundReviewData, raw: unknown): PortfolioEvent {
  const parsed = parseEvent(raw);
  if (parsed.kind !== "ok") throw new Error(`parse: ${parsed.path} ${parsed.message}`);
  const reference = buildEventReference(seed, []);
  const crossRef = crossReferenceEvent(parsed.value, reference);
  if (crossRef.kind !== "ok") throw new Error(`crossref: ${crossRef.path} ${crossRef.message}`);
  return parsed.value;
}

describe("splitTierRemoval — pro-rata within a tier, exact residual", () => {
  it("removes pro-rata across a tier's lots preserving each lot's cost", () => {
    const lots = [
      { quantity: 4, cost: 50, tier: "c1" as const },
      { quantity: 2, cost: 60, tier: "c2" as const },
      { quantity: 2, cost: 80, tier: "c2" as const },
    ];
    const { removed, remaining } = splitTierRemoval(lots, "c2", 2); // half of the 4 c2 units
    expect(removed).toEqual([
      { quantity: 1, cost: 60, tier: "c2" },
      { quantity: 1, cost: 80, tier: "c2" },
    ]);
    // c1 untouched, each c2 lot halved.
    expect(remaining).toEqual([
      { quantity: 4, cost: 50, tier: "c1" },
      { quantity: 1, cost: 60, tier: "c2" },
      { quantity: 1, cost: 80, tier: "c2" },
    ]);
    expect(removed.reduce((s, l) => s + l.quantity, 0)).toBeCloseTo(2, 12);
  });
});

describe("PositionTrimmed — partial close", () => {
  it("emits a partial row, survives with reduced lots, credits the reserve, conserves NAV", () => {
    const seed = genesis();
    const baseNav = buildCompositionReport(foldEvents(seed, []).data).totals.fundValueUsd;
    // Remove all 4 c2 units at mark 100 -> proceeds 400; cost = 2*60 + 2*80 = 280.
    const trim = accept(seed, {
      id: "t1",
      asOf: "2026-06-02",
      type: "PositionTrimmed",
      positionId: "btc-pos",
      removals: [{ tier: "c2", quantity: 4 }],
      settlement: { reserveId: "sink-usdt", proceeds: 400 },
    });
    const data = foldEvents(seed, [trim]).data;
    const report = buildCompositionReport(data);

    const row = report.closedBook.rows.find((r) => r.positionId === "btc-pos");
    expect(row?.partial).toBe(true);
    expect(row?.proceedsUsd).toBeCloseTo(400, 6);
    expect(row?.costBasisUsd).toBeCloseTo(280, 6);
    expect(row?.realizedPnlUsd).toBeCloseTo(120, 6);
    // Survives with only its c1 lot.
    const survivor = data.positions.find((p) => p.id === "btc-pos");
    expect(survivor?.lots).toEqual([{ quantity: 4, cost: 50, tier: "c1" }]);
    // Reserve credited by the proceeds.
    expect(data.reserves.find((r) => r.id === "sink-usdt")?.amount).toBeCloseTo(500, 6);
    // NAV conserved: asset out at mark == cash in.
    expect(report.totals.fundValueUsd).toBeCloseTo(baseNav, 6);
  });

  it("fails loud at ingest when a removal exceeds the tier's lots", () => {
    const seed = genesis();
    const parsed = parseEvent({
      id: "t2",
      asOf: "2026-06-02",
      type: "PositionTrimmed",
      positionId: "btc-pos",
      removals: [{ tier: "c2", quantity: 10 }],
      settlement: { reserveId: "sink-usdt", proceeds: 1000 },
    });
    if (parsed.kind !== "ok") throw new Error("parse should pass");
    const result = crossReferenceEvent(parsed.value, buildEventReference(seed, []));
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("removals");
      expect(result.message).toContain("holds only 4");
    }
  });
});

describe("PositionAddedTo — appends, never merges (ADR-002)", () => {
  it("appends a new lot preserving its own cost/tier and debits the funding reserve", () => {
    const seed = genesis();
    const baseNav = buildCompositionReport(foldEvents(seed, []).data).totals.fundValueUsd;
    const add = accept(seed, {
      id: "a1",
      asOf: "2026-06-02",
      type: "PositionAddedTo",
      positionId: "btc-pos",
      lot: { tier: "c1", quantity: 1, cost: 100 }, // funded at mark -> NAV conserved
      funding: { reserveId: "trade-usdt", amount: 100 },
    });
    const data = foldEvents(seed, [add]).data;
    const pos = data.positions.find((p) => p.id === "btc-pos");
    const c1Lots = pos?.lots.filter((l) => l.tier === "c1") ?? [];
    expect(c1Lots).toEqual([
      { quantity: 4, cost: 50, tier: "c1" },
      { quantity: 1, cost: 100, tier: "c1" }, // distinct lot, not averaged
    ]);
    expect(data.reserves.find((r) => r.id === "trade-usdt")?.amount).toBeCloseTo(900, 6);
    expect(buildCompositionReport(data).totals.fundValueUsd).toBeCloseTo(baseNav, 6);
  });
});

describe("profit-split — descriptive-only, sidecar-driven", () => {
  const prefs: ProfitPolicyEntry[] = [
    { effectiveAt: "2026-06-01", split: { wealth: 60, reserve: 40 }, splitBasis: "highWaterMark", routingReserveId: "sink-usdt", reserveTargetPct: 10 },
    { effectiveAt: "2026-06-10", split: { wealth: 60, reserve: 40 }, splitBasis: "perClose", routingReserveId: "sink-usdt", reserveTargetPct: 10 },
  ];

  it("pickPolicyAsOf time-travels (latest entry <= asOf)", () => {
    expect(pickPolicyAsOf(prefs, "2026-06-05")?.splitBasis).toBe("highWaterMark");
    expect(pickPolicyAsOf(prefs, "2026-06-20")?.splitBasis).toBe("perClose");
    expect(pickPolicyAsOf(prefs)?.splitBasis).toBe("perClose");
  });

  it("obligation recomputes on basis toggle with no code change; empty-guarded", () => {
    const seed = genesis();
    // One winning trim (+120) and one losing full close (-x) to separate HWM vs perClose.
    const trim = accept(seed, {
      id: "t1", asOf: "2026-06-02", type: "PositionTrimmed", positionId: "btc-pos",
      removals: [{ tier: "c2", quantity: 4 }], settlement: { reserveId: "sink-usdt", proceeds: 400 },
    });
    const data = foldEvents(seed, [trim]).data;
    const hwm = composeProfitSplit(data, pickPolicyAsOf(prefs, "2026-06-05"), seed, 12.5);
    const perClose = composeProfitSplit(data, pickPolicyAsOf(prefs, "2026-06-20"), seed, 12.5);
    expect(hwm?.obligationUsd).toBeCloseTo(0.4 * 120, 6); // 40% of peak cumulative
    expect(perClose?.obligationUsd).toBeCloseTo(0.4 * 120, 6); // only winning close here
    expect(hwm?.reservePctOfNav).toBe(12.5);
    // Empty-guard: no policy -> no block.
    expect(composeProfitSplit(data, undefined, seed, 12.5)).toBeUndefined();
    // No closes -> no block (blanking leaves NAV untouched).
    expect(composeProfitSplit(foldEvents(seed, []).data, pickPolicyAsOf(prefs), seed, 12.5)).toBeUndefined();
  });
});
