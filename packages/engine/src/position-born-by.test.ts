// ADR-015's THIRD DELTA CLASS, closed — the position-side twin of
// `requireReserveBornBy`.
//
// The gate walks a batch in LOG order; `foldEvents` applies in (`asOf`, then log)
// order, and nothing reconciled the two on the position side. Measured on
// `[PositionOpened asOf 06-05 btc-late, PositionClosed asOf 06-03 btc-late]`: both
// events passed both gates and were durably appended, the close sorted FIRST at
// fold, `positions.get(...)` missed, the cash leg was skipped and NO closed-book row
// was pushed — so `closedPositionIds` never gained the id, and a SECOND backdated
// close with a fresh event id (log dedup keys on `event.id` alone) sailed past the
// A1 post-close guard too. Two closes in the log, zero effect on the book,
// `warnings: []`.
//
// Mirrors `reserve-opened.test.ts:341-620` deliberately: same `ingestBatch` shape,
// same per-call-site regression matrix, same `expectBornByRejection` helper, and the
// same Z2 discipline — EVERY claim is a DELTA (after − before === 0), never a
// resting state, because a test that asserts absolute balances passes this bug
// vacuously.
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
/** Before `btc-late` is born, after the genesis review: the ADR's measured case. */
const BACKDATED_AS_OF = "2026-06-03";

/**
 * One genesis-HELD position (`btc-core` — no `openedAsOf` anywhere, which is exactly
 * the population the `?? genesisAsOf` fallback exists for) and one funded Reserve.
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

/**
 * The ingest contract in miniature: parse then cross-reference each event in LOG
 * order, rebuilding the reference from genesis + everything committed so far
 * (ADR-015), and ABORT THE WHOLE BATCH on the first rejection. All-or-nothing.
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

/** Every rejection must name BOTH dates, or the operator cannot see the ordering. */
function expectBornByRejection(
  rejection: { path: string; message: string } | null,
  path: string,
): void {
  expect(rejection).not.toBeNull();
  expect(rejection?.path).toBe(path);
  expect(rejection?.message).toContain("not born until");
  expect(rejection?.message).toContain(BACKDATED_AS_OF);
  expect(rejection?.message).toContain(OPENED_AS_OF);
}

