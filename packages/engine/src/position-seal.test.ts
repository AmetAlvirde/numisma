// Ledger 20, the DEATH side: a close may not SEAL BEHIND an event already in the log.
//
// Two halves. `EventReference.positionLastVerbAsOf` is the projection — the latest
// position-targeting event already accepted, per position id — and its tests are
// STRUCTURAL, about the map's key set and its values. `requirePositionUntouchedAfter`
// is the rule that reads it, and its tests are the three measured reproductions (A, D,
// E) plus the ordering pin that keeps it ahead of the settlement-magnitude gate.
//
// Fixtures mirror `position-born-by.test.ts` (same genesis seed, same `openLate`, same
// `accepted` helper) so the two files describe the same world from opposite ends: birth
// is the EARLIEST bound on a verb's date, this map is the LATEST bound on a close's.
import {
  buildEventReference,
  crossReferenceEvent,
  foldEvents,
  parseEvent,
  type FundReviewData,
  type PortfolioEvent,
} from "./index.js";
import { describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";
/** The log-born position's own birth date. */
const OPENED_AS_OF = "2026-06-05";

/**
 * One genesis-HELD position (`btc-core`, which the log below never touches — the
 * population the SUBSET invariant exists for) and one funded Reserve.
 */
function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "bitget-usd", name: "Bitget", platform: "BITGET", currency: "USD" }],
    instruments: [{ id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" }],
    reserves: [
      {
        id: "pulse-cash",
        portfolioId: "core",
        tempo: "Pulse",
        executionMode: "live",
        accountId: "bitget-usd",
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
        id: "btc-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "bitget-usd",
        instrumentId: "btc-usd",
        direction: "long",
        markPrice: 100,
        currency: "USD",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
      },
    ],
  };
}

/** The LOG-BORN position: `btc-late`, born 2026-06-05, one lot of 1 @ 100. */
function openLate(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "evt-open-late",
    asOf: OPENED_AS_OF,
    type: "PositionOpened",
    position: {
      id: "btc-late",
      portfolioId: "core",
      tempo: "Capital",
      executionMode: "live",
      accountId: "bitget-usd",
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
    funding: { reserveId: "pulse-cash", amount: 100 },
    ...overrides,
  };
}

/** parseEvent, asserting success, so a test can hand the typed event onward. */
function accepted(input: Record<string, unknown>): PortfolioEvent {
  const result = parseEvent(input);
  if (result.kind !== "ok") {
    throw new Error(`expected parse to accept: ${result.path}: ${result.message}`);
  }
  return result.value;
}

// RAW payloads, so the same fixtures feed both the structural tests (which build the
// reference from parsed events directly) and the `ingestBatch` harness (which must
// parse them itself, exactly as the real ingest path does).
const trimPayload = (
  id: string,
  asOf: string,
  quantity = 0.25,
  proceeds = 25,
): Record<string, unknown> => ({
  id,
  asOf,
  type: "PositionTrimmed",
  positionId: "btc-late",
  removals: [{ quantity, tier: "c1" }],
  settlement: { reserveId: "pulse-cash", proceeds },
});

const addToPayload = (id: string, asOf: string): Record<string, unknown> => ({
  id,
  asOf,
  type: "PositionAddedTo",
  positionId: "btc-late",
  lot: { quantity: 1, cost: 100, tier: "c1" },
  funding: { reserveId: "pulse-cash", amount: 100 },
});

const invalidatePayload = (id: string, asOf: string): Record<string, unknown> => ({
  id,
  asOf,
  type: "InvalidationMarked",
  positionId: "btc-late",
  price: 80,
  direction: "below",
});

const closePayload = (id: string, asOf: string, proceeds = 100): Record<string, unknown> => ({
  id,
  asOf,
  type: "PositionClosed",
  positionId: "btc-late",
  settlement: { reserveId: "pulse-cash", proceeds },
});

const trimLate = (id: string, asOf: string): PortfolioEvent => accepted(trimPayload(id, asOf));
const addToLate = (id: string, asOf: string): PortfolioEvent => accepted(addToPayload(id, asOf));
const invalidateLate = (id: string, asOf: string): PortfolioEvent =>
  accepted(invalidatePayload(id, asOf));
const closeLate = (id: string, asOf: string): PortfolioEvent => accepted(closePayload(id, asOf));

const markBtc = (id: string, asOf: string): PortfolioEvent =>
  accepted({ id, asOf, type: "PriceMarked", instrumentId: "btc-usd", price: 110 });
const keysOf = (reference: ReturnType<typeof buildEventReference>): string[] =>
  [...reference.positionLastVerbAsOf.keys()].sort();

