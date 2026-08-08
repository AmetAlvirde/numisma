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

/**
 * The ingest contract in miniature, copied from `position-born-by.test.ts`: parse then
 * cross-reference each event in LOG order, rebuilding the reference from genesis +
 * everything committed so far (ADR-015), and ABORT THE WHOLE BATCH on the first
 * rejection. All-or-nothing — which is what makes the delta assertions below meaningful.
 */
function ingestBatch(
  inputs: Record<string, unknown>[],
  seed: FundReviewData = genesis(),
): { committed: PortfolioEvent[]; rejection: { path: string; message: string } | null } {
  const committed: PortfolioEvent[] = [];
  for (const input of inputs) {
    const parsed = parseEvent(input);
    if (parsed.kind !== "ok") {
      return { committed: [], rejection: { path: parsed.path, message: parsed.message } };
    }
    const checked = crossReferenceEvent(parsed.value, buildEventReference(seed, committed));
    if (checked.kind !== "ok") {
      return { committed: [], rejection: { path: checked.path, message: checked.message } };
    }
    committed.push(parsed.value);
  }
  return { committed, rejection: null };
}

const totalCash = (fund: FundReviewData): number =>
  fund.reserves.reduce((sum, reserve) => sum + reserve.amount, 0);

/**
 * Z2: assert the DELTA, never the resting state. A test that asserts absolute balances
 * passes this bug vacuously — the whole defect is that the batch was accepted and the
 * numbers moved. Folds `genesis + committed` against `genesis + nothing`.
 */
function ledgerDelta(committed: PortfolioEvent[]): { cash: number; closedRows: number } {
  const before = foldEvents(genesis(), []);
  const after = foldEvents(genesis(), committed);
  return {
    cash: totalCash(after) - totalCash(before),
    closedRows: (after.closedPositions?.length ?? 0) - (before.closedPositions?.length ?? 0),
  };
}

/** Every seal rejection must name BOTH dates and the verb it would have buried. */
function expectSealRejection(
  rejection: { path: string; message: string } | null,
  blockedAsOf: string,
  latestAsOf: string,
  verb: string,
): void {
  expect(rejection).not.toBeNull();
  expect(rejection?.path).toBe("positionId");
  expect(rejection?.message).toContain("PositionClosed");
  expect(rejection?.message).toContain(blockedAsOf);
  expect(rejection?.message).toContain(latestAsOf);
  expect(rejection?.message).toContain(verb);
}

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

