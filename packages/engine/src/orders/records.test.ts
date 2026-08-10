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
 * `observedAt` IS SELECTED ON, so ADR-004's general rule reaches it — *a field that is
 * selected on must sort as a string in the same order it sorts in time.*
 *
 * The amendment exempts `observedAt` from the class's `YYYY-MM-DD` requirement, and that
 * exemption is about GRANULARITY and holds: a fixed-width, zero-padded second-granular
 * stamp satisfies the rule rather than waiving it. What it never covered is the ROUND
 * TRIP. Every case below matches the shape regex exactly and is still a lie about time —
 * `2026-02-30T…` sorts as February and means March 2; `…T99:99:99` sorts after every
 * real time of its day. Both would silently answer "what was resting on date X" with the
 * wrong set, which is the whole failure the format exists to prevent.
 *
 * Synthetic throughout: invented pair, round sizes, round prices.
 */
describe("observedAt is a real calendar date and time, not merely the right shape", () => {
  const record = (observedAt: string) => ({
    id: "rung-synthetic",
    observedAt,
    kind: "orderCancelled",
    currency: "USD",
  });

  const MALFORMED = {
    status: "skip",
    problem: "malformed",
    message: "observedAt must be YYYY-MM-DDTHH:MM:SS, a real calendar date and time",
  };

  it("refuses a calendar overflow that would sort a month early", () => {
    expect(parseOrderRecord(record("2026-02-30T09:30:00"))).toEqual(MALFORMED);
    expect(parseOrderRecord(record("2025-02-29T09:30:00"))).toEqual(MALFORMED);
    expect(parseOrderRecord(record("2026-13-01T09:30:00"))).toEqual(MALFORMED);
  });

  it("refuses an out-of-range time that would sort after every real time that day", () => {
    expect(parseOrderRecord(record("2026-01-01T99:99:99"))).toEqual(MALFORMED);
    expect(parseOrderRecord(record("2026-01-01T24:00:00"))).toEqual(MALFORMED);
    expect(parseOrderRecord(record("2026-01-01T09:60:00"))).toEqual(MALFORMED);
  });

  it("admits the real boundaries — the narrowing rejects lies, not legitimate stamps", () => {
    // Midnight, the last second of a day, a genuine end-of-month and a real leap day all
    // have to survive, or the rule would cost the operator correct lines.
    for (const stamp of [
      "2026-01-01T00:00:00",
      "2026-01-31T23:59:59",
      "2024-02-29T12:00:00",
      "2026-06-30T15:08:02",
    ]) {
      expect(parseOrderRecord(record(stamp))).toMatchObject({ status: "ok" });
    }
  });

  /**
   * THE REFUSAL HAS TO NAME THE RULE IT APPLIED. The narrowing landed on the predicate and
   * on the reader's sentence only; three producer messages went on saying
   * `YYYY-MM-DDTHH:MM:SS` alone, which `2026-02-30T09:30:00` satisfies. The operator was
   * quoted their own string and told it broke a rule it kept, with the impossible date
   * never named — so they retype a stamp that was already the right shape.
   *
   * Asserted as a SUBSTRING of the calendar clause, and deliberately not against the
   * exported phrase: comparing to the constant that gets interpolated would pass no matter
   * what either side said.
   */
  const claim = (observedAt: string) => ({
    id: "rung-synthetic",
    observedAt,
    currency: "USD" as const,
    observedFilledQuantity: 1,
  });

  it("names the calendar rule when the PRODUCER refuses, not the shape rule alone", () => {
    const built = buildOrderFillObserved(claim("2026-02-30T09:30:00"));
    expect(built.status).toBe("refused");
    expect(built.status === "refused" && built.message).toContain(
      "a real calendar date and time",
    );
  });

  // The range-checked half, at the one producer site where it is cheapest to reach: this is
  // a pure call, so the same coverage costs no harness. `99:99:99` matches the shape and
  // sorts after every real time of its day.
  it("names the same rule for an out-of-range TIME, which the shape also admits", () => {
    const built = buildOrderFillObserved(claim("2026-01-01T99:99:99"));
    expect(built.status).toBe("refused");
    expect(built.status === "refused" && built.message).toContain(
      "a real calendar date and time",
    );
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
