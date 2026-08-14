// THE FOLD'S DISCARD CHANNEL (PRD #323 slice A, implementing #293).
//
// `foldEvents` used to skip an event whose target it could not find and record
// nothing anywhere: a `FundReviewData` folded from a damaged log was byte-identical
// to one folded from a complete log. This suite pins the envelope that ends that
// silence — `{data, skipped}` — and the five drop kinds it must detect.
//
// Every fixture below is AUTHORED. Nothing here is seeded from the durable log or
// from any tool output; the numbers are round so the parity expectations can be
// hand-computed rather than captured.
import { foldEvents } from "./fold.js";
import type { PortfolioEvent } from "./types.js";
import type { FundReviewData } from "../contracts.js";
import { describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";

/** One funded USD reserve, one instrument, no open positions. */
function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "bitget-usd", name: "Bitget", platform: "BITGET", currency: "USD" }],
    instruments: [
      { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
      { id: "eth-usd", name: "Ether", symbol: "ETH", currency: "USD" },
    ],
    reserves: [
      {
        id: "pulse-cash",
        portfolioId: "core",
        tempo: "Pulse",
        executionMode: "live",
        accountId: "bitget-usd",
        currency: "USD",
        amount: 10000,
        lots: [{ quantity: 10000, tier: "c1" }],
      },
    ],
    positions: [],
  };
}

const DECISION = {
  entryThesis: "authored fixture",
  invalidationCondition: "authored fixture",
  riskBudget: "authored fixture",
  plannedHoldingHorizon: "authored fixture",
  strategy: "authored-strategy",
};

function opened(id: string, asOf: string, positionId: string): PortfolioEvent {
  return {
    id,
    asOf,
    type: "PositionOpened",
    position: {
      id: positionId,
      portfolioId: "core",
      tempo: "Pulse",
      executionMode: "live",
      accountId: "bitget-usd",
      instrumentId: "btc-usd",
      direction: "long",
      currency: "USD",
      lots: [{ quantity: 2, cost: 100, tier: "c1", entryFx: 20 }],
    },
    decision: DECISION,
    funding: { reserveId: "pulse-cash", amount: 200 },
  };
}

