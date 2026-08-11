/**
 * THE PURE HALF OF THE DECLARED JOIN (#286): which ladders are in force at an import,
 * what a price match PROPOSES over them, and what a pick declares against the order's
 * own price.
 *
 * Every ladder, price and id here is SYNTHESIZED and invented — round figures, counted
 * UUIDs, no shape copied from real output. The fund's real ladder is figures and must
 * never enter this repository (ADR-007).
 *
 * MUTATION-CHECKED (fix reverted, this file re-run, fix restored):
 *
 *   - `M-I` accept an `ended` lookup as in force  → "a terminated ladder is not in force"
 *   - `M-J` accept `dcaTime` as a ladder          → "a dcaTime plan has no rungs to pick"
 *   - `M-K` return the FIRST price match instead of refusing an ambiguous one
 *                                                 → "proposes nothing when two ladders
 *                                                    declare a rung at the same price"
 *   - `M-L` drop the `effectiveAt <= asOf` window → "a ladder declared AFTER the import
 *                                                    stamp is not in force"
 */
import { describe, expect, it } from "vitest";
import type { IsoDate, LoadedPlanRecord, LoadedPlans } from "../plans.js";
import { buildOrderPlacedRecords, type ObservedOpenOrder } from "./ingest.js";
import { declaredRungPrice, inForceLadders, proposeRungByPrice } from "./rung-picks.js";

const PLAN_A = "00000000-0000-4000-8000-00000000000a";
const PLAN_B = "00000000-0000-4000-8000-00000000000b";

function ladder(
  id: string,
  positionId: string,
  effectiveAt: string,
  line: number,
  prices: readonly number[],
): LoadedPlanRecord {
  return {
    kind: "dcaLadder",
    id,
    positionId,
    effectiveAt: effectiveAt as IsoDate,
    line,
    tierOrder: ["c1"],
    rungs: prices.map((priceUsd, index) => ({
      id: `rung-${index + 1}`,
      priceUsd,
      sizeUsd: 100,
    })),
  };
}

function loaded(plans: LoadedPlanRecord[]): LoadedPlans {
  return { load: { status: "loaded" }, plans, skipped: [] };
}

const IMPORT_DAY = "2026-08-11" as IsoDate;

describe("inForceLadders — the declared ladders an import may propose against", () => {
  it("returns the in-force ladder, carrying its id and the content the operator reads", () => {
    const file = loaded([ladder(PLAN_A, "pos-a", "2026-08-01", 1, [100, 90])]);
    expect(inForceLadders(file, IMPORT_DAY)).toEqual([
      {
        planId: PLAN_A,
        positionId: "pos-a",
        effectiveAt: "2026-08-01",
        rungs: [
          { id: "rung-1", priceUsd: 100, sizeUsd: 100 },
          { id: "rung-2", priceUsd: 90, sizeUsd: 100 },
        ],
      },
    ]);
  });

  it("takes the SUPERSEDING line for a position, never both", () => {
    const file = loaded([
      ladder(PLAN_A, "pos-a", "2026-08-01", 1, [100]),
      ladder(PLAN_B, "pos-a", "2026-08-05", 2, [80]),
    ]);
    expect(inForceLadders(file, IMPORT_DAY).map((entry) => entry.planId)).toEqual([PLAN_B]);
  });

  it("a ladder declared AFTER the import stamp is not in force", () => {
    const file = loaded([ladder(PLAN_A, "pos-a", "2026-09-01", 1, [100])]);
    expect(inForceLadders(file, IMPORT_DAY)).toEqual([]);
  });

  it("a terminated ladder is not in force — the terminator is the whole point of it", () => {
    const file = loaded([
      ladder(PLAN_A, "pos-a", "2026-08-01", 1, [100]),
      { kind: "noPlan", positionId: "pos-a", effectiveAt: "2026-08-09" as IsoDate, line: 2 },
    ]);
    expect(inForceLadders(file, IMPORT_DAY)).toEqual([]);
  });

  it("a dcaTime plan has no rungs to pick, so it is not offered", () => {
    const file = loaded([
      {
        kind: "dcaTime",
        positionId: "pos-a",
        effectiveAt: "2026-08-01" as IsoDate,
        line: 1,
        cadence: "weekly",
        anchorAt: "2026-08-01" as IsoDate,
        amountUsd: 100,
        tierOrder: ["c1"],
      },
    ]);
    expect(inForceLadders(file, IMPORT_DAY)).toEqual([]);
  });

  it("offers a ladder whose position is not born — day zero is the normal case", () => {
    // The fund's live ladder is `pending`: eight rungs, no fill, no Position yet. An
    // import that could not propose against it would be useless on exactly the day the
    // feature exists for.
    const file = loaded([ladder(PLAN_A, "pos-unborn", "2026-08-01", 1, [100])]);
    expect(inForceLadders(file, IMPORT_DAY).map((entry) => entry.planId)).toEqual([PLAN_A]);
  });
});

