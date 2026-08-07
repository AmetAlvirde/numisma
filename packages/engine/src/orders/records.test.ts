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
import { parseOrderRecord } from "./records.js";

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