describe("the fold's discard channel", () => {
  it("records one skip per drop kind, in application order, invalidations appended last", () => {
    // One event per drop kind, all targeting things the fold has no record of.
    // Input order deliberately disagrees with `asOf` order so the ordering rule
    // — application order (asOf, then log index) — is pinned, not coincidental.
    const events: PortfolioEvent[] = [
      {
        id: "evt-close",
        asOf: "2026-06-05",
        type: "PositionClosed",
        positionId: "ghost-position",
        settlement: { reserveId: "pulse-cash", proceeds: 300 },
      },
      {
        id: "evt-deposit",
        asOf: "2026-06-03",
        type: "Deposit",
        reserveId: "ghost-cash",
        amount: 500,
        tier: "c1",
      },
      {
        id: "evt-trim",
        asOf: "2026-06-04",
        type: "PositionTrimmed",
        positionId: "ghost-position",
        removals: [{ tier: "c1", quantity: 1 }],
        settlement: { reserveId: "pulse-cash", proceeds: 150 },
      },
      {
        id: "evt-invalidation",
        asOf: "2026-06-02",
        type: "InvalidationMarked",
        positionId: "ghost-position",
        price: 90,
        direction: "below",
      },
      {
        id: "evt-add",
        asOf: "2026-06-06",
        type: "PositionAddedTo",
        positionId: "ghost-position",
        lot: { quantity: 1, cost: 150, tier: "c1", entryFx: 20 },
        funding: { reserveId: "pulse-cash", amount: 150 },
      },
    ];

    const folded = foldEvents(genesis(), events);

    // `data` is exactly what an empty log yields — only the review date advances,
    // which it does for every applicable event whether or not it applies.
    const untouched = foldEvents(genesis(), []).data;
    expect(folded.data).toEqual({
      ...untouched,
      review: { ...untouched.review, asOf: "2026-06-06" },
    });

    expect(folded.skipped.map((skip) => [skip.eventId, skip.index, skip.verb, skip.reason])).toEqual(
      [
        ["evt-deposit", 1, "Deposit", "reserve-absent"],
        ["evt-trim", 2, "PositionTrimmed", "position-absent"],
        ["evt-close", 0, "PositionClosed", "position-absent"],
        ["evt-add", 4, "PositionAddedTo", "position-absent"],
        ["evt-invalidation", 3, "InvalidationMarked", "position-absent"],
      ],
    );
  });

  it("keeps the detail prose free of event content and fund figures", () => {
    const folded = foldEvents(genesis(), [
      {
        id: "evt-deposit",
        asOf: "2026-06-03",
        type: "Deposit",
        reserveId: "ghost-cash",
        amount: 4321,
        tier: "c1",
      },
      {
        id: "evt-close",
        asOf: "2026-06-05",
        type: "PositionClosed",
        positionId: "ghost-position",
        settlement: { reserveId: "pulse-cash", proceeds: 8765 },
      },
    ]);

    expect(folded.skipped).toHaveLength(2);
    for (const skip of folded.skipped) {
      expect(skip.detail).not.toMatch(/\d/); // no figure of any kind
      expect(skip.detail).not.toContain(skip.verb); // the verb has its own field
      expect(skip.detail).not.toContain(skip.eventId);
      expect(skip.detail).not.toContain("ghost-cash");
      expect(skip.detail).not.toContain("ghost-position");
      expect(skip.detail.length).toBeGreaterThan(0);
    }
  });

  it("does not record a PriceMarked for an unheld instrument", () => {
    const folded = foldEvents(genesis(), [
      { id: "evt-mark", asOf: "2026-06-02", type: "PriceMarked", instrumentId: "eth-usd", price: 3000 },
    ]);

    expect(folded.skipped).toEqual([]);
    expect(folded.data.closes).toEqual([{ instrumentId: "eth-usd", asOf: "2026-06-02", price: 3000 }]);
  });

  it("does not record an invalidation whose position is later legitimately closed", () => {
    // The §5 precision. The mark sets the key, the close then deletes the position,
    // and a naive post-loop pass (keys absent from `positions`) would cry wolf on
    // every clean close that ever carried a mark.
    const folded = foldEvents(genesis(), [
      opened("evt-open", "2026-06-02", "pos-1"),
      {
        id: "evt-invalidation",
        asOf: "2026-06-03",
        type: "InvalidationMarked",
        positionId: "pos-1",
        price: 90,
        direction: "below",
      },
      {
        id: "evt-close",
        asOf: "2026-06-04",
        type: "PositionClosed",
        positionId: "pos-1",
        settlement: { reserveId: "pulse-cash", proceeds: 300 },
      },
    ]);

    expect(folded.skipped).toEqual([]);
    expect(folded.data.positions).toEqual([]);
    expect(folded.data.closedPositions).toHaveLength(1);
  });

  it("records an invalidation dated strictly after its position was retired", () => {
    // The one sub-case detect-by-absence CAN decide (#297). A mark on a closed id is
    // ambiguous in general — but its DATE against the retirement date is not: a mark
    // dated BEFORE the close applied while the position was live (no drop), and a mark
    // dated AFTER it had nothing left to attach to (a drop, and a silent one — an
    // `InvalidationMarked` moves no observable state, which is the reason to report it,
    // not the reason to stay quiet).
    //
    // Three ids in one fold, all retired, differing only in when their mark is dated:
    // after the close, before it, and ON it. Only the first is a drop.
    const folded = foldEvents(genesis(), [
      opened("evt-open-late", "2026-06-02", "pos-late"),
      opened("evt-open-clean", "2026-06-02", "pos-clean"),
      opened("evt-open-same", "2026-06-02", "pos-same"),
      {
        id: "evt-close-late",
        asOf: "2026-06-04",
        type: "PositionClosed",
        positionId: "pos-late",
        settlement: { reserveId: "pulse-cash", proceeds: 300 },
      },
      {
        id: "evt-close-clean",
        asOf: "2026-06-04",
        type: "PositionClosed",
        positionId: "pos-clean",
        settlement: { reserveId: "pulse-cash", proceeds: 300 },
      },
      {
        id: "evt-close-same",
        asOf: "2026-06-04",
        type: "PositionClosed",
        positionId: "pos-same",
        settlement: { reserveId: "pulse-cash", proceeds: 300 },
      },
      {
        id: "evt-invalidation-late",
        asOf: "2026-06-06",
        type: "InvalidationMarked",
        positionId: "pos-late",
        price: 90,
        direction: "below",
      },
      {
        id: "evt-invalidation-clean",
        asOf: "2026-06-03",
        type: "InvalidationMarked",
        positionId: "pos-clean",
        price: 90,
        direction: "below",
      },
      {
        id: "evt-invalidation-same",
        asOf: "2026-06-04",
        type: "InvalidationMarked",
        positionId: "pos-same",
        price: 90,
        direction: "below",
      },
    ]);

    // Exactly one record: the cry-wolf guard the pass was built around must not
    // regress, and the boundary is STRICTLY later — a mark dated on the close date
    // is not later than it.
    expect(folded.skipped).toEqual([
      {
        eventId: "evt-invalidation-late",
        index: 6,
        verb: "InvalidationMarked",
        reason: "position-absent",
        detail: expect.any(String),
      },
    ]);
    expect(folded.data.positions).toEqual([]);
    expect(folded.data.closedPositions).toHaveLength(3);
  });

  it("records the absent leg of a Transfer while the present leg applies", () => {
    const folded = foldEvents(genesis(), [
      {
        id: "evt-transfer",
        asOf: "2026-06-02",
        type: "Transfer",
        fromReserveId: "pulse-cash",
        toReserveId: "ghost-cash",
        amount: 500,
        tier: "c1",
      },
    ]);

    // The debit landed, the credit had nowhere to land: reserves are visibly
    // unbalanced by 500 — and the channel says so, which is the whole point.
    expect(folded.data.reserves).toEqual([
      { ...genesis().reserves[0], amount: 9500, lots: [{ quantity: 9500, tier: "c1" }] },
    ]);
    expect(folded.skipped).toEqual([
      {
        eventId: "evt-transfer",
        index: 0,
        verb: "Transfer",
        reason: "reserve-absent",
        detail: expect.any(String),
      },
    ]);
  });

  it("records nothing on a complete log, and folds it to the hand-computed read model", () => {
    // The parity pin. A mixed log exercising every arm that can drop — open, mark,
    // add, trim, close, deposit, reserve-open, transfer — with all targets present.
    // Every figure below is computed by hand from the fixture, not captured.
    const events: PortfolioEvent[] = [
      { id: "evt-deposit", asOf: "2026-06-02", type: "Deposit", reserveId: "pulse-cash", amount: 1000, tier: "c1" },
      opened("evt-open", "2026-06-03", "pos-1"),
      { id: "evt-mark", asOf: "2026-06-04", type: "PriceMarked", instrumentId: "btc-usd", price: 150 },
      {
        id: "evt-add",
        asOf: "2026-06-05",
        type: "PositionAddedTo",
        positionId: "pos-1",
        lot: { quantity: 1, cost: 150, tier: "c1", entryFx: 20 },
        funding: { reserveId: "pulse-cash", amount: 150 },
      },
      {
        id: "evt-trim",
        asOf: "2026-06-06",
        type: "PositionTrimmed",
        positionId: "pos-1",
        removals: [{ tier: "c1", quantity: 1.5 }],
        settlement: { reserveId: "pulse-cash", proceeds: 225 },
      },
      {
        id: "evt-close",
        asOf: "2026-06-07",
        type: "PositionClosed",
        positionId: "pos-1",
        settlement: { reserveId: "pulse-cash", proceeds: 300 },
      },
      {
        id: "evt-reserve",
        asOf: "2026-06-08",
        type: "ReserveOpened",
        reserve: {
          id: "capital-cash",
          portfolioId: "core",
          tempo: "Capital",
          executionMode: "live",
          accountId: "bitget-usd",
          currency: "USD",
        },
      },
      {
        id: "evt-transfer",
        asOf: "2026-06-09",
        type: "Transfer",
        fromReserveId: "pulse-cash",
        toReserveId: "capital-cash",
        amount: 500,
        tier: "c1",
      },
    ];

    const folded = foldEvents(genesis(), events);

    expect(folded.skipped).toEqual([]);
    // 10000 +1000 −200 −150 +225 +300 −500 = 10675 in pulse, 500 in capital.
    expect(folded.data).toEqual({
      fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
      review: { asOf: "2026-06-09", usdMxn: 20 },
      portfolios: [{ id: "core", name: "Core" }],
      accounts: [{ id: "bitget-usd", name: "Bitget", platform: "BITGET", currency: "USD" }],
      instruments: [
        { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
        { id: "eth-usd", name: "Ether", symbol: "ETH", currency: "USD" },
      ],
      reserves: [
        { ...genesis().reserves[0], amount: 10675, lots: [{ quantity: 10675, tier: "c1" }] },
        {
          id: "capital-cash",
          portfolioId: "core",
          tempo: "Capital",
          executionMode: "live",
          accountId: "bitget-usd",
          currency: "USD",
          amount: 500,
          lots: [{ quantity: 500, tier: "c1" }],
        },
      ],
      positions: [],
      closes: [
        // The open's entry anchor (VWAC 100), then the real mark.
        { instrumentId: "btc-usd", asOf: "2026-06-03", price: 100 },
        { instrumentId: "btc-usd", asOf: "2026-06-04", price: 150 },
      ],
      closedPositions: [
        {
          // Trim: 1 unit @100 + 0.5 @150 removed → cost 175, proceeds 225 at mark 150.
          positionId: "pos-1",
          instrumentId: "btc-usd",
          tempo: "Pulse",
          strategy: "authored-strategy",
          direction: "long",
          openedAsOf: "2026-06-03",
          closedAsOf: "2026-06-06",
          costBasisUsd: 175,
          proceedsUsd: 225,
          realizedPnlUsd: 50,
          tierAttribution: [{ tier: "c1", costBasisUsd: 175, proceedsUsd: 225, realizedPnlUsd: 50 }],
          partial: true,
          markVsFill: { markValueUsd: 225, proceedsUsd: 225, deltaUsd: 0 },
        },
        {
          // Close: the surviving 1 @100 + 0.5 @150 → cost 175, proceeds 300.
          positionId: "pos-1",
          instrumentId: "btc-usd",
          tempo: "Pulse",
          strategy: "authored-strategy",
          direction: "long",
          openedAsOf: "2026-06-03",
          closedAsOf: "2026-06-07",
          costBasisUsd: 175,
          proceedsUsd: 300,
          realizedPnlUsd: 125,
          tierAttribution: [{ tier: "c1", costBasisUsd: 175, proceedsUsd: 300, realizedPnlUsd: 125 }],
        },
      ],
    });
  });
});