describe("proposeRungByPrice — a suggestion, and never a confident guess", () => {
  const ladders = inForceLadders(
    loaded([
      ladder(PLAN_A, "pos-a", "2026-08-01", 1, [100, 90]),
      ladder(PLAN_B, "pos-b", "2026-08-01", 2, [70]),
    ]),
    IMPORT_DAY,
  );

  it("proposes the one rung declared at the order's price, across every ladder", () => {
    expect(proposeRungByPrice(ladders, 90)).toEqual({ planId: PLAN_A, rungId: "rung-2" });
    expect(proposeRungByPrice(ladders, 70)).toEqual({ planId: PLAN_B, rungId: "rung-1" });
  });

  it("proposes nothing when no rung is declared at that price", () => {
    expect(proposeRungByPrice(ladders, 95)).toBeUndefined();
  });

  it("proposes nothing when two ladders declare a rung at the same price", () => {
    // WITHIN one ladder this cannot arise — the plan loader refuses a duplicated
    // `priceUsd` outright. ACROSS two ladders it is a legitimate declaration, and the
    // honest answer is silence: an operator ratifying a proposal must not be handed a
    // coin flip wearing the clothes of a match.
    const colliding = inForceLadders(
      loaded([
        ladder(PLAN_A, "pos-a", "2026-08-01", 1, [100]),
        ladder(PLAN_B, "pos-b", "2026-08-01", 2, [100]),
      ]),
      IMPORT_DAY,
    );
    expect(proposeRungByPrice(colliding, 100)).toBeUndefined();
  });

  it("proposes nothing when there is no ladder at all", () => {
    expect(proposeRungByPrice([], 100)).toBeUndefined();
  });
});

describe("declaredRungPrice — what the picked rung says, so a difference can be flagged", () => {
  const ladders = inForceLadders(
    loaded([ladder(PLAN_A, "pos-a", "2026-08-01", 1, [100, 90])]),
    IMPORT_DAY,
  );

  it("answers the declared price of the picked rung", () => {
    expect(declaredRungPrice(ladders, { planId: PLAN_A, rungId: "rung-2" })).toBe(90);
  });

  it("answers nothing for a rung or a ladder no in-force declaration names", () => {
    expect(declaredRungPrice(ladders, { planId: PLAN_A, rungId: "rung-9" })).toBeUndefined();
    expect(declaredRungPrice(ladders, { planId: PLAN_B, rungId: "rung-1" })).toBeUndefined();
  });
});

/**
 * THE PICK REACHES THE RECORD THROUGH THE ATTRIBUTION VALUE the import already threads —
 * one path in, not a second. `M-M`: dropping the `rungPicks` spread from
 * `buildOrderPlacedRecords` makes the first assertion below fail, with the record
 * carrying the funding declaration and neither declared join field.
 */
describe("buildOrderPlacedRecords carries the operator's pick onto the line", () => {
  const observed: ObservedOpenOrder = {
    id: "venue:SYNTH/USD:buy:90:2026-08-11T09:30:00",
    observedAt: "2026-08-11T09:30:00",
    currency: "USD",
    symbol: "SYNTH/USD",
    side: "buy",
    price: 90,
    quantity: 2,
  };

  it("writes both fields for a picked order", () => {
    const [record] = buildOrderPlacedRecords([observed], {
      fundingReserveId: "reserve-a",
      rungPicks: { [observed.id]: { planId: PLAN_A, rungId: "rung-2" } },
    });
    expect(record).toMatchObject({ planId: PLAN_A, rungId: "rung-2" });
  });

  it("writes NEITHER field for an order with no pick — the legacy path, not an error", () => {
    const [record] = buildOrderPlacedRecords([observed], { fundingReserveId: "reserve-a" });
    expect(record && "planId" in record).toBe(false);
    expect(record && "rungId" in record).toBe(false);
  });

  it("picks are per order: an unpicked order beside a picked one stays unpicked", () => {
    const other: ObservedOpenOrder = { ...observed, id: "venue:SYNTH/USD:buy:80:x", price: 80 };
    const records = buildOrderPlacedRecords([observed, other], {
      fundingReserveId: "reserve-a",
      rungPicks: { [observed.id]: { planId: PLAN_A, rungId: "rung-2" } },
    });
    expect(records[0]).toMatchObject({ rungId: "rung-2" });
    expect(records[1] && "rungId" in records[1]).toBe(false);
  });
});
