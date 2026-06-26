import { readFileSync } from "node:fs";
import {
  buildDashboardDetail,
  buildCompositionReport,
  formatCompositionReport,
  parseFundReview,
  validationSeverityByCode,
  type FundReviewData,
} from "./index.js";
import { describe, expect, it } from "vitest";

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

describe("@numisma/engine buildCompositionReport", () => {
  it("covers canonical live-only composition behavior from generated fixtures", () => {
    const report = buildCompositionReport(parseFixture(makeCanonicalFixture()));

    expect(report.totals).toEqual({
      baseCurrency: "USD",
      fundValueUsd: 1000,
      usdMxn: 20,
    });
    expect(report.excluded).toEqual({
      nonLive: 2,
      invalid: 2,
      shortDeferred: 0,
    });
    expect(report.warnings.map((warning) => warning.code)).toEqual([
      "unsupported-currency",
      "invalid-position-number",
    ]);

    expect(sectionRows(report, "portfolios")).toEqual([
      {
        id: "portfolio:core",
        kind: "portfolio",
        label: "Core",
        usdValue: 550,
        percentOfFund: 55,
        costBasisUsd: 200,
        unrealizedPnlUsd: 100,
      },
      {
        id: "portfolio:tactical",
        kind: "portfolio",
        label: "Tactical",
        usdValue: 450,
        percentOfFund: 45,
        costBasisUsd: 200,
      },
    ]);

    expect(sectionRows(report, "tempos")).toEqual([
      {
        id: "tempo:Reserve",
        kind: "tempo",
        label: "Reserve",
        usdValue: 500,
        percentOfFund: 50,
      },
      {
        id: "tempo:Capital",
        kind: "tempo",
        label: "Capital",
        usdValue: 300,
        percentOfFund: 30,
        costBasisUsd: 200,
        unrealizedPnlUsd: 100,
      },
      {
        id: "tempo:Liquid",
        kind: "tempo",
        label: "Liquid",
        usdValue: 150,
        percentOfFund: 15,
        costBasisUsd: 100,
        unrealizedPnlUsd: 50,
      },
      {
        id: "tempo:Foresight",
        kind: "tempo",
        label: "Foresight",
        usdValue: 50,
        percentOfFund: 5,
        costBasisUsd: 100,
        unrealizedPnlUsd: -50,
      },
    ]);

    expect(sectionRows(report, "accounts")).toEqual([
      {
        id: "account:xtb-usd",
        kind: "account",
        label: "XTB: Main Broker",
        usdValue: 550,
        percentOfFund: 55,
        costBasisUsd: 200,
        unrealizedPnlUsd: 100,
      },
      {
        id: "account:bitso-mxn",
        kind: "account",
        label: "BITSO: MXN Reserve",
        usdValue: 300,
        percentOfFund: 30,
        costBasisUsd: 100,
        unrealizedPnlUsd: -50,
      },
      {
        id: "account:binance-usd",
        kind: "account",
        label: "BINANCE: Liquid Desk",
        usdValue: 150,
        percentOfFund: 15,
        costBasisUsd: 100,
        unrealizedPnlUsd: 50,
      },
    ]);

    expect(sectionRows(report, "instruments")).toEqual([
      {
        id: "instrument:reserve",
        kind: "instrument",
        label: "Reserve",
        usdValue: 500,
        percentOfFund: 50,
      },
      {
        id: "instrument:aapl-usd",
        kind: "instrument",
        label: "AAPL (Apple Inc.)",
        usdValue: 300,
        percentOfFund: 30,
        costBasisUsd: 200,
        unrealizedPnlUsd: 100,
      },
      {
        id: "instrument:btc-usd",
        kind: "instrument",
        label: "BTC (Bitcoin)",
        usdValue: 150,
        percentOfFund: 15,
        costBasisUsd: 100,
        unrealizedPnlUsd: 50,
      },
      {
        id: "instrument:cemex-mxn",
        kind: "instrument",
        label: "CEMEXCPO (Cemex)",
        usdValue: 50,
        percentOfFund: 5,
        costBasisUsd: 100,
        unrealizedPnlUsd: -50,
      },
    ]);

    expect(report.dashboard.summary).toMatchObject({
      fundName: "Main Fund",
      asOf: "2026-05-28",
      fundValueUsd: 1000,
      usdMxn: 20,
      largestPortfolio: {
        rowId: "portfolio:core",
        kind: "portfolio",
      },
      largestTempo: {
        rowId: "tempo:Reserve",
        kind: "tempo",
      },
      largestAccount: {
        rowId: "account:xtb-usd",
        kind: "account",
      },
      largestInstrument: {
        rowId: "instrument:reserve",
        kind: "instrument",
      },
      reserve: {
        rowId: "tempo:Reserve",
        kind: "tempo",
      },
      dataSafety: {
        nonLiveExcluded: 2,
        invalidExcluded: 2,
        shortDeferredExcluded: 0,
        hasWarnings: true,
      },
    });
  });

  it("excludes missing references from canonical totals and classifies them as warnings", () => {
    const fixture = makeCanonicalFixture();
    fixture.positions.push({
      id: "ghost-position",
      portfolioId: "missing-portfolio",
      tempo: "Capital",
      executionMode: "live",
      accountId: "missing-account",
      instrumentId: "missing-instrument",
      direction: "long",
      quantity: 5,
      averageCost: 10,
      markPrice: 20,
      currency: "USD",
    });

    const report = buildCompositionReport(parseFixture(fixture));

    expect(report.totals.fundValueUsd).toBe(1000);
    expect(report.excluded.invalid).toBe(3);
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-portfolio", severity: "warning", recordId: "ghost-position" }),
        expect.objectContaining({ code: "missing-account", severity: "warning", recordId: "ghost-position" }),
        expect.objectContaining({ code: "missing-instrument", severity: "warning", recordId: "ghost-position" }),
      ]),
    );
    expect(sectionRows(report, "instruments").map((row) => row.id)).not.toContain(
      "instrument:missing-instrument",
    );
    expect(sectionRows(report, "portfolios").map((row) => row.id)).not.toContain(
      "portfolio:missing-portfolio",
    );
  });

  it("covers warning vocabulary for unsupported values, invalid numerics, and unsafe totals", () => {
    const fixture = cloneFixture(makeCanonicalFixture());
    fixture.reserves = [
      {
        id: "reserve-bad-mode",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "demo" as FundReviewData["reserves"][number]["executionMode"],
        accountId: "xtb-usd",
        currency: "USD",
        amount: 100,
      },
      {
        id: "reserve-bad-amount",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "USD",
        amount: Number.NaN,
      },
      {
        id: "reserve-currency-mismatch",
        portfolioId: "tactical",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "bitso-mxn",
        currency: "USD",
        amount: 50,
      },
    ] as FundReviewData["reserves"];
    fixture.positions = [
      {
        id: "position-bad-currency",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        quantity: 1,
        averageCost: 100,
        markPrice: 110,
        currency: "EUR" as FundReviewData["positions"][number]["currency"],
      },
      {
        id: "position-bad-direction",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "flat" as FundReviewData["positions"][number]["direction"],
        quantity: 1,
        averageCost: 100,
        markPrice: 110,
        currency: "USD",
      },
      {
        id: "position-bad-number",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        quantity: 1,
        averageCost: 100,
        markPrice: Number.NaN,
        currency: "USD",
      },
    ] as FundReviewData["positions"];

    const report = buildCompositionReport(parseFixture(fixture));

    expect(report.totals.fundValueUsd).toBe(0);
    expect(report.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "unsupported-execution-mode",
        "invalid-amount",
        "currency-mismatch",
        "unsupported-currency",
        "unsupported-direction",
        "invalid-position-number",
        "non-positive-fund-value",
      ]),
    );
  });

  it("excludes deferred short positions with a visible count", () => {
    const fixture = makeCanonicalFixture();
    fixture.positions.push({
      id: "btc-short",
      portfolioId: "tactical",
      tempo: "Pulse",
      executionMode: "live",
      accountId: "binance-usd",
      instrumentId: "btc-usd",
      direction: "short",
      quantity: 1,
      averageCost: 150,
      markPrice: 100,
      currency: "USD",
    });

    const report = buildCompositionReport(parseFixture(fixture));

    expect(report.excluded.shortDeferred).toBe(1);
    expect(report.totals.fundValueUsd).toBe(1000);
    expect(validationSeverityByCode["short-deferred"]).toBe("warning");
    expect(formatCompositionReport(report)).toContain(
      "Short direction: 1 deferred short record(s) excluded",
    );
  });

  it("keeps the weekly-review-first formatted layout ahead of detailed tables", () => {
    const report = buildCompositionReport(parseFixture(makeCanonicalFixture()));
    const formatted = formatCompositionReport(report);

    expect(formatted.indexOf("Weekly Review Focus")).toBeGreaterThan(-1);
    expect(formatted.indexOf("Weekly Review Focus")).toBeLessThan(
      formatted.indexOf("Portfolio Composition"),
    );
    expect(formatted).toContain("Data safety: 2 non-live excluded; 2 invalid excluded; warnings shown below");
  });

  it("builds dashboard detail rows from the canonical engine model", () => {
    const data = parseFixture(makeCanonicalFixture());
    const report = buildCompositionReport(data);

    expect(buildDashboardDetail(data, report, "portfolio:tactical")).toMatchObject({
      rowId: "portfolio:tactical",
      kind: "portfolio",
      label: "Tactical",
      rows: [
        {
          kind: "position",
          recordLabel: "BTC (Bitcoin)",
          tempoLabel: "Liquid",
          accountLabel: "BINANCE: Liquid Desk",
          usdValue: 150,
        },
        {
          kind: "position",
          recordLabel: "CEMEXCPO (Cemex)",
          tempoLabel: "Foresight",
          accountLabel: "BITSO: MXN Reserve",
          usdValue: 50,
        },
      ],
    });

    expect(buildDashboardDetail(data, report, "tempo:Reserve")).toMatchObject({
      rowId: "tempo:Reserve",
      kind: "tempo",
      rows: [
        { kind: "reserve", recordLabel: "Reserve", usdValue: 250 },
        { kind: "reserve", recordLabel: "Reserve", usdValue: 250 },
      ],
    });

    expect(buildDashboardDetail(data, report, "account:bitso-mxn")).toMatchObject({
      rowId: "account:bitso-mxn",
      kind: "account",
      rows: [
        { kind: "reserve", recordLabel: "Reserve", usdValue: 250 },
        { kind: "position", recordLabel: "CEMEXCPO (Cemex)", usdValue: 50 },
      ],
    });

    expect(buildDashboardDetail(data, report, "instrument:reserve")).toBeUndefined();
  });

  it("attributes per-tier P&L from Lots and converts cost basis at entry FX", () => {
    // Two tiers of one instrument with DIFFERENT costs (50 vs 80) prove the
    // model is a per-Lot join, not a "one cost + tier-quantity split" shortcut.
    // The c1 Lot also carries an entry FX (25) distinct from the review FX (20),
    // proving cost basis converts at acquisition rate while value uses review.
    const data = parseFixture({
      fund: { id: "fx-fund", name: "FX Fund", baseCurrency: "USD" },
      review: { asOf: "2026-06-25", usdMxn: 20 },
      portfolios: [{ id: "core", name: "Core" }],
      accounts: [
        { id: "gbm-mxn", name: "Casa de Bolsa", platform: "GBM", currency: "MXN" },
      ],
      instruments: [
        { id: "cemex-mxn", name: "Cemex", symbol: "CEMEXCPO", currency: "MXN" },
      ],
      reserves: [],
      positions: [
        {
          id: "cemex-house-money",
          portfolioId: "core",
          tempo: "Capital",
          executionMode: "live",
          accountId: "gbm-mxn",
          instrumentId: "cemex-mxn",
          direction: "long",
          markPrice: 100,
          currency: "MXN",
          lots: [
            { quantity: 10, cost: 50, tier: "c1", entryFx: 25 },
            { quantity: 10, cost: 80, tier: "c2" },
          ],
        },
      ],
    });

    const report = buildCompositionReport(data);

    expect(report.dashboard.summary.totalUnrealizedPnlUsd).toBe(40);
    expect(sectionRows(report, "tiers")).toEqual([
      {
        id: "tier:c1",
        kind: "tier",
        label: "c1",
        usdValue: 50,
        percentOfFund: 50,
        costBasisUsd: 20,
        unrealizedPnlUsd: 30,
      },
      {
        id: "tier:c2",
        kind: "tier",
        label: "c2",
        usdValue: 50,
        percentOfFund: 50,
        costBasisUsd: 40,
        unrealizedPnlUsd: 10,
      },
    ]);
  });

  it("attributes tiered cash Reserves into the Capital Tier rollup, untiered cash stays out", () => {
    // A cash Lot is degenerate: value == cost, Price P&L == 0. Two tiered
    // Reserves (USD + MXN) contribute to the tier rollup; an untiered Reserve
    // opts out, so the tier total deliberately sits below the fund total.
    const data = parseFixture({
      fund: { id: "cash-fund", name: "Cash Fund", baseCurrency: "USD" },
      review: { asOf: "2026-06-25", usdMxn: 20 },
      portfolios: [{ id: "core", name: "Core" }],
      accounts: [
        { id: "xtb-usd", name: "Broker", platform: "XTB", currency: "USD" },
        { id: "bitso-mxn", name: "MXN Cash", platform: "BITSO", currency: "MXN" },
      ],
      instruments: [],
      reserves: [
        {
          id: "tiered-usd",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "xtb-usd",
          currency: "USD",
          amount: 1000,
          lots: [
            { quantity: 600, tier: "c1" },
            { quantity: 400, tier: "c2" },
          ],
        },
        {
          id: "untiered-usd",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "xtb-usd",
          currency: "USD",
          amount: 500,
        },
        {
          id: "tiered-mxn",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "bitso-mxn",
          currency: "MXN",
          amount: 2000,
          lots: [{ quantity: 2000, tier: "c1" }],
        },
      ],
      positions: [],
    });

    const report = buildCompositionReport(data);

    // Fund = 1000 + 500 + (2000 / 20) = 1600; cash carries no P&L.
    expect(report.totals.fundValueUsd).toBe(1600);
    expect(report.dashboard.summary.totalUnrealizedPnlUsd).toBe(0);
    expect(report.warnings).toEqual([]);

    expect(sectionRows(report, "tiers")).toEqual([
      {
        id: "tier:c1",
        kind: "tier",
        label: "c1",
        usdValue: 700, // 600 USD + 2000 MXN / 20
        percentOfFund: 43.75,
        costBasisUsd: 700,
      },
      {
        id: "tier:c2",
        kind: "tier",
        label: "c2",
        usdValue: 400,
        percentOfFund: 25,
        costBasisUsd: 400,
      },
    ]);

    // Untiered cash ($500) keeps the tier rollup honestly below 100% of fund.
    const tierTotal = sectionRows(report, "tiers").reduce(
      (sum, row) => sum + row.usdValue,
      0,
    );
    expect(tierTotal).toBe(1100);
    expect(tierTotal).toBeLessThan(report.totals.fundValueUsd);
  });

  it("warns when Reserve Lot tiers do not reconcile to amount, keeping amount authoritative", () => {
    const data = parseFixture({
      fund: { id: "cash-fund", name: "Cash Fund", baseCurrency: "USD" },
      review: { asOf: "2026-06-25", usdMxn: 20 },
      portfolios: [{ id: "core", name: "Core" }],
      accounts: [
        { id: "xtb-usd", name: "Broker", platform: "XTB", currency: "USD" },
      ],
      instruments: [],
      reserves: [
        {
          id: "blended-usd",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "xtb-usd",
          currency: "USD",
          amount: 579.88,
          // Approximate source split: sums to 580.00, 0.12 over the balance.
          lots: [
            { quantity: 453, tier: "c1" },
            { quantity: 127, tier: "c2" },
          ],
        },
      ],
      positions: [],
    });

    const report = buildCompositionReport(data);

    const mismatch = report.warnings.filter(
      (warning) => warning.code === "reserve-lot-sum-mismatch",
    );
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]).toMatchObject({
      code: "reserve-lot-sum-mismatch",
      severity: "warning",
      recordId: "blended-usd",
    });
    expect(validationSeverityByCode["reserve-lot-sum-mismatch"]).toBe("warning");

    // amount stays authoritative for fund value; the split is taken as-given.
    expect(report.totals.fundValueUsd).toBe(579.88);
    expect(sectionRows(report, "tiers").map((row) => row.usdValue)).toEqual([453, 127]);
  });

  it("treats Reserve Lot sums within a cent of amount as reconciling (no warning)", () => {
    const data = parseFixture({
      fund: { id: "cash-fund", name: "Cash Fund", baseCurrency: "USD" },
      review: { asOf: "2026-06-25", usdMxn: 20 },
      portfolios: [{ id: "core", name: "Core" }],
      accounts: [
        { id: "xtb-usd", name: "Broker", platform: "XTB", currency: "USD" },
      ],
      instruments: [],
      reserves: [
        {
          id: "rounded-usd",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "xtb-usd",
          currency: "USD",
          amount: 3763.48682758,
          lots: [
            { quantity: 968.5, tier: "c1" },
            { quantity: 2794.99, tier: "c2" },
          ],
        },
      ],
      positions: [],
    });

    const report = buildCompositionReport(data);
    expect(report.warnings).toEqual([]);
  });

  it("derives a sorted price journey with Price P&L from the Close series", () => {
    const report = buildCompositionReport(loadSanitizedRealisticFixture());

    const btc = report.priceJourneys.find((journey) => journey.instrumentId === "btc-usd");
    expect(btc).toMatchObject({
      label: "BTC (Bitcoin)",
      currency: "USD",
      firstPrice: 115340,
      latestPrice: 100000,
      changeAbs: -15340,
    });
    expect(btc?.points.map((point) => point.asOf)).toEqual([
      "2026-05-08",
      "2026-05-15",
      "2026-05-22",
      "2026-05-29",
    ]);
    expect(btc?.changePct).toBeCloseTo(-13.30, 2);

    // Instruments with fewer than two anchors are not a journey.
    expect(report.priceJourneys.map((journey) => journey.instrumentId).sort()).toEqual([
      "aapl-usd",
      "btc-usd",
      "eth-usd",
    ]);
  });

  it("returns no price journeys when the review records no Close history", () => {
    const report = buildCompositionReport(parseFixture(makeCanonicalFixture()));
    expect(report.priceJourneys).toEqual([]);
  });

  it("pins the sanitized realistic fixture as the stable canonical answer", () => {
    const report = buildCompositionReport(loadSanitizedRealisticFixture());

    expect(canonicalSnapshot(report)).toEqual({
      totals: {
        baseCurrency: "USD",
        fundValueUsd: 10340,
        usdMxn: 17.31,
      },
      excluded: {
        nonLive: 1,
        invalid: 1,
        shortDeferred: 0,
      },
      warnings: [{ code: "missing-instrument", recordId: "sol-binance-invalid" }],
      summary: {
        fundValueUsd: 10340,
        totalUnrealizedPnlUsd: 399,
        largestPortfolio: "portfolio:core",
        largestTempo: "tempo:Capital",
        largestAccount: "account:xtb-usd",
        largestInstrument: "instrument:btc-usd",
        reserve: "tempo:Reserve",
        dataSafety: {
          nonLiveExcluded: 1,
          invalidExcluded: 1,
          shortDeferredExcluded: 0,
          hasWarnings: true,
        },
      },
      sections: {
        portfolios: [
          {
            id: "portfolio:core",
            usdValue: 6220,
            percentOfFund: 60.154739,
            costBasisUsd: 5040,
            unrealizedPnlUsd: 260,
          },
          {
            id: "portfolio:tactical",
            usdValue: 4120,
            percentOfFund: 39.845261,
            costBasisUsd: 3061,
            unrealizedPnlUsd: 139,
          },
        ],
        tempos: [
          {
            id: "tempo:Capital",
            usdValue: 3090,
            percentOfFund: 29.883946,
            costBasisUsd: 3016,
            unrealizedPnlUsd: 74,
          },
          {
            id: "tempo:Wealth",
            usdValue: 2950,
            percentOfFund: 28.529981,
            costBasisUsd: 2696,
            unrealizedPnlUsd: 254,
          },
          {
            id: "tempo:Reserve",
            usdValue: 1840,
            percentOfFund: 17.794971,
            costBasisUsd: undefined,
            unrealizedPnlUsd: undefined,
          },
          {
            id: "tempo:Liquid",
            usdValue: 1150,
            percentOfFund: 11.121857,
            costBasisUsd: 1077.5,
            unrealizedPnlUsd: 72.5,
          },
          {
            id: "tempo:Pulse",
            usdValue: 750,
            percentOfFund: 7.253385,
            costBasisUsd: 784.5,
            unrealizedPnlUsd: -34.5,
          },
          {
            id: "tempo:Foresight",
            usdValue: 560,
            percentOfFund: 5.415861,
            costBasisUsd: 527,
            unrealizedPnlUsd: 33,
          },
        ],
        accounts: [
          {
            id: "account:xtb-usd",
            usdValue: 2270,
            percentOfFund: 21.953578,
            costBasisUsd: 1510,
            unrealizedPnlUsd: 140,
          },
          {
            id: "account:t1-usd",
            usdValue: 2100,
            percentOfFund: 20.309478,
            costBasisUsd: 1896,
            unrealizedPnlUsd: 204,
          },
          {
            id: "account:binance-usd",
            usdValue: 1710,
            percentOfFund: 16.537718,
            costBasisUsd: 1289.5,
            unrealizedPnlUsd: 60.5,
          },
          {
            id: "account:bingx-usd",
            usdValue: 1270,
            percentOfFund: 12.282398,
            costBasisUsd: 932.5,
            unrealizedPnlUsd: 17.5,
          },
          {
            id: "account:gbm-usd",
            usdValue: 950,
            percentOfFund: 9.187621,
            costBasisUsd: 982,
            unrealizedPnlUsd: -32,
          },
          {
            id: "account:t2-usd",
            usdValue: 900,
            percentOfFund: 8.704062,
            costBasisUsd: 882,
            unrealizedPnlUsd: 18,
          },
          {
            id: "account:bitget-usd",
            usdValue: 540,
            percentOfFund: 5.222437,
            costBasisUsd: 312,
            unrealizedPnlUsd: -12,
          },
          {
            id: "account:bitso-usd",
            usdValue: 300,
            percentOfFund: 2.901354,
            costBasisUsd: 297,
            unrealizedPnlUsd: 3,
          },
          {
            id: "account:bitso-mxn",
            usdValue: 300,
            percentOfFund: 2.901354,
            costBasisUsd: undefined,
            unrealizedPnlUsd: undefined,
          },
        ],
        instruments: [
          {
            id: "instrument:btc-usd",
            usdValue: 3500,
            percentOfFund: 33.84913,
            costBasisUsd: 3373,
            unrealizedPnlUsd: 127,
          },
          {
            id: "instrument:eth-usd",
            usdValue: 2400,
            percentOfFund: 23.210832,
            costBasisUsd: 2236,
            unrealizedPnlUsd: 164,
          },
          {
            id: "instrument:reserve",
            usdValue: 1840,
            percentOfFund: 17.794971,
            costBasisUsd: undefined,
            unrealizedPnlUsd: undefined,
          },
          {
            id: "instrument:aapl-usd",
            usdValue: 850,
            percentOfFund: 8.220503,
            costBasisUsd: 800,
            unrealizedPnlUsd: 50,
          },
          {
            id: "instrument:googl-usd",
            usdValue: 510,
            percentOfFund: 4.932302,
            costBasisUsd: 480,
            unrealizedPnlUsd: 30,
          },
          {
            id: "instrument:rivn-usd",
            usdValue: 310,
            percentOfFund: 2.998066,
            costBasisUsd: 260,
            unrealizedPnlUsd: 50,
          },
          {
            id: "instrument:tsla-usd",
            usdValue: 260,
            percentOfFund: 2.514507,
            costBasisUsd: 230,
            unrealizedPnlUsd: 30,
          },
          {
            id: "instrument:intc-usd",
            usdValue: 240,
            percentOfFund: 2.321083,
            costBasisUsd: 310,
            unrealizedPnlUsd: -70,
          },
          {
            id: "instrument:sbux-usd",
            usdValue: 230,
            percentOfFund: 2.224371,
            costBasisUsd: 220,
            unrealizedPnlUsd: 10,
          },
          {
            id: "instrument:nke-usd",
            usdValue: 200,
            percentOfFund: 1.934236,
            costBasisUsd: 192,
            unrealizedPnlUsd: 8,
          },
        ],
        tiers: [
          {
            id: "tier:c1",
            usdValue: 8100,
            percentOfFund: 78.336557,
            costBasisUsd: 7717,
            unrealizedPnlUsd: 383,
          },
          {
            id: "tier:c2",
            usdValue: 400,
            percentOfFund: 3.868472,
            costBasisUsd: 384,
            unrealizedPnlUsd: 16,
          },
        ],
      },
    });
  });
});

