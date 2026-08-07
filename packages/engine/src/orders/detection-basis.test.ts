/**
 * THE DETECTION SEAM (#181, slice #208) — what `detectChangedClaims` compares against.
 *
 * `S-D`. The function's INPUT widened to the whole record stream and its BASIS became the
 * latest observation, and those are two claims a caller cannot check for itself: the TUI's
 * end-to-end suite can prove that an already-recorded restatement stops being re-reported,
 * but it cannot reach the equal-stamp tie-break or the epsilon floor without contriving an
 * export around each. Those live here, at the interface, where the figures are the whole
 * fixture.
 *
 * WHY THE TIE-BREAK IS PINNED AT ALL. It is not arithmetic — it is an AGREEMENT. The
 * selector's stable sort makes the LAST line in file order win an equal-stamp tie, so a
 * detector that resolved the tie the other way would compare against a figure the fold
 * does not hold, and the two would disagree about which observation is current in exactly
 * the case nobody would think to look at.
 *
 * Synthetic throughout: invented pair, round sizes, round prices.
 */
import { describe, expect, it } from "vitest";
import { detectChangedClaims, type ObservedOpenOrder } from "./ingest.js";
import {
  buildOrderFillObserved,
  type OrderFillObservedRecord,
  type OrderPlacedRecord,
  type OrderRecord,
} from "./records.js";
import { pickRestingOrdersAsOf } from "./select.js";

const RUNG = "rung-synthetic";

function placed(
  observedAt: string,
  quantity: number,
  observedFilledQuantity?: number,
): OrderPlacedRecord {
  return {
    id: RUNG,
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

/** Built THROUGH THE CONSTRUCTOR — the witness makes a literal untypeable (#206). */
function observed(observedAt: string, observedFilledQuantity: number): OrderFillObservedRecord {
  const built = buildOrderFillObserved({
    id: RUNG,
    observedAt,
    currency: "USD",
    observedFilledQuantity,
  });
  if (built.status !== "ok") throw new Error(`fixture must build: ${built.message}`);
  return built.record;
}

/** The export's row for the same rung: 10 units at 100, filled as given. */
function exported(quantity: number, filledQuantity: number): ObservedOpenOrder {
  return {
    id: RUNG,
    observedAt: "2026-01-01T10:00:00",
    currency: "USD",
    symbol: "TEST/USD",
    side: "buy",
    price: 100,
    quantity,
    filledQuantity,
  };
}

describe("detectChangedClaims compares against the LATEST observation (#181)", () => {
  it("reports NO difference when the file already carries the restatement", () => {
    // THE CASE THE PLACEMENT-LINE BASIS GOT WRONG FOREVER. The venue restated 6 → 8, the
    // observation was recorded, and the SAME export is imported again. Against the
    // placement line's 6 this reads as a fresh restatement on every import for the life of
    // the rung; against the latest observation it reads as what it is — nothing new.
    const stream: OrderRecord[] = [placed("2026-01-01T10:00:00", 10, 6), observed("2026-01-02T09:00:00", 8)];
    expect(detectChangedClaims(stream, [exported(10, 8)])).toEqual([]);
  });

  it("still reports a difference when the venue has moved PAST the latest observation", () => {
    const stream: OrderRecord[] = [placed("2026-01-01T10:00:00", 10, 6), observed("2026-01-02T09:00:00", 8)];
    expect(detectChangedClaims(stream, [exported(10, 9)])).toEqual([
      { id: RUNG, differences: [{ field: "observedFilledQuantity", known: 8, observed: 9 }] },
    ]);
  });

  it("falls back to the placement line's own figure, then to 0", () => {
    const withFigure: OrderRecord[] = [placed("2026-01-01T10:00:00", 10, 6)];
    expect(detectChangedClaims(withFigure, [exported(10, 6)])).toEqual([]);

    // No figure at all reads as nothing filled — the same `?? 0` the fold takes, not a
    // missing case.
    const without: OrderRecord[] = [placed("2026-01-01T10:00:00", 10)];
    expect(detectChangedClaims(without, [exported(10, 0)])).toEqual([]);
    expect(detectChangedClaims(without, [exported(10, 1)])).toEqual([
      { id: RUNG, differences: [{ field: "observedFilledQuantity", known: 0, observed: 1 }] },
    ]);
  });

  it("resolves an equal-stamp tie to the LAST line in file order — as the fold does", () => {
    // Two observations at the SAME second. The selector sorts stably, so the last line
    // wins there; detection must land on the same one or the two disagree about which
    // observation is current.
    const stream: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10, 6),
      observed("2026-01-02T09:00:00", 8),
      observed("2026-01-02T09:00:00", 7),
    ];
    expect(detectChangedClaims(stream, [exported(10, 7)])).toEqual([]);
    expect(detectChangedClaims(stream, [exported(10, 8)])).toEqual([
      { id: RUNG, differences: [{ field: "observedFilledQuantity", known: 7, observed: 8 }] },
    ]);

    // THE AGREEMENT ITSELF, asserted rather than described: the fold folds the same
    // stream to a remainder of 3, i.e. `consumed` 7 — the same line detection chose.
    expect(pickRestingOrdersAsOf(stream).map((order) => order.remainingQuantity)).toEqual([3]);
  });

  it("takes the latest observation by STAMP, not by position", () => {
    const stream: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10, 6),
      observed("2026-01-03T09:00:00", 8),
      observed("2026-01-02T09:00:00", 7),
    ];
    expect(detectChangedClaims(stream, [exported(10, 8)])).toEqual([]);
  });

  it("ignores `orderFilled` and `orderCancelled` — they are not observations", () => {
    // What the FUND booked is not what the VENUE showed. A fill line moves `consumed`,
    // which is the partition's business downstream, and must not move the figure the
    // export is compared against.
    const stream: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10, 6),
      { id: RUNG, observedAt: "2026-01-02T09:00:00", kind: "orderFilled", currency: "USD", filledQuantity: 4 },
    ];
    expect(detectChangedClaims(stream, [exported(10, 6)])).toEqual([]);
  });
});

describe("the epsilon is on the FILLED comparison only (#181)", () => {
  it("reports no difference for a filled gap below the noise floor", () => {
    const stream: OrderRecord[] = [placed("2026-01-01T10:00:00", 10, 6)];
    expect(detectChangedClaims(stream, [exported(10, 6 + 1e-12)])).toEqual([]);
  });

  it("still reports a filled gap above it", () => {
    const stream: OrderRecord[] = [placed("2026-01-01T10:00:00", 10, 6)];
    expect(detectChangedClaims(stream, [exported(10, 6.5)])).toHaveLength(1);
  });

  it("keeps `quantity` EXACT — the one figure nothing may go stale on", () => {
    // No floor here, deliberately: `quantity` is one authored number against another
    // rather than a comparison with a folded figure, so there is nothing for a floor to
    // absorb, and this refuses the whole batch (#174) where the filled test would not.
    const stream: OrderRecord[] = [placed("2026-01-01T10:00:00", 10, 6)];
    expect(detectChangedClaims(stream, [exported(10 + 1e-12, 6)])).toEqual([
      { id: RUNG, differences: [{ field: "quantity", known: 10, observed: 10 + 1e-12 }] },
    ]);
  });
});
