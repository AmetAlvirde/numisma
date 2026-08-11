/**
 * `selectOrdersThrough` — THE AS-OF BOUNDARY ON A WHOLE ORDER STREAM (spec #285,
 * slice 3).
 *
 * WHY IT EXISTS AT ALL, given `foldOrderStream` already takes an `asOf`. The fill-path
 * reconciliation reads the stream TWICE — once through the fold, once through
 * `bookedFills` — and only the first of those has a boundary parameter. A caller that
 * wants a historical answer therefore cannot get one by passing a date to
 * `reconcileFillPath`: it has to hand in a stream that is already bounded, or the book
 * axis silently answers with lines the anchor could not have known about. The push's
 * backfill is exactly that caller — it replays June anchors — and a June anchor showing
 * an August fill is the failure this closes.
 *
 * THE DAY-WIDENING RULE HAS ONE SPELLING and this function reuses it rather than
 * restating it: `observedAt` is second-granular, so a bare `YYYY-MM-DD` boundary means
 * the WHOLE day, and a plain string comparison against the bare date would exclude every
 * order placed during the very day being asked about. That trap already cost this repo
 * once; a second copy of the rule in the push would be the same defect waiting.
 *
 * MUTATION-CHECKED: `upperBound(asOf)` replaced with a bare `asOf`. The whole-day case
 * goes red naming the same-day order that vanished. Restored after.
 *
 * Synthetic throughout: invented ids, round prices, round sizes.
 */
import { describe, expect, it } from "vitest";
import type { OrderPlacedRecord, OrderRecord } from "./records.js";
import { selectOrdersThrough } from "./select.js";

function placed(id: string, observedAt: string): OrderPlacedRecord {
  return {
    id,
    observedAt,
    kind: "orderPlaced",
    currency: "USD",
    symbol: "TEST/USD",
    side: "buy",
    price: 10_000,
    quantity: 1,
    fundingReserveId: "reserve-synthetic",
  };
}

const STREAM: OrderRecord[] = [
  placed("order-1", "2026-06-10T09:00:00"),
  placed("order-2", "2026-06-20T23:59:59"),
  placed("order-3", "2026-06-21T00:00:00"),
];

describe("selectOrdersThrough — what the anchor could have known", () => {
  it("keeps every line at or before the boundary and drops the ones after", () => {
    expect(selectOrdersThrough(STREAM, "2026-06-20").map((r) => r.id)).toEqual([
      "order-1",
      "order-2",
    ]);
  });

  it("includes lines from the boundary DAY ITSELF, second-granular stamps and all", () => {
    // The trap: `"2026-06-20T23:59:59" > "2026-06-20"` lexically, so a bare comparison
    // answers with the previous day's book — silently, and only for the day being asked
    // about, which is the day that matters most.
    expect(selectOrdersThrough(STREAM, "2026-06-20").map((r) => r.id)).toContain("order-2");
  });

  it("honors a second-granular boundary verbatim when one is given", () => {
    expect(
      selectOrdersThrough(STREAM, "2026-06-20T12:00:00").map((r) => r.id),
    ).toEqual(["order-1"]);
  });

  it("returns the WHOLE stream when no boundary is given — the daily push's case", () => {
    expect(selectOrdersThrough(STREAM).map((r) => r.id)).toEqual([
      "order-1",
      "order-2",
      "order-3",
    ]);
  });

  it("preserves FILE ORDER and does not mutate its input", () => {
    // Ordering is the fold's own business (`observedAt` replay order, documented as a
    // contract on `pickRestingOrdersAsOf`). This is a filter and nothing more; sorting
    // here would put a second, invisible ordering rule in front of the one that counts.
    const input = [...STREAM].reverse();
    const before = input.map((r) => r.id);
    expect(selectOrdersThrough(input).map((r) => r.id)).toEqual(before);
    expect(input.map((r) => r.id)).toEqual(before);
  });
});
