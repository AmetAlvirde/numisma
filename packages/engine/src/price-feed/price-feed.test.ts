// Pure-boundary suite for the two-plane price core (ADR-005 / R1). Table-driven,
// no network, no data files: it pins the registry resolution, the deterministic
// id, quote → real PriceMarkedEvent construction, the trading-day/mark-instant
// rule (including the CDMX-evening/UTC-tomorrow case and the pre-mark-time no-mark
// case), the non-clobbering inbox merge, and a round-trip through the real ingest
// guard using the existing engine reference builder.
import { describe, expect, it } from "vitest";
import {
  buildEventReference,
  crossReferenceEvent,
  instrumentsForSource,
  isAtOrAfterMarkTime,
  markFromQuote,
  mergeInbox,
  parseEvent,
  priceMarkId,
  resolveInstrument,
  tradingDayAsOf,
  type FundReviewData,
  type InboxRecord,
  type MarkClock,
  type Quote,
} from "../index.js";

const CDMX: MarkClock = { timeZone: "America/Mexico_City", markTime: "18:00" };

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    instrumentId: "btc",
    symbol: "BTCUSDT",
    asOf: "2026-07-03",
    price: 65000,
    source: "binance",
    fetchedAt: "2026-07-04T00:05:00.000Z",
    ...overrides,
  };
}

describe("instrument registry (R5)", () => {
  it("lists the four crypto instruments served by Binance", () => {
    const ids = instrumentsForSource("binance").map((entry) => entry.instrumentId);
    expect(ids).toEqual(["btc", "eth", "render", "gram"]);
  });

  it("resolves a known id to its provider symbol, quote currency, and source", () => {
    expect(resolveInstrument("render")).toEqual({
      instrumentId: "render",
      symbol: "RENDERUSDT",
      quoteCurrency: "USD",
      source: "binance",
    });
  });

  it("fails loud on an unknown instrument id", () => {
    expect(() => resolveInstrument("doge")).toThrow(/Unknown instrument id 'doge'/);
  });

  it("lists the US equities served by Twelve Data (direct + *-mxn USD legs)", () => {
    const ids = instrumentsForSource("twelvedata").map((entry) => entry.instrumentId);
    expect(ids).toEqual([
      "aapl",
      "googl",
      "tsla",
      "eww-mxn",
      "intc-mxn",
      "nke-mxn",
      "nu-mxn",
      "rivn-mxn",
      "sbux-mxn",
    ]);
  });

  it("resolves a US equity to a direct USD quote (not derived)", () => {
    expect(resolveInstrument("aapl")).toEqual({
      instrumentId: "aapl",
      symbol: "AAPL",
      quoteCurrency: "USD",
      source: "twelvedata",
    });
  });

  it("resolves a *-mxn instrument to its US-listed symbol, MXN mark currency, derived flag", () => {
    expect(resolveInstrument("eww-mxn")).toEqual({
      instrumentId: "eww-mxn",
      symbol: "EWW",
      quoteCurrency: "MXN",
      source: "twelvedata",
      derived: true,
    });
  });
});

describe("deterministic mark id (C2)", () => {
  it("is the frozen pm-<instrumentId>-<asOf> contract", () => {
    expect(priceMarkId("btc", "2026-07-03")).toBe("pm-btc-2026-07-03");
  });
});

describe("quote → PriceMarkedEvent construction (R1)", () => {
  it("builds the engine's real event with the deterministic id and no usdMxn", () => {
    const mark = markFromQuote(quote({ instrumentId: "eth", asOf: "2026-07-03", price: 3400 }));
    expect(mark).toEqual({
      id: "pm-eth-2026-07-03",
      asOf: "2026-07-03",
      type: "PriceMarked",
      instrumentId: "eth",
      price: 3400,
    });
  });

  it("produces a candidate that satisfies parseEvent (C1)", () => {
    const mark = markFromQuote(quote());
    const parsed = parseEvent(mark);
    expect(parsed.kind).toBe("ok");
  });
});

describe("trading-day / mark-instant rule (R2)", () => {
  // 2026-07-04T00:05Z is 2026-07-03 18:05 in CDMX (UTC-6): the local trading day
  // is the 3rd, NOT the provider's UTC "4th" — the prototype bug the rule fixes.
  it("labels a CDMX-evening fetch with the local trading day, not UTC tomorrow", () => {
    const instant = new Date("2026-07-04T00:05:00.000Z");
    expect(tradingDayAsOf(instant, CDMX.timeZone)).toBe("2026-07-03");
  });

  it("emits a mark at/after the mark time", () => {
    // 18:05 CDMX — at/after 18:00.
    expect(isAtOrAfterMarkTime(new Date("2026-07-04T00:05:00.000Z"), CDMX)).toBe(true);
  });

  it("emits NO mark before the mark time (store-only fetch)", () => {
    // 2026-07-03T20:00Z = 14:00 CDMX — before 18:00.
    expect(isAtOrAfterMarkTime(new Date("2026-07-03T20:00:00.000Z"), CDMX)).toBe(false);
  });
});

describe("non-clobbering inbox merge (C3)", () => {
  it("preserves hand-authored pending events and appends fresh marks", () => {
    const handAuthored: InboxRecord = { id: "hand-1" };
    const mark = markFromQuote(quote());
    const result = mergeInbox<InboxRecord>([handAuthored], [mark]);
    expect(result.addedCount).toBe(1);
    expect(result.next).toEqual([handAuthored, mark]);
  });

  it("skips a mark whose id is already queued (idempotent re-run)", () => {
    const mark = markFromQuote(quote());
    const result = mergeInbox<InboxRecord>([mark], [mark]);
    expect(result.addedCount).toBe(0);
    expect(result.next).toEqual([mark]);
  });
});

// --- round-trip through the real ingest guard --------------------------------
const GENESIS_AS_OF = "2026-06-01";

function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" }],
    instruments: [{ id: "btc", name: "Bitcoin", symbol: "BTC", currency: "USD" }],
    reserves: [
      {
        id: "cash-core",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "USD",
        amount: 1000,
      },
    ],
    positions: [
      {
        id: "btc-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "btc",
        direction: "long",
        markPrice: 65000,
        currency: "USD",
        lots: [{ quantity: 1, cost: 60000, tier: "c1" }],
      },
    ],
  };
}

describe("round-trip through the real ingest guard (R5 / C1)", () => {
  it("a plausible fetched mark clears parse + cross-reference", () => {
    const mark = markFromQuote(quote({ instrumentId: "btc", price: 66000 }));
    const parsed = parseEvent(mark);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    const result = crossReferenceEvent(parsed.value, buildEventReference(genesis()));
    expect(result.kind).toBe("ok");
  });

  it("an unknown instrument id fails crossReferenceMark loudly", () => {
    // 'gram' is a valid registry id but not a genesis instrument here → the second
    // gate rejects it even though the mark is structurally valid.
    const mark = markFromQuote(quote({ instrumentId: "gram", price: 5 }));
    const parsed = parseEvent(mark);
    expect(parsed.kind).toBe("ok");
    if (parsed.kind !== "ok") return;
    const result = crossReferenceEvent(parsed.value, buildEventReference(genesis()));
    expect(result.kind).toBe("event-error");
    if (result.kind === "ok") return;
    expect(result.message).toMatch(/genesis seed does not contain/);
  });
});
