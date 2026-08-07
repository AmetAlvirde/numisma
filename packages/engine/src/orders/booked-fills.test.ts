/**
 * THE BOOKED-FILLS CEILING, PURE HALF (#181, slice #207) — seam `S-C`.
 *
 * Slice #206 made `consumed` NON-MONOTONIC on purpose: an `orderFillObserved` SETS the
 * baseline, so an observation below it takes a retired rung's `remainingQuantity` from
 * zero back to positive. That is the right arithmetic and it is not reversed. What it
 * costs is that `remainingQuantity` stopped being an AUTHORIZATION — and the fill
 * recorder used it as one.
 *
 * `bookedFills` is the second term of the gate that replaces it:
 *
 *     admissible = min(rung.remainingQuantity, rung.quantity − bookedFills(id))
 *
 * This file pins the pure function and, more importantly, THE PROPERTY THAT MAKES THE
 * GATE SAFE TO SHIP: on every stream the import path can produce, `consumed ≥
 * bookedFills`, so `quantity − bookedFills ≥ remainingQuantity` and the `min` NEVER
 * BINDS. It binds only in the resurrection case. Both directions are asserted here, so
 * "provable no-op" is a test rather than a claim in a spec.
 *
 * Synthetic throughout: invented pair, round sizes, round prices.
 */
import { describe, expect, it } from "vitest";
import {
  buildOrderFillObserved,
  type OrderFillObservedRecord,
  type OrderFilledRecord,
  type OrderPlacedRecord,
  type OrderRecord,
} from "./records.js";
import { bookedFills, pickRestingOrdersAsOf } from "./select.js";

const RUNG = "rung-synthetic";
const OTHER = "rung-synthetic-other";

function placed(
  id: string,
  observedAt: string,
  quantity: number,
  observedFilledQuantity?: number,
): OrderPlacedRecord {
  return {
    id,
    observedAt,
    kind: "orderPlaced",
    currency: "USD",
    symbol: "TEST/USD",
    side: "buy",
    price: 100,
    quantity,
    ...(observedFilledQuantity === undefined ? {} : { observedFilledQuantity }),
    fundingReserveId: "reserve-synthetic",
  };
}

function booked(id: string, observedAt: string, filledQuantity: number): OrderFilledRecord {
  return { id, observedAt, kind: "orderFilled", currency: "USD", filledQuantity };
}

/** Through the constructor — there is no other way to build one (slice #206). */
function observed(
  id: string,
  observedAt: string,
  observedFilledQuantity: number,
): OrderFillObservedRecord {
  const built = buildOrderFillObserved({
    id,
    observedAt,
    currency: "USD",
    observedFilledQuantity,
  });
  if (built.status !== "ok") {
    throw new Error(`synthetic observation refused: ${built.message}`);
  }
  return built.record;
}

/** What the rung reports as still resting, or `undefined` when it is not resting at all. */
function remainingOf(records: OrderRecord[], id: string): number | undefined {
  return pickRestingOrdersAsOf(records).find((order) => order.placed.id === id)
    ?.remainingQuantity;
}

