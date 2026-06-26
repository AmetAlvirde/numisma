// Exhaustive coverage of `parseFundReview`'s blocking validation branches.
// `fund-composition.test.ts` covers the happy path and a representative handful
// of failures; this file walks every remaining `validate*`/`require*` error
// return so the parser's rejection behavior is guarded branch-by-branch rather
// than inferred. Each case mutates a known-valid base into exactly one defect.
import { parseFundReview } from "./index.js";
import { describe, expect, it } from "vitest";

/** A minimal, known-valid review. Every test clones and breaks one field. */
function validReview() {
  return {
    fund: { id: "fund-1", name: "Main Fund", baseCurrency: "USD" },
    review: { asOf: "2026-05-28", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "acc-1", name: "Broker", platform: "XTB", currency: "USD" }],
    instruments: [{ id: "inst-1", name: "Apple", symbol: "AAPL", currency: "USD" }],
    reserves: [
      {
        id: "reserve-1",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "acc-1",
        currency: "USD",
        amount: 100,
      },
    ],
    positions: [
      {
        id: "position-1",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "acc-1",
        instrumentId: "inst-1",
        direction: "long",
        markPrice: 10,
        currency: "USD",
        lots: [{ quantity: 1, cost: 5, tier: "c1" }],
      },
    ],
  };
}

/** Clone the valid base, apply one mutation, parse. */
function brokenBy(mutate: (review: Record<string, any>) => void): ReturnType<typeof parseFundReview> {
  const review = structuredClone(validReview()) as Record<string, any>;
  mutate(review);
  return parseFundReview(review);
}

describe("parseFundReview — the valid base parses", () => {
  it("accepts the known-valid fixture every other case mutates", () => {
    expect(parseFundReview(validReview())).toMatchObject({ kind: "ok" });
  });
});

describe("parseFundReview — top-level shape", () => {
  it("rejects a non-object top-level value", () => {
    expect(parseFundReview(42)).toMatchObject({ kind: "schema-error", path: "$" });
  });

  it("rejects a missing required array", () => {
    expect(brokenBy((r) => delete r.positions)).toMatchObject({
      kind: "schema-error",
      path: "positions",
    });
  });

  it("rejects a missing fund object", () => {
    expect(brokenBy((r) => (r.fund = 5))).toMatchObject({
      kind: "schema-error",
      path: "fund",
    });
  });

  it("rejects an empty fund id", () => {
    expect(brokenBy((r) => (r.fund.id = ""))).toMatchObject({
      kind: "schema-error",
      path: "fund.id",
    });
  });

  it("rejects an empty fund name", () => {
    expect(brokenBy((r) => (r.fund.name = ""))).toMatchObject({
      kind: "schema-error",
      path: "fund.name",
    });
  });

  it("rejects a missing review object", () => {
    expect(brokenBy((r) => (r.review = 5))).toMatchObject({
      kind: "schema-error",
      path: "review",
    });
  });

  it("rejects a missing review.asOf", () => {
    expect(brokenBy((r) => delete r.review.asOf)).toMatchObject({
      kind: "schema-error",
      path: "review.asOf",
    });
  });
});

describe("parseFundReview — named records (portfolios)", () => {
  it("rejects a non-object record", () => {
    expect(brokenBy((r) => (r.portfolios[0] = 5))).toMatchObject({
      kind: "schema-error",
      path: "portfolios[0]",
    });
  });

  it("rejects an empty record id", () => {
    expect(brokenBy((r) => (r.portfolios[0].id = ""))).toMatchObject({
      kind: "schema-error",
      path: "portfolios[0].id",
    });
  });

  it("rejects an empty record name", () => {
    expect(brokenBy((r) => (r.portfolios[0].name = ""))).toMatchObject({
      kind: "schema-error",
      path: "portfolios[0].name",
    });
  });

  it("rejects a duplicate record id", () => {
    expect(
      brokenBy((r) => r.portfolios.push({ id: "core", name: "Dup" })),
    ).toMatchObject({
      kind: "duplicate-reference-id",
      recordType: "portfolio",
      id: "core",
    });
  });
});

describe("parseFundReview — accounts and instruments", () => {
  it("rejects a missing account platform", () => {
    expect(brokenBy((r) => delete r.accounts[0].platform)).toMatchObject({
      kind: "schema-error",
      path: "accounts[0].platform",
    });
  });

  it("rejects a missing account currency", () => {
    expect(brokenBy((r) => delete r.accounts[0].currency)).toMatchObject({
      kind: "schema-error",
      path: "accounts[0].currency",
    });
  });

  it("rejects a missing instrument symbol", () => {
    expect(brokenBy((r) => delete r.instruments[0].symbol)).toMatchObject({
      kind: "schema-error",
      path: "instruments[0].symbol",
    });
  });

  it("rejects a missing instrument currency", () => {
    expect(brokenBy((r) => delete r.instruments[0].currency)).toMatchObject({
      kind: "schema-error",
      path: "instruments[0].currency",
    });
  });

  it("propagates a named-record failure from accounts", () => {
    expect(brokenBy((r) => (r.accounts[0] = 5))).toMatchObject({
      kind: "schema-error",
      path: "accounts[0]",
    });
  });

  it("propagates a named-record failure from instruments", () => {
    expect(brokenBy((r) => (r.instruments[0] = 5))).toMatchObject({
      kind: "schema-error",
      path: "instruments[0]",
    });
  });
});

