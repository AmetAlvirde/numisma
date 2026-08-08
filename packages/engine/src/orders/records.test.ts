/**
 * THE RECORD CONTRACT'S REFUSALS (`./records.ts`) — the cases whose whole value is the
 * MESSAGE, not the status.
 *
 * `parseOrderRecord` refuses an array line through `isRecordObject`, the strict half of
 * the engine kernel's predicate pair (`../internal.ts`). Its loose sibling `isRecord`
 * passes arrays deliberately, and nothing but this file stops a future reader from
 * concluding the two are duplicates and collapsing them: under the loose predicate an
 * array still SKIPS as `malformed`, so a status-only assertion stays green while the
 * operator's message silently degrades to `id must be a non-empty string` — a hunt for a
 * missing field in a line that has no fields.
 *
 * Synthetic throughout: invented pair, round sizes, round prices.
 */
import { describe, expect, it } from "vitest";
import {
  buildOrderFillObserved,
  parseOrderRecord,
  serializeOrderRecord,
  type OrderPlacedRecord,
} from "./records.js";

describe("parseOrderRecord refuses a non-object line attributably", () => {
  it("names the shape, not a field, for an array line", () => {
    expect(parseOrderRecord([])).toEqual({
      status: "skip",
      problem: "malformed",
      message: "record must be a JSON object",
    });
  });

  it("names the shape for an array WRAPPING a valid record — it is never unwrapped", () => {
    expect(
      parseOrderRecord([
        {
          id: "rung-synthetic",
          observedAt: "2026-01-01T09:30:00",
          kind: "orderCancelled",
          currency: "USD",
        },
      ]),
    ).toEqual({
      status: "skip",
      problem: "malformed",
      message: "record must be a JSON object",
    });
  });

  it("refuses a genuine object with a missing id by FIELD, not by shape", () => {
    // The contrast case: this is the message the array cases must NOT produce. Without it,
    // the two above would pin "some refusal happens" rather than "the shape check fires".
    expect(parseOrderRecord({ observedAt: "2026-01-01T09:30:00" })).toEqual({
      status: "skip",
      problem: "malformed",
      message: "id must be a non-empty string",
    });
  });
});

/**
 * THE CANONICAL KEY ORDER, PINNED (#12 of the 2026-08-07 audit).
 *
 * `KEY_ORDER` is derived by `Object.keys` over per-kind `Record<keyof …Record, true>`
 * tables, so the TYPE now catches the omission the module's own comment admitted it could
 * not — a field added to `OrderPlacedRecord` and forgotten no longer compiles. What a type
 * cannot catch is the other half: `Object.keys` returns the TABLE's insertion order, so a
 * key moved (or a new one appended in the wrong place) still typechecks while every line
 * written after it changes shape. Round-tripping an append-only file is byte-equality, so
 * the sequence is behavior and is asserted here rather than trusted to the table's layout.
 *
 * Synthetic throughout: invented pair, round sizes, round prices.
 */
describe("serializeOrderRecord emits the canonical key order", () => {
  const emittedKeys = (line: string): string[] => Object.keys(JSON.parse(line) as object);

  it("writes every `orderPlaced` key, descriptors and partial included, in order", () => {
    const placed: OrderPlacedRecord = {
      id: "rung-synthetic",
      observedAt: "2026-01-01T09:30:00",
      kind: "orderPlaced",
      currency: "USD",
      symbol: "SYNTH/USD",
      side: "buy",
      price: 100,
      quantity: 2,
      orderType: "limit",
      timeInForce: "GTC",
      triggerPrice: 95,
      observedFilledQuantity: 1,
      fundingReserveId: "reserve-synthetic",
    };
    expect(emittedKeys(serializeOrderRecord(placed))).toEqual([
      "id",
      "observedAt",
      "kind",
      "currency",
      "symbol",
      "side",
      "price",
      "quantity",
      "orderType",
      "timeInForce",
      "triggerPrice",
      "observedFilledQuantity",
      "fundingReserveId",
    ]);
  });

  it("drops the absent optionals of an `orderPlaced` line without disturbing the rest", () => {
    const bare: OrderPlacedRecord = {
      id: "rung-synthetic",
      observedAt: "2026-01-01T09:30:00",
      kind: "orderPlaced",
      currency: "USD",
      symbol: "SYNTH/USD",
      side: "buy",
      price: 100,
      quantity: 2,
      fundingReserveId: "reserve-synthetic",
    };
    expect(emittedKeys(serializeOrderRecord(bare))).toEqual([
      "id",
      "observedAt",
      "kind",
      "currency",
      "symbol",
      "side",
      "price",
      "quantity",
      "fundingReserveId",
    ]);
  });

  it("writes the three state-change kinds in order", () => {
    expect(
      emittedKeys(
        serializeOrderRecord({
          id: "rung-synthetic",
          observedAt: "2026-01-01T09:30:00",
          kind: "orderCancelled",
          currency: "USD",
        }),
      ),
    ).toEqual(["id", "observedAt", "kind", "currency"]);

    expect(
      emittedKeys(
        serializeOrderRecord({
          id: "rung-synthetic",
          observedAt: "2026-01-01T09:30:00",
          kind: "orderFilled",
          currency: "USD",
          filledQuantity: 2,
        }),
      ),
    ).toEqual(["id", "observedAt", "kind", "currency", "filledQuantity"]);

    // The observation line is only constructible through its constructor — the compile-time
    // witness makes an object literal of the right shape unassignable — so it is built here.
    const built = buildOrderFillObserved({
      id: "rung-synthetic",
      observedAt: "2026-01-01T09:30:00",
      currency: "USD",
      observedFilledQuantity: 1,
    });
    expect(built.status).toBe("ok");
    if (built.status !== "ok") return;
    // FIVE KEYS, and no trace of the type-only witness: the symbol is excluded from the
    // table deliberately, so a line on disk never carries it.
    expect(emittedKeys(serializeOrderRecord(built.record))).toEqual([
      "id",
      "observedAt",
      "kind",
      "currency",
      "observedFilledQuantity",
    ]);
  });
});
