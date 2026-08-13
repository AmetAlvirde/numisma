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
  /** The #205 descriptors, absent by default — which is the shape of every existing line. */
  descriptors: Descriptors = {},
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
    ...descriptors,
    fundingReserveId: "reserve-synthetic",
  };
}

interface Descriptors {
  orderType?: string;
  timeInForce?: string;
  triggerPrice?: number;
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

/** The same export row, plus whatever the venue says about how the rung was placed. */
function exportedWith(descriptors: {
  orderType?: string;
  timeInForce?: string;
  triggerPrice?: number | null;
}): ObservedOpenOrder {
  return { ...exported(10, 0), ...descriptors };
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
    // and a cancellation retires the rung — both are the partition's business downstream,
    // and neither must move the figure the export is compared against.
    const stream: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10, 6),
      { id: RUNG, observedAt: "2026-01-02T09:00:00", kind: "orderFilled", currency: "USD", filledQuantity: 4 },
      { id: RUNG, observedAt: "2026-01-03T09:00:00", kind: "orderCancelled", currency: "USD" },
    ];
    expect(detectChangedClaims(stream, [exported(10, 6)])).toEqual([]);

    // BOTH DIRECTIONS, so neither line can go unread. The `[]` above stays `[]` whether
    // the cancellation is ignored (correct) or swallows the rung entirely (wrong), so it
    // alone cannot tell the two apart: the placement line must still be the basis AFTER a
    // cancellation, and a venue figure past it must still be reported.
    expect(detectChangedClaims(stream, [exported(10, 9)])).toEqual([
      { id: RUNG, differences: [{ field: "observedFilledQuantity", known: 6, observed: 9 }] },
    ]);
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

/**
 * THE PLACEMENT DESCRIPTORS AND THEIR OWN CONVENTION (#205).
 *
 * The comparison rule here DIVERGES from `observedFilledQuantity`'s, which coalesces
 * (`?? 0`) and is pinned above — deliberately, and the contrast is the point. A fill figure
 * has a meaningful zero, so an absent one is a real claim about the venue and DOES raise a
 * difference. A descriptor has no meaningful empty value, so an absent one can only mean
 * *we never recorded this* — and coalescing it would report a difference on every line
 * written before the widening, refusing an unchanged batch on every rung until a migration
 * rewrote an append-only file.
 *
 * Synthetic throughout: invented pair, round sizes, round prices, invented descriptors.
 */
describe("the placement descriptors are compared only when PRESENT (#205)", () => {
  it("reports NOTHING for a pre-widening line against an export that carries all three", () => {
    // THE NO-MIGRATION PROPERTY, at the seam that decides it. Every line already on the
    // file looks exactly like this one: no `orderType`, no `timeInForce`, no
    // `triggerPrice`. If absence were coalesced, this single assertion would be a
    // difference on all three fields — i.e. a refused batch on every rung of every
    // re-import, forever.
    const stream: OrderRecord[] = [placed("2026-01-01T10:00:00", 10)];
    expect(
      detectChangedClaims(stream, [
        exportedWith({ orderType: "Limit", timeInForce: "GTC", triggerPrice: 90 }),
      ]),
    ).toEqual([]);
  });

  it("reports a difference once the FILE carries the descriptor too", () => {
    const stream: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10, undefined, { orderType: "Limit", timeInForce: "GTC" }),
    ];
    expect(
      detectChangedClaims(stream, [exportedWith({ orderType: "Limit", timeInForce: "IOC" })]),
    ).toEqual([{ id: RUNG, differences: [{ field: "timeInForce", known: "GTC", observed: "IOC" }] }]);
  });

  it("compares `triggerPrice` as a NUMBER, exactly, and reports both sides", () => {
    const stream: OrderRecord[] = [placed("2026-01-01T10:00:00", 10, undefined, { triggerPrice: 90 })];
    expect(detectChangedClaims(stream, [exportedWith({ triggerPrice: 90 })])).toEqual([]);
    expect(detectChangedClaims(stream, [exportedWith({ triggerPrice: 95 })])).toEqual([
      { id: RUNG, differences: [{ field: "triggerPrice", known: 90, observed: 95 }] },
    ]);
  });

  it("treats the venue's BLANK trigger as absent rather than as a change to zero", () => {
    // `null` is the sentinel the parser produces for `-- / --`. There is no honest figure
    // to render as the `observed` side of a difference, and reading it as `0` would refuse
    // a batch over a rung the venue simply never triggered.
    const stream: OrderRecord[] = [placed("2026-01-01T10:00:00", 10, undefined, { triggerPrice: 90 })];
    expect(detectChangedClaims(stream, [exportedWith({ triggerPrice: null })])).toEqual([]);
  });

  it("KNOWN LIMIT, asserted rather than described: a rung that GAINS a descriptor is not detected", () => {
    // Absent on file means there is nothing to compare, so this is the one direction the
    // widening does not close. It is the same gap every pre-widening line already had, and
    // it closes for every rung placed from here on — the placement line will carry the
    // descriptor. Pinned so that a later change of mind about it is a deliberate one.
    const stream: OrderRecord[] = [placed("2026-01-01T10:00:00", 10, undefined, { orderType: "Limit" })];
    expect(detectChangedClaims(stream, [exportedWith({ orderType: "Limit", timeInForce: "IOC" })])).toEqual(
      [],
    );
  });

  it("reports a descriptor difference BESIDE a fill difference, not instead of it", () => {
    // Both land on the one claim. Which refusal class that claim goes to is the import
    // boundary's decision; the detector's job is to say everything it found.
    const stream: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10, 6, { timeInForce: "GTC" }),
    ];
    const differing: ObservedOpenOrder = { ...exported(10, 8), timeInForce: "IOC" };
    expect(detectChangedClaims(stream, [differing])).toEqual([
      {
        id: RUNG,
        differences: [
          { field: "observedFilledQuantity", known: 6, observed: 8 },
          { field: "timeInForce", known: "GTC", observed: "IOC" },
        ],
      },
    ]);
  });
});