describe("the position gate learns time", () => {
  /** The ADR's measured pair, in the log order an inbox would hand them over. */
  function backdatedBatch(): Record<string, unknown>[] {
    return [
      openLate(),
      {
        id: "evt-close-1",
        asOf: BACKDATED_AS_OF, // BEFORE `btc-late` is born on 2026-06-05.
        type: "PositionClosed",
        positionId: "btc-late",
        settlement: { reserveId: "pulse-cash", proceeds: 100 },
      },
    ];
  }

  it("rejects a PositionClosed dated before the position it closes was born", () => {
    const { rejection } = ingestBatch(backdatedBatch());

    expectBornByRejection(rejection, "positionId");
    // The verb names itself, exactly as the reserve call sites do.
    expect(rejection?.message).toMatch(/^PositionClosed /);
    // The fold-order explanation is the actionable half.
    expect(rejection?.message).toContain("date order");
    expect(rejection?.message).toContain("open the position earlier");
  });

  // Z2 — THE ASSERTION IS THE DELTA, NOT THE RESTING STATE.
  it("moves no cash and mints no closed-book row when the batch is rejected", () => {
    const before = foldEvents(genesis(), []);
    const { committed } = ingestBatch(backdatedBatch());
    const after = foldEvents(genesis(), committed);

    expect(totalCash(after) - totalCash(before)).toBe(0);
    expect((after.closedPositions ?? []).length - (before.closedPositions ?? []).length).toBe(0);
    expect(after.positions.length - before.positions.length).toBe(0);
  });

  // THE DOUBLE-CLOSE CHAIN IS NOW UNREACHABLE. Pre-fix, close #1 was admitted, folded
  // to nothing, left `closedPositionIds` empty — and close #2, carrying a fresh event
  // id, cleared the A1 post-close guard on that empty set. With the born-by rule in
  // front, close #1 is refused and #2 never gets its chance.
  it("makes the double-close chain unreachable — the FIRST backdated close is refused", () => {
    const before = foldEvents(genesis(), []);
    const { committed, rejection } = ingestBatch([
      ...backdatedBatch(),
      {
        id: "evt-close-2-reauthored",
        asOf: BACKDATED_AS_OF,
        type: "PositionClosed",
        positionId: "btc-late",
        settlement: { reserveId: "pulse-cash", proceeds: 100 },
      },
    ]);
    const after = foldEvents(genesis(), committed);

    expectBornByRejection(rejection, "positionId");
    expect(committed).toHaveLength(0);
    expect(totalCash(after) - totalCash(before)).toBe(0);
    expect((after.closedPositions ?? []).length - (before.closedPositions ?? []).length).toBe(0);
  });

  // PER-CALL-SITE REGRESSION MATRIX. Four position-targeting verbs, one case each,
  // so mutating any single call site reddens exactly one case below.
  describe("every position-targeting call site rejects a verb dated before the position's birth", () => {
    /** `[PositionOpened, <verb backdated before it>]` — the ADR's shape, per verb. */
    function afterOpening(verb: Record<string, unknown>): { path: string; message: string } | null {
      return ingestBatch([openLate(), { asOf: BACKDATED_AS_OF, ...verb }]).rejection;
    }

    it("PositionClosed — positionId", () => {
      expectBornByRejection(
        afterOpening({
          id: "evt-close",
          type: "PositionClosed",
          positionId: "btc-late",
          settlement: { reserveId: "pulse-cash", proceeds: 100 },
        }),
        "positionId",
      );
    });

    it("PositionTrimmed — positionId", () => {
      expectBornByRejection(
        afterOpening({
          id: "evt-trim",
          type: "PositionTrimmed",
          positionId: "btc-late",
          removals: [{ quantity: 0.5, tier: "c1" }],
          settlement: { reserveId: "pulse-cash", proceeds: 50 },
        }),
        "positionId",
      );
    });

    it("PositionAddedTo — positionId", () => {
      expectBornByRejection(
        afterOpening({
          id: "evt-add",
          type: "PositionAddedTo",
          positionId: "btc-late",
          lot: { quantity: 1, cost: 100, tier: "c1" },
          funding: { reserveId: "pulse-cash", amount: 100 },
        }),
        "positionId",
      );
    });

    it("InvalidationMarked — positionId", () => {
      expectBornByRejection(
        afterOpening({
          id: "evt-invalidation",
          type: "InvalidationMarked",
          positionId: "btc-late",
          price: 80,
          direction: "below",
        }),
        "positionId",
      );
    });
  });

  // POSITIVE CONTROL, and the thing that pins `?? genesisAsOf`. A genesis-HELD
  // position carries no `openedAsOf` on either the surviving or the closed record, so
  // without the fallback its birth date would be `undefined` and every one of these
  // four legal verbs would be refused — the rule would eat the whole seeded book.
  describe("a genesis-held position is born with the world", () => {
    const onGenesisDay = (verb: Record<string, unknown>) =>
      ingestBatch([{ asOf: GENESIS_AS_OF, ...verb }]).rejection;

    it("PositionClosed on the genesis review date is accepted", () => {
      expect(
        onGenesisDay({
          id: "evt-close-core",
          type: "PositionClosed",
          positionId: "btc-core",
          settlement: { reserveId: "pulse-cash", proceeds: 200 },
        }),
      ).toBeNull();
    });

    it("PositionTrimmed on the genesis review date is accepted", () => {
      expect(
        onGenesisDay({
          id: "evt-trim-core",
          type: "PositionTrimmed",
          positionId: "btc-core",
          removals: [{ quantity: 1, tier: "c1" }],
          settlement: { reserveId: "pulse-cash", proceeds: 100 },
        }),
      ).toBeNull();
    });

    it("PositionAddedTo on the genesis review date is accepted", () => {
      expect(
        onGenesisDay({
          id: "evt-add-core",
          type: "PositionAddedTo",
          positionId: "btc-core",
          lot: { quantity: 1, cost: 100, tier: "c1" },
          funding: { reserveId: "pulse-cash", amount: 100 },
        }),
      ).toBeNull();
    });

    it("InvalidationMarked on the genesis review date is accepted", () => {
      expect(
        onGenesisDay({
          id: "evt-invalidation-core",
          type: "InvalidationMarked",
          positionId: "btc-core",
          price: 80,
          direction: "below",
        }),
      ).toBeNull();
    });
  });

  // STRUCTURAL INVARIANT. `requirePositionBornBy` answers EXISTENCE off
  // `positionBornAsOf.get(id) === undefined`, so an id that is in `positionIds` but
  // missing from the map would be reported as unknown — a retired position would
  // start lying about why it was refused. Every known id must be datable.
  describe("positionBornAsOf's key set is exactly positionIds", () => {
    const expectSameKeys = (reference: ReturnType<typeof buildEventReference>) => {
      expect([...reference.positionBornAsOf.keys()].sort()).toEqual(
        [...reference.positionIds].sort(),
      );
    };

    it("at genesis", () => {
      expectSameKeys(buildEventReference(genesis()));
    });

    it("with a log-born position open", () => {
      expectSameKeys(buildEventReference(genesis(), [accepted(openLate())]));
    });

    it("after a FULL close — a retired id stays datable", () => {
      const reference = buildEventReference(genesis(), [
        accepted(openLate()),
        accepted({
          id: "evt-close-late",
          asOf: "2026-06-20",
          type: "PositionClosed",
          positionId: "btc-late",
          settlement: { reserveId: "pulse-cash", proceeds: 100 },
        }),
      ]);

      expect(reference.closedPositionIds.has("btc-late")).toBe(true);
      expectSameKeys(reference);
      // And it is datable to its LOG birth, not to genesis.
      expect(reference.positionBornAsOf.get("btc-late")).toBe(OPENED_AS_OF);
      expect(reference.positionBornAsOf.get("btc-core")).toBe(GENESIS_AS_OF);
    });

    // The path that keeps the genesis SEEDING (below) safe for the key-set invariant.
    // Seeding ids straight off `genesis.positions` would put a key in the map that
    // `positionIds` lacks if the fold could ever drop a genesis position without
    // minting a closed-book row. It cannot — a genesis position is in `positions` from
    // t0, so its close always finds it and always pushes a full row — and this is the
    // case that holds that reasoning to account rather than leaving it in a comment.
    it("after a genesis-HELD position is fully closed", () => {
      const reference = buildEventReference(genesis(), [
        accepted({
          id: "evt-close-core",
          asOf: "2026-06-10",
          type: "PositionClosed",
          positionId: "btc-core",
          settlement: { reserveId: "pulse-cash", proceeds: 200 },
        }),
      ]);

      expect(reference.closedPositionIds.has("btc-core")).toBe(true);
      expectSameKeys(reference);
      expect(reference.positionBornAsOf.get("btc-core")).toBe(GENESIS_AS_OF);
    });

    // WHAT THIS PROVES, STATED HONESTLY: that a trimmed-but-still-open position is
    // datable to its log birth, and that the survivor pass and the closed-book pass
    // AGREE on the value for the id they share. It does NOT prove the
    // not-already-present guard is load-bearing, and it cannot: `buildClosedPosition`
    // copies `openedAsOf` off the very `PositionRecord` the surviving row came from, so
    // last-write-wins would produce a byte-identical map here and through every other
    // path the fold can currently produce. The guard is inert today and kept for a
    // future change to how closed rows carry that date; that argument lives at the
    // guard itself, because no test can carry it.
    it("dates a trimmed-but-still-open position to its log birth, both passes agreeing", () => {
      const reference = buildEventReference(genesis(), [
        accepted(openLate()),
        accepted({
          id: "evt-trim-late",
          asOf: "2026-06-20",
          type: "PositionTrimmed",
          positionId: "btc-late",
          removals: [{ quantity: 0.5, tier: "c1" }],
          settlement: { reserveId: "pulse-cash", proceeds: 50 },
        }),
      ]);

      expect(reference.closedPositionIds.has("btc-late")).toBe(false);
      expectSameKeys(reference);
      expect(reference.positionBornAsOf.get("btc-late")).toBe(OPENED_AS_OF);
    });
  });

  // THE ACCEPT SIDE FOR A LOG-BORN POSITION, THROUGH THE FULL GATE. The matrix above
  // only proves these four verbs can be REFUSED; without this, a call site that
  // rejected unconditionally would pass every rejection case in this file. Dated after
  // the birth, and on the birth date itself — the boundary is `<`, so a verb dated
  // exactly on the birth date is legal, the same rule the Reserve side applies.
  describe("a verb dated on or after a log-born position's birth is accepted", () => {
    const afterOpening = (verb: Record<string, unknown>, asOf: string) =>
      ingestBatch([openLate(), { asOf, ...verb }]).rejection;

    const verbs: [string, Record<string, unknown>][] = [
      [
        "PositionClosed",
        {
          id: "evt-close",
          type: "PositionClosed",
          positionId: "btc-late",
          settlement: { reserveId: "pulse-cash", proceeds: 100 },
        },
      ],
      [
        "PositionTrimmed",
        {
          id: "evt-trim",
          type: "PositionTrimmed",
          positionId: "btc-late",
          removals: [{ quantity: 0.5, tier: "c1" }],
          settlement: { reserveId: "pulse-cash", proceeds: 50 },
        },
      ],
      [
        "PositionAddedTo",
        {
          id: "evt-add",
          type: "PositionAddedTo",
          positionId: "btc-late",
          lot: { quantity: 1, cost: 100, tier: "c1" },
          funding: { reserveId: "pulse-cash", amount: 100 },
        },
      ],
      [
        "InvalidationMarked",
        {
          id: "evt-invalidation",
          type: "InvalidationMarked",
          positionId: "btc-late",
          price: 80,
          direction: "below",
        },
      ],
    ];

    it.each(verbs)("%s dated after the birth", (_verb, input) => {
      expect(afterOpening(input, "2026-06-20")).toBeNull();
    });

    it.each(verbs)("%s dated ON the birth date itself", (_verb, input) => {
      expect(afterOpening(input, OPENED_AS_OF)).toBeNull();
    });
  });

  // A GENESIS POSITION CANNOT CLAIM A BIRTH BEFORE THE WORLD'S. `openedAsOf` is
  // documented as absent for a genesis-held position, but nothing enforces it:
  // `parseFundReview` passes the seed through as `value as FundReviewData` and
  // `foldEvents` `structuredClone`s each genesis position verbatim, so a hand-written
  // seed carrying one reached the birth map intact and dated the position years early.
  describe("a genesis position's explicit openedAsOf does not move its birth", () => {
    /** The seed above, with a bogus pre-genesis `openedAsOf` on the held position. */
    function seededEarly(): FundReviewData {
      const seed = genesis();
      return {
        ...seed,
        positions: seed.positions.map((position) => ({ ...position, openedAsOf: "2025-03-01" })),
      };
    }

    /** After the bogus date, BEFORE the genesis review — the window the bug opened. */
    const IN_THE_GAP = "2025-06-01";

    it("dates it to the genesis review, not to the field", () => {
      const reference = buildEventReference(seededEarly());

      expect(reference.positionBornAsOf.get("btc-core")).toBe(GENESIS_AS_OF);
    });

    // `InvalidationMarked` is the only position verb with NO reserve leg, so it is the
    // only one `requireReserveBornBy` does not independently catch — the verb where the
    // two gates would have visibly disagreed about where the world begins.
    it("rejects an InvalidationMarked dated in the gap between the two dates", () => {
      const { rejection } = ingestBatch(
        [
          {
            id: "evt-invalidation-early",
            asOf: IN_THE_GAP,
            type: "InvalidationMarked",
            positionId: "btc-core",
            price: 80,
            direction: "below",
          },
        ],
        seededEarly(),
      );

      expect(rejection).not.toBeNull();
      expect(rejection?.path).toBe("positionId");
      expect(rejection?.message).toContain("not born until");
      expect(rejection?.message).toContain(IN_THE_GAP);
      expect(rejection?.message).toContain(GENESIS_AS_OF);
      expect(rejection?.message).not.toContain("2025-03-01");
    });

    // THE REMEDY MUST BE ONE THE OPERATOR CAN PERFORM. A genesis-held position has no
    // `PositionOpened` to redate, so the log-born branch's advice would send them
    // hunting for an event that does not exist — which is exactly what a birth date
    // read off the bogus field produced, since `held` compares against `genesisAsOf`.
    it("takes the genesis-seeded remedy branch, never 'open the position earlier'", () => {
      const { rejection } = ingestBatch(
        [
          {
            id: "evt-close-early",
            asOf: IN_THE_GAP,
            type: "PositionClosed",
            positionId: "btc-core",
            settlement: { reserveId: "pulse-cash", proceeds: 200 },
          },
        ],
        seededEarly(),
      );

      // The path and the verb prefix are load-bearing here, not decoration: without
      // them this passes vacuously on the REJECTION FROM THE OTHER GATE. A close in
      // this window also predates `pulse-cash`, so `requireReserveBornBy` refuses it at
      // `settlement.reserveId` with its own near-identical genesis-seeded remedy — and
      // that is precisely the disagreement being pinned, so the assertion has to insist
      // the POSITION gate is the one speaking.
      expect(rejection?.path).toBe("positionId");
      expect(rejection?.message).toMatch(/^PositionClosed references position /);
      expect(rejection?.message).toContain("not born until");
      expect(rejection?.message).toContain("genesis review date");
      expect(rejection?.message).not.toContain("open the position earlier");
    });

    it("leaves a log-born position's birth alone", () => {
      const reference = buildEventReference(seededEarly(), [accepted(openLate())]);

      expect(reference.positionBornAsOf.get("btc-late")).toBe(OPENED_AS_OF);
      expect([...reference.positionBornAsOf.keys()].sort()).toEqual(
        [...reference.positionIds].sort(),
      );
    });
  });

  // THREE CONDITIONS, THREE MESSAGES, ONE PATH. Collapsing any two would tell the
  // operator the wrong thing about a position that plainly did exist — the same
  // argument the A1 guard's comment already makes for the already-closed case.
  it("keeps unknown-id, not-born-yet and already-closed distinct on the same path", () => {
    const world = buildEventReference(genesis(), [
      accepted(openLate()),
      accepted({
        id: "evt-close-core-first",
        asOf: "2026-06-10",
        type: "PositionClosed",
        positionId: "btc-core",
        settlement: { reserveId: "pulse-cash", proceeds: 200 },
      }),
    ]);
    const reject = (input: Record<string, unknown>) => {
      const result = crossReferenceEvent(accepted(input), world);
      expect(result.kind).toBe("event-error");
      if (result.kind !== "event-error") throw new Error("unreachable");
      return result;
    };

    const unknown = reject({
      id: "evt-close-ghost",
      asOf: "2026-06-20",
      type: "PositionClosed",
      positionId: "ghost",
      settlement: { reserveId: "pulse-cash", proceeds: 100 },
    });
    const notBorn = reject({
      id: "evt-close-early",
      asOf: BACKDATED_AS_OF,
      type: "PositionClosed",
      positionId: "btc-late",
      settlement: { reserveId: "pulse-cash", proceeds: 100 },
    });
    const retired = reject({
      id: "evt-close-core-second",
      asOf: "2026-06-20",
      type: "PositionClosed",
      positionId: "btc-core",
      settlement: { reserveId: "pulse-cash", proceeds: 200 },
    });

    for (const error of [unknown, notBorn, retired]) {
      expect(error.path).toBe("positionId");
    }
    expect(unknown.message).toContain("neither the genesis seed nor the log contains");
    expect(notBorn.message).toContain("not born until");
    expect(retired.message).toContain("already closed");
    expect(new Set([unknown.message, notBorn.message, retired.message]).size).toBe(3);
  });
});
