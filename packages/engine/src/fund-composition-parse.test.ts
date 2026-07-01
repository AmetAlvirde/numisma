import { parseFundReview, type FundReviewData } from "./index.js";
import { describe, expect, it } from "vitest";
import { cloneFixture, makeCanonicalFixture } from "./fund-composition.fixtures.js";

describe("@numisma/engine parseFundReview", () => {
  it("returns typed parse failures for invalid JSON and unsupported top-level values", () => {
    expect(parseFundReview("{")).toMatchObject({
      kind: "invalid-json",
      severity: "blocking",
    });

    expect(
      parseFundReview({
        fund: {
          id: "fund-1",
          name: "Main Fund",
          baseCurrency: "MXN",
        },
        review: {
          asOf: "2026-05-28",
          usdMxn: 20,
        },
        portfolios: [],
        accounts: [],
        instruments: [],
        reserves: [],
        positions: [],
      }),
    ).toMatchObject({
      kind: "unsupported-base-currency",
      severity: "blocking",
      baseCurrency: "MXN",
    });
  });

  it("returns typed schema and FX failures", () => {
    expect(
      parseFundReview({
        fund: {
          id: "fund-1",
          name: "Main Fund",
          baseCurrency: "USD",
        },
        review: {
          asOf: "2026-05-28",
          usdMxn: 0,
        },
        portfolios: [],
        accounts: [],
        instruments: [],
        reserves: [],
        positions: [],
      }),
    ).toMatchObject({
      kind: "invalid-fx-rate",
      severity: "blocking",
      path: "review.usdMxn",
    });

    expect(
      parseFundReview({
        fund: {
          id: "fund-1",
          name: "Main Fund",
          baseCurrency: "USD",
        },
        review: {
          asOf: "2026-05-28",
          usdMxn: 20,
        },
        portfolios: [],
        accounts: [],
        instruments: [],
        reserves: [],
      }),
    ).toMatchObject({
      kind: "schema-error",
      severity: "blocking",
      path: "positions",
    });
  });

  it("blocks malformed dates, duplicate ids, and wrong scalar types", () => {
    const malformedAsOf = cloneFixture(makeCanonicalFixture());
    malformedAsOf.review.asOf = "2026-02-30";
    expect(parseFundReview(malformedAsOf)).toMatchObject({
      kind: "invalid-as-of",
      severity: "blocking",
      path: "review.asOf",
    });

    const duplicatePortfolio = cloneFixture(makeCanonicalFixture());
    duplicatePortfolio.portfolios.push({ id: "core", name: "Duplicate Core" });
    expect(parseFundReview(duplicatePortfolio)).toMatchObject({
      kind: "duplicate-reference-id",
      severity: "blocking",
      recordType: "portfolio",
      id: "core",
    });

    const duplicateCapital = cloneFixture(makeCanonicalFixture());
    duplicateCapital.positions[0] = {
      ...duplicateCapital.positions[0]!,
      id: duplicateCapital.reserves[0]!.id,
    } as FundReviewData["positions"][number];
    expect(parseFundReview(duplicateCapital)).toMatchObject({
      kind: "duplicate-capital-record-id",
      severity: "blocking",
      id: duplicateCapital.reserves[0]!.id,
    });

    const wrongScalarType = cloneFixture(makeCanonicalFixture()) as unknown as {
      accounts: Array<Record<string, unknown>>;
    };
    wrongScalarType.accounts[0] = {
      ...wrongScalarType.accounts[0],
      platform: 123,
    };
    expect(parseFundReview(wrongScalarType)).toMatchObject({
      kind: "schema-error",
      severity: "blocking",
      path: "accounts[0].platform",
    });
  });
});
