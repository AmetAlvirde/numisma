/**
 * THE OBSERVATION VERB (#181, slice #206) — the record kind and the unified fold.
 *
 * Two seams, and this file is the whole test surface for both: `S-A` the record
 * contract (`./records.ts`) and `S-B` the selector (`./select.ts`). The slice has no
 * operator-facing caller until the import path is re-implemented, which is deliberate —
 * the selector's own interface is what four production adapters already cross, so it is
 * the thing worth pinning, and everything downstream is arithmetic this file either
 * caught or did not.
 *
 * THE THREE DISCRIMINATING CASES are the point. #181's own headline case passes on every
 * fold the design considered and rejected, so on its own it decides nothing; the second
 * and third are what actually pin SET-not-add and order-sensitivity.
 *
 * Synthetic throughout: invented pair, round sizes, round prices. No real rung, price,
 * size or balance appears here.
 */
import { describe, expect, it } from "vitest";
import { committedRungs } from "./committed.js";
import {
  buildOrderFillObserved,
  parseOrderRecord,
  serializeOrderRecord,
  type OrderFillObservedRecord,
  type OrderFilledRecord,
  type OrderPlacedRecord,
  type OrderRecord,
} from "./records.js";
import { pickRestingOrdersAsOf, type RestingOrder } from "./select.js";

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

/**
 * The observation line, built THROUGH THE CONSTRUCTOR — there is no other way to build
 * one, and that is enforced by the compiler rather than by this comment. A test that
 * could hand-roll the literal would be testing a shape the writer cannot actually
 * produce.
 */
function observed(observedAt: string, observedFilledQuantity: number): OrderFillObservedRecord {
  const built = buildOrderFillObserved({
    id: RUNG,
    observedAt,
    currency: "USD",
    observedFilledQuantity,
  });
  if (built.status !== "ok") {
    throw new Error(`fixture refused: ${built.message}`);
  }
  return built.record;
}

function filled(observedAt: string, filledQuantity: number): OrderFilledRecord {
  return { id: RUNG, observedAt, kind: "orderFilled", currency: "USD", filledQuantity };
}

function remainingOf(records: OrderRecord[]): number[] {
  return pickRestingOrdersAsOf(records).map((order) => order.remainingQuantity);
}

describe("S-B the fold — the three discriminating cases, verbatim", () => {
  it("Q10, P2, C6 leaves 4 resting, and the committed figure reads 400", () => {
    const records: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10, 2),
      observed("2026-01-02T10:00:00", 6),
    ];

    const resting = pickRestingOrdersAsOf(records);
    expect(resting.map((order) => order.remainingQuantity)).toEqual([4]);
    // Through the committed-rungs read, not recomputed here: the encumbrance the four
    // TUI shells actually render is what the increment is for.
    expect(committedRungs(resting).map((rung) => rung.committed)).toEqual([400]);
  });

  it("SET SUBSUMES prior fills rather than double-subtracting them: Q10, P2, F3, then C8 leaves 2", () => {
    const records: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10, 2),
      filled("2026-01-02T10:00:00", 3),
      observed("2026-01-03T10:00:00", 8),
    ];

    // A fold that SUBTRACTED the observation would read 10 − 2 − 3 − 8 and go negative.
    // An order-insensitive `Q − max(P + F, C)` also reads 2 here, which is exactly why
    // this case cannot decide the fold on its own — the next one does.
    expect(remainingOf(records)).toEqual([2]);
  });

  it("THE FOLD IS ORDER-SENSITIVE: Q10, P2, C6, THEN F1 leaves 3", () => {
    const records: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10, 2),
      observed("2026-01-02T10:00:00", 6),
      filled("2026-01-03T10:00:00", 1),
    ];

    // THE discriminating assertion. `Q − max(P + F, C)` gives 4 here and 4 is wrong: the
    // observation restated the baseline at 6, and a real fill of 1 consumed one more unit
    // AFTER it. Replayed in `observedAt` order there is exactly one answer, and nothing
    // else in the suite catches a fold that reads 4.
    expect(remainingOf(records)).toEqual([3]);
  });
});

