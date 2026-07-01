import { buildCompositionReport, validationSeverityByCode } from "./index.js";
import { describe, expect, it } from "vitest";
import {
  loadCashGenealogyFixture,
  parseFixture,
  sectionRows,
  singlePositionReview,
} from "./fund-composition.fixtures.js";

describe("@numisma/engine buildCompositionReport tier rollup", () => {
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
});
