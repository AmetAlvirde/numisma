// The PURE half of the hardened preferences sidecar: `pickPolicyAsOf` as-of
// selection (latest entry with
// effectiveAt <= asOf, non-monotonic input handled deterministically, empty/undefined
// guards) and the standalone-fold guarantee — the event log folds to the pure #90 book
// with NO sidecar present, and the descriptive-only profit-split block stays empty so
// NAV is untouched. Prior art: #90/#93 as-of replay locks.
import {
  buildCompositionReport,
  buildEventReference,
  composeProfitSplit,
  crossReferenceEvent,
  foldEvents,
  parseEvent,
  pickPolicyAsOf,
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
          { quantity: 2, cost: 60, tier: "c2" },
          { quantity: 2, cost: 80, tier: "c2" },
        ],
      },
    ],
  };
}

function accept(seed: FundReviewData, raw: unknown): PortfolioEvent {
  const parsed = parseEvent(raw);
  if (parsed.kind !== "ok") throw new Error(`parse: ${parsed.path} ${parsed.message}`);
  const crossRef = crossReferenceEvent(parsed.value, buildEventReference(seed, []));
  if (crossRef.kind !== "ok") throw new Error(`crossref: ${crossRef.path} ${crossRef.message}`);
  return parsed.value;
}

function entry(effectiveAt: string, splitBasis: "highWaterMark" | "perClose"): ProfitPolicyEntry {
  return {
    effectiveAt,
    split: { wealth: 60, reserve: 40 },
    splitBasis,
    routingReserveId: "sink-usdt",
    reserveTargetPct: 10,
  };
}

describe("pickPolicyAsOf — pure as-of selection", () => {
  const prefs: ProfitPolicyEntry[] = [
    entry("2026-06-01", "highWaterMark"),
    entry("2026-06-10", "perClose"),
  ];

  it("returns the latest entry whose effectiveAt <= asOf", () => {
    expect(pickPolicyAsOf(prefs, "2026-06-01")?.splitBasis).toBe("highWaterMark");
    expect(pickPolicyAsOf(prefs, "2026-06-05")?.splitBasis).toBe("highWaterMark");
    expect(pickPolicyAsOf(prefs, "2026-06-10")?.splitBasis).toBe("perClose");
    expect(pickPolicyAsOf(prefs, "2026-06-20")?.splitBasis).toBe("perClose");
  });

  it("returns the latest entry overall when asOf is omitted", () => {
    expect(pickPolicyAsOf(prefs)?.splitBasis).toBe("perClose");
  });

  it("returns undefined when asOf precedes every entry, or prefs is empty", () => {
    expect(pickPolicyAsOf(prefs, "2026-05-01")).toBeUndefined();
    expect(pickPolicyAsOf([])).toBeUndefined();
    expect(pickPolicyAsOf([], "2026-06-05")).toBeUndefined();
  });

  it("handles NON-MONOTONIC append order deterministically (sorts by effectiveAt)", () => {
    // Same policies, but the file appended them out of date order.
    const scrambled: ProfitPolicyEntry[] = [
      entry("2026-06-10", "perClose"),
      entry("2026-06-01", "highWaterMark"),
    ];
    expect(pickPolicyAsOf(scrambled, "2026-06-05")?.splitBasis).toBe("highWaterMark");
    expect(pickPolicyAsOf(scrambled, "2026-06-20")?.splitBasis).toBe("perClose");
    expect(pickPolicyAsOf(scrambled)?.splitBasis).toBe("perClose");
  });

  it("is a pure function of its inputs (no mutation of the prefs array)", () => {
    const input: ProfitPolicyEntry[] = [entry("2026-06-10", "perClose"), entry("2026-06-01", "highWaterMark")];
    const snapshot = [...input];
    pickPolicyAsOf(input, "2026-06-20");
    expect(input).toEqual(snapshot);
  });
});

describe("standalone fold — no sidecar present, still the pure #90 book", () => {
  it("folds to the closed book and leaves the profit-split block empty (NAV untouched)", () => {
    const seed = genesis();
    const baseNav = buildCompositionReport(foldEvents(seed, []).data).totals.fundValueUsd;

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

    // The log folds standalone: the realized closed book exists with no sidecar.
    expect(report.closedBook.rows.some((r) => r.positionId === "btc-pos")).toBe(true);

    // With an empty sidecar the pure selector yields no policy, so the descriptive-only
    // block is empty and NAV is exactly the standalone-fold NAV (trim settles at mark).
    const noPolicy = pickPolicyAsOf([]);
    expect(noPolicy).toBeUndefined();
    expect(composeProfitSplit(data, noPolicy, seed, 12.5)).toBeUndefined();
    expect(report.totals.fundValueUsd).toBeCloseTo(baseNav, 6);
  });
});
