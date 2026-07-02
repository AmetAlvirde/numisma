// PRD #96 slice #101 — the profit-split OBLIGATION layer, reliable.
//
// Locks the obligation-only contract (R1: no routed-flow / no unallocated line), the
// exact-cumulative-total HWM-vs-perClose config toggle (T7), the empty-guard plus the
// conscious first wiring into formatCompositionReport (T6/C1), and the descriptive-only
// invariant that blanking the block leaves NAV untouched (R3). Kept separate from the
// prototype behavior lock (partial-close-profit-split.test.ts), which is untouched.
import {
  buildCompositionReport,
  composeProfitSplit,
  formatCompositionReport,
  formatProfitSplit,
  type FundReviewData,
  type ClosedPositionRecord,
  type ProfitPolicy,
  type ProfitSplit,
} from "./index.js";
import { describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";

// A minimal fund with one live Reserve so buildCompositionReport yields a real
// dashboard (and a Reserve %-of-NAV) but no positions / no closes of its own.
function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "binance-usd", name: "Desk", platform: "BINANCE", currency: "USD" }],
    instruments: [{ id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" }],
    reserves: [
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
    positions: [],
  };
}

// The fund's locked 60/40 default policy, high-water-mark basis.
const HWM_POLICY: ProfitPolicy = {
  split: { wealth: 60, reserve: 40 },
  splitBasis: "highWaterMark",
  routingReserveId: "sink-usdt",
  reserveTargetPct: 10,
};
const PER_CLOSE_POLICY: ProfitPolicy = { ...HWM_POLICY, splitBasis: "perClose" };

// A closed book chosen so HWM (peak) and perClose (Σ winners) DIVERGE: a win, then a
// draw-down loss (peak stays 100), then another win. Cumulative net = 90, peak = 100,
// winners = 130. HWM obligation = 0.4×100 = 40; perClose = 0.4×130 = 52.
function closedBook(): ClosedPositionRecord[] {
  const row = (positionId: string, closedAsOf: string, realizedPnlUsd: number): ClosedPositionRecord => ({
    positionId,
    instrumentId: "btc-usd",
    tempo: "Capital",
    direction: "long",
    closedAsOf,
    costBasisUsd: 100,
    proceedsUsd: 100 + realizedPnlUsd,
    realizedPnlUsd,
    tierAttribution: [],
  });
  return [
    row("p1", "2026-06-02", 100),
    row("p2", "2026-06-03", -40),
    row("p3", "2026-06-04", 30),
  ];
}

function dataWithBook(): FundReviewData {
  return { ...genesis(), closedPositions: closedBook() };
}

describe("composeProfitSplit — obligation on the exact cumulative total (T7)", () => {
  it("computes the HWM obligation on the peak cumulative, not the per-tier split", () => {
    const split = composeProfitSplit(dataWithBook(), HWM_POLICY, genesis(), 12.5);
    expect(split).toBeDefined();
    expect(split?.basis).toBe("highWaterMark");
    expect(split?.cumulativeNetRealizedUsd).toBeCloseTo(90, 6);
    expect(split?.peakCumulativeUsd).toBeCloseTo(100, 6);
    expect(split?.obligationUsd).toBeCloseTo(0.4 * 100, 6); // 40% of the high-water mark
    expect(split?.reservePctOfNav).toBe(12.5);
    expect(split?.reserveTargetPct).toBe(10);
  });

  it("toggling to perClose recomputes from configuration, not code (Σ winning closes)", () => {
    const data = dataWithBook();
    const hwm = composeProfitSplit(data, HWM_POLICY, genesis(), 12.5);
    const perClose = composeProfitSplit(data, PER_CLOSE_POLICY, genesis(), 12.5);
    // Same book + same code path — only the sidecar `splitBasis` changed.
    expect(hwm?.obligationUsd).toBeCloseTo(0.4 * 100, 6); // peak
    expect(perClose?.obligationUsd).toBeCloseTo(0.4 * 130, 6); // Σ winners (100 + 30)
    expect(perClose?.obligationUsd).not.toBeCloseTo(hwm?.obligationUsd ?? 0, 6);
  });

  it("empty-guards: no policy or no closes yields no block", () => {
    expect(composeProfitSplit(dataWithBook(), undefined, genesis(), 12.5)).toBeUndefined();
    expect(composeProfitSplit(genesis(), HWM_POLICY, genesis(), 12.5)).toBeUndefined();
  });

  it("replays same-day closes in realization (input) order — the HWM peak is not decided by positionId", () => {
    // Both close on ONE day: realized as a +100 win THEN a -40 draw-down, so the running
    // peak is 100. The fold pushes rows in realization order; a positionId tie-break in
    // the sort would reorder to (a-pos -40, z-pos +100), dropping the peak to 60 and the
    // obligation from 40 to 24 — an obligation decided by id spelling, not by economics.
    const sameDay: ClosedPositionRecord[] = [
      { positionId: "z-pos", instrumentId: "btc-usd", tempo: "Capital", direction: "long", closedAsOf: "2026-06-02", costBasisUsd: 100, proceedsUsd: 200, realizedPnlUsd: 100, tierAttribution: [] },
      { positionId: "a-pos", instrumentId: "btc-usd", tempo: "Capital", direction: "long", closedAsOf: "2026-06-02", costBasisUsd: 100, proceedsUsd: 60, realizedPnlUsd: -40, tierAttribution: [] },
    ];
    const split = composeProfitSplit({ ...genesis(), closedPositions: sameDay }, HWM_POLICY, genesis(), 12.5);
    expect(split?.peakCumulativeUsd).toBeCloseTo(100, 6);
    expect(split?.cumulativeNetRealizedUsd).toBeCloseTo(60, 6);
    expect(split?.obligationUsd).toBeCloseTo(0.4 * 100, 6);
  });
});

describe("profit-split render — obligation-only (R1)", () => {
  it("the block prints ONLY the obligation + RESERVE %-vs-target — no routed/unallocated line", () => {
    const split = composeProfitSplit(dataWithBook(), HWM_POLICY, genesis(), 12.5) as ProfitSplit;
    const block = formatProfitSplit(split);
    // No destination-inferred lines survive (R1 / PRD Out of Scope).
    expect(block).not.toContain("Routed");
    expect(block).not.toContain("routed");
    expect(block).not.toContain("Unallocated");
    expect(block).not.toContain("unallocated");
    // The honestly computable content is present.
    expect(block).toContain("Split obligation to Reserve:");
    expect(block).toContain("of NAV vs");
  });

  it("the compose result carries no routedFlow / unallocated fields (R1)", () => {
    const split = composeProfitSplit(dataWithBook(), HWM_POLICY, genesis(), 12.5) as ProfitSplit;
    expect(split).not.toHaveProperty("routedFlowUsd");
    expect(split).not.toHaveProperty("unallocatedUsd");
  });
});

describe("profit-split wiring — empty-guard + conscious first render (T6/C1)", () => {
  it("formatProfitSplit(undefined) === \"\"", () => {
    expect(formatProfitSplit(undefined)).toBe("");
  });

  it("a report composed without a policy is byte-for-byte the un-wired report (C1)", () => {
    const report = buildCompositionReport(dataWithBook());
    // No `profitSplit` arg — the pre-existing #90 caller shape — appends nothing.
    expect(formatCompositionReport(report)).toBe(formatCompositionReport(report, undefined));
    expect(formatCompositionReport(report)).not.toContain("Profit Split — Obligation");
  });

  it("the first populated render is snapshot-locked at the chosen location", () => {
    const split = composeProfitSplit(dataWithBook(), HWM_POLICY, genesis(), 12.5);
    expect(formatProfitSplit(split)).toMatchInlineSnapshot(`
      "Profit Split — Obligation (descriptive only)
      --------------------------------------------
      Basis: highWaterMark (Reserve share 40% of gains)
      Cumulative net realized: $90.00  (peak $100.00)
      Split obligation to Reserve: $40.00
      Reserve is 12.5% of NAV vs 10.0% target (at/above)."
    `);
    // Wired into the full report at the chosen location: the block appears once the
    // split is supplied, immediately after the descriptive-only review sections.
    const report = buildCompositionReport(dataWithBook());
    const wired = formatCompositionReport(report, split);
    expect(wired).toContain("Profit Split — Obligation (descriptive only)");
    expect(wired.indexOf("Profit Split — Obligation")).toBeGreaterThan(
      wired.indexOf("Realized P&L — Closed Book"),
    );
  });
});

describe("profit-split — descriptive-only invariant (R3)", () => {
  it("blanking the block leaves fundValueUsd unchanged", () => {
    const data = dataWithBook();
    const report = buildCompositionReport(data);
    const split = composeProfitSplit(data, HWM_POLICY, genesis(), 12.5);

    const navWithBlock = report.totals.fundValueUsd; // block computed but never fed to NAV
    const navBlanked = buildCompositionReport(data).totals.fundValueUsd;
    expect(navWithBlock).toBe(navBlanked);

    // Same report, rendered with vs without the block — NAV in each is identical text.
    const withBlock = formatCompositionReport(report, split);
    const blanked = formatCompositionReport(report, undefined);
    const navLine = (text: string) => text.split("\n").find((l) => l.startsWith("Fund value:"));
    expect(navLine(withBlock)).toBe(navLine(blanked));
    expect(navLine(withBlock)).toBeDefined();
  });
});

// Guard the obligation math directly on a hand-built cumulative sequence too, so the
// exact-total contract (not per-tier) is locked independent of the fold.
describe("composeProfitSplit — exact cumulative total, HWM no clawback", () => {
  it("recovers a drawdown before accruing new obligation (no clawback)", () => {
    // +50, then -50 back to flat: peak 50, cumulative 0. HWM basis = peak = 50.
    const data: FundReviewData = {
      ...genesis(),
      closedPositions: [
        { positionId: "a", instrumentId: "btc-usd", tempo: "Capital", direction: "long", closedAsOf: "2026-06-02", costBasisUsd: 10, proceedsUsd: 60, realizedPnlUsd: 50, tierAttribution: [] },
        { positionId: "b", instrumentId: "btc-usd", tempo: "Capital", direction: "long", closedAsOf: "2026-06-03", costBasisUsd: 60, proceedsUsd: 10, realizedPnlUsd: -50, tierAttribution: [] },
      ],
    };
    const hwm = composeProfitSplit(data, HWM_POLICY, genesis(), 5);
    expect(hwm?.cumulativeNetRealizedUsd).toBeCloseTo(0, 6);
    expect(hwm?.peakCumulativeUsd).toBeCloseTo(50, 6);
    expect(hwm?.obligationUsd).toBeCloseTo(0.4 * 50, 6); // obligation on the peak, no clawback
  });
});
