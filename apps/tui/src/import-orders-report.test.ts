/**
 * THE COUNTING RULE, ASSERTED DIRECTLY — the reason `report` left `import-orders.ts`.
 *
 * Every fact below was reachable before only through a whole import: an export file, a
 * sidecar, an injected clock, a prompt answered, a funding guard satisfied. The rule is a
 * pure function of what landed, so it is tested as one — no stub, no IO bag, no temp dir.
 *
 * The observation lines are built through `buildOrderFillObserved` rather than by object
 * literal, because that is the only way to obtain one: the record type carries a
 * compile-time brand precisely so an unvalidated figure cannot be passed off as observed.
 */
import {
  buildOrderFillObserved,
  type BitgetRowSkip,
  type OrderFillObservedRecord,
  type OrderPlacedRecord,
} from "@numisma/engine";
import { describe, expect, it } from "vitest";
import { reportOrdersImport, type OrdersImportReportInput } from "./import-orders-report.js";

const CSV = "/tmp/bitget-open-orders.csv";

function placed(id: string): OrderPlacedRecord {
  return {
    id,
    observedAt: "2026-08-07T10:00:00",
    kind: "orderPlaced",
    currency: "USD",
    symbol: "BTCUSDT",
    side: "buy",
    price: 100,
    quantity: 2,
    fundingReserveId: "cash-core",
  };
}

function observedLine(id: string, observedFilledQuantity: number): OrderFillObservedRecord {
  const built = buildOrderFillObserved({
    id,
    observedAt: "2026-08-07T12:00:00",
    currency: "USD",
    observedFilledQuantity,
  });
  if (built.status !== "ok") {
    throw new Error(`fixture is not buildable: ${built.message}`);
  }
  return built.record;
}

function skip(problem: BitgetRowSkip["problem"], line: number): BitgetRowSkip {
  return { line, problem, message: `row ${line} is ${problem}` };
}

/** The empty import, for a test to override exactly the field it is about. */
function input(overrides: Partial<OrdersImportReportInput> = {}): OrdersImportReportInput {
  return {
    written: [],
    placements: [],
    knownFigures: new Map(),
    pickedDifferences: new Map(),
    skips: [],
    csvPath: CSV,
    ...overrides,
  };
}

