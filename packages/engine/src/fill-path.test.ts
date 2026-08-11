/**
 * THE FILL PATH RECONCILIATION (#287, slice 2 of #285) — the pure module's own tests.
 *
 * EVERY FIXTURE HERE IS SYNTHESIZED. Not one value was seeded from a real export, a real
 * ladder, or a real lot: the prices are round five-figure numbers, the quantities are
 * tenths, and the ids are counted UUIDs of the form `00000000-0000-4000-8000-…`. Authorship
 * is the line, not shape.
 *
 * MUTATION CHECKS — each guard was reverted and confirmed red for the RIGHT reason before
 * being restored:
 *
 *   - `bookAxis` from `bookedFills` → from `consumed`: "filled at venue — not recorded"
 *     collapses into "filled", and `records the venue/book gap as two axes` fails on r2's
 *     label. The gap between what the venue showed and what the fund booked is the whole
 *     feature, so this is the guard that matters most.
 *   - folding the whole stream → folding `pickRestingOrdersAsOf`: r1 and r2 vanish from the
 *     view entirely (a consumed rung is not resting), and `a fully consumed rung is
 *     reachable` fails with 3 rungs instead of 5.
 *   - `deployedUsd` as `Σ (quantity × cost)` → `Σ cost`: the spine test fails with 110000
 *     against the fold's 1100 — per-unit prices summed as if they were amounts.
 *   - the per-lot `entryFx ?? reviewFx` conversion → a flat `reviewFx`: the MXN spine test
 *     reads 72 against the fold's 78, because the lot that carries its own rate is
 *     converted at the review's instead.
 *   - the declared-join pass running BEFORE the price-match pass → after: r1's order is
 *     taken by the price matcher first and reads `price-matched`, so `prefers the declared
 *     rung` fails — the operator's statement losing silently to an inference.
 *   - the positive-and-finite gate on the three measured figures → emitting them
 *     unconditionally: the no-zero invariant fails with `deployedUsd: 0` on the fixture
 *     that has no lots at all.
 *   - `claimed.add` moved back inside the joined branch, so only a HONORED declaration
 *     claims its order: all three `a declaration is never overridden` tests fail, each
 *     with the declared order seated on r3 by its price.
 *   - the orphan join keyed on `lot.cost` against the declared prices again: 7 tests fail,
 *     including `explains a booked lot whose per-unit cost does not land on the declared
 *     price` — a correctly booked fill reported as an orphan.
 *   - the retired-placement pass skipped: the cancelled rung reads `bookedQuantity: 0`
 *     and its lot is orphaned while `deployedUsd` still counts it (2 tests).
 *   - `waitingRestingUsd` also counting a rung that was DECLARED and never placed: it reads
 *     4200 against the resting 2700 and 6500 on day zero, collapsing into
 *     `waitingDeclaredUsd`. That collapse is exactly the hidden encumbrance the split
 *     exists to show. (Note the near-miss: for a rung that HAS an order, `resting` and
 *     `venueAxis !== "filled"` are the same predicate by construction — `remaining > 0` iff
 *     `consumed < quantity`. The two figures differ ONLY on the never-placed rungs, and a
 *     mutation swapping those equivalent predicates is a no-op, not a missing guard.)
 */
import { describe, expect, it } from "vitest";
import { buildCanonicalState } from "./compose/canonical.js";
import type { Currency, FundReviewData, PositionLot } from "./contracts.js";
import { reconcileFillPath, type FillPathInput } from "./fill-path.js";
import type { TornFillAct } from "./orders/fill.js";
import {
  buildOrderFillObserved,
  type OrderFilledRecord,
  type OrderPlacedRecord,
  type OrderRecord,
} from "./orders/records.js";
import type { DcaLadderPlanRecord } from "./plans.js";

const PLAN_ID = "00000000-0000-4000-8000-000000000001";
const POSITION_ID = "position:synthesized-ladder";

