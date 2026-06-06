import { buildCompositionReport, parseFundReview } from "./index.js";
import { describe, expect, it } from "vitest";

describe("@numisma/engine", () => {
  it("builds the canonical report from the public engine surface", () => {
    const data = parseFundReview({
      fund: {
        id: "fund-1",
        name: "Main Fund",
        baseCurrency: "USD",
      },
      review: {
        asOf: "2026-05-28",
        usdMxn: 17.32,
      },
      portfolios: [{ id: "core", name: "Core" }],
      accounts: [
        {
          id: "xtb",
          name: "Broker",
          platform: "XTB",
          currency: "USD",
        },
      ],
      instruments: [
        {
          id: "aapl",
          name: "Apple Inc.",
          symbol: "AAPL",
          currency: "USD",
        },
      ],
      reserves: [
        {
          id: "reserve-1",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "xtb",
          currency: "USD",
          amount: 500,
        },
      ],
      positions: [
        {
          id: "position-1",
          portfolioId: "core",
          tempo: "Capital",
          executionMode: "live",
          accountId: "xtb",
          instrumentId: "aapl",
          direction: "long",
          quantity: 1,
          averageCost: 180,
          markPrice: 200,
          currency: "USD",
        },
      ],
    });

    const report = buildCompositionReport(data);

    expect(report.totalUsd).toBe(700);
    expect(report.groups.portfolios).toEqual([
      {
        label: "Core",
        usdValue: 700,
        percentOfFund: 100,
        costBasisUsd: 180,
        unrealizedPnlUsd: 20,
      },
    ]);
    expect(report.excludedNonLiveRecords).toBe(0);
    expect(report.excludedInvalidRecords).toBe(0);
  });
});