describe("reportOrdersImport", () => {
  it("counts `appended` over ORDERS ONLY — never the length of what was written", () => {
    // The #181 defect in one line: the two numbers were the same until an import could
    // write a second kind, and a build that counts lines reports observations as orders.
    const { outcome } = reportOrdersImport(
      input({
        written: [placed("a"), observedLine("b", 3), placed("c"), observedLine("d", 4)],
        placements: [placed("a"), placed("c")],
        knownFigures: new Map([
          ["b", 1],
          ["d", 2],
        ]),
      }),
    );
    expect(outcome.appended).toBe(2);
  });

  it("reports `alreadyKnown` as what the batch PROPOSED less what landed", () => {
    // Three placements went in, one was already on file under the same id saying the same
    // thing, so the append filter dropped it. Both halves of that subtraction are counted
    // here, from the array, which is why `placements` is not passed as a number.
    const { outcome } = reportOrdersImport(
      input({
        written: [placed("a"), placed("b")],
        placements: [placed("a"), placed("b"), placed("c")],
      }),
    );
    expect(outcome.appended).toBe(2);
    expect(outcome.alreadyKnown).toBe(1);
  });

  it("derives observations from the WRITTEN lines, joined to the decision's old figure", () => {
    const { outcome } = reportOrdersImport(
      input({
        written: [observedLine("rung-1", 5)],
        knownFigures: new Map([["rung-1", 2]]),
      }),
    );
    expect(outcome.observations).toEqual([{ id: "rung-1", known: 2, observed: 5 }]);
  });

  it("NEVER REPORTS A DECIDED OBSERVATION THAT DID NOT LAND (#181)", () => {
    // The defect this rebuild exists to fix. The decision proposed two restatements and
    // the append filter let one through — a repeat of a figure already on file dedupes —
    // and the operator must be told about the one on disk, not the one that was decided.
    const { outcome, message } = reportOrdersImport(
      input({
        written: [observedLine("landed", 5)],
        knownFigures: new Map([
          ["landed", 2],
          ["dropped", 3],
        ]),
      }),
    );
    expect(outcome.observations).toEqual([{ id: "landed", known: 2, observed: 5 }]);
    expect(message).toContain("1 observation(s) recorded");
    expect(message).not.toContain("dropped");
  });

  it("DROPS a written observation with no decision behind it rather than defaulting it", () => {
    // Unreachable by construction, and the behaviour on reaching it is still decided:
    // inventing a `known` would print an arithmetic nobody performed — `filled 0 → 5` for
    // a rung whose old figure this build never read.
    const { outcome, message } = reportOrdersImport(
      input({ written: [observedLine("orphan", 5)], knownFigures: new Map() }),
    );
    expect(outcome.observations).toEqual([]);
    expect(message).toContain("0 observation(s) recorded");
    expect(message).not.toContain("OBSERVED —");
  });

  it("RENDERS THE OBSERVATION CLAUSE AT ZERO — a placements-only import still says so", () => {
    // A clause that appears conditionally is two shapes for a reader to learn and two for
    // a test to assert. This is the invariant, locked at the number that tempts an author
    // to hide it.
    const { message } = reportOrdersImport(
      input({ written: [placed("a")], placements: [placed("a")] }),
    );
    expect(message).toBe(
      `Imported ${CSV}: 1 order(s) appended, 0 already known, 0 observation(s) recorded.\n`,
    );
  });

  it("reads `0 order(s) appended` beside a non-zero observation count — the honest pair", () => {
    // The pure-observation import: nothing new claims capital, two rungs claim less. Both
    // numbers are true at once, and the shape that looks like a contradiction is the one
    // that would have to lie to avoid looking like one.
    const { outcome, message } = reportOrdersImport(
      input({
        written: [observedLine("rung-1", 5), observedLine("rung-2", 7)],
        placements: [],
        knownFigures: new Map([
          ["rung-1", 2],
          ["rung-2", 6],
        ]),
      }),
    );
    expect(outcome.appended).toBe(0);
    expect(outcome.observations).toHaveLength(2);
    expect(message).toContain("0 order(s) appended, 0 already known, 2 observation(s) recorded");
  });

  it("weighs skips through `leavesRungUnweighed`, NOT through their count (#184)", () => {
    // A `not-resting` row was read COMPLETELY — the parser's positive finding is that
    // nothing is still claimed — so it must not fire a money-direction alarm about a rung
    // nobody weighed. One genuinely unreadable row rides beside it, and the notice counts
    // one, not two.
    const skips = [skip("not-resting", 4), skip("malformed", 9)];
    const { outcome, message } = reportOrdersImport(
      input({ written: [placed("a")], placements: [placed("a")], skips }),
    );
    expect(message).toContain(`INCOMPLETE — 1 row(s) of ${CSV} could not be read`);
    // Every skip still rides on the outcome; only the ALARM discriminates.
    expect(outcome.skips).toEqual(skips);
  });

  it("stays `imported` when every skip was read completely", () => {
    const { outcome, message } = reportOrdersImport(
      input({
        written: [placed("a")],
        placements: [placed("a")],
        skips: [skip("not-resting", 4)],
      }),
    );
    expect(outcome.status).toBe("imported");
    expect(message).not.toContain("INCOMPLETE");
  });

  it("qualifies to `imported-partial` on a row that left a rung UNWEIGHED", () => {
    for (const problem of ["malformed", "unknown-status", "unknown-quote-currency"] as const) {
      const { outcome } = reportOrdersImport(input({ skips: [skip(problem, 2)] }));
      expect(outcome.status).toBe("imported-partial");
    }
  });

  it("orders the notices unread-rows-first and speaks exactly once", () => {
    // Unread rows lead because they are the one thing we know least about. The counts
    // follow all of them, once — they used to be the whole line, with the notice a suffix
    // in exactly the position an operator skims past.
    const { message } = reportOrdersImport(
      input({
        written: [placed("a"), observedLine("rung-1", 5)],
        placements: [placed("a"), placed("b")],
        knownFigures: new Map([["rung-1", 2]]),
        skips: [skip("malformed", 9)],
      }),
    );
    const lines = message.split("\n");
    expect(lines).toHaveLength(4); // three notice/count lines plus the trailing newline
    expect(lines[0]).toMatch(/^INCOMPLETE — 1 row\(s\)/);
    expect(lines[1]).toMatch(/^OBSERVED — 1 rung\(s\)/);
    expect(lines[1]).toContain("rung-1 (filled 2 → 5)");
    expect(lines[2]).toBe(
      `Imported ${CSV}: 1 order(s) appended, 1 already known, 1 observation(s) recorded.`,
    );
    expect(lines[3]).toBe("");
  });
});
