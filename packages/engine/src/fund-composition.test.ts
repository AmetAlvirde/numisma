import { buildCompositionReport, formatCompositionReport } from "./index.js";
import { describe, expect, it } from "vitest";
import {
  canonicalSnapshot,
  loadSanitizedRealisticFixture,
  makeCanonicalFixture,
  parseFixture,
  sectionRows,
} from "./fund-composition.fixtures.js";

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

  it("reconciles each live Reserve's native balance and USD value in insertion order (C3)", () => {
    const report = buildCompositionReport(parseFixture(makeCanonicalFixture()));

    // Only the two live, valid reserves appear — the paper reserve and the
    // CAD (unsupported-currency) reserve are excluded, exactly as they are from the
    // composition. Native `balance` is the venue figure (250 USD, 5000 MXN); the
    // USD value converts MXN at the review FX (5000 / 20 = 250). Insertion order,
    // never re-sorted by value.
    expect(report.reserveReconciliation).toEqual([
      {
        reserveId: "reserve-usd-live",
        venueLabel: "XTB: Main Broker",
        currency: "USD",
        balance: 250,
        usdValue: 250,
      },
      {
        reserveId: "reserve-mxn-live",
        venueLabel: "BITSO: MXN Reserve",
        currency: "MXN",
        balance: 5000,
        usdValue: 250,
      },
    ]);

    // The MXN reserve renders its native MX$ balance next to its USD value, so the
    // operator eyeballs the venue's own figure, not just the base-currency total.
    const formatted = formatCompositionReport(report);
    expect(formatted).toMatch(/reserve-mxn-live\b.*BITSO: MXN Reserve.*MX\$5,000\.00.*\$250\.00/);
  });

  it("pins the sanitized realistic fixture as the stable canonical answer", () => {
    const report = buildCompositionReport(loadSanitizedRealisticFixture());

    expect(canonicalSnapshot(report)).toEqual({
      totals: {
        baseCurrency: "USD",
        fundValueUsd: 10859.930675909878,
        usdMxn: 17.31,
      },
      excluded: {
        nonLive: 1,
        invalid: 1,
        shortDeferred: 0,
      },
      warnings: [{ code: "missing-instrument", recordId: "sol-binance-invalid" }],
      summary: {
        fundValueUsd: 10859.93,
        totalUnrealizedPnlUsd: 453.65,
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
            percentOfFund: 57.274767,
            costBasisUsd: 5040,
            unrealizedPnlUsd: 260,
          },
          {
            id: "portfolio:tactical",
            usdValue: 4639.93,
            percentOfFund: 42.725233,
            costBasisUsd: 3526.28,
            unrealizedPnlUsd: 193.65,
          },
        ],
        tempos: [
          {
            id: "tempo:Capital",
            usdValue: 3090,
            percentOfFund: 28.45322,
            costBasisUsd: 3016,
            unrealizedPnlUsd: 74,
          },
          {
            id: "tempo:Wealth",
            usdValue: 2950,
            percentOfFund: 27.164078,
            costBasisUsd: 2696,
            unrealizedPnlUsd: 254,
          },
          {
            id: "tempo:Reserve",
            usdValue: 1840,
            percentOfFund: 16.943018,
          },
          {
            id: "tempo:Liquid",
            usdValue: 1150,
            percentOfFund: 10.589386,
            costBasisUsd: 1077.5,
            unrealizedPnlUsd: 72.5,
          },
          {
            id: "tempo:Foresight",
            usdValue: 1079.93,
            percentOfFund: 9.944177,
            costBasisUsd: 992.28,
            unrealizedPnlUsd: 87.65,
          },
          {
            id: "tempo:Pulse",
            usdValue: 750,
            percentOfFund: 6.906121,
            costBasisUsd: 784.5,
            unrealizedPnlUsd: -34.5,
          },
        ],
        accounts: [
          {
            id: "account:xtb-usd",
            usdValue: 2270,
            percentOfFund: 20.902528,
            costBasisUsd: 1510,
            unrealizedPnlUsd: 140,
          },
          {
            id: "account:t1-usd",
            usdValue: 2100,
            percentOfFund: 19.33714,
            costBasisUsd: 1896,
            unrealizedPnlUsd: 204,
          },
          {
            id: "account:binance-usd",
            usdValue: 1710,
            percentOfFund: 15.745957,
            costBasisUsd: 1289.5,
            unrealizedPnlUsd: 60.5,
          },
          {
            id: "account:bingx-usd",
            usdValue: 1270,
            percentOfFund: 11.694366,
            costBasisUsd: 932.5,
            unrealizedPnlUsd: 17.5,
          },
          {
            id: "account:gbm-usd",
            usdValue: 950,
            percentOfFund: 8.747754,
            costBasisUsd: 982,
            unrealizedPnlUsd: -32,
          },
          {
            id: "account:t2-usd",
            usdValue: 900,
            percentOfFund: 8.287346,
            costBasisUsd: 882,
            unrealizedPnlUsd: 18,
          },
          {
            id: "account:bitso-mxn",
            usdValue: 819.93,
            percentOfFund: 7.550054,
            costBasisUsd: 465.28,
            unrealizedPnlUsd: 54.65,
          },
          {
            id: "account:bitget-usd",
            usdValue: 540,
            percentOfFund: 4.972407,
            costBasisUsd: 312,
            unrealizedPnlUsd: -12,
          },
          {
            id: "account:bitso-usd",
            usdValue: 300,
            percentOfFund: 2.762449,
            costBasisUsd: 297,
            unrealizedPnlUsd: 3,
          },
        ],
        instruments: [
          {
            id: "instrument:btc-usd",
            usdValue: 3500,
            percentOfFund: 32.228567,
            costBasisUsd: 3373,
            unrealizedPnlUsd: 127,
          },
          {
            id: "instrument:eth-usd",
            usdValue: 2400,
            percentOfFund: 22.099589,
            costBasisUsd: 2236,
            unrealizedPnlUsd: 164,
          },
          {
            id: "instrument:reserve",
            usdValue: 1840,
            percentOfFund: 16.943018,
          },
          {
            id: "instrument:aapl-usd",
            usdValue: 850,
            percentOfFund: 7.826938,
            costBasisUsd: 800,
            unrealizedPnlUsd: 50,
          },
          {
            id: "instrument:cemex-mxn",
            usdValue: 519.93,
            percentOfFund: 4.787606,
            costBasisUsd: 465.28,
            unrealizedPnlUsd: 54.65,
          },
          {
            id: "instrument:googl-usd",
            usdValue: 510,
            percentOfFund: 4.696163,
            costBasisUsd: 480,
            unrealizedPnlUsd: 30,
          },
          {
            id: "instrument:rivn-usd",
            usdValue: 310,
            percentOfFund: 2.85453,
            costBasisUsd: 260,
            unrealizedPnlUsd: 50,
          },
          {
            id: "instrument:tsla-usd",
            usdValue: 260,
            percentOfFund: 2.394122,
            costBasisUsd: 230,
            unrealizedPnlUsd: 30,
          },
          {
            id: "instrument:intc-usd",
            usdValue: 240,
            percentOfFund: 2.209959,
            costBasisUsd: 310,
            unrealizedPnlUsd: -70,
          },
          {
            id: "instrument:sbux-usd",
            usdValue: 230,
            percentOfFund: 2.117877,
            costBasisUsd: 220,
            unrealizedPnlUsd: 10,
          },
          {
            id: "instrument:nke-usd",
            usdValue: 200,
            percentOfFund: 1.841632,
            costBasisUsd: 192,
            unrealizedPnlUsd: 8,
          },
        ],
        tiers: [
          {
            id: "tier:c1",
            usdValue: 8100,
            percentOfFund: 74.586111,
            costBasisUsd: 7717,
            unrealizedPnlUsd: 383,
          },
          {
            id: "tier:c2",
            usdValue: 746.62,
            percentOfFund: 6.875002,
            costBasisUsd: 696.5,
            unrealizedPnlUsd: 50.12,
          },
          {
            id: "tier:c3",
            usdValue: 173.31,
            percentOfFund: 1.595869,
            costBasisUsd: 152.78,
            unrealizedPnlUsd: 20.53,
          },
        ],
      },
    });
  });

  it("pins the full formatted composition report on the realistic fixture (characterization)", () => {
    // Full-string oracle for the engine CLI text. Unlike the numeric snapshot
    // above and the `toContain` substring checks, this captures exact rendered
    // content — column widths, padding, and formatUsd/formatPercent precision —
    // so the upcoming formatter dedup is provably behavior-preserving.
    const report = buildCompositionReport(loadSanitizedRealisticFixture());

    expect(formatCompositionReport(report)).toMatchSnapshot();
  });
});