describe("S-B the fold — the no-regression property, asserted rather than assumed", () => {
  /**
   * THE PREVIOUS FOLD, transcribed verbatim from the commit this slice replaces.
   *
   * The claim "a stream with no observation line reads exactly as it did" is worth
   * nothing as prose, and worth nothing as a handful of remembered numbers either. So the
   * old arithmetic is kept here and both folds are run over the same streams, compared as
   * SERIALIZED OUTPUT — byte-identical, not merely numerically close.
   */
  function previousFold(records: OrderRecord[]): RestingOrder[] {
    const eligible = records
      .slice()
      .sort((a, b) => (a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1 : 0));
    const resting = new Map<string, RestingOrder>();
    for (const record of eligible) {
      if (record.kind === "orderPlaced") {
        if (!resting.has(record.id)) {
          const remaining = record.quantity - (record.observedFilledQuantity ?? 0);
          if (remaining > 0) {
            resting.set(record.id, { placed: record, remainingQuantity: remaining });
          }
        }
      } else if (record.kind === "orderCancelled") {
        resting.delete(record.id);
      } else if (record.kind === "orderFilled") {
        const open = resting.get(record.id);
        if (open) {
          const remaining = open.remainingQuantity - record.filledQuantity;
          if (remaining > 0) {
            resting.set(record.id, { placed: open.placed, remainingQuantity: remaining });
          } else {
            resting.delete(record.id);
          }
        }
      }
    }
    return [...resting.values()];
  }

  const cancelled = (observedAt: string) =>
    ({ id: RUNG, observedAt, kind: "orderCancelled", currency: "USD" }) as const;

  const STREAMS: Record<string, OrderRecord[]> = {
    "a bare placement": [placed("2026-01-01T10:00:00", 10)],
    "a placement carrying its own partial": [placed("2026-01-01T10:00:00", 10, 2)],
    "a partial then a fill": [placed("2026-01-01T10:00:00", 10, 2), filled("2026-01-02T10:00:00", 3)],
    "a fill that exhausts the rung": [
      placed("2026-01-01T10:00:00", 10),
      filled("2026-01-02T10:00:00", 10),
    ],
    "two fills that exhaust the rung": [
      placed("2026-01-01T10:00:00", 10),
      filled("2026-01-02T10:00:00", 6),
      filled("2026-01-03T10:00:00", 4),
    ],
    "a cancellation": [placed("2026-01-01T10:00:00", 10, 2), cancelled("2026-01-02T10:00:00")],
    "a repeat placement line of a known id": [
      placed("2026-01-01T10:00:00", 10, 2),
      placed("2026-01-01T10:00:00", 10, 5),
    ],
    "a re-placement after a cancellation": [
      placed("2026-01-01T10:00:00", 10),
      cancelled("2026-01-02T10:00:00"),
      placed("2026-01-03T10:00:00", 10),
    ],
    "a fully-filled placement line": [placed("2026-01-01T10:00:00", 10, 10)],
    "a fill naming an id that was never placed": [filled("2026-01-02T10:00:00", 3)],
    "lines arriving out of file order": [
      filled("2026-01-03T10:00:00", 3),
      placed("2026-01-01T10:00:00", 10, 2),
    ],
    // ORDER OF THE RETURNED LIST, not just the numbers in it. Both folds emit map
    // insertion order, and every caller downstream renders the rungs in the order given.
    "three rungs, one of them partly filled and one cancelled": [
      { ...placed("2026-01-01T10:00:00", 10), id: "rung-a" },
      { ...placed("2026-01-01T10:00:01", 4, 1), id: "rung-b" },
      { ...placed("2026-01-01T10:00:02", 6), id: "rung-c" },
      { ...filled("2026-01-02T10:00:00", 2), id: "rung-a" },
      { id: "rung-c", observedAt: "2026-01-02T10:00:01", kind: "orderCancelled", currency: "USD" },
    ],
  };

  for (const [name, stream] of Object.entries(STREAMS)) {
    it(`reads byte-identically to the previous fold: ${name}`, () => {
      expect(JSON.stringify(pickRestingOrdersAsOf(stream))).toBe(
        JSON.stringify(previousFold(stream)),
      );
    });
  }

  it("DIVERGES on exactly one stream, and the divergence is the relocation", () => {
    // The one place the two folds disagree with no observation line in sight, named
    // rather than discovered later. The old fold DELETED a rung on exhaustion, so a
    // repeat placement line after a full fill found no entry and re-inserted the claim at
    // FULL SIZE — resurrection, silently, off a line the selector otherwise ignores by
    // design. The new fold keeps the rung and its baseline, so the repeat line is ignored
    // as a repeat line always is.
    //
    // Resurrection is RELOCATED by this slice, not introduced: it now happens only where
    // an observation deliberately restates the baseline, and never off a duplicate.
    const stream: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10),
      filled("2026-01-02T10:00:00", 10),
      placed("2026-01-03T10:00:00", 10),
    ];
    expect(previousFold(stream).map((order) => order.remainingQuantity)).toEqual([10]);
    expect(remainingOf(stream)).toEqual([]);
  });
});