/** Five rungs, five states — prices far enough apart that no two could be confused. */
function ladderPlan(): DcaLadderPlanRecord {
  return {
    kind: "dcaLadder",
    id: PLAN_ID,
    positionId: POSITION_ID,
    effectiveAt: "2026-01-01",
    tierOrder: ["c1"],
    rungs: [
      { id: "r1", priceUsd: 11000, sizeUsd: 1100 },
      { id: "r2", priceUsd: 12000, sizeUsd: 1200 },
      { id: "r3", priceUsd: 13000, sizeUsd: 1300 },
      { id: "r4", priceUsd: 14000, sizeUsd: 1400 },
      { id: "r5", priceUsd: 15000, sizeUsd: 1500 },
    ],
  };
}

function placed(fields: Partial<OrderPlacedRecord> & { id: string; price: number }): OrderRecord {
  return {
    kind: "orderPlaced",
    observedAt: "2026-02-01T10:00:00",
    currency: "USD",
    symbol: "SYNTHBTC",
    side: "buy",
    quantity: 0.1,
    fundingReserveId: "reserve:synthesized",
    ...fields,
  } as OrderPlacedRecord;
}

function filled(id: string, observedAt: string, filledQuantity: number): OrderFilledRecord {
  return { kind: "orderFilled", id, observedAt, currency: "USD", filledQuantity };
}

function observed(id: string, observedAt: string, quantity: number): OrderRecord {
  const built = buildOrderFillObserved({
    id,
    observedAt,
    currency: "USD",
    observedFilledQuantity: quantity,
  });
  if (built.status !== "ok") {
    throw new Error(`fixture is not buildable: ${built.message}`);
  }
  return built.record;
}

/**
 * The five-state stream. r1 filled AND booked; r2 filled at the venue with nothing booked,
 * joined by a DECLARED rung whose price it does not match; r3 half filled and joined only
 * by price; r4 resting; r5 never placed at all.
 */
function fiveStateOrders(): OrderRecord[] {
  return [
    placed({ id: "order:0001", price: 11000, quantity: 0.1, planId: PLAN_ID, rungId: "r1" }),
    filled("order:0001", "2026-02-02T10:00:00", 0.1),
    placed({
      id: "order:0002",
      price: 12345,
      quantity: 0.2,
      observedFilledQuantity: 0.2,
      planId: PLAN_ID,
      rungId: "r2",
    }),
    placed({ id: "order:0003", price: 13000, quantity: 0.3 }),
    observed("order:0003", "2026-02-03T10:00:00", 0.15),
    placed({ id: "order:0004", price: 14000, quantity: 0.4, planId: PLAN_ID, rungId: "r4" }),
  ];
}

/** One lot the ladder explains, one it does not. */
const BOOKED_LOT: PositionLot = { quantity: 0.1, cost: 11000, tier: "c1" };
const ORPHAN_LOT: PositionLot = { quantity: 0.05, cost: 99000, tier: "c2" };

function input(overrides: Partial<FillPathInput> = {}): FillPathInput {
  return {
    plan: ladderPlan(),
    orders: fiveStateOrders(),
    lots: [BOOKED_LOT, ORPHAN_LOT],
    tornActs: [],
    ...overrides,
  };
}

function rungById(view: ReturnType<typeof reconcileFillPath>, id: string) {
  const row = view.rungs.find((entry) => entry.rung.id === id);
  if (!row) {
    throw new Error(`no row for rung ${id}`);
  }
  return row;
}

