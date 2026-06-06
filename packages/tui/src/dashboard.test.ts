import {
  buildCompositionReport,
  buildDashboardDetail,
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
      message: "Review file contains invalid JSON.",
    });

    expect(text).toContain("Could not render Fund composition.");
    expect(text).toContain("Review file contains invalid JSON.");
    expect(text).toContain("Load failed:");
    expect(text).toContain("Data file: /tmp/fund-review.json");
  });
});

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
