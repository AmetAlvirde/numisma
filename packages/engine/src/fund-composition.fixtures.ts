import { readFileSync } from "node:fs";
import { expect } from "vitest";
import {
  buildCompositionReport,
  parseFundReview,
  type FundReviewData,
  type PositionLot,
} from "./index.js";

export function parseFixture(value: unknown): FundReviewData {
  const parsed = parseFundReview(value);
  expect(parsed.kind).toBe("ok");
  if (parsed.kind !== "ok") {
    throw new Error(`Expected generated fixture to parse, got ${parsed.kind}`);
  }
  return parsed.value;
}

export function cloneFixture<T>(value: T): T {
  return structuredClone(value);
}

export function loadSanitizedRealisticFixture(): FundReviewData {
  return parseFixture(
    JSON.parse(
      readFileSync(
        new URL("../tests/fixtures/sanitized-realistic-fund-review.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}

export function loadCashGenealogyFixture(): FundReviewData {
  return parseFixture(
    JSON.parse(
      readFileSync(
        new URL("../tests/fixtures/sanitized-cash-genealogy-review.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}

export function canonicalSnapshot(report: ReturnType<typeof buildCompositionReport>) {
  return {
    totals: report.totals,
    excluded: report.excluded,
    warnings: report.warnings.map(({ code, recordId }) => ({ code, recordId })),
    summary: {
      fundValueUsd: roundSnapshotNumber(report.dashboard.summary.fundValueUsd),
      totalUnrealizedPnlUsd: roundSnapshotNumber(
        report.dashboard.summary.totalUnrealizedPnlUsd,
      ),
      largestPortfolio: report.dashboard.summary.largestPortfolio?.rowId,
      largestTempo: report.dashboard.summary.largestTempo?.rowId,
      largestAccount: report.dashboard.summary.largestAccount?.rowId,
      largestInstrument: report.dashboard.summary.largestInstrument?.rowId,
      reserve: report.dashboard.summary.reserve?.rowId,
      dataSafety: report.dashboard.summary.dataSafety,
    },
    sections: Object.fromEntries(
      report.dashboard.sections.map((section) => [
        section.id,
        section.rows.map((row) => ({
          id: row.id,
          usdValue: roundSnapshotNumber(row.usdValue),
          percentOfFund: roundSnapshotNumber(row.percentOfFund, 6),
          costBasisUsd:
            row.costBasisUsd === undefined
              ? undefined
              : roundSnapshotNumber(row.costBasisUsd),
          unrealizedPnlUsd:
            row.unrealizedPnlUsd === undefined
              ? undefined
              : roundSnapshotNumber(row.unrealizedPnlUsd),
        })),
      ]),
    ),
  };
}

export function roundSnapshotNumber(value: number, decimals = 2): number {
  return Number(value.toFixed(decimals));
}

export function sectionRows(
  report: ReturnType<typeof buildCompositionReport>,
  sectionId: "portfolios" | "tempos" | "accounts" | "instruments" | "tiers",
) {
  return report.dashboard.sections.find((section) => section.id === sectionId)?.rows ?? [];
}

export function singlePositionReview(lots: PositionLot[], markPrice: number) {
  return {
    fund: { id: "single-fund", name: "Single Fund", baseCurrency: "USD" },
    review: { asOf: "2026-06-25", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "xtb-usd", name: "Broker", platform: "XTB", currency: "USD" }],
    instruments: [{ id: "aapl-usd", name: "Apple", symbol: "AAPL", currency: "USD" }],
    reserves: [],
    positions: [
      {
        id: "aapl-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        markPrice,
        currency: "USD",
        lots,
      },
    ],
  };
}

export function priceJourneyReview(opts: {
  markPrice?: number;
  closes: Array<{ instrumentId: string; asOf: string; price: number }>;
}) {
  return {
    fund: { id: "pj-fund", name: "Price Journey Fund", baseCurrency: "USD" },
    review: { asOf: "2026-06-25", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "xtb-usd", name: "Broker", platform: "XTB", currency: "USD" }],
    instruments: [
      { id: "aapl-usd", name: "Apple", symbol: "AAPL", currency: "USD" },
      { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
    ],
    reserves: [],
    positions: [
      {
        id: "aapl-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        markPrice: opts.markPrice ?? 200,
        currency: "USD",
        lots: [{ quantity: 1, cost: 100, tier: "c1" }],
      },
    ],
    closes: opts.closes,
  };
}

export function emptyFundReview(): FundReviewData {
  return parseFixture({
    fund: { id: "empty-fund", name: "Empty Fund", baseCurrency: "USD" },
    review: { asOf: "2026-06-25", usdMxn: 20 },
    portfolios: [],
    accounts: [],
    instruments: [],
    reserves: [],
    positions: [],
  });
}

export function makeCanonicalFixture() {
  return {
    fund: {
      id: "fund-1",
      name: "Main Fund",
      baseCurrency: "USD",
    },
    review: {
      asOf: "2026-05-28",
      usdMxn: 20,
    },
    portfolios: [
      { id: "core", name: "Core" },
      { id: "tactical", name: "Tactical" },
    ],
    accounts: [
      {
        id: "xtb-usd",
        name: "Main Broker",
        platform: "XTB",
        currency: "USD",
      },
      {
        id: "bitso-mxn",
        name: "MXN Reserve",
        platform: "BITSO",
        currency: "MXN",
      },
      {
        id: "binance-usd",
        name: "Liquid Desk",
        platform: "BINANCE",
        currency: "USD",
      },
    ],
    instruments: [
      {
        id: "aapl-usd",
        name: "Apple Inc.",
        symbol: "AAPL",
        currency: "USD",
      },
      {
        id: "btc-usd",
        name: "Bitcoin",
        symbol: "BTC",
        currency: "USD",
      },
      {
        id: "cemex-mxn",
        name: "Cemex",
        symbol: "CEMEXCPO",
        currency: "MXN",
      },
    ],
    reserves: [
      {
        id: "reserve-usd-live",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "USD",
        amount: 250,
      },
      {
        id: "reserve-mxn-live",
        portfolioId: "tactical",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "bitso-mxn",
        currency: "MXN",
        amount: 5000,
      },
      {
        id: "reserve-paper",
        portfolioId: "tactical",
        tempo: "Reserve",
        executionMode: "paper",
        accountId: "bitso-mxn",
        currency: "MXN",
        amount: 2000,
      },
      {
        id: "reserve-invalid-currency",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "CAD",
        amount: 10,
      },
    ],
    positions: [
      {
        id: "aapl-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
        markPrice: 150,
        currency: "USD",
      },
      {
        id: "btc-liquid",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        lots: [{ quantity: 1, cost: 100, tier: "c1" }],
        markPrice: 150,
        currency: "USD",
      },
      {
        id: "cemex-foresight",
        portfolioId: "tactical",
        tempo: "Foresight",
        executionMode: "live",
        accountId: "bitso-mxn",
        instrumentId: "cemex-mxn",
        direction: "long",
        lots: [{ quantity: 100, cost: 20, tier: "c1" }],
        markPrice: 10,
        currency: "MXN",
      },
      {
        id: "btc-paper",
        portfolioId: "tactical",
        tempo: "Pulse",
        executionMode: "paper",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        lots: [{ quantity: 1, cost: 100, tier: "c1" }],
        markPrice: 100,
        currency: "USD",
      },
      {
        id: "aapl-invalid-mark",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        lots: [{ quantity: 1, cost: 100, tier: "c1" }],
        markPrice: Number.NaN,
        currency: "USD",
      },
    ],
  } as unknown as FundReviewData & {
    reserves: Array<FundReviewData["reserves"][number] | { currency: "CAD"; amount: number }>;
  };
}