describe("@numisma/engine reconcileFillPath — the two axes", () => {
  it("reaches every row of the state table from one synthesized stream", () => {
    const view = reconcileFillPath(input());

    expect(view.rungs.map((row) => row.label)).toEqual([
      "filled",
      "filled at venue — not recorded",
      "partly filled · 50%",
      "waiting",
      "declared — not placed",
    ]);
    expect(view.orphans.map((entry) => entry.label)).toEqual(["orphan"]);
  });

  it("records the venue/book gap as two axes rather than one word", () => {
    const view = reconcileFillPath(input());

    expect(rungById(view, "r1")).toMatchObject({ venueAxis: "filled", bookAxis: "recorded" });
    expect(rungById(view, "r2")).toMatchObject({ venueAxis: "filled", bookAxis: "not-recorded" });
    expect(rungById(view, "r3")).toMatchObject({
      venueAxis: "partly-filled",
      bookAxis: "not-recorded",
    });
    expect(rungById(view, "r4")).toMatchObject({ venueAxis: "resting", bookAxis: "not-recorded" });
    expect(rungById(view, "r5")).toMatchObject({
      venueAxis: "not-placed",
      bookAxis: "not-recorded",
    });
  });

  it("measures the partial percentage rather than guessing it", () => {
    const view = reconcileFillPath(input());

    expect(rungById(view, "r3").venueFilledFraction).toBe(0.5);
    expect(rungById(view, "r3").venueConsumedQuantity).toBe(0.15);
    expect(rungById(view, "r3").placedQuantity).toBe(0.3);
  });

  it("keeps a fully consumed rung reachable — it folds the stream, not the resting view", () => {
    const view = reconcileFillPath(input());

    expect(view.rungs).toHaveLength(5);
    expect(rungById(view, "r1").venueAxis).toBe("filled");
    expect(rungById(view, "r1").resting).toBe(false);
    expect(rungById(view, "r2").resting).toBe(false);
  });

  it("is a pure function of its inputs", () => {
    expect(reconcileFillPath(input())).toEqual(reconcileFillPath(input()));
  });
});

describe("@numisma/engine reconcileFillPath — the join and its provenance", () => {
  it("prefers the declared rung and falls back to price for a line that carries neither", () => {
    const view = reconcileFillPath(input());

    expect(rungById(view, "r1").joinProvenance).toBe("declared");
    expect(rungById(view, "r3").joinProvenance).toBe("price-matched");
    expect(rungById(view, "r5").joinProvenance).toBeUndefined();
  });

  it("honours a declared join whose prices differ, and flags it", () => {
    const view = reconcileFillPath(input());
    const row = rungById(view, "r2");

    expect(row.joinProvenance).toBe("declared");
    expect(row.orderId).toBe("order:0002");
    expect(row.orderPriceUsd).toBe(12345);
    expect(row.declaredPriceMismatch).toBe(true);
    expect(rungById(view, "r1").declaredPriceMismatch).toBe(false);
  });

  it("refuses an ambiguous price match rather than taking the first rung", () => {
    const plan = ladderPlan();
    // Two rungs at one price cannot arise WITHIN a loaded ladder, so this fixture states
    // the ambiguity directly to prove the module carries the proposal's silence through.
    plan.rungs[3] = { id: "r4", priceUsd: 13000, sizeUsd: 1400 };
    const view = reconcileFillPath(
      input({ plan, orders: [placed({ id: "order:0003", price: 13000, quantity: 0.3 })] }),
    );

    expect(rungById(view, "r3").venueAxis).toBe("not-placed");
    expect(rungById(view, "r4").venueAxis).toBe("not-placed");
  });

  it("puts a lot no declared rung explains in the orphan set rather than on a rung", () => {
    const view = reconcileFillPath(input());

    expect(view.orphans).toEqual([{ lot: ORPHAN_LOT, label: "orphan" }]);
  });
});

/**
 * A DECLARATION THIS LADDER CANNOT HONOR IS STILL A DECLARATION. Each case below is a
 * line the operator ratified onto an append-only file; none of them may be handed to the
 * price matcher, because seating a declared order on a rung nobody named is precisely the
 * inference the declared join was built to remove.
 */
