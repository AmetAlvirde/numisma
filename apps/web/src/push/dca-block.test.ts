/**
 * Unit tests for the pure `DcaBlock` builder (spec #277, slice #278).
 *
 * IN-MEMORY FIXTURES WITH SYNTHESIZED FIGURES ONLY. The real ladder lives in the
 * git-ignored accumulus sidecar and never enters this repo; every price and size
 * below is invented, and no assertion here depends on a real desk figure.
 *
 * The key-set assertions are the load-bearing ones. Asserting VALUES would pass
 * just as happily on a row that also carried `sizeUsd` or `endedBy`, and the whole
 * point of this builder is what it REFUSES to put on the wire.
 */
import type {
  DcaLadderPlanRecord,
  DcaTimePlanRecord,
  IsoDate,
  LoadedPlanRecord,
  LoadedPlans,
  NoPlanRecord,
  OrderFilledRecord,
  OrderPlacedRecord,
  OrderRecord,
  PositionLot,
  SkippedPlanLine,
} from "@numisma/engine";
import { describe, expect, it } from "vitest";
import { buildDcaBlock, type DcaFillInputs } from "./dca-block.ts";

const ASOF = "2026-08-10" as IsoDate;

/** The plan id `ladder()` stamps, by line — synthesized, counted, obviously fake. */
function planIdOf(line: number): string {
  return `00000000-0000-4000-8000-${String(line).padStart(12, "0")}`;
}

function loadedPlans(parts: Partial<LoadedPlans> = {}): LoadedPlans {
  return {
    load: { status: "loaded" },
    plans: [],
    skipped: [],
    ...parts,
  };
}

/** A synthesized two-rung ladder. The figures are invented, not the desk's. */
function ladder(
  positionId: string,
  line: number,
  effectiveAt = "2026-01-01",
): LoadedPlanRecord {
  const record: DcaLadderPlanRecord = {
    kind: "dcaLadder",
    // Synthesized, obviously fake, and STABLE — it counts the fixture's own line rather
    // than being generated. Nothing on the wire or the card carries it.
    id: `00000000-0000-4000-8000-${String(line).padStart(12, "0")}`,
    positionId,
    effectiveAt: effectiveAt as IsoDate,
    tierOrder: ["c1"],
    rungs: [
      { id: "r1", priceUsd: 11_000, sizeUsd: 250 },
      { id: "r2", priceUsd: 9_000, sizeUsd: 250 },
    ],
  };
  return { ...record, line };
}

function timePlan(positionId: string, line: number): LoadedPlanRecord {
  const record: DcaTimePlanRecord = {
    kind: "dcaTime",
    positionId,
    effectiveAt: "2026-01-01" as IsoDate,
    cadence: "weekly",
    anchorAt: "2026-01-05" as IsoDate,
    amountUsd: 100,
    tierOrder: ["c1"],
  };
  return { ...record, line };
}

function terminator(positionId: string, line: number): LoadedPlanRecord {
  const record: NoPlanRecord = {
    kind: "noPlan",
    positionId,
    effectiveAt: "2026-02-01" as IsoDate,
    reason: "ladder filled",
  };
  return { ...record, line };
}

function skip(parts: Partial<SkippedPlanLine> & { line: number }): SkippedPlanLine {
  return { reason: "invalid", detail: "synthesized", ...parts };
}

/**
 * A synthesized `orderPlaced` line for one rung of `ladder()`'s two-rung ladder. Every
 * figure invented; the DECLARED join (`planId` + `rungId`) is what slice 1 shipped and
 * what this branch is meant to read.
 */
function placed(
  id: string,
  price: number,
  quantity: number,
  // `Partial` would make every optional field `T | undefined`, which
  // `exactOptionalPropertyTypes` refuses to spread onto a record whose optionals are
  // exact. The overrides are named as a Pick of exactly the four these fixtures set.
  parts: Partial<
    Pick<OrderPlacedRecord, "planId" | "rungId" | "observedAt" | "observedFilledQuantity">
  > = {},
): OrderPlacedRecord {
  return {
    id,
    observedAt: "2026-08-01T10:00:00",
    kind: "orderPlaced",
    currency: "USD",
    symbol: "TEST/USD",
    side: "buy",
    price,
    quantity,
    // Required on every placement line — the declared funding source. The fill path
    // reads none of it; it is here because the record cannot be built without it.
    fundingReserveId: "reserve-synthetic",
    ...parts,
  };
}

/** A synthesized `orderFilled` line — the half of a fill act the sidecar carries. */
function filled(id: string, quantity: number): OrderFilledRecord {
  return {
    id,
    observedAt: "2026-08-02T10:00:00",
    kind: "orderFilled",
    currency: "USD",
    filledQuantity: quantity,
  };
}