// THE RULE ITSELF. Neither event can see the problem when it is judged: when the trim
// is gated the close does not exist yet, and when the close is gated nothing is retired
// yet. Both passed, and the fold's (`asOf`, then log) ordering then applied the close
// first and dropped everything dated after it — silently, `warnings: []`.
describe("a PositionClosed may not seal behind a verb already in the log", () => {
  // CASE A, THE TRACER — and the only one that writes a WRONG NUMBER rather than merely
  // dropping a leg. Open 1 @ 100, trim half for 50, close the rest for 50: a position
  // that broke even. With the close sorted first it lands on the FULL lots.
  describe("case A — a trim, and a close dated before it", () => {
    const batch = (proceeds = 50) => [
      openLate(),
      trimPayload("evt-trim", "2026-06-18", 0.5, 50),
      closePayload("evt-close", "2026-06-10", proceeds),
    ];

    it("is rejected, naming both dates and the trim, with nothing committed", () => {
      const result = ingestBatch(batch());

      expectSealRejection(result.rejection, "2026-06-10", "2026-06-18", "PositionTrimmed");
      expect(result.committed).toEqual([]);
      expect(ledgerDelta(result.committed)).toEqual({ cash: 0, closedRows: 0 });
    });

    // THE PRE-FIX DAMAGE, PINNED. Folded WITHOUT the gate — which is exactly what the
    // durable log held before this rule — the same three events report a fabricated $50
    // realized LOSS at full size on a position that broke even, and take $50 of cash
    // with them. Measured at 80827b6. This is the number the gate exists to make
    // unreachable; if the rule regresses, the assertion above goes green-to-red against
    // these very figures.
    it("would fabricate a realized loss if those events ever reached the fold", () => {
      const folded = foldEvents(genesis(), batch().map(accepted));

      expect(ledgerDelta(batch().map(accepted))).toEqual({ cash: -50, closedRows: 1 });
      expect(folded.closedPositions?.[0]).toMatchObject({
        positionId: "btc-late",
        costBasisUsd: 100,
        proceedsUsd: 50,
        realizedPnlUsd: -50,
      });
      // And nothing anywhere says so: `foldEvents` has NO diagnostics channel to say it
      // with (ledger 18, deliberately out of scope here), which is precisely why the
      // rule has to live at INGEST rather than as a warning after the fact.
    });

    // CASE 4 — THE MAGNITUDE ACCIDENT, RE-POINTED. This same batch at `proceeds: 100`
    // was already refused before this rule, but by the settlement-magnitude gate, and
    // for the WRONG REASON: "proceeds 100 deviate 100.0% from expected 50.00" blames the
    // fill size when the fill was honest and the ORDERING was the defect. The seal check
    // sits AHEAD of magnitude, so the message must no longer mention the deviation. THIS
    // IS THE TEST THAT PINS THE CALL-SITE ORDER — it reddens if the check lands after
    // the magnitude gate.
    it("is refused by the SEAL rule, not the magnitude gate, at proceeds 100", () => {
      const result = ingestBatch(batch(100));

      expectSealRejection(result.rejection, "2026-06-10", "2026-06-18", "PositionTrimmed");
      expect(result.rejection?.message).not.toContain("deviate");
      expect(result.rejection?.path).not.toBe("settlement.proceeds");
    });
  });

  // CASE D — the verb the FOLD can never date. `InvalidationLevel` carries no `asOf`,
  // so no fold-only projection could have caught this one; the level simply vanished.
  it("case D — rejects a close dated before an accepted InvalidationMarked", () => {
    const result = ingestBatch([
      openLate(),
      invalidatePayload("evt-invalidate", "2026-06-20"),
      closePayload("evt-close", "2026-06-10"),
    ]);

    expectSealRejection(result.rejection, "2026-06-10", "2026-06-20", "InvalidationMarked");
    expect(result.committed).toEqual([]);
    expect(ledgerDelta(result.committed)).toEqual({ cash: 0, closedRows: 0 });
  });

  // CASE E, THE WIDEST — the case where MONEY moves against the operator's belief. The
  // add-to is dropped whole, so its $100 funding DEBIT never fires: the operator thinks
  // $100 was deployed into the position, and the book shows it in neither the position's
  // lots nor as a debit against the reserve. Measured at 80827b6: cash delta 0 across
  // open + add + close, and a closed row sized 1 rather than 2.
  describe("case E — an add-to, and a close dated before it", () => {
    const batch = () => [
      openLate(),
      addToPayload("evt-add", "2026-06-18"),
      closePayload("evt-close", "2026-06-10"),
    ];

    it("is rejected, with the funding debit delta at zero", () => {
      const result = ingestBatch(batch());

      expectSealRejection(result.rejection, "2026-06-10", "2026-06-18", "PositionAddedTo");
      expect(result.committed).toEqual([]);
      expect(ledgerDelta(result.committed)).toEqual({ cash: 0, closedRows: 0 });
    });

    // The pre-fix damage, and why a cash-delta assertion ALONE cannot see it: the
    // unfolded batch also nets to a cash delta of 0, because the $100 debit that should
    // have fired never did. The lie is in the SIZE of what was closed.
    it("would drop the add-to whole — its debit unfired, its lot unclosed", () => {
      const folded = foldEvents(genesis(), batch().map(accepted));

      expect(ledgerDelta(batch().map(accepted))).toEqual({ cash: 0, closedRows: 1 });
      expect(folded.closedPositions?.[0]).toMatchObject({
        positionId: "btc-late",
        costBasisUsd: 100,
        proceedsUsd: 100,
      });
      expect(folded.positions.map((position) => position.id)).toEqual(["btc-core"]);
    });
  });
});
