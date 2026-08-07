/**
 * THE MERGE NOTICE, ASSERTED DIRECTLY — the operator's only word that two export rows
 * sharing one id were summed into a single claim (#174, #221).
 *
 * WHY THIS FILE EXISTS AT ALL: the notice had a test before this one, and most of it did
 * not bite. `import-orders.test.ts`'s "REPORTS the merge to the operator, naming both
 * quantities and the total" asserted `toContain("1")` and `toContain("2")` against a
 * string containing the price `1000` and the stamp `2020-01-01T10:00:00` — so both were
 * satisfied by digits that are not quantities at all. Proved by mutation, not reasoned
 * about: deleting `(${quantities.join(" + ")})` from the renderer left that test green,
 * and so did deleting the symbol and the side outright.
 *
 * THE BAR HERE IS MUTATION, NOT COVERAGE. Every assertion below was run against a
 * renderer mutated to remove the thing that assertion names, and every one of them went
 * red. Anything that survived its own mutation was rewritten until it did not.
 *
 * FIXTURE VALUES ARE CHOSEN TO BE UNCONFUSABLE. The digits of the price, the stamp and
 * the quantities do not overlap by accident here, and the assertions are structural
 * (`ONE claim of 18`, `(7 + 11)`) rather than bare substrings, so neither this file nor
 * a later reader can mistake a coincidence for a claim.
 *
 * ASSERTIONS READ THE FLATTENED STRING. A phrase this file names may straddle a line
 * break once the renderer's prose is wrapped, so `flat()` collapses whitespace runs and
 * every assertion below states a CONTENT rule and nothing about where lines end.
 *
 * THE END-TO-END TEST STAYS. `import-orders.test.ts` keeps the WIRING claim — that a
 * colliding batch produces a merge notice on the `out` channel — which is a fact about
 * `import-orders.ts` and not about this string.
 */
import { describe, expect, it } from "vitest";
import type { MergedOrderClaim } from "@numisma/engine";
import { describeMerge } from "./import-orders-merge-notice.js";

/** Two rows the venue rendered under one id. The shape every fixture in the suite had. */
const TWO_ROWS: MergedOrderClaim = {
  id: "ETHUSDT:sell:1234.5:2020-03-04T05:06:07.000Z",
  price: 1234.5,
  observedAt: "2020-03-04T05:06:07.000Z",
  symbol: "ETHUSDT",
  side: "sell",
  quantities: [7, 11],
  mergedQuantity: 18,
};

/**
 * THREE rows — the case `mergeCollidingClaims` sums ("two or more", an unbounded array)
 * and that no fixture in this repo exercised before #221. It renders a different listing
 * AND a different count, which is exactly why it is here.
 */
const THREE_ROWS: MergedOrderClaim = {
  id: "ETHUSDT:sell:1234.5:2020-03-04T05:06:07.000Z",
  price: 1234.5,
  observedAt: "2020-03-04T05:06:07.000Z",
  symbol: "ETHUSDT",
  side: "sell",
  quantities: [1, 2, 4],
  mergedQuantity: 7,
};

/** Whitespace runs collapsed, so a content assertion is not also a wrapping assertion. */
function flat(notice: string): string {
  return notice.replace(/\s+/g, " ");
}

describe("the arithmetic the operator is owed", () => {
  it("renders BOTH quantities as the sum that was applied, not merely somewhere in the line", () => {
    // The assertion the old e2e test's title claimed and did not make: `toContain("7")`
    // would be satisfied by the stamp's `07`, so the listing is asserted as a listing.
    expect(flat(describeMerge(TWO_ROWS))).toContain("(7 + 11)");
  });

  it("renders THREE quantities as one chain — the unbounded case nothing exercised", () => {
    expect(flat(describeMerge(THREE_ROWS))).toContain("(1 + 2 + 4)");
  });

  it("names the merged total as the size of the single surviving claim", () => {
    // Anchored on `ONE claim of` so a bare `18` elsewhere could not satisfy it.
    expect(flat(describeMerge(TWO_ROWS))).toContain("ONE claim of 18");
    expect(flat(describeMerge(THREE_ROWS))).toContain("ONE claim of 7");
  });

  it("counts the rows, and the count AGREES with the listing it counts", () => {
    // Two fields, rendered a clause apart: `${quantities.length} rows` counts one thing
    // and `(${quantities.join(" + ")})` lists another. Nothing held them together.
    for (const merge of [TWO_ROWS, THREE_ROWS]) {
      const match = /(\d+) rows sharing one id \(([^)]*)\)/.exec(flat(describeMerge(merge)));
      expect(match).not.toBeNull();
      const [, counted, listed] = match ?? [];
      expect(Number(counted)).toBe(merge.quantities.length);
      expect(listed?.split(" + ")).toHaveLength(merge.quantities.length);
    }
  });
});

