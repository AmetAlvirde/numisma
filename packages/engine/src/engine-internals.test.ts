// Direct unit tests for the small internal helpers whose guard/edge branches the
// fixture-driven `fund-composition.test.ts` does not reach. These are imported
// from their sibling modules (not the public `index.ts`) on purpose — they are
// internal kernel helpers, and this is the same direct-import seam `parse.ts`
// already relies on. Covers the otherwise-uncovered branches called out in
// docs/coverage-rationale.md.
import { indexById, percentOfFund } from "./internal.js";
import { pad, padLeft } from "./format.js";
import { buildPriceJourneys } from "./price-journey.js";
import type { FundReviewData, Warning } from "./contracts.js";
import { describe, expect, it } from "vitest";

describe("internal.percentOfFund", () => {
  it("returns 0 when the fund value is 0 (no division by zero)", () => {
    expect(percentOfFund(50, 0)).toBe(0);
  });

  it("computes a percentage against a non-zero fund value", () => {
    expect(percentOfFund(25, 100)).toBe(25);
  });
});

describe("internal.indexById", () => {
  it("throws when a record has no id", () => {
    expect(() => indexById([{ id: "", name: "Nameless" }], "account")).toThrowError(
      "Found account without id.",
    );
  });

  it("throws on a duplicate id", () => {
    expect(() =>
      indexById(
        [
          { id: "dup", name: "First" },
          { id: "dup", name: "Second" },
        ],
        "instrument",
      ),
    ).toThrowError("Duplicate instrument id: dup");
  });

  it("indexes well-formed records by id", () => {
    const index = indexById([{ id: "a", name: "A" }], "portfolio");
    expect(index.get("a")).toMatchObject({ name: "A" });
  });
});

describe("format.pad / format.padLeft truncation", () => {
  it("truncates an over-wide value with a trailing tilde", () => {
    expect(pad("abcdef", 4)).toBe("abc~");
  });

  it("pads a short value to the requested width", () => {
    expect(pad("ab", 4)).toBe("ab  ");
  });

  it("hard-truncates an over-wide left-padded value", () => {
    expect(padLeft("abcdef", 4)).toBe("abcd");
  });

  it("left-pads a short value to the requested width", () => {
    expect(padLeft("ab", 4)).toBe("  ab");
  });
});

describe("price-journey.buildPriceJourneys — zero first price", () => {
  it("reports a 0% change when the first anchor price is 0", () => {
    const warnings: Warning[] = [];
    const data = {
      instruments: [{ id: "inst-1", name: "Apple", symbol: "AAPL", currency: "USD" }],
      closes: [
        { instrumentId: "inst-1", asOf: "2026-05-20", price: 0 },
        { instrumentId: "inst-1", asOf: "2026-05-28", price: 10 },
      ],
    } as unknown as FundReviewData;

    const [journey] = buildPriceJourneys(data, warnings);

    expect(journey).toMatchObject({ firstPrice: 0, latestPrice: 10, changePct: 0 });
  });
});