function parseFixture(value: unknown): FundReviewData {
  const parsed = parseFundReview(value);
  expect(parsed.kind).toBe("ok");
  if (parsed.kind !== "ok") {
    throw new Error(`Expected generated fixture to parse, got ${parsed.kind}`);
  }
  return parsed.value;
}

function cloneFixture<T>(value: T): T {
  return structuredClone(value);
}

function loadSanitizedRealisticFixture(): FundReviewData {
  return parseFixture(
    JSON.parse(
      readFileSync(
        new URL("../tests/fixtures/sanitized-realistic-fund-review.json", import.meta.url),
        "utf8",
      ),
    ),
  );
}

function canonicalSnapshot(report: ReturnType<typeof buildCompositionReport>) {
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

function roundSnapshotNumber(value: number, decimals = 2): number {
  return Number(value.toFixed(decimals));
}

function sectionRows(
  report: ReturnType<typeof buildCompositionReport>,
  sectionId: "portfolios" | "tempos" | "accounts" | "instruments" | "tiers",
) {
  return report.dashboard.sections.find((section) => section.id === sectionId)?.rows ?? [];
}

function makeCanonicalFixture() {
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
        quantity: 2,
        averageCost: 100,
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
        quantity: 1,
        averageCost: 100,
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
        quantity: 100,
        averageCost: 20,
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
        quantity: 1,
        averageCost: 100,
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
        quantity: 1,
        averageCost: 100,
        markPrice: Number.NaN,
        currency: "USD",
      },
    ],
  } as unknown as FundReviewData & {
    reserves: Array<FundReviewData["reserves"][number] | { currency: "CAD"; amount: number }>;
  };
}