describe("WHICH claim was merged — the rung has to be identifiable", () => {
  it("names the symbol and the side, adjacent, in the header", () => {
    // Deleting either from the renderer left the old e2e test green. Asserted here as
    // the header they actually form, so neither can go missing unnoticed.
    expect(flat(describeMerge(TWO_ROWS))).toContain("MERGED — ETHUSDT sell at");
  });

  it("names the price the two rows agreed on", () => {
    expect(flat(describeMerge(TWO_ROWS))).toContain("sell at 1234.5,");
  });

  it("names the second the venue stamped, so the collision is locatable in the export", () => {
    expect(flat(describeMerge(TWO_ROWS))).toContain("submitted 2020-03-04T05:06:07.000Z");
  });
});

describe("the remedy, which is the operator's to apply and not ours", () => {
  it("says how to keep two genuinely distinct rungs distinct next time", () => {
    expect(flat(describeMerge(TWO_ROWS))).toContain(
      "re-place one a tick apart so their prices differ",
    );
  });
});

/**
 * THE WRAP BUDGET (#221), the same 100 `import-orders-unattributed-refusal.test.ts`
 * asserts. This notice used to be ONE unbroken ~450-character line, so every terminal
 * soft-wrapped it at a column nothing chose; the prose is now hard-wrapped at 88.
 */
const BUDGET = 100;

/** Every line that does not fit, named with its width — a failure here is a re-wrap job. */
function overWide(notice: string, width = BUDGET): string[] {
  return notice
    .split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.length > width)
    .map(({ line, index }) => `line ${index + 1} (${line.length} cols): ${line}`);
}

describe(`${BUDGET} COLUMNS — nothing measured this line's length before`, () => {
  it(`keeps every line inside ${BUDGET} columns for a realistic collision`, () => {
    expect(overWide(describeMerge(TWO_ROWS))).toEqual([]);
    expect(overWide(describeMerge(THREE_ROWS))).toEqual([]);
  });

  it("keeps the FIXED PROSE inside the budget no matter how wide the claim is", () => {
    // The prose is the part a budget can actually govern, so it is the part asserted.
    // Lines 1-3 are built from the symbol, the stamp and an unbounded `quantities`; no
    // wrap width can promise those fit, and the docstring says so rather than pretending.
    const wide = describeMerge({
      ...TWO_ROWS,
      symbol: "SOMELONGSYMBOL",
      price: 123456.789,
      quantities: [0.1234, 0.2345, 0.3456, 0.4567, 0.5678, 0.6789],
      mergedQuantity: 2.4069,
    });
    expect(overWide(wide.split("\n").slice(3).join("\n"))).toEqual([]);
  });

  it("keeps the TOTAL on its own line, so a wide listing never soft-wraps it away", () => {
    // The reliability claim behind the split: `quantities` is unbounded and the total is
    // not, so the total must not share a line with it. Six rows at four decimals is 113
    // columns of listing — and the total still arrives intact on a line of its own.
    const wide = describeMerge({
      ...TWO_ROWS,
      quantities: [0.1234, 0.2345, 0.3456, 0.4567, 0.5678, 0.6789],
      mergedQuantity: 2.4069,
    });
    expect(wide.split("\n")).toContain("were summed into ONE claim of 2.4069.");
  });
});
