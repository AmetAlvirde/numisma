// The ONE pending-inbox walk (audit finding 9). The TUI spine's `ingestInbox` and
// the price-feed's fetch-time rejection pre-check each used to hand-roll this loop;
// the pre-check's entire value is byte-fidelity to the spine, and nothing held the
// two copies together (the price-feed package cannot import `apps/tui`). These tests
// lock the ONE walk's contract at the seam both callers consume: order, dedup
// (before the guard), the reference advancing only on accept, and the two error
// policies the callers deliberately differ on — halt-on-rejection (the spine's
// all-or-nothing ingest) vs collect-and-continue (the advisory pre-check).
import { describe, expect, it } from "vitest";
import { buildEventReference, walkPendingInbox, type FundReviewData } from "../index.js";

const GENESIS_AS_OF = "2026-06-01";

function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" }],
    instruments: [
      { id: "aapl-usd", name: "Apple Inc.", symbol: "AAPL", currency: "USD" },
      { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
    ],
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
        id: "aapl-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        markPrice: 150,
        currency: "USD",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
      },
    ],
  };
}

function openedInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-open",
    asOf: "2026-06-05",
    type: "PositionOpened",
    position: {
      id: "btc-core",
      portfolioId: "core",
      tempo: "Liquid",
      executionMode: "live",
      accountId: "xtb-usd",
      instrumentId: "btc-usd",
      direction: "long",
      currency: "USD",
      lots: [{ quantity: 1, cost: 100, tier: "c1" }],
    },
    decision: {
      entryThesis: "thesis",
      invalidationCondition: "invalidation",
      riskBudget: "1R",
      plannedHoldingHorizon: "weeks",
      strategy: "trend",
    },
    funding: { reserveId: "cash-core", amount: 100 },
    ...overrides,
  };
}

function markedInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-mark",
    asOf: "2026-06-06",
    type: "PriceMarked",
    instrumentId: "aapl-usd",
    price: 160,
    ...overrides,
  };
}

describe("walkPendingInbox — the one pending-inbox walk", () => {
  it("accepts in order and ADVANCES the reference, so a later event can cite an earlier one", () => {
    const reference = buildEventReference(genesis());
    const walk = walkPendingInbox(
      [openedInput(), markedInput({ id: "e-mark-btc", instrumentId: "btc-usd", price: 100 })],
      reference,
    );

    expect(walk.invalid).toBeUndefined();
    expect(walk.rejected).toEqual([]);
    expect(walk.accepted.map((event) => event.id)).toEqual(["e-open", "e-mark-btc"]);
    expect(walk.duplicateCount).toBe(0);
    // The mark cites `btc-usd`, whose only close comes from the open folded a step
    // earlier in this same batch — it can only pass on an ADVANCED reference.
    expect([...walk.seenIds]).toEqual(["e-open", "e-mark-btc"]);
  });

  it("dedup-skips an id already seen BEFORE the guard, counting it as a duplicate", () => {
    const reference = buildEventReference(genesis());
    const walk = walkPendingInbox([openedInput()], reference, { seenIds: new Set(["e-open"]) });

    expect(walk.duplicateCount).toBe(1);
    expect(walk.accepted).toEqual([]);
    expect(walk.rejected).toEqual([]);
  });

  it("dedup-skips a repeat of an id accepted earlier in the SAME batch", () => {
    const reference = buildEventReference(genesis());
    const walk = walkPendingInbox([openedInput(), openedInput()], reference);

    expect(walk.accepted.map((event) => event.id)).toEqual(["e-open"]);
    expect(walk.duplicateCount).toBe(1);
  });

  it("HALTS at the first structurally invalid candidate, walking nothing after it", () => {
    const reference = buildEventReference(genesis());
    const walk = walkPendingInbox([{ type: "NotAVerb" }, openedInput()], reference);

    expect(walk.invalid).toEqual({
      index: 0,
      path: expect.any(String),
      message: expect.any(String),
    });
    expect(walk.accepted).toEqual([]);
  });

  it("haltOnRejection stops at the first cross-reference rejection (the spine's all-or-nothing ingest)", () => {
    const reference = buildEventReference(genesis());
    const walk = walkPendingInbox(
      // A 10× mark trips the magnitude guard; the open after it must never be walked.
      [markedInput({ id: "e-fat-finger", price: 3000 }), openedInput()],
      reference,
      { haltOnRejection: true },
    );

    expect(walk.rejected).toHaveLength(1);
    expect(walk.rejected[0]?.index).toBe(0);
    expect(walk.rejected[0]?.event.id).toBe("e-fat-finger");
    expect(walk.accepted).toEqual([]);
  });

  it("by default COLLECTS rejections, keeps walking, and never advances on a rejected event", () => {
    const reference = buildEventReference(genesis());
    const walk = walkPendingInbox(
      [markedInput({ id: "e-fat-finger", price: 3000 }), openedInput()],
      reference,
    );

    expect(walk.rejected.map((rejection) => rejection.event.id)).toEqual(["e-fat-finger"]);
    expect(walk.accepted.map((event) => event.id)).toEqual(["e-open"]);
    // A rejected event's id is still SEEN: a later duplicate of it is one the spine
    // would dedup-skip too, so the pre-check must not judge it a second time.
    expect(walk.seenIds.has("e-fat-finger")).toBe(true);
  });

  it("passes the magnitude dial straight through to the guard", () => {
    const wide = buildEventReference(genesis());
    const walk = walkPendingInbox([markedInput({ price: 3000 })], wide, {
      magnitudeThreshold: 100,
    });

    expect(walk.rejected).toEqual([]);
    expect(walk.accepted.map((event) => event.id)).toEqual(["e-mark"]);
  });
});