/** A synthesized recorded lot. `cost` is PER UNIT, as the fold's own arithmetic reads it. */
function lot(quantity: number, cost: number): PositionLot {
  return { quantity, cost, tier: "c1" };
}

function fillInputs(
  orders: readonly OrderRecord[] = [],
  lots: readonly PositionLot[] = [],
  positionId = "cap-btc",
): DcaFillInputs {
  return {
    orders,
    positions: new Map([[positionId, { lots, currency: "USD" as const }]]),
  };
}

describe("buildDcaBlock — the plans roster narrowed to the wire", () => {
  it("maps a failed load to `source: \"unreadable\"` with nothing else to say", () => {
    const block = buildDcaBlock(
      loadedPlans({ load: { status: "load-failed", message: "synthesized" } }),
      ASOF,
      new Set(),
    );
    expect(block).toEqual({ source: "unreadable", positions: [], unattributable: 0 });
  });

  it("maps loaded-and-empty — the normal starting state — to an empty branch", () => {
    const block = buildDcaBlock(loadedPlans(), ASOF, new Set());
    expect(block).toEqual({ source: "loaded", positions: [], unattributable: 0 });
  });

  it("OMITS a `none` row — absence is the encoding, `none` never reaches the wire", () => {
    // A position the sidecar names ONLY through a future-dated attributable skip:
    // enumerated as a row, looked up as `none`.
    const block = buildDcaBlock(
      loadedPlans({
        skipped: [skip({ line: 1, positionId: "ghost", effectiveAt: "2099-01-01" as IsoDate })],
      }),
      ASOF,
      new Set(),
    );
    expect(block.positions).toEqual([]);
  });

  it("ships a pending ladder with `kind`, its `planId`, and IDENTITY+PRICE rungs", () => {
    // With no fill inputs the row is what v4 shipped PLUS the two identity fields the
    // Fill Path route resolves on: the ladder's own `planId` and each rung's `id`.
    // Nothing else — a `sizeUsd`, an `effectiveAt` or a zeroed figure would fail here.
    const block = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(),
    );
    expect(block.positions).toHaveLength(1);
    const row = block.positions[0]!;
    expect(Object.keys(row).sort()).toEqual([
      "kind",
      "planId",
      "positionId",
      "rungs",
      "state",
    ]);
    expect(row.state).toBe("pending");
    expect(row.kind).toBe("dcaLadder");
    expect(row.planId).toBe(planIdOf(1));
    for (const rung of row.rungs ?? []) {
      expect(Object.keys(rung).sort()).toEqual(["id", "priceUsd"]);
    }
  });

  it("ships NO figures and NO fill state when no reconciliation was possible", () => {
    // The distinction the absence carries: `figures` absent means the push could not
    // reconcile at all (no readable orders sidecar), NOT that the ladder has not moved.
    // A defaulted `{ waitingDeclaredUsd: 0 }` would assert the second while meaning the
    // first, and the two say opposite things about capital.
    const row = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(),
    ).positions[0]!;
    expect(row.figures).toBeUndefined();
    expect(row.orphanLots).toBeUndefined();
  });

  it("ships an active ladder the same way — born-ness only moves `state`", () => {
    const block = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(["cap-btc"]),
    );
    const row = block.positions[0]!;
    expect(row.state).toBe("active");
    expect(row.kind).toBe("dcaLadder");
    expect(row.rungs?.map((rung) => rung.priceUsd)).toEqual([11_000, 9_000]);
  });

  it("preserves rung order AS DECLARED — the descending sort is the view's job", () => {
    const block = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(),
    );
    expect(block.positions[0]!.rungs?.map((rung) => rung.priceUsd)).toEqual([11_000, 9_000]);
  });

  it("gives a `dcaTime` row its `kind` and NO rungs key at all", () => {
    const block = buildDcaBlock(
      loadedPlans({ plans: [timePlan("cap-eth", 1)] }),
      ASOF,
      new Set(["cap-eth"]),
    );
    const row = block.positions[0]!;
    expect(Object.keys(row).sort()).toEqual(["kind", "positionId", "state"]);
    expect("rungs" in row).toBe(false);
    expect(row.kind).toBe("dcaTime");
  });

  it("reduces an `ended` row to `{ positionId, state }` — `endedBy` is an INPUT", () => {
    const block = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1), terminator("cap-btc", 2)] }),
      ASOF,
      new Set(["cap-btc"]),
    );
    const row = block.positions[0]!;
    expect(Object.keys(row).sort()).toEqual(["positionId", "state"]);
    expect(row.state).toBe("ended");
  });

  it("reduces an `unreadable` row to `{ positionId, state }` — `skipped` is an INPUT", () => {
    const block = buildDcaBlock(
      loadedPlans({
        skipped: [skip({ line: 1, positionId: "cap-sol", effectiveAt: "2026-03-01" as IsoDate })],
      }),
      ASOF,
      new Set(),
    );
    const row = block.positions[0]!;
    expect(Object.keys(row).sort()).toEqual(["positionId", "state"]);
    expect(row.state).toBe("unreadable");
  });

  it("ships `unattributable` as a COUNT, never the line content", () => {
    const block = buildDcaBlock(
      loadedPlans({ skipped: [skip({ line: 1 }), skip({ line: 2 })] }),
      ASOF,
      new Set(),
    );
    expect(block.unattributable).toBe(2);
  });

  it("keeps the DATE-FREE rule while carrying fill state — orders are full of stamps", () => {
    // The sharpest constraint on this slice. `OrderRecord.observedAt` is a second-
    // granular stamp on EVERY line, and the reconciliation reads all of them; the wire
    // ships conclusions drawn from those stamps and not one of the stamps itself. The
    // payload-wide scan in `projection-payload.test.ts` says the same thing about the
    // whole payload; this says it about the branch that grew.
    const block = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(["cap-btc"]),
      fillInputs(),
    );
    expect(JSON.stringify(block)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("puts NO date-shaped value anywhere in the serialized branch", () => {
    const block = buildDcaBlock(
      loadedPlans({
        plans: [ladder("cap-btc", 1), timePlan("cap-eth", 2), terminator("cap-old", 3)],
        skipped: [skip({ line: 4 }), skip({ line: 5, positionId: "cap-bad" })],
      }),
      ASOF,
      new Set(["cap-eth"]),
    );
    expect(JSON.stringify(block)).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

/**
 * THE FILL PATH ON THE WIRE (spec #285, slice 3) — the engine's reconciliation narrowed
 * to conclusions.
 *
 * WHAT THESE ASSERT, and it is a narrowing claim rather than a reconciliation one: the
 * reconciliation itself is `packages/engine/src/fill-path.test.ts`'s subject, and
 * re-testing its arithmetic here would give the same rule two homes. What lives here is
 * which of its conclusions cross, which do not, and the SHAPE of the absences.
 *
 * ABSENT, NEVER ZERO, is the property most of these are about. A rung with no order
 * carries no fill key at all — not `venueConsumedQuantity: 0`, not
 * `label: "declared — not placed"` — because the surface renders the absence, and a
 * zero on the wire is a number that can be rendered by mistake.
 *
 * MUTATION-CHECKED, twice. (1) The `joined` test in `toWireRung` removed so every rung
 * emits its fill keys: the never-placed cases go red naming the zeroed quantities that
 * appeared. (2) `orphanLots` emitted unconditionally: the day-zero case goes red on a
 * `0` it says must be absent. Both restored.
 *
 * Synthetic throughout: invented prices, sizes, quantities and ids.
 */
describe("buildDcaBlock — the reconciled fill path, narrowed", () => {
  it("day zero: rungs stay identity-only, and the WAITING figures are still knowable", () => {
    // The live fund's actual state, and the spec's named acceptance case. Nothing is
    // placed, so no rung carries fill state — but declared capital is knowable without a
    // single order, which is exactly what `waitingDeclaredUsd` is for.
    const row = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(["cap-btc"]),
      fillInputs(),
    ).positions[0]!;

    for (const rung of row.rungs ?? []) {
      expect(Object.keys(rung).sort()).toEqual(["id", "priceUsd"]);
    }
    // The two invented rung sizes of `ladder()`, summed. Nothing is resting because
    // nothing was placed — and that is the whole point of shipping both figures.
    expect(row.figures).toEqual({ waitingDeclaredUsd: 500, waitingRestingUsd: 0 });
    // THE THREE MEASURED FIGURES ARE ABSENT, not zero (G-D8). A `0` here is always a
    // bug: a recorded fill has cost > 0 and quantity > 0 by construction.
    expect("deployedUsd" in row.figures!).toBe(false);
    expect("unitsAcquired" in row.figures!).toBe(false);
    expect("avgEntryUsd" in row.figures!).toBe(false);
    expect(row.orphanLots).toBeUndefined();
  });

  it("a resting DECLARED join ships both axes, the join's provenance, and the split", () => {
    const row = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(["cap-btc"]),
      fillInputs([
        placed("order-a", 11_000, 2, { planId: planIdOf(1), rungId: "r1" }),
      ]),
    ).positions[0]!;

    const rung = row.rungs![0]!;
    expect(rung.venueAxis).toBe("resting");
    expect(rung.bookAxis).toBe("not-recorded");
    expect(rung.joinProvenance).toBe("declared");
    expect(rung.resting).toBe(true);
    expect(rung.placedQuantity).toBe(2);
    expect(rung.venueConsumedQuantity).toBe(0);
    expect(rung.declaredPriceMismatch).toBe(false);
    // The order's price matches the rung's, so it is NOT restated on the wire — the
    // rung already carries that number and a duplicate is a second thing to keep true.
    expect("orderPriceUsd" in rung).toBe(false);
    // One rung resting, one never placed: both waiting, only one encumbered. This is
    // the split, and it is the only pair of figures that can show hidden encumbrance.
    expect(row.figures).toMatchObject({ waitingDeclaredUsd: 500, waitingRestingUsd: 250 });
  });

  it("a PARTLY FILLED rung carries its measured fraction and the engine's own label", () => {
    const row = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(["cap-btc"]),
      fillInputs(
        // Four placed, two booked: `orderFilled` ADDS to the fold's cumulative baseline
        // (`orderPlaced` and `orderFillObserved` SET it), so consumed lands at 2 of 4.
        [placed("order-a", 11_000, 4, { planId: planIdOf(1), rungId: "r1" }), filled("order-a", 2)],
        [lot(2, 11_000)],
      ),
    ).positions[0]!;

    const rung = row.rungs![0]!;
    expect(rung.venueAxis).toBe("partly-filled");
    expect(rung.bookAxis).toBe("recorded");
    expect(rung.venueFilledFraction).toBe(0.5);
    // The label is the ENGINE'S word, shipped rather than re-spelled: the desk and the
    // phone describing the same rung differently is the drift a shared label prevents.
    expect(rung.label).toBe("partly filled · 50%");
    expect(rung.bookedQuantity).toBe(2);
    // And the measured figures are now present, because a fill really was recorded.
    expect(row.figures).toMatchObject({
      deployedUsd: 22_000,
      unitsAcquired: 2,
      avgEntryUsd: 11_000,
    });
  });

  it("flags a declared join whose order price differs, and NAMES the price placed", () => {
    // Honored, never refused: the operator knew something the price match did not. The
    // flag alone would leave the card unable to say what was actually placed, which is
    // the one case `orderPriceUsd` exists for.
    const row = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(["cap-btc"]),
      fillInputs([
        placed("order-a", 10_950, 2, { planId: planIdOf(1), rungId: "r1" }),
      ]),
    ).positions[0]!;

    const rung = row.rungs![0]!;
    expect(rung.declaredPriceMismatch).toBe(true);
    expect(rung.orderPriceUsd).toBe(10_950);
    expect(rung.priceUsd).toBe(11_000);
  });

  it("carries PRICE-MATCHED provenance so the card can show its own confidence", () => {
    // A legacy order carries no `planId`/`rungId` — those fields are optional forever,
    // so this fallback is permanent rather than transitional, and the surface labels it.
    const row = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(["cap-btc"]),
      fillInputs([placed("order-legacy", 9_000, 1)]),
    ).positions[0]!;

    expect(row.rungs![1]!.joinProvenance).toBe("price-matched");
    expect(row.rungs![0]!.joinProvenance).toBeUndefined();
  });

  it("ships the orphan-lot COUNT and never the lots", () => {
    // The same discipline `unattributable` follows: a lot is position data of the class
    // D8 keeps off the wire, but how many the ladder cannot explain is a call to action.
    const row = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      ASOF,
      new Set(["cap-btc"]),
      fillInputs([], [lot(1, 7_777), lot(2, 6_666)]),
    ).positions[0]!;

    expect(row.orphanLots).toBe(2);
    expect(JSON.stringify(row)).not.toContain("7777");
    expect(JSON.stringify(row)).not.toContain("tier");
  });

  it("reconciles NOTHING for a `dcaTime` plan — there is no price axis to walk", () => {
    const row = buildDcaBlock(
      loadedPlans({ plans: [timePlan("cap-eth", 1)] }),
      ASOF,
      new Set(["cap-eth"]),
      { orders: [], positions: new Map([["cap-eth", { lots: [], currency: "USD" }]]) },
    ).positions[0]!;
    expect(Object.keys(row).sort()).toEqual(["kind", "positionId", "state"]);
  });

  it("bounds the order stream to the ANCHOR — a June anchor cannot see an August line", () => {
    // The backfill's correctness, and the reason `selectOrdersThrough` exists. Replaying
    // history with the whole stream would show every June anchor the fills that happened
    // in August — which reads as data, not as a bug.
    const june = "2026-06-15" as IsoDate;
    const row = buildDcaBlock(
      loadedPlans({ plans: [ladder("cap-btc", 1)] }),
      june,
      new Set(["cap-btc"]),
      fillInputs([
        placed("order-a", 11_000, 2, {
          planId: planIdOf(1),
          rungId: "r1",
          observedAt: "2026-08-01T10:00:00",
        }),
      ]),
    ).positions[0]!;

    expect(Object.keys(row.rungs![0]!).sort()).toEqual(["id", "priceUsd"]);
    expect(row.figures).toEqual({ waitingDeclaredUsd: 500, waitingRestingUsd: 0 });
  });
});
