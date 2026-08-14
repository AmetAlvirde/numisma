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
  const before = foldEvents(genesis(), []).data;
  const after = foldEvents(genesis(), committed).data;
  return {
    cash: totalCash(after) - totalCash(before),
    closedRows: (after.closedPositions?.length ?? 0) - (before.closedPositions?.length ?? 0),
  };
}

/**
 * WHAT THE GATE ACTUALLY PREVENTED, as a number: fold the events the gate LET THROUGH,
 * fold the same batch with the gate bypassed entirely, and return the difference.
 *
 * This is the assertion with teeth, and the reason the obvious one has none. Asserting
 * `ledgerDelta(result.committed)` is `{0, 0}` on a rejection proves nothing: the harness
 * returns `committed: []` on any rejection, so that is `ledgerDelta([])` — zero for every
 * possible implementation of `foldEvents`, already implied by asserting `committed` is
 * empty, and unreachable anyway because the rejection assertion throws first. The
 * counterfactual is what carries the meaning, and it must be JOINED to the gated result
 * rather than measured beside it: if the rule regresses, the gate lets everything
 * through, gated equals ungated, and this difference collapses to zero — red, against
 * the exact figures the damage is worth.
 */
function damagePrevented(
  inputs: Record<string, unknown>[],
  committed: PortfolioEvent[],
): { cash: number; closedRows: number } {
  const gated = ledgerDelta(committed);
  const ungated = ledgerDelta(inputs.map(accepted));
  return {
    cash: ungated.cash - gated.cash,
    closedRows: ungated.closedRows - gated.closedRows,
  };
}

/**
 * Every seal rejection must name both dates AND BIND EACH TO ITS ROLE. Bare `toContain`
 * on each date is order-blind: a message that swapped them — "your close as of 06-18 is
 * blocked by a trim dated 06-10, date the close 06-10 or later" — would pass while
 * instructing the operator to use the very date being rejected. The composed substrings
 * below are what make the two dates non-interchangeable.
 */