describe("parseFundReview — capital record shape (reserves)", () => {
  it("rejects a non-object reserve", () => {
    expect(brokenBy((r) => (r.reserves[0] = 5))).toMatchObject({
      kind: "schema-error",
      path: "reserves[0]",
    });
  });

  it("rejects a missing capital-record field", () => {
    expect(brokenBy((r) => delete r.reserves[0].portfolioId)).toMatchObject({
      kind: "schema-error",
      path: "reserves[0].portfolioId",
    });
  });

  it("rejects a non-numeric reserve amount", () => {
    expect(brokenBy((r) => (r.reserves[0].amount = "lots"))).toMatchObject({
      kind: "schema-error",
      path: "reserves[0].amount",
    });
  });

  it("rejects malformed reserve lots when present", () => {
    expect(
      brokenBy((r) => (r.reserves[0].lots = [{ quantity: "x", tier: "c1" }])),
    ).toMatchObject({
      kind: "schema-error",
      path: "reserves[0].lots[0].quantity",
    });
  });
});

describe("parseFundReview — positions", () => {
  it("rejects a missing instrumentId", () => {
    expect(brokenBy((r) => delete r.positions[0].instrumentId)).toMatchObject({
      kind: "schema-error",
      path: "positions[0].instrumentId",
    });
  });

  it("rejects a missing direction", () => {
    expect(brokenBy((r) => delete r.positions[0].direction)).toMatchObject({
      kind: "schema-error",
      path: "positions[0].direction",
    });
  });

  it("rejects a non-numeric markPrice", () => {
    expect(brokenBy((r) => (r.positions[0].markPrice = "high"))).toMatchObject({
      kind: "schema-error",
      path: "positions[0].markPrice",
    });
  });

  it("rejects a malformed position capital-record shape", () => {
    expect(brokenBy((r) => delete r.positions[0].portfolioId)).toMatchObject({
      kind: "schema-error",
      path: "positions[0].portfolioId",
    });
  });
});

describe("parseFundReview — lots", () => {
  it("rejects an empty lots array", () => {
    expect(brokenBy((r) => (r.positions[0].lots = []))).toMatchObject({
      kind: "schema-error",
      path: "positions[0].lots",
    });
  });

  it("rejects a non-object lot", () => {
    expect(brokenBy((r) => (r.positions[0].lots = [5]))).toMatchObject({
      kind: "schema-error",
      path: "positions[0].lots[0]",
    });
  });

  it("rejects a non-numeric lot cost", () => {
    expect(
      brokenBy((r) => (r.positions[0].lots = [{ quantity: 1, cost: "x", tier: "c1" }])),
    ).toMatchObject({
      kind: "schema-error",
      path: "positions[0].lots[0].cost",
    });
  });

  it("rejects an invalid lot tier", () => {
    expect(
      brokenBy((r) => (r.positions[0].lots = [{ quantity: 1, cost: 5, tier: "c9" }])),
    ).toMatchObject({
      kind: "schema-error",
      path: "positions[0].lots[0].tier",
    });
  });

  it("rejects a non-numeric entryFx when present", () => {
    expect(
      brokenBy(
        (r) =>
          (r.positions[0].lots = [{ quantity: 1, cost: 5, tier: "c1", entryFx: "x" }]),
      ),
    ).toMatchObject({
      kind: "schema-error",
      path: "positions[0].lots[0].entryFx",
    });
  });
});

describe("parseFundReview — optional closes", () => {
  it("rejects a non-array closes", () => {
    expect(brokenBy((r) => (r.closes = 5))).toMatchObject({
      kind: "schema-error",
      path: "closes",
    });
  });

  it("rejects a non-object close", () => {
    expect(brokenBy((r) => (r.closes = [5]))).toMatchObject({
      kind: "schema-error",
      path: "closes[0]",
    });
  });

  it("rejects a missing close instrumentId", () => {
    expect(brokenBy((r) => (r.closes = [{ asOf: "2026-05-28", price: 1 }]))).toMatchObject({
      kind: "schema-error",
      path: "closes[0].instrumentId",
    });
  });

  it("rejects a missing close asOf", () => {
    expect(
      brokenBy((r) => (r.closes = [{ instrumentId: "inst-1", price: 1 }])),
    ).toMatchObject({
      kind: "schema-error",
      path: "closes[0].asOf",
    });
  });

  it("rejects a non-numeric close price", () => {
    expect(
      brokenBy(
        (r) => (r.closes = [{ instrumentId: "inst-1", asOf: "2026-05-28", price: "x" }]),
      ),
    ).toMatchObject({
      kind: "schema-error",
      path: "closes[0].price",
    });
  });

  it("accepts a well-formed closes entry", () => {
    expect(
      brokenBy(
        (r) => (r.closes = [{ instrumentId: "inst-1", asOf: "2026-05-28", price: 9 }]),
      ),
    ).toMatchObject({ kind: "ok" });
  });
});
