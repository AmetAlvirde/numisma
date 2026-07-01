import {
  buildCompositionReport,
  buildDashboardDetail,
  formatCompositionReport,
} from "./index.js";
import { describe, expect, it } from "vitest";
import {
  emptyFundReview,
  loadSanitizedRealisticFixture,
  makeCanonicalFixture,
  parseFixture,
  priceJourneyReview,
  singlePositionReview,
} from "./fund-composition.fixtures.js";

describe("@numisma/engine buildCompositionReport dashboard and formatting", () => {
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
});