describe("S-B the fold — consumed is NOT monotonic, and the fold resurrects deliberately", () => {
  it("an observation BELOW the current baseline takes remaining from zero back to positive", () => {
    const exhausted: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10),
      filled("2026-01-02T10:00:00", 10),
    ];
    expect(remainingOf(exhausted)).toEqual([]);

    // THE PROPERTY, ASSERTED IN THE DIRECTION IT ACTUALLY MATTERS. A hand-authored
    // observation of 3 over a rung with 10 already consumed SETs the baseline back to 3,
    // and 7 units read as resting again. This is intended behaviour of a pure fold, and
    // the reason `remainingQuantity` is a REPORT and not an authorization: what may still
    // be acted on is decided at the fill-admission gate, not here.
    expect(remainingOf([...exhausted, observed("2026-01-03T10:00:00", 3)])).toEqual([7]);
  });

  it("a cancellation retires the rung outright, and nothing later resurrects it", () => {
    const records: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10, 2),
      { id: RUNG, observedAt: "2026-01-02T10:00:00", kind: "orderCancelled", currency: "USD" },
      observed("2026-01-03T10:00:00", 3),
    ];
    // Retirement is the one irreversible step: an observation about a rung that left the
    // book cannot re-place it, because a placement is the only thing that can.
    expect(remainingOf(records)).toEqual([]);
  });
});

describe("S-B the fold — an observation cannot invent a claim", () => {
  it("an observation naming an id that was never placed folds to nothing", () => {
    expect(remainingOf([observed("2026-01-02T10:00:00", 6)])).toEqual([]);
  });

  it("an observation that exhausts the rung retires it", () => {
    expect(
      remainingOf([placed("2026-01-01T10:00:00", 10, 2), observed("2026-01-02T10:00:00", 10)]),
    ).toEqual([]);
  });

  it("an observation after the as-of boundary is not read", () => {
    const records: OrderRecord[] = [
      placed("2026-01-01T10:00:00", 10, 2),
      observed("2026-01-05T10:00:00", 6),
    ];
    expect(pickRestingOrdersAsOf(records, "2026-01-03").map((o) => o.remainingQuantity)).toEqual([
      8,
    ]);
    expect(pickRestingOrdersAsOf(records, "2026-01-05").map((o) => o.remainingQuantity)).toEqual([
      4,
    ]);
  });
});