/**
 * THE INVARIANT THAT DISTINGUISHES THIS MAP FROM `positionBornAsOf`, whose key set is
 * EXACTLY `positionIds`. Here it is a SUBSET: a position the log has never touched has
 * no entry, and that absence is the meaningful answer — "nothing to seal behind" — not
 * a gap to be filled with a fallback.
 */
function expectSubsetOfPositionIds(reference: ReturnType<typeof buildEventReference>): void {
  for (const id of reference.positionLastVerbAsOf.keys()) {
    expect(reference.positionIds.has(id)).toBe(true);
  }
}

describe("positionLastVerbAsOf carries the latest verb date per position", () => {
  describe("its key set is a SUBSET of positionIds, not equal to it", () => {
    it("is EMPTY at genesis, though positionIds is not", () => {
      const reference = buildEventReference(genesis());

      expect(reference.positionIds.has("btc-core")).toBe(true);
      expect(keysOf(reference)).toEqual([]);
      expectSubsetOfPositionIds(reference);
    });

    it("leaves a genesis-held position the log never touched with NO entry", () => {
      const reference = buildEventReference(genesis(), [
        accepted(openLate()),
        trimLate("evt-trim", "2026-06-12"),
      ]);

      expect(reference.positionIds.has("btc-core")).toBe(true);
      expect(reference.positionLastVerbAsOf.has("btc-core")).toBe(false);
      expect(keysOf(reference)).toEqual(["btc-late"]);
      expectSubsetOfPositionIds(reference);
    });

    it("gains a genesis-held position only once a verb targets it", () => {
      const reference = buildEventReference(genesis(), [
        accepted({
          id: "evt-invalidate-core",
          asOf: "2026-06-09",
          type: "InvalidationMarked",
          positionId: "btc-core",
          price: 80,
          direction: "below",
        }),
      ]);

      expect(reference.positionLastVerbAsOf.get("btc-core")?.asOf).toBe("2026-06-09");
      expectSubsetOfPositionIds(reference);
    });
  });

  describe("each value is the MAX asOf across that position's position-targeting events", () => {
    it("counts the open itself — a freshly opened position is dated to its birth", () => {
      const reference = buildEventReference(genesis(), [accepted(openLate())]);

      expect(reference.positionLastVerbAsOf.get("btc-late")?.asOf).toBe(OPENED_AS_OF);
    });

    it("takes the max across all five verbs, not the last one in the log", () => {
      // The invalidation is the LATEST by date but NOT last in the log: a
      // last-write-wins scan would answer 06-12 and the seal rule would then admit a
      // close that buries the level.
      const reference = buildEventReference(genesis(), [
        accepted(openLate()),
        addToLate("evt-add", "2026-06-08"),
        invalidateLate("evt-invalidate", "2026-06-20"),
        trimLate("evt-trim", "2026-06-12"),
      ]);

      expect(reference.positionLastVerbAsOf.get("btc-late")?.asOf).toBe("2026-06-20");
    });

    it("counts a close, so a retired position is still dated", () => {
      const reference = buildEventReference(genesis(), [
        accepted(openLate()),
        trimLate("evt-trim", "2026-06-12"),
        closeLate("evt-close", "2026-06-18"),
      ]);

      expect(reference.closedPositionIds.has("btc-late")).toBe(true);
      expect(reference.positionLastVerbAsOf.get("btc-late")?.asOf).toBe("2026-06-18");
      expectSubsetOfPositionIds(reference);
    });

    it("keeps each position's max independent of the others", () => {
      const reference = buildEventReference(genesis(), [
        accepted(openLate()),
        trimLate("evt-trim", "2026-06-12"),
        accepted({
          id: "evt-invalidate-core",
          asOf: "2026-06-25",
          type: "InvalidationMarked",
          positionId: "btc-core",
          price: 80,
          direction: "below",
        }),
      ]);

      expect(reference.positionLastVerbAsOf.get("btc-late")?.asOf).toBe("2026-06-12");
      expect(reference.positionLastVerbAsOf.get("btc-core")?.asOf).toBe("2026-06-25");
    });
  });

  // `PriceMarked` targets an INSTRUMENT, not a position. Scanning it would date every
  // position holding that instrument to the last mark — and since the price feed marks
  // daily, that would seal every position behind today, refusing ordinary backdated
  // bookkeeping for a reason that has nothing to do with the position.
  it("does not advance on a PriceMarked", () => {
    const reference = buildEventReference(genesis(), [
      accepted(openLate()),
      trimLate("evt-trim", "2026-06-12"),
      markBtc("evt-mark", "2026-06-30"),
    ]);

    expect(reference.positionLastVerbAsOf.get("btc-late")?.asOf).toBe("2026-06-12");
    expect(keysOf(reference)).toEqual(["btc-late"]);
  });
});
