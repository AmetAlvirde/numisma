/**
 * The read-time join of `orders.jsonl` to the fold, and what the TUI renders from it.
 *
 * EVERY FIXTURE IS A SYNTHETIC LADDER (`O7`). No real price, quantity, balance or rung
 * appears here — this repository is public.
 */
import { describe, expect, it } from "vitest";
import { parseFundReview, type FundReviewData, type OrderRecord } from "@numisma/engine";
import type { OrdersLoad } from "@numisma/preferences";
import { loadAvailableCapital } from "./available-capital.js";
import { buildDashboardLines } from "./dashboard.js";
import { buildCompositionReport } from "@numisma/engine";

const RESERVE = "reserve-capital";
const ORDERS_PATH = "/synthetic/orders.jsonl";

function fund(): FundReviewData {
  const parsed = parseFundReview({
    fund: { id: "synthetic-fund", name: "Synthetic Fund", baseCurrency: "USD" },
    review: { asOf: "2026-01-31", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [
      { id: "venue-usd", name: "Synthetic Venue", platform: "BITGET", currency: "USD" },
    ],
    instruments: [{ id: "test-usd", name: "Test Asset", symbol: "TEST", currency: "USD" }],
    reserves: [
      {
        id: RESERVE,
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "venue-usd",
        currency: "USD",
        amount: 1000,
      },
    ],
    positions: [],
  });
  if (parsed.kind !== "ok") throw new Error("synthetic fixture must parse");
  return parsed.value;
}

const LADDER: OrderRecord[] = [
  {
    id: "rung-0",
    observedAt: "2026-01-02T10:00:00",
    kind: "orderPlaced",
    currency: "USD",
    symbol: "TEST/USD",
    side: "buy",
    price: 100,
    quantity: 2,
    fundingReserveId: RESERVE,
  },
  {
    id: "rung-1",
    observedAt: "2026-01-03T10:00:00",
    kind: "orderPlaced",
    currency: "USD",
    symbol: "TEST/USD",
    side: "buy",
    price: 100,
    quantity: 3,
    fundingReserveId: RESERVE,
  },
];

const loaded = (records: OrderRecord[]): OrdersLoad => ({
  status: "loaded",
  path: ORDERS_PATH,
  records,
  skips: [],
});

const io = (load: OrdersLoad) => ({
  ordersPath: ORDERS_PATH,
  loadOrders: async () => load,
});

describe("the sidecar join REFUSES rather than rendering an unencumbered balance", () => {
  it("composes over an ABSENT sidecar — no orders is an honest zero", async () => {
    const section = await loadAvailableCapital(fund(), io({ status: "absent", path: ORDERS_PATH }));
    expect(section.status).toBe("composed");
    if (section.status !== "composed") throw new Error("unreachable");
    expect(section.report.reserves[0]?.committed).toBe(0);
  });

  it("REFUSES an UNREADABLE sidecar — the opposite fact, never collapsed into zero", async () => {
    const section = await loadAvailableCapital(
      fund(),
      io({ status: "unreadable", path: ORDERS_PATH, message: "permission denied" }),
    );
    expect(section.status).toBe("refused");
  });

  it("REFUSES a partially-read sidecar — a skipped line understates encumbrance", async () => {
    const section = await loadAvailableCapital(fund(), {
      ordersPath: ORDERS_PATH,
      loadOrders: async () => ({
        status: "loaded",
        path: ORDERS_PATH,
        records: LADDER,
        skips: [{ line: 3, problem: "malformed", message: "not JSON" }],
      }),
    });
    expect(section.status).toBe("refused");
  });

  it("REFUSES when the loader itself throws", async () => {
    const section = await loadAvailableCapital(fund(), {
      ordersPath: ORDERS_PATH,
      loadOrders: async () => {
        throw new Error("disk fell over");
      },
    });
    expect(section.status).toBe("refused");
  });

  it("passes `asOf` through, so a prior date shows the book AS IT RESTED then", async () => {
    const section = await loadAvailableCapital(fund(), io(loaded(LADDER)), "2026-01-02");
    if (section.status !== "composed") throw new Error("unreachable");
    // Only the first rung had been placed by then.
    expect(section.report.reserves[0]?.rungs).toHaveLength(1);
  });
});

describe("the TUI renders the three numbers AND the rungs beneath them", () => {
  const report = buildCompositionReport(fund(), {
    load: { status: "loaded", sourcePath: "synthetic", loadedAt: "2026-01-31T00:00:00Z" },
  });

  it("renders nothing at all when no capital section is supplied — prior surface intact", () => {
    const withoutSection = buildDashboardLines(report, undefined).map((line) => line.content);
    const withEmpty = buildDashboardLines(report, undefined, undefined, {
      status: "composed",
      report: { reserves: [], unmatched: [] },
    }).map((line) => line.content);
    expect(withEmpty).toEqual(withoutSection);
  });

  it("renders the section header, the reserve and one line per rung", async () => {
    const section = await loadAvailableCapital(fund(), io(loaded(LADDER)));
    if (section.status !== "composed") throw new Error("unreachable");
    const rendered = buildDashboardLines(report, undefined, undefined, section).map(
      (line) => line.content,
    );
    const text = rendered.join("\n");

    expect(text).toContain("Available Capital");
    expect(text).toContain(RESERVE);
    // The substantiation: every resting rung is on screen, named by its own id's symbol
    // and its remaining size, so the operator can eyeball it against the real venue.
    const rungLines = rendered.filter((line) => line.trimStart().startsWith("TEST/USD"));
    expect(rungLines).toHaveLength(LADDER.length);
  });

  it("renders a REFUSAL as a warning, never as silence", async () => {
    const section = await loadAvailableCapital(
      fund(),
      io({ status: "unreadable", path: ORDERS_PATH, message: "permission denied" }),
    );
    const lines = buildDashboardLines(report, undefined, undefined, section);
    const refusal = lines.find((line) => line.content.includes("Available Capital unavailable"));
    expect(refusal?.warning).toBe(true);
  });
});