describe("bookedFills — what the FUND actually booked, and nothing else", () => {
  it("sums the rung's orderFilled lines", () => {
    const records: OrderRecord[] = [
      placed(RUNG, "2026-01-02T09:00:00", 10),
      booked(RUNG, "2026-01-03T10:00:00", 4),
      booked(RUNG, "2026-01-04T10:00:00", 6),
    ];
    expect(bookedFills(records, RUNG)).toBe(10);
  });

  it("counts NO observation — neither the placement line's partial nor a restatement", () => {
    // The whole point of the ceiling. An observation is what the VENUE SHOWED; only an
    // `orderFilled` line has a lot and a cash leg behind it. Counting an observation here
    // would make the ceiling move with the very figure it exists to be independent of.
    const records: OrderRecord[] = [
      placed(RUNG, "2026-01-02T09:00:00", 10, 2),
      observed(RUNG, "2026-01-03T10:00:00", 6),
    ];
    expect(bookedFills(records, RUNG)).toBe(0);
  });

  it("counts only the named rung, and a cancellation does not discharge what was booked", () => {
    const records: OrderRecord[] = [
      placed(RUNG, "2026-01-02T09:00:00", 10),
      placed(OTHER, "2026-01-02T09:00:01", 10),
      booked(RUNG, "2026-01-03T10:00:00", 3),
      booked(OTHER, "2026-01-03T10:00:01", 7),
      { id: RUNG, observedAt: "2026-01-04T10:00:00", kind: "orderCancelled", currency: "USD" },
    ];
    // A cancellation retires the CLAIM. It does not un-buy the lot: the cash left and the
    // asset arrived, so the fund's booked total is still 3 and the ceiling still knows it.
    expect(bookedFills(records, RUNG)).toBe(3);
    expect(bookedFills(records, OTHER)).toBe(7);
  });

  it("is TOTAL — an id it has never met sums to zero rather than throwing", () => {
    expect(bookedFills([], "no-such-rung")).toBe(0);
    expect(bookedFills([placed(RUNG, "2026-01-02T09:00:00", 10)], "no-such-rung")).toBe(0);
  });

  it("is PURE — it does not touch the array it is given", () => {
    const records: OrderRecord[] = [
      placed(RUNG, "2026-01-02T09:00:00", 10),
      booked(RUNG, "2026-01-03T10:00:00", 4),
    ];
    const before = JSON.stringify(records);
    bookedFills(records, RUNG);
    expect(JSON.stringify(records)).toBe(before);
  });
});

describe("the ceiling is a PROVABLE NO-OP on every stream the import path can produce", () => {
  it("does not bind on an ordinary partial: placed 10, venue showed 2, nothing booked", () => {
    // The AC's ordinary stream. `consumed` is 2 off the placement line, nothing is booked,
    // so the headroom is the full 10 and the remainder of 8 is what binds — exactly the
    // figure the gate used before this slice. Admission is unchanged.
    const records: OrderRecord[] = [placed(RUNG, "2026-01-02T09:00:00", 10, 2)];
    const remaining = remainingOf(records, RUNG);

    expect(remaining).toBe(8);
    expect(bookedFills(records, RUNG)).toBe(0);
    expect(10 - bookedFills(records, RUNG)).toBeGreaterThanOrEqual(remaining ?? 0);
  });

  it("does not bind across an ordinary observe-then-book interleaving", () => {
    // Placed 10, venue observed 6, the fund then booked 1 of its own. `consumed` is 7 and
    // `bookedFills` is 1, so headroom 9 ≥ remainder 3. The `min` still never binds.
    const records: OrderRecord[] = [
      placed(RUNG, "2026-01-02T09:00:00", 10, 2),
      observed(RUNG, "2026-01-03T10:00:00", 6),
      booked(RUNG, "2026-01-04T10:00:00", 1),
    ];
    const remaining = remainingOf(records, RUNG);

    expect(remaining).toBe(3);
    expect(bookedFills(records, RUNG)).toBe(1);
    expect(10 - bookedFills(records, RUNG)).toBeGreaterThanOrEqual(remaining ?? 0);
  });

  it("BINDS only when a backwards observation resurrects a rung the fund already exhausted", () => {
    // The one geometry the gate exists for. The rung was placed at 10 and the fund booked
    // all 10 — two files, a lot and a cash leg. A hand-authored observation asserting 3
    // then SETS `consumed` back to 3, so the fold honestly reports 7 still resting.
    //
    // Trusting that 7 would authorize 7 more units, taking total booked fills to 17
    // against a placed 10, in a log with no reversal verb. The headroom is 0.
    const records: OrderRecord[] = [
      placed(RUNG, "2026-01-02T09:00:00", 10),
      booked(RUNG, "2026-01-03T10:00:00", 10),
      observed(RUNG, "2026-01-04T10:00:00", 3),
    ];
    const remaining = remainingOf(records, RUNG);

    expect(remaining).toBe(7);
    expect(bookedFills(records, RUNG)).toBe(10);
    expect(10 - bookedFills(records, RUNG)).toBe(0);
    expect(Math.min(remaining ?? 0, 10 - bookedFills(records, RUNG))).toBe(0);
  });
});