describe("@numisma/engine reconcileFillPath — a declaration is never overridden", () => {
  const OTHER_PLAN = "00000000-0000-4000-8000-000000000009";

  it("does not price-match an order that declares ANOTHER ladder onto this one", () => {
    const view = reconcileFillPath(
      input({
        orders: [
          placed({ id: "order:0009", price: 13000, planId: OTHER_PLAN, rungId: "r1" }),
        ],
        lots: [],
      }),
    );

    expect(rungById(view, "r3").joinProvenance).toBeUndefined();
    expect(rungById(view, "r3").venueAxis).toBe("not-placed");
    expect(view.rungs.every((row) => row.orderId === undefined)).toBe(true);
  });

  it("does not re-seat a second order declaring an already-claimed rung", () => {
    const view = reconcileFillPath(
      input({
        orders: [
          placed({ id: "order:0001", price: 11000, planId: PLAN_ID, rungId: "r1" }),
          // Same rung declared twice — the pick-list's own duplicate-proposal hole. The
          // second line joins to NOTHING; it must not slide onto r3 by its price.
          placed({ id: "order:0002", price: 13000, planId: PLAN_ID, rungId: "r1" }),
        ],
        lots: [],
      }),
    );

    expect(rungById(view, "r1").orderId).toBe("order:0001");
    expect(rungById(view, "r3").joinProvenance).toBeUndefined();
    expect(rungById(view, "r3").venueAxis).toBe("not-placed");
  });

  it("does not price-match an order declaring a rung this ladder does not have", () => {
    // A stale pick after a supersession, or a typo. Unjoinable is the honest answer.
    const view = reconcileFillPath(
      input({
        orders: [placed({ id: "order:0003", price: 13000, planId: PLAN_ID, rungId: "zzz" })],
        lots: [],
      }),
    );

    expect(rungById(view, "r3").joinProvenance).toBeUndefined();
    expect(rungById(view, "r3").venueAxis).toBe("not-placed");
  });

  it("still price-matches a line that declares NOTHING — the permanent fallback", () => {
    const view = reconcileFillPath(
      input({ orders: [placed({ id: "order:0003", price: 13000 })], lots: [] }),
    );

    expect(rungById(view, "r3").joinProvenance).toBe("price-matched");
  });
});

/**
 * THE ORPHAN SET IS A JOIN FAILURE, SO IT JOINS ON ORDER IDENTITY. `PositionLot.cost` is
 * `fundingAmount / filledQuantity` — a quotient of the cash that really left the reserve,
 * not a price — so comparing it against a declared limit by float equality manufactures
 * orphans on the ordinary path. The lot's `quantity` is the `orderFilled` line's own
 * `filledQuantity`, copied through `buildFillAct` without arithmetic, which is why THAT
 * is the exact correspondence.
 */
describe("@numisma/engine reconcileFillPath — orphans join on the order, not on a price", () => {
  function bookedAt(cost: number, quantity = 0.1): FillPathInput {
    return input({
      orders: [
        placed({ id: "order:0001", price: 11000, quantity, planId: PLAN_ID, rungId: "r1" }),
        filled("order:0001", "2026-02-02T10:00:00", quantity),
      ],
      lots: [{ quantity, cost, tier: "c1" }],
    });
  }

  it("explains a booked lot whose per-unit cost does not land on the declared price", () => {
    // The ACCEPT-THE-DEFAULT path: the prompt offers `price × quantity` as the funding
    // amount, the lot divides it back down, and the quotient is not the price it came
    // from. Roughly one plausible quantity in twelve does this; no fee required.
    const quantity = 0.00019;
    const drifted = (11000 * quantity) / quantity;
    expect(drifted).not.toBe(11000);

    expect(reconcileFillPath(bookedAt(drifted, quantity)).orphans).toEqual([]);
  });

  it("explains a booked lot the venue debited at something other than the limit", () => {
    // A fill at better than limit, or with a fee — both entirely ordinary.
    expect(reconcileFillPath(bookedAt(11033.742331288344)).orphans).toEqual([]);
  });

  it("still reports a lot no booked fill accounts for", () => {
    const view = reconcileFillPath(bookedAt(11000));
    expect(view.orphans).toEqual([]);

    const extra: PositionLot = { quantity: 0.07, cost: 11000, tier: "c2" };
    const withExtra = reconcileFillPath({
      ...bookedAt(11000),
      lots: [{ quantity: 0.1, cost: 11000, tier: "c1" }, extra],
    });
    // The cost sits exactly on a declared rung price and it is STILL an orphan: nothing
    // the fund booked stands for it. A price was never the question.
    expect(withExtra.orphans).toEqual([{ lot: extra, label: "orphan" }]);
  });

  it("explains each booked fill ONCE — two identical lots, one fill", () => {
    const lot: PositionLot = { quantity: 0.1, cost: 11000, tier: "c1" };
    const view = reconcileFillPath({ ...bookedAt(11000), lots: [lot, { ...lot }] });

    expect(view.orphans).toHaveLength(1);
  });
});