function expectSealRejection(
  rejection: { path: string; message: string } | null,
  blockedAsOf: string,
  latestAsOf: string,
  verb: string,
): void {
  expect(rejection).not.toBeNull();
  expect(rejection?.path).toBe("positionId");
  expect(rejection?.message).toContain("PositionClosed closes position");
  expect(rejection?.message).toContain(`as of ${blockedAsOf}`);
  expect(rejection?.message).toContain(`${verb} dated ${latestAsOf}`);
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
      // What the gate PREVENTED, joined to what it did: $50 of cash and one fabricated
      // closed row. Collapses to `{0, 0}` — red — if the rule ever stops rejecting.
      expect(damagePrevented(batch(), result.committed)).toEqual({ cash: -50, closedRows: 1 });
    });

    // THE SHAPE OF THAT DAMAGE, spelled out. Folded WITHOUT the gate — which is exactly
    // what the durable log held before this rule — the same three events report a
    // fabricated $50 realized LOSS at full size on a position that broke even. Measured
    // at 80827b6.
    //
    // THIS TEST DOES NOT GUARD THE RULE, and an earlier comment here claimed it did.
    // `crossReferenceEvent` is nowhere in its path, so every mutation that destroys the
    // seal check leaves it green. It documents the figures; the `damagePrevented`
    // assertion above is what reddens.
    it("would fabricate a realized loss if those events ever reached the fold", () => {
      const folded = foldEvents(genesis(), batch().map(accepted)).data;

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
    const batch = [
      openLate(),
      invalidatePayload("evt-invalidate", "2026-06-20"),
      closePayload("evt-close", "2026-06-10"),
    ];
    const result = ingestBatch(batch);

    expectSealRejection(result.rejection, "2026-06-10", "2026-06-20", "InvalidationMarked");
    expect(result.committed).toEqual([]);
    // The prevented damage is a closed row, and NO cash — an invalidation has no reserve
    // leg, which is exactly why the message must not claim a vanished cash leg here.
    expect(damagePrevented(batch, result.committed)).toEqual({ cash: 0, closedRows: 1 });
    expect(result.rejection?.message).not.toContain("taking its cash leg");
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
      // Cash nets to zero even UNGATED, because the debit that should have fired never
      // did — so the prevented damage shows up only as the bogus closed row. This is the
      // case that proves a cash-only assertion is not enough.
      expect(damagePrevented(batch(), result.committed)).toEqual({ cash: 0, closedRows: 1 });
    });

    // The pre-fix damage, and why a cash-delta assertion ALONE cannot see it: the
    // unfolded batch also nets to a cash delta of 0, because the $100 debit that should
    // have fired never did. The lie is in the SIZE of what was closed.
    it("would drop the add-to whole — its debit unfired, its lot unclosed", () => {
      const folded = foldEvents(genesis(), batch().map(accepted)).data;

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

// THE OTHER HALF OF THE RULE: what it must NOT refuse. A gate that rejects everything
// passes every test in the block above, so these are the cases that give those their
// meaning. Each one folds the ACCEPTED batch and asserts what the fold produced — an
// acceptance test that only checks `rejection === null` would pass even if the close
// silently swallowed the trim, which is the very defect this increment closes.
describe("the seal rule refuses nothing it should not", () => {
  // CASE 1, AND THE ONLY TEST IN THE INCREMENT THAT EXERCISES STRICTNESS. Trim and
  // close on the SAME DAY, trim first in the log — an ordinary trading sequence. The
  // comparison is `asOf < latest` rejects, so equal is accepted; a non-strict `<=`
  // would refuse this batch outright and the first assertion would go red.
  //
  // The fold sorts by (`asOf`, THEN LOG INDEX), so the trim still applies first even at
  // equal dates and the close lands on the already-reduced lots. That is what the
  // `costBasisUsd: 50` below proves, and it is the load-bearing assertion here: had the
  // trim been dropped, the full-close row would read `costBasisUsd: 100` — exactly the
  // fabricated figure case A produces. Same-day acceptance is worth nothing if the
  // close still buries the trim.
  it("case 1 — accepts a same-day trim-then-close, and folds BOTH legs", () => {
    const result = ingestBatch([
      openLate(),
      trimPayload("evt-trim", "2026-06-10", 0.5, 50),
      closePayload("evt-close", "2026-06-10", 50),
    ]);

    expect(result.rejection).toBeNull();
    // Two rows: the trim's PARTIAL and the close's FULL. Cash nets to zero — out 100 at
    // the open, back 50 + 50.
    expect(ledgerDelta(result.committed)).toEqual({ cash: 0, closedRows: 2 });

    const folded = foldEvents(genesis(), result.committed).data;
    const rows = folded.closedPositions ?? [];
    expect(rows.map((row) => Boolean(row.partial))).toEqual([true, false]);
    // THE ASSERTION THAT MAKES THIS TEST NON-VACUOUS: the full-close row is sized 50,
    // not 100, so the close demonstrably ran on lots the trim had already reduced.
    expect(rows[1]).toMatchObject({
      positionId: "btc-late",
      costBasisUsd: 50,
      proceedsUsd: 50,
      realizedPnlUsd: 0,
    });
    expect(rows[0]).toMatchObject({ costBasisUsd: 50, proceedsUsd: 50, realizedPnlUsd: 0 });
    expect(folded.positions.map((position) => position.id)).toEqual(["btc-core"]);
  });

  // CASE 2 — the ordinary sequence the rule must leave completely alone. If this ever
  // reddens, the comparison direction has been inverted.
  it("case 2 — accepts an ordinary trim-then-later-close, unchanged", () => {
    const result = ingestBatch([
      openLate(),
      trimPayload("evt-trim", "2026-06-10", 0.5, 50),
      closePayload("evt-close", "2026-06-18", 50),
    ]);

    expect(result.rejection).toBeNull();
    expect(ledgerDelta(result.committed)).toEqual({ cash: 0, closedRows: 2 });

    const rows = foldEvents(genesis(), result.committed).data.closedPositions ?? [];
    expect(rows.map((row) => row.closedAsOf)).toEqual(["2026-06-10", "2026-06-18"]);
    expect(rows[1]).toMatchObject({ costBasisUsd: 50, realizedPnlUsd: 0 });
  });

  // CASE 3 — THE SUBSET INVARIANT, READ FROM THE CONSUMING SIDE. `btc-core` is
  // genesis-held and no log event has ever touched it, so `positionLastVerbAsOf` has no
  // entry for it and the helper's missing-entry branch must return SUCCESS, not a
  // dangling reference. Slice 1 pins the absence; this pins that the absence is read as
  // "nothing to seal behind". A helper that treated a missing entry as an error would
  // make every genesis-held position uncloseable — the loudest possible regression, and
  // one no rejection test in this file would catch.
  it("case 3 — accepts a close against a genesis-held position the log never touched", () => {
    const seed = genesis();
    const reference = buildEventReference(seed);
    expect(reference.positionLastVerbAsOf.has("btc-core")).toBe(false);

    const result = ingestBatch([
      {
        id: "evt-close-core",
        asOf: "2026-06-10",
        type: "PositionClosed",
        positionId: "btc-core",
        settlement: { reserveId: "pulse-cash", proceeds: 200 },
      },
    ]);

    expect(result.rejection).toBeNull();
    expect(ledgerDelta(result.committed)).toEqual({ cash: 200, closedRows: 1 });

    const folded = foldEvents(genesis(), result.committed).data;
    expect(folded.closedPositions?.[0]).toMatchObject({
      positionId: "btc-core",
      costBasisUsd: 200,
      proceedsUsd: 200,
      realizedPnlUsd: 0,
    });
    expect(folded.positions).toEqual([]);
  });
});

// FOUR GATES, ONE PATH. `positionId` is the machine-readable half of all four
// rejections a close can draw, so the MESSAGE is the only thing distinguishing them —
// which makes "are they actually distinguishable" a real question rather than a
// formality. Pairwise distinctness is the assertion; four regexes each matching its own
// message would still pass if two gates emitted the same string.
describe("the four position-id rejections a close can draw are distinguishable", () => {
  const rejections = () => ({
    unknown: ingestBatch([
      {
        id: "evt-close-ghost",
        asOf: "2026-06-10",
        type: "PositionClosed",
        positionId: "ghost",
        settlement: { reserveId: "pulse-cash", proceeds: 100 },
      },
    ]).rejection,
    // Ordered ahead of the seal check, so a close that is BOTH backdated before birth
    // and behind an accepted verb reports the birth fact. That ordering is what this
    // entry silently pins.
    notBorn: ingestBatch([openLate(), closePayload("evt-close", "2026-06-03")]).rejection,
    // DATED BEFORE THE FIRST CLOSE, DELIBERATELY. A second close dated LATER is the one
    // date where already-closed and the seal check AGREE on rejecting, so it pins
    // nothing about their order; backdating it makes the two gates disagree, and the
    // already-closed message is the one that must win. See the ordering test below.
    alreadyClosed: ingestBatch([
      openLate(),
      closePayload("evt-close", "2026-06-18"),
      closePayload("evt-close-again", "2026-06-08"),
    ]).rejection,
    sealsBehind: ingestBatch([
      openLate(),
      trimPayload("evt-trim", "2026-06-18", 0.5, 50),
      closePayload("evt-close", "2026-06-10", 50),
    ]).rejection,
  });

  it("all four land on path 'positionId'", () => {
    for (const rejection of Object.values(rejections())) {
      expect(rejection?.path).toBe("positionId");
    }
  });

  it("each says its own thing", () => {
    const { unknown, notBorn, alreadyClosed, sealsBehind } = rejections();

    expect(unknown?.message).toContain("neither the genesis seed nor the log contains");
    expect(notBorn?.message).toContain("not born until");
    expect(alreadyClosed?.message).toContain("already closed");
    expect(sealsBehind?.message).toContain("has already been accepted for it");
  });

  it("and no two of them are the same string", () => {
    const messages = Object.values(rejections()).map((rejection) => rejection?.message);

    expect(new Set(messages).size).toBe(4);
  });

  // THE ONE GATE BOUNDARY NOTHING ELSE PINS. Its siblings are already guarded — moving
  // the seal check ahead of `requirePositionBornBy` reddens five tests, moving it behind
  // the magnitude gate reddens one — but seal-vs-already-closed was free to swap, because
  // the only fixture exercising it used a second close dated LATER, where both orderings
  // reject alike. Backdated, they disagree: already-closed must still win, because "this
  // position is retired" is the more fundamental fact and the one the operator can act
  // on. Under a reorder this test reports the seal message instead.
  it("a second close dated BEFORE the first reports already-closed, not the seal", () => {
    const result = ingestBatch([
      openLate(),
      closePayload("evt-close", "2026-06-18"),
      closePayload("evt-close-again", "2026-06-08"),
    ]);

    expect(result.rejection?.path).toBe("positionId");
    expect(result.rejection?.message).toContain("already closed");
    expect(result.rejection?.message).not.toContain("has already been accepted for it");
  });
});

// WHICH POSITION THE RULE IS ABOUT. The map is keyed by position id and the helper looks
// up ONE key; a helper that ignored its `positionId` argument and took a global maximum
// over every value would have passed the entire suite before this test existed. The
// consequence is not subtle — every position becomes uncloseable the moment ANY other
// position has a later verb, and the rejection cites a trim on an unrelated instrument.
//
// The suite had both halves and never joined them: one test reads the map without
// running the rule, another runs the rule against a map with no entry for the target.
// This is the join — two positions, BOTH with entries, and only one of them relevant.
describe("the rule reads the CLOSING position's history, not the log's", () => {
  const twoPositions = () => [
    openLate(),
    invalidatePayload("evt-invalidate-core", "2026-06-08"),
    trimPayload("evt-trim-late", "2026-06-18", 0.5, 50),
  ];

  it("accepts a close whose own position is untouched after it, though another is not", () => {
    // `btc-core` was last touched 06-08 and closes 06-10 — fine on its own history.
    // `btc-late` was trimmed 06-18, LATER than that close, and is nobody's business here.
    const batch = [
      ...twoPositions(),
      {
        id: "evt-close-core",
        asOf: "2026-06-10",
        type: "PositionClosed",
        positionId: "btc-core",
        settlement: { reserveId: "pulse-cash", proceeds: 200 },
      },
    ];
    const result = ingestBatch(batch);

    // Both positions really do have entries — otherwise this proves nothing.
    const reference = buildEventReference(genesis(), result.committed);
    expect(reference.positionLastVerbAsOf.get("btc-late")?.asOf).toBe("2026-06-18");
    expect(reference.positionLastVerbAsOf.get("btc-core")?.asOf).toBe("2026-06-10");

    expect(result.rejection).toBeNull();
    expect(result.committed).toHaveLength(4);
  });

  it("still rejects when the closing position's OWN history is the later one", () => {
    // Same two-position world, but now the seal-breaking close targets `btc-late`, whose
    // own trim is the blocker. Proves the acceptance above is about WHOSE history it
    // read, not about the rule having gone quiet in a crowded log.
    const result = ingestBatch([...twoPositions(), closePayload("evt-close", "2026-06-10", 50)]);

    expectSealRejection(result.rejection, "2026-06-10", "2026-06-18", "PositionTrimmed");
  });
});

// THE TIE-BREAK, WHICH ONLY THE MESSAGE CAN SEE. Two verbs share the max date, so the
// date — and therefore every accept/reject verdict — is identical whichever wins the
// type slot. What changes is which verb the operator is sent to look at, and `foldEvents`
// sorts by (`asOf`, THEN LOG INDEX), so the LAST-logged of a same-dated group is the one
// applied last: the event actually sitting on top, and the first thing a close buries.
// Under `>` instead of `>=` the FIRST-logged kept the slot and this batch blamed the
// trim while the add-to — the one carrying the unfired funding debit — was the casualty.
it("names the LAST-logged verb when two share the latest date", () => {
  const batch = [
    openLate(),
    trimPayload("evt-trim", "2026-06-18", 0.5, 50),
    addToPayload("evt-add", "2026-06-18"),
    closePayload("evt-close", "2026-06-10", 100),
  ];
  const reference = buildEventReference(genesis(), batch.slice(0, 3).map(accepted));

  expect(reference.positionLastVerbAsOf.get("btc-late")).toEqual({
    asOf: "2026-06-18",
    type: "PositionAddedTo",
  });
  expectSealRejection(
    ingestBatch(batch).rejection,
    "2026-06-10",
    "2026-06-18",
    "PositionAddedTo",
  );
});

// CASE C — THE OVER-REJECTION ADR-017 RESOLVED, NOW PINNED THE OTHER WAY UP.
// `[Opened 06-05, Closed 06-10, Trimmed 06-08]`: the trim sorts BEFORE the close and
// folds perfectly correctly, so refusing it was stricter than the fold required. It was
// pinned as refused (ledger item 21) so that relaxing it would be a decision rather than
// drift; ADR-017 took that decision, and the pin is inverted here rather than deleted —
// the batch is the same, only the expected answer moved. It remains a pin on the SEAL
// rule's reach in the bargain: the seal check guards closes only, and admitting this trim
// must not make it start reporting on trims. The refusal boundary and the settlement-
// magnitude gate that survives the relaxation live in `position-backdated-trim.test.ts`.
describe("case C is admitted, the backdated trim ADR-017 relaxed", () => {
  const caseC = () => [
    openLate(),
    closePayload("evt-close", "2026-06-10"),
    trimPayload("evt-trim", "2026-06-08", 0.5, 50),
  ];

  it("admits the backdated trim, reporting neither the already-closed nor the seal message", () => {
    const result = ingestBatch(caseC());

    expect(result.rejection).toBeNull();
    expect(result.committed.map((event) => event.id)).toEqual([
      "evt-open-late",
      "evt-close",
      "evt-trim",
    ]);
  });

  // Unchanged from when it was the EVIDENCE for ledger 21: the same fold, the same two
  // rows, the same realized 50. It was the argument for the relaxation and is now the
  // expectation of it — which is the point of stating the cost in the book's own numbers.
  it("and the book it folds to is the one that argued for admitting it", () => {
    const folded = foldEvents(genesis(), caseC().map(accepted)).data;
    const rows = folded.closedPositions ?? [];

    expect(rows.map((row) => row.closedAsOf)).toEqual(["2026-06-08", "2026-06-10"]);
    expect(rows[1]).toMatchObject({ costBasisUsd: 50, proceedsUsd: 100, realizedPnlUsd: 50 });
  });
});

// CASE 6 — CANARY CONFIRMATION, recorded rather than re-run. These suites already run
// on every `pnpm test`; duplicating them here would only add a second place to update.
// Measured green and byte-untouched with the seal check in place:
//
//   position-born-by.test.ts   29 tests — the seal check sits BEHIND born-by's own call,
//                                         so any moved message or path means the
//                                         call-site ordering is wrong.
//   reserve-opened.test.ts     45 tests — the standing canary from the born-by increment.
//   event-ingest.test.ts       64 tests — including the post-close guard, whose two
//                                         `/already closed/` assertions are positive
//                                         evidence the seal check did not pre-empt it.
