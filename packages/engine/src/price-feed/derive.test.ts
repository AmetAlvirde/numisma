// Pure-boundary suite for the MXN derivation (ADR-005 / R1). Table-driven, no
// network, no data files: it pins the `USD × FIX` math (precision preserved, no
// rounding), the `usdMxn` snapshot on the derived event, the loud missing/stale
// FIX guard, and a round-trip of a derived mark through the real ingest guard.
import { describe, expect, it } from "vitest";
import {
  buildEventReference,
  crossReferenceEvent,
  deriveMxnMark,
  parseEvent,
  requireFreshFix,
  type FixObservation,
  type FundReviewData,
  type Quote,
} from "../index.js";

function usdLeg(overrides: Partial<Quote> = {}): Quote {
  return {
    instrumentId: "eww-mxn",
    symbol: "EWW",
    asOf: "2026-07-03",
    price: 62.5,
    source: "twelvedata",
    fetchedAt: "2026-07-04T00:05:00.000Z",
    ...overrides,
  };
}

describe("deriveMxnMark — USD × FIX, precision preserved (no rounding)", () => {
  const cases: { usdClose: number; fix: number; expected: number }[] = [
    { usdClose: 100, fix: 20, expected: 2000 },
    { usdClose: 62.5, fix: 18.5, expected: 1156.25 },
    { usdClose: 34.2, fix: 18.5, expected: 34.2 * 18.5 },
    // A many-decimal case: the mark keeps the raw float product, NOT a rounded value.
    { usdClose: 123.456, fix: 18.7654, expected: 123.456 * 18.7654 },
    { usdClose: 15.5, fix: 17.9321, expected: 15.5 * 17.9321 },
  ];

  for (const { usdClose, fix, expected } of cases) {
    it(`derives ${usdClose} × ${fix} = ${expected} with no rounding`, () => {
      const mark = deriveMxnMark(usdLeg({ price: usdClose }), { rate: fix, date: "2026-07-03" });
      expect(mark.price).toBe(expected);
    });
  }

  it("attaches the FIX as the usdMxn snapshot and keeps the frozen id (C1/C2)", () => {
    const mark = deriveMxnMark(usdLeg({ instrumentId: "intc-mxn", price: 34.2 }), {
      rate: 18.5,
      date: "2026-07-03",
    });
    expect(mark).toEqual({
      id: "pm-intc-mxn-2026-07-03",
      asOf: "2026-07-03",
      type: "PriceMarked",
      instrumentId: "intc-mxn",
      price: 34.2 * 18.5,
      usdMxn: 18.5,
    });
  });

  it("does NOT round: a many-decimal product is not equal to its 2-dp rounding", () => {
    const mark = deriveMxnMark(usdLeg({ price: 123.456 }), { rate: 18.7654, date: "2026-07-03" });
    const roundedTo2dp = Math.round(mark.price * 100) / 100;
    expect(mark.price).not.toBe(roundedTo2dp);
  });
});

describe("requireFreshFix — loud on missing/stale (ADR-005 reliability)", () => {
  const fresh: FixObservation = { rate: 18.5, date: "2026-07-03" };

  it("returns a present, same-day FIX", () => {
    expect(requireFreshFix(fresh, "2026-07-03", 4)).toBe(fresh);
  });

  it("accepts a FIX within the staleness window (weekend gap)", () => {
    // Friday FIX marking through to Monday: 3 days old, within the 4-day window.
    const friday: FixObservation = { rate: 18.5, date: "2026-07-03" };
    expect(requireFreshFix(friday, "2026-07-06", 4)).toBe(friday);
  });

  it("throws loud when the FIX is missing (undefined)", () => {
    expect(() => requireFreshFix(undefined, "2026-07-03", 4)).toThrow(/FIX .*unavailable/);
  });

  it("throws loud when the FIX is older than the staleness window", () => {
    const stale: FixObservation = { rate: 18.5, date: "2026-06-25" };
    expect(() => requireFreshFix(stale, "2026-07-03", 4)).toThrow(/stale/);
  });

  it("throws loud when the FIX date is after the mark date (incoherent)", () => {
    const future: FixObservation = { rate: 18.5, date: "2026-07-10" };
    expect(() => requireFreshFix(future, "2026-07-03", 4)).toThrow(/AFTER the mark date/);
  });

  it("throws loud on a non-positive FIX rate", () => {
    expect(() => requireFreshFix({ rate: 0, date: "2026-07-03" }, "2026-07-03", 4)).toThrow(
      /not a positive rate/,
    );
  });
});

// --- round-trip through the real ingest guard --------------------------------
const GENESIS_AS_OF = "2026-06-01";

function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "bitso-mxn", name: "MXN Reserve", platform: "BITSO", currency: "MXN" }],
    instruments: [{ id: "eww-mxn", name: "iShares Mexico ETF (SIC)", symbol: "EWW", currency: "MXN" }],
    reserves: [
      {
        id: "cash-core",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "bitso-mxn",
        currency: "MXN",
        amount: 10000,
      },
    ],
    positions: [
      {
        id: "eww-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "bitso-mxn",
        instrumentId: "eww-mxn",
        direction: "long",
        markPrice: 1150,
        currency: "MXN",
        lots: [{ quantity: 10, cost: 1100, tier: "c1" }],
      },
    ],
  };
}

describe("round-trip: a derived *-mxn mark passes the real ingest guard (R5 / C1)", () => {
  it("a plausible derived MXN mark clears parse + cross-reference", () => {
    // 62.5 USD × 18.5 FIX = 1156.25 MXN — near the genesis 1150 markPrice.
    const mark = deriveMxnMark(usdLeg({ price: 62.5 }), { rate: 18.5, date: "2026-07-03" });
    const parsed = parseEvent(mark);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    if (parsed.value.type === "PriceMarked") {
      expect(parsed.value.usdMxn).toBe(18.5);
    }
    const result = crossReferenceEvent(parsed.value, buildEventReference(genesis()));
    expect(result.kind).toBe("ok");
  });

  it("an unknown *-mxn id fails crossReferenceMark loudly", () => {
    const mark = deriveMxnMark(usdLeg({ instrumentId: "sbux-mxn", price: 95 }), {
      rate: 18.5,
      date: "2026-07-03",
    });
    const parsed = parseEvent(mark);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    const result = crossReferenceEvent(parsed.value, buildEventReference(genesis()));
    expect(result.kind).toBe("event-error");
    if (result.kind === "ok") return;
    expect(result.message).toMatch(/genesis seed does not contain/);
  });
});