/**
 * FINDING: a rung cancelled after a booked partial read `declared — not placed` with
 * `bookedQuantity: 0`, while the very same lot was counted in `deployedUsd` — the two
 * halves of one card disagreeing over an entirely ordinary DCA lifecycle.
 */
describe("@numisma/engine reconcileFillPath — a cancelled rung keeps its booking", () => {
  function cancelledAfterPartial(): FillPathInput {
    return input({
      orders: [
        placed({ id: "order:0001", price: 11000, quantity: 0.1, planId: PLAN_ID, rungId: "r1" }),
        filled("order:0001", "2026-02-02T10:00:00", 0.04),
        {
          kind: "orderCancelled",
          id: "order:0001",
          observedAt: "2026-02-03T10:00:00",
          currency: "USD",
        } as OrderRecord,
      ],
      lots: [{ quantity: 0.04, cost: 11000, tier: "c1" }],
    });
  }

  it("reports the booked quantity rather than an unplaced rung the fund bought against", () => {
    const row = rungById(reconcileFillPath(cancelledAfterPartial()), "r1");

    expect(row.bookedQuantity).toBe(0.04);
    expect(row.orderId).toBe("order:0001");
    expect(row.bookAxis).toBe("recorded");
    expect(row.label).not.toBe("declared — not placed");
    // The claim DID leave the book, and the venue axis still says so.
    expect(row.venueAxis).toBe("not-placed");
    expect(row.resting).toBe(false);
  });

  it("explains that rung's lot instead of orphaning capital it just counted", () => {
    const view = reconcileFillPath(cancelledAfterPartial());

    expect(view.orphans).toEqual([]);
    expect(view.figures.deployedUsd).toBeCloseTo(0.04 * 11000, 10);
  });

  it("leaves a cancelled rung with NOTHING booked as declared — not placed", () => {
    const view = reconcileFillPath(
      input({
        orders: [
          placed({ id: "order:0001", price: 11000, quantity: 0.1, planId: PLAN_ID, rungId: "r1" }),
          {
            kind: "orderCancelled",
            id: "order:0001",
            observedAt: "2026-02-03T10:00:00",
            currency: "USD",
          } as OrderRecord,
        ],
        lots: [],
      }),
    );

    expect(rungById(view, "r1").label).toBe("declared — not placed");
    expect(rungById(view, "r1").joinProvenance).toBeUndefined();
  });
});

describe("@numisma/engine reconcileFillPath — the figures", () => {
  it("sums quantity for units and quantity × cost for deployed capital", () => {
    const view = reconcileFillPath(input());

    // 0.1 × 11000 + 0.05 × 99000 = 1100 + 4950. `Σ cost` would read 110000.
    expect(view.figures.deployedUsd).toBeCloseTo(6050, 10);
    expect(view.figures.unitsAcquired).toBeCloseTo(0.15, 10);
    expect(view.figures.avgEntryUsd).toBeCloseTo(6050 / 0.15, 10);
  });

  it("omits all three measured figures when no fill is recorded", () => {
    const view = reconcileFillPath(input({ lots: [] }));

    expect(view.figures.deployedUsd).toBeUndefined();
    expect(view.figures.unitsAcquired).toBeUndefined();
    expect(view.figures.avgEntryUsd).toBeUndefined();
  });

  it("never emits zero for a measured figure — present means positive", () => {
    const cases: PositionLot[][] = [
      [],
      [{ quantity: 0, cost: 0, tier: "c1" }],
      [BOOKED_LOT],
      [BOOKED_LOT, ORPHAN_LOT],
    ];

    for (const lots of cases) {
      const { deployedUsd, unitsAcquired, avgEntryUsd } = reconcileFillPath(input({ lots })).figures;
      for (const figure of [deployedUsd, unitsAcquired, avgEntryUsd]) {
        expect(figure === undefined || figure > 0).toBe(true);
      }
    }
  });

  it("separates declared waiting from resting waiting", () => {
    const view = reconcileFillPath(input());

    // r3 + r4 + r5 are unfilled; only r3 and r4 have an order actually resting.
    expect(view.figures.waitingDeclaredUsd).toBe(4200);
    expect(view.figures.waitingRestingUsd).toBe(2700);
  });

  it("answers on day zero, with no orders and no fills", () => {
    const view = reconcileFillPath(input({ orders: [], lots: [] }));

    expect(view.figures.waitingDeclaredUsd).toBe(6500);
    expect(view.figures.waitingRestingUsd).toBe(0);
    expect(view.figures.deployedUsd).toBeUndefined();
  });
});

