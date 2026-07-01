import {
  buildCompositionReport,
  formatCompositionReport,
  validationSeverityByCode,
  type FundReviewData,
} from "./index.js";
import { describe, expect, it } from "vitest";
import {
  cloneFixture,
  makeCanonicalFixture,
  parseFixture,
  sectionRows,
} from "./fund-composition.fixtures.js";

describe("@numisma/engine buildCompositionReport exclusions and warnings", () => {
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
});