describe("S-A the record — five keys, byte-equal round trip, required and positive", () => {
  const line = observed("2026-01-02T10:00:00", 6);

  it("round-trips BYTE-EQUAL through the canonical key order", () => {
    const serialized = serializeOrderRecord(line);
    expect(serialized).toBe(
      `{"id":"rung-synthetic","observedAt":"2026-01-02T10:00:00","kind":"orderFillObserved",` +
        `"currency":"USD","observedFilledQuantity":6}`,
    );
    const parsed = parseOrderRecord(JSON.parse(serialized));
    if (parsed.status !== "ok") {
      throw new Error(`expected a record, got ${parsed.problem}: ${parsed.message}`);
    }
    expect(serializeOrderRecord(parsed.record)).toBe(serialized);
    expect(parsed.record).toEqual(line);
  });

  it("carries FIVE keys and NO copy of quantity", () => {
    // Quantity is the one figure nothing may go stale on. A second copy here would
    // manufacture exactly the drift the batch refusal exists to prevent.
    expect(Object.keys(JSON.parse(serializeOrderRecord(line)))).toEqual([
      "id",
      "observedAt",
      "kind",
      "currency",
      "observedFilledQuantity",
    ]);
  });

  it("is a KNOWN kind — never skipped as forward-compatibility noise", () => {
    const parsed = parseOrderRecord(JSON.parse(serializeOrderRecord(line)));
    expect(parsed.status).toBe("ok");
  });

  it("rejects a zero, negative, absent or non-finite figure as MALFORMED — never reads it as zero", () => {
    const base = JSON.parse(serializeOrderRecord(line)) as Record<string, unknown>;
    const bad: Array<[string, Record<string, unknown>]> = [
      ["zero", { ...base, observedFilledQuantity: 0 }],
      ["negative", { ...base, observedFilledQuantity: -1 }],
      ["NaN", { ...base, observedFilledQuantity: Number.NaN }],
      ["Infinity", { ...base, observedFilledQuantity: Number.POSITIVE_INFINITY }],
      ["a string", { ...base, observedFilledQuantity: "6" }],
      ["null", { ...base, observedFilledQuantity: null }],
    ];
    const absent = { ...base };
    delete absent.observedFilledQuantity;
    bad.push(["absent", absent]);

    for (const [name, candidate] of bad) {
      expect(parseOrderRecord(candidate), name).toMatchObject({
        status: "skip",
        problem: "malformed",
      });
    }
  });
});

describe("S-A the record — the TOTAL constructor is the only way in", () => {
  it("refuses a non-positive figure instead of writing a line that reads back malformed", () => {
    // THE DEFECT THIS CLOSES. A `?? 0` fallback over an object literal is a LIVE BRANCH,
    // however it is annotated: a zero serializes cleanly and then reads back as
    // `malformed` on every subsequent load, at which point all four shells refuse to
    // render a committed figure at all. One bad line poisons the readability of the book.
    for (const figure of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        buildOrderFillObserved({
          id: RUNG,
          observedAt: "2026-01-02T10:00:00",
          currency: "USD",
          observedFilledQuantity: figure,
        }).status,
      ).toBe("refused");
    }
  });

  it("refuses a bad stamp BEFORE it reaches an append-only file", () => {
    expect(
      buildOrderFillObserved({
        id: RUNG,
        observedAt: "2026-01-02",
        currency: "USD",
        observedFilledQuantity: 6,
      }).status,
    ).toBe("refused");
  });

  it("refuses an empty id", () => {
    expect(
      buildOrderFillObserved({
        id: "  ",
        observedAt: "2026-01-02T10:00:00",
        currency: "USD",
        observedFilledQuantity: 6,
      }).status,
    ).toBe("refused");
  });

  it("is TOTAL: it answers for every input rather than throwing on some of them", () => {
    expect(() =>
      buildOrderFillObserved({
        id: "",
        observedAt: "nonsense",
        currency: "USD",
        observedFilledQuantity: -1,
      }),
    ).not.toThrow();
  });
});