/** The synthesized fund the fold is run over, so both sides read the SAME lots. */
function fundWith(lots: PositionLot[], currency: Currency, usdMxn: number): FundReviewData {
  return {
    fund: { id: "fund:synthesized", name: "Synthesized Fund", baseCurrency: "USD" },
    review: { asOf: "2026-02-04", usdMxn },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "venue:synthesized", name: "Venue", platform: "synthetic", currency }],
    instruments: [{ id: "instrument:synth", name: "Synth", symbol: "SYNTHBTC", currency }],
    reserves: [],
    positions: [
      {
        id: POSITION_ID,
        portfolioId: "core",
        tempo: "Capital",
        // `live`, because the fold values only live positions — a `paper` one is skipped
        // silently and the spine would reconcile two absences against each other.
        executionMode: "live",
        accountId: "venue:synthesized",
        instrumentId: "instrument:synth",
        direction: "long",
        lots,
        markPrice: 20000,
        currency,
      },
    ],
  } as FundReviewData;
}

function foldedCostBasisUsd(data: FundReviewData): number {
  const line = buildCanonicalState(data).canonicalLines.find(
    (candidate) => candidate.recordId === POSITION_ID,
  );
  if (!line || line.costBasisUsd === undefined) {
    throw new Error("the fold excluded the synthesized position, or valued it without a basis");
  }
  return line.costBasisUsd;
}

describe("@numisma/engine reconcileFillPath — the spine", () => {
  it("reconciles deployedUsd exactly with the fold's own costBasisUsd (USD)", () => {
    const lots = [BOOKED_LOT, ORPHAN_LOT];
    const view = reconcileFillPath(input({ lots }));

    expect(view.figures.deployedUsd).toBe(foldedCostBasisUsd(fundWith(lots, "USD", 20)));
  });

  it("reconciles exactly when each lot converts at its own entryFx, review FX as fallback", () => {
    const lots: PositionLot[] = [
      { quantity: 2, cost: 300, tier: "c1", entryFx: 20 },
      { quantity: 3, cost: 400, tier: "c2" },
    ];
    const view = reconcileFillPath(input({ lots, currency: "MXN", reviewFx: 25 }));

    // 2 × 300 / 20 + 3 × 400 / 25 = 30 + 48.
    expect(view.figures.deployedUsd).toBe(78);
    expect(view.figures.deployedUsd).toBe(foldedCostBasisUsd(fundWith(lots, "MXN", 25)));
  });
});

describe("@numisma/engine reconcileFillPath — torn acts", () => {
  it("reports a non-empty torn-act set through as a fund-level fact", () => {
    const tornActs: TornFillAct[] = [
      {
        kind: "lot-without-fill",
        orderId: "order:0001",
        observedAt: "2026-02-02T10:00:00",
        eventId: "fill:order:0001@2026-02-02T10:00:00",
      },
    ];

    const view = reconcileFillPath(input({ tornActs }));

    expect(view.tornActs).toEqual(tornActs);
    // The module reports; it does not decide what a torn act blocks, so nothing else moves.
    expect(view.rungs).toEqual(reconcileFillPath(input()).rungs);
  });
});
