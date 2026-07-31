// The PURE half of the `orders.jsonl` sidecar: `pickRestingOrdersAsOf` replayed over a
// SYNTHETIC lifecycle stream. Every figure here is invented and round — the fund's real
// rungs are figures and must never enter this repository (ADR-007). The assertions are
// about PROPERTIES of the replay, never about a real price, size or balance.
import { describe, expect, it } from "vitest";
import { pickRestingOrdersAsOf } from "./orders/select.js";
import type {
  OrderCancelledRecord,
  OrderFilledRecord,
  OrderPlacedRecord,
  OrderRecord,
} from "./orders/records.js";

function placed(
  id: string,
  observedAt: string,
  price: number,
  quantity: number,
): OrderPlacedRecord {
  return {
    id,
    observedAt,
    kind: "orderPlaced",
    currency: "USD",
    symbol: "TEST/USD",
    side: "buy",
    price,
    quantity,
    fundingReserveId: "reserve-synthetic",
  };
}

function cancelled(id: string, observedAt: string): OrderCancelledRecord {
  return { id, observedAt, kind: "orderCancelled", currency: "USD" };
}

function filled(id: string, observedAt: string, filledQuantity: number): OrderFilledRecord {
  return { id, observedAt, kind: "orderFilled", currency: "USD", filledQuantity };
}

/**
 * A synthetic three-rung ladder with a lifecycle: all three placed on day one, the top
 * rung cancelled on day two, the middle rung fully filled on day three.
 */
const LADDER: OrderRecord[] = [
  placed("rung-top", "2026-01-01T10:00:00", 300, 2),
  placed("rung-mid", "2026-01-01T10:00:01", 200, 2),
  placed("rung-low", "2026-01-01T10:00:02", 100, 2),
  cancelled("rung-top", "2026-01-02T09:00:00"),
  filled("rung-mid", "2026-01-03T09:00:00", 2),
];

const idsOf = (asOf?: string): string[] =>
  pickRestingOrdersAsOf(LADDER, asOf).map((resting) => resting.placed.id);

describe("pickRestingOrdersAsOf — as-of replay of the lifecycle stream", () => {
  it("answers 'what was resting on date X' differently on each day of the lifecycle", () => {
    // The question adherence is made of, and the reason the file is a lifecycle stream
    // rather than a current-state snapshot: a snapshot could only ever answer the last.
    expect(idsOf("2026-01-01")).toEqual(["rung-top", "rung-mid", "rung-low"]);
    expect(idsOf("2026-01-02")).toEqual(["rung-mid", "rung-low"]);
    expect(idsOf("2026-01-03")).toEqual(["rung-low"]);
  });

  it("selects as of the whole stream when asOf is omitted", () => {
    expect(idsOf()).toEqual(["rung-low"]);
  });

  it("returns nothing before the first line, and never throws on an empty stream", () => {
    expect(idsOf("2025-12-31")).toEqual([]);
    expect(pickRestingOrdersAsOf([], "2026-01-01")).toEqual([]);
    expect(pickRestingOrdersAsOf([])).toEqual([]);
  });

  it("includes an order placed LATER on the as-of day itself", () => {
    // A bare YYYY-MM-DD asks about a whole day. Comparing it against a second-granular
    // stamp without widening would exclude every order placed during that very day.
    const sameDay = [placed("rung-late", "2026-01-01T23:59:58", 100, 1)];
    expect(pickRestingOrdersAsOf(sameDay, "2026-01-01")).toHaveLength(1);
  });

  it("accepts a second-granular boundary and orders rungs placed within one minute", () => {
    // The precision `observedAt` exists to keep: a date-only stamp could not separate
    // these three, all submitted inside the same minute.
    expect(idsOf("2026-01-01T10:00:01")).toEqual(["rung-top", "rung-mid"]);
  });

  it("keeps a partially-filled rung resting for its unfilled remainder only", () => {
    const partial: OrderRecord[] = [
      placed("rung-part", "2026-01-01T10:00:00", 100, 10),
      filled("rung-part", "2026-01-02T10:00:00", 4),
    ];
    const [resting, ...rest] = pickRestingOrdersAsOf(partial);
    expect(rest).toEqual([]);
    expect(resting?.remainingQuantity).toBe(6);
    // The claim's own record is untouched — the remainder is derived, never written back.
    expect(resting?.placed.quantity).toBe(10);
  });

  it("retires a rung only when successive partials exhaust it", () => {
    const partials: OrderRecord[] = [
      placed("rung-part", "2026-01-01T10:00:00", 100, 10),
      filled("rung-part", "2026-01-02T10:00:00", 4),
      filled("rung-part", "2026-01-03T10:00:00", 6),
    ];
    expect(pickRestingOrdersAsOf(partials, "2026-01-02")).toHaveLength(1);
    expect(pickRestingOrdersAsOf(partials, "2026-01-03")).toEqual([]);
  });

  it("replays a non-monotonic file deterministically, in placement order", () => {
    const scrambled = [LADDER[4]!, LADDER[2]!, LADDER[0]!, LADDER[3]!, LADDER[1]!];
    expect(pickRestingOrdersAsOf(scrambled, "2026-01-02").map((r) => r.placed.id)).toEqual([
      "rung-mid",
      "rung-low",
    ]);
  });

  it("does not mutate the caller's array", () => {
    const input = [...LADDER];
    pickRestingOrdersAsOf(input, "2026-01-02");
    expect(input).toEqual(LADDER);
  });

  it("ignores a state change for an id that was never placed", () => {
    // Nothing may invent a resting claim: a cancel or a fill naming an unknown order is
    // not evidence that the order existed.
    const orphans: OrderRecord[] = [
      cancelled("rung-unknown", "2026-01-02T09:00:00"),
      filled("rung-unknown", "2026-01-02T09:00:01", 1),
    ];
    expect(pickRestingOrdersAsOf(orphans)).toEqual([]);
  });

  it("counts a repeated placement of the same id once", () => {
    // Ingest ids are deterministic, so re-importing the same export re-observes the same
    // claim. Counting it twice would double the ladder's committed capital.
    const twice: OrderRecord[] = [
      placed("rung-low", "2026-01-01T10:00:00", 100, 2),
      placed("rung-low", "2026-01-02T10:00:00", 100, 2),
    ];
    expect(pickRestingOrdersAsOf(twice)).toHaveLength(1);
  });

  it("keeps a rung resting when it merely stops being observed", () => {
    // An absence is not a fill and not a cancellation (ADR-013, D12). With no line
    // saying what happened, the claim stands.
    expect(pickRestingOrdersAsOf([LADDER[0]!], "2026-06-30")).toHaveLength(1);
  });
});
