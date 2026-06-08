import { readFileSync } from "node:fs";
import {
  buildCompositionReport,
  buildDashboardDetail,
  parseFundReview,
  type FundReviewData,
} from "@numisma/engine";
import {
  buildDashboardLines,
  renderDashboardText,
  renderLoadFailureText,
} from "./dashboard.js";
import { describe, expect, it } from "vitest";

describe("@numisma/tui dashboard rendering", () => {
  it("resolves row actions from structured row ids and renders engine detail rows", () => {
    const data = makeFixture();
    const report = buildCompositionReport(data, {
      load: {
        status: "loaded",
        sourcePath: "/tmp/fund-review.json",
        loadedAt: "2026-06-05T12:34:56.000Z",
      },
    });
    const detail = buildDashboardDetail(data, report, "account:bitso-mxn");
    const lines = buildDashboardLines(report, detail);

    expect(lines.flatMap((line) => line.action?.type === "open-detail" ? [line.action.rowId] : [])).toEqual(
      expect.arrayContaining([
        "portfolio:core",
        "tempo:Reserve",
        "account:xtb-usd",
        "account:bitso-mxn",
      ]),
    );
    expect(lines.flatMap((line) => line.action?.type === "open-detail" ? [line.action.rowId] : [])).not.toContain(
      "instrument:reserve",
    );
    expect(lines.some((line) => line.action?.type === "collapse-detail")).toBe(true);
    expect(lines.some((line) => line.content.includes("Account: BITSO: MXN Reserve"))).toBe(true);
    expect(lines.some((line) => line.content.includes("CEMEXCPO (Cemex)"))).toBe(true);
    expect(lines.some((line) => line.content.includes("Reserve"))).toBe(true);
  });

  it("marks warnings and renders load metadata from report.load", () => {
    const report = buildCompositionReport(makeFixture(), {
      load: {
        status: "loaded",
        sourcePath: "/tmp/fund-review.json",
        loadedAt: "2026-06-05T12:34:56.000Z",
      },
    });
    const lines = buildDashboardLines(report, undefined);
    const text = renderDashboardText(lines, report.load);

    expect(lines.filter((line) => line.warning).map((line) => line.content)).toEqual(
      expect.arrayContaining([
        "!!! WARNINGS !!!",
        "- Position aapl-invalid-mark has invalid markPrice and was excluded.",
      ]),
    );
    expect(text).toContain("Loaded:");
    expect(text).toContain("Data file: /tmp/fund-review.json");
  });

  it("renders reload failure state from LoadOutcome", () => {
    const text = renderLoadFailureText({
      status: "load-failed",
      sourcePath: "/tmp/fund-review.json",
      loadedAt: "2026-06-05T12:34:56.000Z",
      message: "Blocking validation error (invalid-json) in /tmp/fund-review.json: Review file contains invalid JSON.",
    });

    expect(text).toContain("Unsafe render blocked by engine validation.");
    expect(text).toContain("Blocking validation error (invalid-json)");
    expect(text).toContain("Load failed:");
    expect(text).toContain("Data file: /tmp/fund-review.json");
  });

  it("keeps deferred short exclusions visible without rendering warning rows for them", () => {
    const data = makeFixture();
    data.positions.push({
      id: "btc-short",
      portfolioId: "core",
      tempo: "Pulse",
      executionMode: "live",
      accountId: "xtb-usd",
      instrumentId: "aapl-usd",
      direction: "short",
      quantity: 1,
      averageCost: 100,
      markPrice: 50,
      currency: "USD",
    });

    const report = buildCompositionReport(data);
    const lines = buildDashboardLines(report, undefined);
    const warningContents = lines.filter((line) => line.warning).map((line) => line.content);

    expect(lines.some((line) => line.content.includes("1 deferred short record(s) excluded"))).toBe(true);
    expect(warningContents.some((content) => content.toLowerCase().includes("short"))).toBe(false);
  });

  it("smoke-renders the pinned realistic fixture from engine read models", () => {
    const data = loadSanitizedRealisticFixture();
    const report = buildCompositionReport(data, {
      load: {
        status: "loaded",
        sourcePath: "packages/engine/tests/fixtures/sanitized-realistic-fund-review.json",
        loadedAt: "2026-06-05T12:34:56.000Z",
      },
    });
    const detail = buildDashboardDetail(data, report, "account:xtb-usd");
    const lines = buildDashboardLines(report, detail);
    const text = renderDashboardText(lines, report.load);

    expect(detail).toMatchObject({
      rowId: "account:xtb-usd",
      kind: "account",
    });
    expect(detail?.rows.map((row) => row.kind)).toContain("reserve");
    expect(detail?.rows.some((row) => row.recordLabel === "AAPL (Apple Inc.)")).toBe(true);
    expect(detail?.rows.some((row) => row.recordLabel === "TSLA (Tesla Inc.)")).toBe(true);

    const openDetailRowIds = lines.flatMap((line) =>
      line.action?.type === "open-detail" ? [line.action.rowId] : [],
    );
    expect(openDetailRowIds).toEqual(
      report.dashboard.sections.flatMap((section) =>
        section.rows
          .filter((row) => row.kind !== "instrument")
          .map((row) => row.id),
      ),
    );

    expect(text).toContain("Fund: Sanitized Exploratory Fund");
    expect(text).toContain("Weekly Review Focus");
    expect(text).toContain("Portfolio Composition");
    expect(text).toContain("Instrument Composition");
    expect(text).toContain("Selected Row Detail  [enter collapse]");
    expect(text).toContain("Account: XTB: Main Broker");
    expect(text).toContain("!!! WARNINGS !!!");
    expect(text).toContain("- Position sol-binance-invalid references missing Instrument sol-usd and was excluded.");
    expect(text).toContain("Data file: packages/engine/tests/fixtures/sanitized-realistic-fund-review.json");
  });
});

function loadSanitizedRealisticFixture(): FundReviewData {
  const parsed = parseFundReview(
    readFileSync(
      new URL("../../engine/tests/fixtures/sanitized-realistic-fund-review.json", import.meta.url),
      "utf8",
    ),
  );
  expect(parsed.kind).toBe("ok");
  if (parsed.kind !== "ok") {
    throw new Error(`Expected realistic fixture to parse, got ${parsed.kind}`);
  }
  return parsed.value;
}

function makeFixture(): FundReviewData {
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
    ],
    instruments: [
      {
        id: "aapl-usd",
        name: "Apple Inc.",
        symbol: "AAPL",
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
  };
}
