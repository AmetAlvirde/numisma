// Reliable-conversion locks for the PositionTrimmed verb (PRD #96, slice #98).
// These sit alongside (not replacing) the prototype behavior locks in
// `partial-close-profit-split.test.ts`, and pin the three hardening properties this
// slice adds on the pure engine seams:
//   T2 — off-mark trim: proceeds != qty x mark -> realized captures the delta, NAV
//        legitimately MOVES, and the `markVsFill` NAV-honesty disclosure is present.
//   T3 — multi-tier single trim aggregation + batch-aware sufficiency (a later trim
//        in the same batch sees the shrunk position; the gate aggregates repeated tiers).
//   T4 — full-retirement REJECT at the gate, and the position ALWAYS survives a trim
//        (the fold never deletes).
import {
  buildCompositionReport,
  buildEventReference,
  crossReferenceEvent,
  foldEvents,
  parseEvent,
  type EventReference,
  type FundReviewData,
  type PortfolioEvent,
} from "./index.js";
import { describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";

/** A one-position seed: 4 c1 + 4 c2 (two c2 lots) units of BTC, mark 100. */
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

function trim(overrides: {
  id?: string;
  asOf?: string;
  positionId?: string;
  removals: Array<{ tier: "c1" | "c2" | "c3"; quantity: number }>;
  proceeds: number;
  reserveId?: string;
}): unknown {
  return {
    id: overrides.id ?? "t1",
    asOf: overrides.asOf ?? "2026-06-02",
    type: "PositionTrimmed",
    positionId: overrides.positionId ?? "btc-pos",
    removals: overrides.removals,
    settlement: { reserveId: overrides.reserveId ?? "sink-usdt", proceeds: overrides.proceeds },
  };
}

/** Parse + cross-reference against a fresh reference; throw on either failure. */
function accept(seed: FundReviewData, raw: unknown): PortfolioEvent {
  const parsed = parseEvent(raw);
  if (parsed.kind !== "ok") throw new Error(`parse: ${parsed.path} ${parsed.message}`);
  const crossRef = crossReferenceEvent(parsed.value, buildEventReference(seed, []));
  if (crossRef.kind !== "ok") throw new Error(`crossref: ${crossRef.path} ${crossRef.message}`);
  return parsed.value;
}

/** Parse (asserting it passes) then cross-reference against a supplied reference. */
function crossRef(seed: FundReviewData, raw: unknown, reference: EventReference) {
  const parsed = parseEvent(raw);
  if (parsed.kind !== "ok") throw new Error(`parse: ${parsed.path} ${parsed.message}`);
  return { event: parsed.value, result: crossReferenceEvent(parsed.value, reference) };
}

describe("PositionTrimmed — off-mark NAV honesty (T2 / R2)", () => {
  it("an off-mark fill moves NAV, realized captures the delta, and markVsFill discloses it", () => {
    const seed = genesis();
    const baseNav = buildCompositionReport(foldEvents(seed, []).data).totals.fundValueUsd;

    // Remove all 4 c2 units. At mark 100 the removed units are worth 400; the fill
    // lands OFF the mark at 360 (10% low — inside the 50% settlement sanity gate).
    const event = accept(seed, trim({ removals: [{ tier: "c2", quantity: 4 }], proceeds: 360 }));
    const data = foldEvents(seed, [event]).data;
    const report = buildCompositionReport(data);
    const row = report.closedBook.rows.find((r) => r.positionId === "btc-pos");

    // Realized captures the delta: cost 2*60+2*80 = 280, proceeds 360 -> realized 80
    // (NOT the 120 an at-mark fill would have booked).
    expect(row?.partial).toBe(true);
    expect(row?.proceedsUsd).toBeCloseTo(360, 6);
    expect(row?.costBasisUsd).toBeCloseTo(280, 6);
    expect(row?.realizedPnlUsd).toBeCloseTo(80, 6);

    // The NAV-honesty disclosure is present: mark value 400 vs fill 360, delta -40.
    expect(row?.markVsFill).toBeDefined();
    expect(row?.markVsFill?.markValueUsd).toBeCloseTo(400, 6);
    expect(row?.markVsFill?.proceedsUsd).toBeCloseTo(360, 6);
    expect(row?.markVsFill?.deltaUsd).toBeCloseTo(-40, 6);

    // NAV legitimately MOVES by exactly the off-mark delta (no false neutrality claim).
    expect(report.totals.fundValueUsd).toBeCloseTo(baseNav - 40, 6);
    expect(report.totals.fundValueUsd).not.toBeCloseTo(baseNav, 6);
  });

  it("a settle-at-mark fill conserves NAV and discloses a ~zero delta", () => {
    const seed = genesis();
    const baseNav = buildCompositionReport(foldEvents(seed, []).data).totals.fundValueUsd;
    const event = accept(seed, trim({ removals: [{ tier: "c2", quantity: 4 }], proceeds: 400 }));
    const report = buildCompositionReport(foldEvents(seed, [event]).data);
    const row = report.closedBook.rows.find((r) => r.positionId === "btc-pos");

    expect(row?.markVsFill?.deltaUsd).toBeCloseTo(0, 6);
    expect(report.totals.fundValueUsd).toBeCloseTo(baseNav, 6);
  });
});

describe("PositionTrimmed — multi-tier + batch sufficiency (T3)", () => {
  it("a multi-tier single trim aggregates and removes from each named tier", () => {
    const seed = genesis();
    // Remove 2 of c1 and 3 of c2 in one event; c1 leaves 2, c2 leaves 1.
    const event = accept(
      seed,
      trim({ removals: [{ tier: "c1", quantity: 2 }, { tier: "c2", quantity: 3 }], proceeds: 500 }),
    );
    const data = foldEvents(seed, [event]).data;
    const survivor = data.positions.find((p) => p.id === "btc-pos");
    const c1 = survivor?.lots.filter((l) => l.tier === "c1").reduce((s, l) => s + l.quantity, 0);
    const c2 = survivor?.lots.filter((l) => l.tier === "c2").reduce((s, l) => s + l.quantity, 0);
    expect(c1).toBeCloseTo(2, 9);
    expect(c2).toBeCloseTo(1, 9);
  });

  it("the gate aggregates a repeated tier across removals in one event", () => {
    const seed = genesis();
    // Two c2 removals summing to 5 > 4 held -> rejected on the aggregate, not per-entry.
    const { result } = crossRef(
      seed,
      trim({ removals: [{ tier: "c2", quantity: 2 }, { tier: "c2", quantity: 3 }], proceeds: 500 }),
      buildEventReference(seed, []),
    );
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("removals");
      expect(result.message).toContain("holds only 4");
    }
  });

  it("is batch-aware: a later trim in the same batch sees the shrunk position", () => {
    const seed = genesis();

    // First trim removes all 4 c2 units; accept it and fold it into the world the rest
    // of the batch is judged against (ADR-015: the accepted prefix IS the advance).
    const first = crossRef(seed, trim({ id: "t-a", removals: [{ tier: "c2", quantity: 4 }], proceeds: 400 }), buildEventReference(seed, []));
    expect(first.result.kind).toBe("ok");
    const reference = buildEventReference(seed, [first.event]);

    // A follow-on c2 trim must now fail: the batch-shrunk position holds 0 c2.
    const overC2 = crossRef(seed, trim({ id: "t-b", removals: [{ tier: "c2", quantity: 1 }], proceeds: 100 }), reference);
    expect(overC2.result.kind).toBe("event-error");
    if (overC2.result.kind === "event-error") {
      expect(overC2.result.message).toContain("holds only 0");
    }

    // A follow-on c1 trim that leaves a lot behind still passes on the shrunk position.
    const okC1 = crossRef(seed, trim({ id: "t-c", removals: [{ tier: "c1", quantity: 3 }], proceeds: 300 }), reference);
    expect(okC1.result.kind).toBe("ok");
  });
});

describe("PositionTrimmed — full-retirement REJECT, the position always survives (T4)", () => {
  it("rejects a trim whose removals would empty the position and points at PositionClosed", () => {
    const seed = genesis();
    const { result } = crossRef(
      seed,
      trim({ removals: [{ tier: "c1", quantity: 4 }, { tier: "c2", quantity: 4 }], proceeds: 800 }),
      buildEventReference(seed, []),
    );
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("removals");
      expect(result.message).toContain("full retirement");
      expect(result.message).toContain("PositionClosed");
    }
  });

  it("accepts a near-full trim that leaves a single lot behind, and the position survives the fold", () => {
    const seed = genesis();
    // Remove all of c1 and all but one of c2 (7 of 8 held) -> survives with 1 c2 unit.
    const event = accept(
      seed,
      trim({ removals: [{ tier: "c1", quantity: 4 }, { tier: "c2", quantity: 3 }], proceeds: 700 }),
    );
    const data = foldEvents(seed, [event]).data;
    const survivor = data.positions.find((p) => p.id === "btc-pos");
    expect(survivor).toBeDefined();
    const remaining = survivor?.lots.reduce((s, l) => s + l.quantity, 0);
    expect(remaining).toBeCloseTo(1, 9);
  });
});
