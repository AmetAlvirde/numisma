import { readFileSync } from "node:fs";
import {
  buildDashboardDetail,
  buildCompositionReport,
  formatCompositionReport,
  parseFundReview,
  validationSeverityByCode,
  type FundReviewData,
  type PositionLot,
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
      lots: [{ quantity: 5, cost: 10, tier: "c1" }],
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
        lots: [{ quantity: 1, cost: 100, tier: "c1" }],
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
        lots: [{ quantity: 1, cost: 100, tier: "c1" }],
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
        lots: [{ quantity: 1, cost: 100, tier: "c1" }],
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
      lots: [{ quantity: 1, cost: 150, tier: "c1" }],
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

  it("excludes a live Reserve whose Portfolio and Account references are missing", () => {
    const fixture = cloneFixture(makeCanonicalFixture());
    fixture.reserves = [
      {
        id: "reserve-missing-refs",
        portfolioId: "ghost-portfolio",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "ghost-account",
        currency: "USD",
        amount: 100,
      },
    ] as FundReviewData["reserves"];

    const report = buildCompositionReport(parseFixture(fixture));

    expect(report.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "missing-portfolio", recordId: "reserve-missing-refs" }),
        expect.objectContaining({ code: "missing-account", recordId: "reserve-missing-refs" }),
      ]),
    );
    // The reserve is excluded, so no Reserve tempo row exists from it.
    expect(sectionRows(report, "tempos").map((row) => row.id)).not.toContain("tempo:Reserve");
  });

  it("warns and excludes a Position that uses an unsupported Execution Mode", () => {
    const fixture = cloneFixture(makeCanonicalFixture());
    fixture.positions = [
      {
        id: "position-bad-mode",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "demo" as FundReviewData["positions"][number]["executionMode"],
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        lots: [{ quantity: 1, cost: 100, tier: "c1" }],
        markPrice: 110,
        currency: "USD",
      },
    ] as FundReviewData["positions"];

    const report = buildCompositionReport(parseFixture(fixture));

    expect(
      report.warnings.filter(
        (warning) =>
          warning.code === "unsupported-execution-mode" &&
          warning.recordId === "position-bad-mode",
      ),
    ).toHaveLength(1);
    // The bad-mode Position is excluded; the fixture's live Reserves remain.
    expect(report.totals.fundValueUsd).toBe(500);
  });

  it("warns and excludes a Position whose Currency mismatches both Account and Instrument", () => {
    const fixture = cloneFixture(makeCanonicalFixture());
    // A USD Position booked on an MXN Account (bitso-mxn) against an MXN
    // Instrument (cemex-mxn): the Account-currency check and the
    // Instrument-currency check both fire on the same record.
    fixture.positions = [
      {
        id: "position-currency-clash",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "bitso-mxn",
        instrumentId: "cemex-mxn",
        direction: "long",
        lots: [{ quantity: 1, cost: 100, tier: "c1" }],
        markPrice: 110,
        currency: "USD",
      },
    ] as FundReviewData["positions"];

    const report = buildCompositionReport(parseFixture(fixture));

    const mismatch = report.warnings.filter(
      (warning) =>
        warning.code === "currency-mismatch" &&
        warning.recordId === "position-currency-clash",
    );
    expect(mismatch).toHaveLength(2);
    expect(mismatch.map((warning) => warning.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Account bitso-mxn"),
        expect.stringContaining("Instrument cemex-mxn"),
      ]),
    );
    // The mismatched Position is excluded; the fixture's live Reserves remain.
    expect(report.totals.fundValueUsd).toBe(500);
  });

  it("warns and excludes a Position with invalid Lot quantity, cost, or entryFx", () => {
    const fixture = cloneFixture(makeCanonicalFixture());
    // markPrice is valid, isolating the per-Lot numeric checks: one Lot per
    // invalid field so quantity, cost, and entryFx branches all fire at once.
    fixture.positions = [
      {
        id: "position-bad-lots",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        markPrice: 110,
        currency: "USD",
        lots: [
          { quantity: -1, cost: 100, tier: "c1" },
          { quantity: 1, cost: Number.NaN, tier: "c2" },
          { quantity: 1, cost: 100, tier: "c3", entryFx: 0 },
        ],
      },
    ] as FundReviewData["positions"];

    const report = buildCompositionReport(parseFixture(fixture));

    const warn = report.warnings.filter(
      (warning) =>
        warning.code === "invalid-position-number" &&
        warning.recordId === "position-bad-lots",
    );
    expect(warn).toHaveLength(1);
    expect(warn[0]?.message).toContain("quantity");
    expect(warn[0]?.message).toContain("cost");
    expect(warn[0]?.message).toContain("entryFx");
    // The invalid Position is excluded; the fixture's live Reserves remain.
    expect(report.totals.fundValueUsd).toBe(500);
  });

  it("excludes a Position carrying an empty Lot set", () => {
    // `parseFundReview` rejects empty `lots` (schema: non-empty array), so this
    // guards `buildCompositionReport`'s own contract for a caller that builds a
    // `FundReviewData` without parsing — the same direct-construction path the
    // TUI dashboard tests exercise. The Position is dropped as invalid.
    const data: FundReviewData = {
      fund: { id: "f", name: "F", baseCurrency: "USD" },
      review: { asOf: "2026-06-25", usdMxn: 20 },
      portfolios: [{ id: "core", name: "Core" }],
      accounts: [{ id: "xtb-usd", name: "Broker", platform: "XTB", currency: "USD" }],
      instruments: [{ id: "aapl-usd", name: "Apple", symbol: "AAPL", currency: "USD" }],
      reserves: [],
      positions: [
        {
          id: "empty-lots",
          portfolioId: "core",
          tempo: "Capital",
          executionMode: "live",
          accountId: "xtb-usd",
          instrumentId: "aapl-usd",
          direction: "long",
          markPrice: 100,
          currency: "USD",
          lots: [],
        },
      ],
    };

    const report = buildCompositionReport(data);

    expect(report.excluded.invalid).toBe(1);
    const warn = report.warnings.filter(
      (warning) => warning.code === "invalid-position-number",
    );
    expect(warn).toHaveLength(1);
    expect(warn[0]?.message).toContain("lots");
    expect(report.totals.fundValueUsd).toBe(0);
  });

  it("returns no dashboard detail for an unknown row id", () => {
    const data = parseFixture(makeCanonicalFixture());
    const report = buildCompositionReport(data);

    expect(buildDashboardDetail(data, report, "account:does-not-exist")).toBeUndefined();
    expect(buildDashboardDetail(data, report, "totally-unknown")).toBeUndefined();
  });

  it("drills an Account holding only Positions down to its Position lines", () => {
    const data = parseFixture(makeCanonicalFixture());
    const report = buildCompositionReport(data);

    // binance-usd holds one live Position (btc-liquid); its paper sibling is
    // excluded, so the drill-down filters to Positions only (no Reserve lines).
    const detail = buildDashboardDetail(data, report, "account:binance-usd");
    expect(detail).toMatchObject({
      rowId: "account:binance-usd",
      kind: "account",
      rows: [{ kind: "position", recordLabel: "BTC (Bitcoin)", usdValue: 150 }],
    });
    expect(detail?.rows.every((row) => row.kind === "position")).toBe(true);
  });

  it("formats an empty fund with placeholder focuses and empty section bodies", () => {
    const report = buildCompositionReport(emptyFundReview());
    const text = formatCompositionReport(report);

    expect(text).toContain("Largest Portfolio: No live records");
    expect(text).toContain("Reserve: No live records");
    // Empty section bodies render the placeholder row.
    expect(text).toContain("No live records.");
  });

  it("formats data safety as 'no warnings' for a clean report", () => {
    const report = buildCompositionReport(
      parseFixture(singlePositionReview([{ quantity: 1, cost: 100, tier: "c1" }], 150)),
    );

    expect(report.warnings).toEqual([]);
    expect(formatCompositionReport(report)).toContain("; no warnings");
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

  it("keeps an untiered Position (single c1 Lot) byte-identical to the flat-amount path", () => {
    // Dropping the {quantity, averageCost} shim must not change output: the shim
    // mapped a flat amount to exactly one c1 Lot, so a single-c1-Lot Position must
    // produce the market value, cost basis, and P&L the flat path produced on main.
    const quantity = 2;
    const cost = 100;
    const markPrice = 150;
    const report = buildCompositionReport(
      parseFixture(singlePositionReview([{ quantity, cost, tier: "c1" }], markPrice)),
    );

    const marketValue = quantity * markPrice; // 300
    const costBasis = quantity * cost; // 200
    expect(report.totals.fundValueUsd).toBe(marketValue);
    expect(report.dashboard.summary.totalUnrealizedPnlUsd).toBe(marketValue - costBasis);

    const instrument = sectionRows(report, "instruments")[0];
    expect(instrument).toMatchObject({
      usdValue: marketValue,
      costBasisUsd: costBasis,
      unrealizedPnlUsd: marketValue - costBasis,
    });
    // The lone c1 tier line equals the whole untiered Position.
    expect(sectionRows(report, "tiers")).toEqual([
      {
        id: "tier:c1",
        kind: "tier",
        label: "c1",
        usdValue: marketValue,
        percentOfFund: 100,
        costBasisUsd: costBasis,
        unrealizedPnlUsd: marketValue - costBasis,
      },
    ]);
  });

  it("preserves aggregate numbers when a Position is tiered (split into Lots)", () => {
    // Splitting one Lot into several with the same total quantity and cost keeps
    // every non-tier rollup byte-identical; only the tier section changes.
    const markPrice = 150;
    const single = buildCompositionReport(
      parseFixture(singlePositionReview([{ quantity: 4, cost: 100, tier: "c1" }], markPrice)),
    );
    const tiered = buildCompositionReport(
      parseFixture(
        singlePositionReview(
          [
            { quantity: 1, cost: 100, tier: "c1" },
            { quantity: 3, cost: 100, tier: "c2" },
          ],
          markPrice,
        ),
      ),
    );

    for (const section of ["portfolios", "tempos", "accounts", "instruments"] as const) {
      expect(sectionRows(tiered, section)).toEqual(sectionRows(single, section));
    }
    expect(tiered.totals.fundValueUsd).toBe(single.totals.fundValueUsd);
    expect(tiered.dashboard.summary.totalUnrealizedPnlUsd).toBe(
      single.dashboard.summary.totalUnrealizedPnlUsd,
    );
    // The single Position has one c1 tier line; the tiered Position splits into two.
    expect(sectionRows(single, "tiers").map((row) => row.id)).toEqual(["tier:c1"]);
    expect(sectionRows(tiered, "tiers").map((row) => row.id).sort()).toEqual([
      "tier:c1",
      "tier:c2",
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
          amount: 560,
          // Lots sum to 580, $20 over the $560 balance — well beyond the hybrid
          // band (max($0.01, 0.1% × 560) = $0.56): real misallocation, not rounding.
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
    expect(report.totals.fundValueUsd).toBe(560);
    expect(sectionRows(report, "tiers").map((row) => row.usdValue)).toEqual([453, 127]);
  });

  it("reconciles Reserve Lot sums on a hybrid max($0.01, 0.1%) tolerance", () => {
    // One reserve per band edge, all live, so a single report exercises the
    // whole hybrid tolerance: floor on tiny balances, relative band on large
    // ones, and a warning only beyond the band.
    const reserve = (
      id: string,
      amount: number,
      lots: Array<{ quantity: number; tier: "c1" | "c2" | "c3" }>,
    ) => ({
      id,
      portfolioId: "core",
      tempo: "Reserve",
      executionMode: "live" as const,
      accountId: "xtb-usd",
      currency: "USD" as const,
      amount,
      lots,
    });

    const data = parseFixture({
      fund: { id: "cash-fund", name: "Cash Fund", baseCurrency: "USD" },
      review: { asOf: "2026-06-25", usdMxn: 20 },
      portfolios: [{ id: "core", name: "Core" }],
      accounts: [
        { id: "xtb-usd", name: "Broker", platform: "XTB", currency: "USD" },
      ],
      instruments: [],
      reserves: [
        // Tiny balance: 0.1% × 5 = $0.005 < the $0.01 floor, so the floor governs.
        // Gap $0.008 sits under the floor — no warning.
        reserve("floor-ok", 5, [
          { quantity: 3, tier: "c1" },
          { quantity: 2.008, tier: "c2" },
        ]),
        // Same tiny balance, gap $0.02 clears the $0.01 floor — warning.
        reserve("floor-warn", 5, [
          { quantity: 3, tier: "c1" },
          { quantity: 2.02, tier: "c2" },
        ]),
        // Large balance: 0.1% × 1,000,000 = $1,000 band. Gap $500 would trip the
        // old flat $0.01, but is forgiven by the relative band — no warning.
        reserve("relative-ok", 1_000_000, [
          { quantity: 600_000, tier: "c1" },
          { quantity: 400_500, tier: "c2" },
        ]),
        // Same large balance, gap $1,500 clears the $1,000 band — warning.
        reserve("relative-warn", 1_000_000, [
          { quantity: 600_000, tier: "c1" },
          { quantity: 401_500, tier: "c2" },
        ]),
      ],
      positions: [],
    });

    const report = buildCompositionReport(data);

    const mismatches = report.warnings
      .filter((warning) => warning.code === "reserve-lot-sum-mismatch")
      .map((warning) => warning.recordId)
      .sort();
    expect(mismatches).toEqual(["floor-warn", "relative-warn"]);
  });

  it("warns and keeps a Reserve untiered when a Lot quantity is invalid", () => {
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
          id: "negative-qty",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "xtb-usd",
          currency: "USD",
          amount: 300,
          // A negative quantity slipped past schema typing: the Reserve stays
          // untiered (no NaN in the rollup) but the drop is surfaced, not silent.
          lots: [
            { quantity: -100, tier: "c1" },
            { quantity: 400, tier: "c2" },
          ],
        },
        {
          id: "tiered-usd",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "xtb-usd",
          currency: "USD",
          amount: 200,
          lots: [{ quantity: 200, tier: "c1" }],
        },
      ],
      positions: [],
    });

    const report = buildCompositionReport(data);

    const invalid = report.warnings.filter(
      (warning) => warning.code === "invalid-reserve-lot-quantity",
    );
    expect(invalid).toHaveLength(1);
    expect(invalid[0]).toMatchObject({
      code: "invalid-reserve-lot-quantity",
      severity: "warning",
      recordId: "negative-qty",
    });
    expect(validationSeverityByCode["invalid-reserve-lot-quantity"]).toBe("warning");

    // amount stays authoritative for the fund even though the Reserve is untiered.
    expect(report.totals.fundValueUsd).toBe(500);
    // Only the valid Reserve reaches the tier rollup; the invalid one is dropped.
    expect(sectionRows(report, "tiers")).toEqual([
      {
        id: "tier:c1",
        kind: "tier",
        label: "c1",
        usdValue: 200,
        percentOfFund: 40,
        costBasisUsd: 200,
      },
    ]);
  });

  it("preserves aggregate numbers when a Reserve is tiered (split into Lots)", () => {
    const baseReserve = {
      id: "cash-core",
      portfolioId: "core",
      tempo: "Reserve",
      executionMode: "live" as const,
      accountId: "xtb-usd",
      currency: "USD" as const,
      amount: 1000,
    };
    const fixture = {
      fund: { id: "cash-fund", name: "Cash Fund", baseCurrency: "USD" },
      review: { asOf: "2026-06-25", usdMxn: 20 },
      portfolios: [{ id: "core", name: "Core" }],
      accounts: [
        { id: "xtb-usd", name: "Broker", platform: "XTB", currency: "USD" },
      ],
      instruments: [],
      positions: [],
    };

    const untiered = buildCompositionReport(
      parseFixture({ ...fixture, reserves: [baseReserve] }),
    );
    const tiered = buildCompositionReport(
      parseFixture({
        ...fixture,
        reserves: [
          {
            ...baseReserve,
            lots: [
              { quantity: 700, tier: "c1" },
              { quantity: 300, tier: "c2" },
            ],
          },
        ],
      }),
    );

    // Every non-tier rollup is byte-identical; only the tier section changes.
    for (const section of ["portfolios", "tempos", "accounts", "instruments"] as const) {
      expect(sectionRows(tiered, section)).toEqual(sectionRows(untiered, section));
    }
    expect(tiered.totals.fundValueUsd).toBe(untiered.totals.fundValueUsd);
    expect(tiered.dashboard.summary.totalUnrealizedPnlUsd).toBe(
      untiered.dashboard.summary.totalUnrealizedPnlUsd,
    );
    expect(tiered.warnings).toEqual([]);

    // Untiered Reserve contributes nothing to the tier rollup; tiering splits it.
    expect(sectionRows(untiered, "tiers")).toEqual([]);
    expect(sectionRows(tiered, "tiers").map((row) => row.id)).toEqual([
      "tier:c1",
      "tier:c2",
    ]);
  });

  it("rolls the tracked cash-genealogy fixture up end-to-end", () => {
    const report = buildCompositionReport(loadCashGenealogyFixture());

    // Fund = 1000 + (2000 MXN / 20) + 500 + 800 + 300; cash carries no P&L.
    expect(report.totals.fundValueUsd).toBe(2700);
    expect(report.dashboard.summary.totalUnrealizedPnlUsd).toBe(0);

    // Both reserve anomalies surface as warnings; nothing is silently dropped.
    expect(
      report.warnings.map(({ code, recordId }) => ({ code, recordId })).sort(
        (a, b) => a.recordId!.localeCompare(b.recordId!),
      ),
    ).toEqual([
      { code: "invalid-reserve-lot-quantity", recordId: "invalid-qty-usd" },
      { code: "reserve-lot-sum-mismatch", recordId: "mismatch-usd" },
    ]);

    // Tier rollup: c1 = 600 + 100 (MXN) + 500 (mismatch, taken as-given);
    // c2 = 400 + 250 (mismatch). Blended and invalid-quantity reserves stay out.
    expect(sectionRows(report, "tiers")).toEqual([
      {
        id: "tier:c1",
        kind: "tier",
        label: "c1",
        usdValue: 1200,
        percentOfFund: 44.444444444444,
        costBasisUsd: 1200,
      },
      {
        id: "tier:c2",
        kind: "tier",
        label: "c2",
        usdValue: 650,
        percentOfFund: 24.074074074074,
        costBasisUsd: 650,
      },
    ]);

    // Honest partial attribution: the tier total sits below 100% of the fund by
    // the untraced remainder (blended + invalid + the mismatch gap), never normalized.
    const tierTotal = sectionRows(report, "tiers").reduce(
      (sum, row) => sum + row.usdValue,
      0,
    );
    expect(tierTotal).toBe(1850);
    expect(tierTotal).toBeLessThan(report.totals.fundValueUsd);
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

  it("surfaces skipped-close for a Close referencing an unknown Instrument while valid anchors still render", () => {
    const report = buildCompositionReport(
      parseFixture(
        priceJourneyReview({
          closes: [
            { instrumentId: "btc-usd", asOf: "2026-05-08", price: 100 },
            { instrumentId: "btc-usd", asOf: "2026-05-15", price: 110 },
            { instrumentId: "ghost-usd", asOf: "2026-05-15", price: 5 },
          ],
        }),
      ),
    );

    const skipped = report.warnings.filter((w) => w.code === "skipped-close");
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.recordId).toBe("ghost-usd");
    expect(skipped[0]?.severity).toBe("warning");

    // The unknown anchor is dropped, but its valid siblings still render.
    const btc = report.priceJourneys.find((j) => j.instrumentId === "btc-usd");
    expect(btc?.points.map((p) => p.asOf)).toEqual(["2026-05-08", "2026-05-15"]);
  });

  it("surfaces skipped-close for invalid Close scalars and still builds the journey from the remaining valid anchors", () => {
    const report = buildCompositionReport(
      parseFixture(
        priceJourneyReview({
          closes: [
            { instrumentId: "btc-usd", asOf: "2026-05-08", price: 100 },
            { instrumentId: "btc-usd", asOf: "2026-05-15", price: -1 }, // invalid price
            { instrumentId: "btc-usd", asOf: "not-a-date", price: 130 }, // invalid date
            { instrumentId: "btc-usd", asOf: "2026-05-22", price: 120 },
          ],
        }),
      ),
    );

    const skipped = report.warnings.filter((w) => w.code === "skipped-close");
    expect(skipped).toHaveLength(2);
    expect(skipped.every((w) => w.recordId === "btc-usd")).toBe(true);

    // A dropped/invalid anchor does not block the journey: it renders from the
    // two valid anchors that remain.
    const btc = report.priceJourneys.find((j) => j.instrumentId === "btc-usd");
    expect(btc?.points.map((p) => p.asOf)).toEqual(["2026-05-08", "2026-05-22"]);
    expect(btc?.firstPrice).toBe(100);
    expect(btc?.latestPrice).toBe(120);
    expect(btc?.changeAbs).toBe(20);
  });

  it("fires markprice-close-mismatch per-position when markPrice diverges from the latest Close beyond tolerance, without altering valuation", () => {
    const report = buildCompositionReport(
      parseFixture(
        priceJourneyReview({
          markPrice: 210,
          closes: [{ instrumentId: "aapl-usd", asOf: "2026-05-29", price: 200 }],
        }),
      ),
    );

    const mismatch = report.warnings.filter(
      (w) => w.code === "markprice-close-mismatch",
    );
    expect(mismatch).toHaveLength(1);
    expect(mismatch[0]?.recordId).toBe("aapl-core");
    expect(mismatch[0]?.severity).toBe("warning");

    // markPrice (210) stays the authoritative P&L input; the Close (200) is
    // display-only and never drives valuation: one unit ⇒ fund value 210.
    expect(report.totals.fundValueUsd).toBe(210);
  });

  it("does not fire markprice-close-mismatch when markPrice and the latest Close agree within tolerance", () => {
    const report = buildCompositionReport(
      parseFixture(
        priceJourneyReview({
          markPrice: 200.5,
          closes: [{ instrumentId: "aapl-usd", asOf: "2026-05-29", price: 200 }],
        }),
      ),
    );

    expect(
      report.warnings.filter((w) => w.code === "markprice-close-mismatch"),
    ).toHaveLength(0);
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

function loadCashGenealogyFixture(): FundReviewData {
  return parseFixture(
    JSON.parse(
      readFileSync(
        new URL("../tests/fixtures/sanitized-cash-genealogy-review.json", import.meta.url),
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

function singlePositionReview(lots: PositionLot[], markPrice: number) {
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

function priceJourneyReview(opts: {
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

function emptyFundReview(): FundReviewData {
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
