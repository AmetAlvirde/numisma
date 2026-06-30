// Single-source-of-truth tests (ADR-003 slice 4). `pnpm report` (report.ts) now
// renders the FOLD over genesis + log instead of the legacy hand-edited snapshot
// (review-file.ts). Two obligations are locked here:
//   1. Parity: for a known genesis with no events, the fold's read model produces
//      the SAME composition report as the prior snapshot-based path — moving report
//      onto the fold changes nothing for the existing no-event case (the
//      compatibility promise).
//   2. No divergence: once the durable log carries activity, report folds it in, so
//      report and the app derive current holdings from the one source of truth and
//      cannot disagree.
// report.ts is a thin script (resolve paths → parseAsOfArg → loadFoldedReview →
// buildCompositionReport); this exercises that exact pipeline at the function level.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCompositionReport } from "@numisma/engine";
import { ingestInbox, loadFoldedReview, resolveEventStorePaths } from "./event-store.js";
import { loadFundReview } from "./review-file.js";
import { afterEach, describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";

function genesisSeed() {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" }],
    instruments: [
      { id: "aapl-usd", name: "Apple Inc.", symbol: "AAPL", currency: "USD" },
      { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
    ],
    reserves: [
      {
        id: "cash-core",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "USD",
        amount: 1000,
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
        markPrice: 150,
        currency: "USD",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
      },
    ],
  };
}

const DECISION = {
  entryThesis: "thesis",
  invalidationCondition: "invalidation",
  riskBudget: "1R",
  plannedHoldingHorizon: "weeks",
  strategy: "trend",
};

function openBtc() {
  return {
    id: "open-btc",
    asOf: "2026-06-05",
    type: "PositionOpened",
    position: {
      id: "btc-core",
      portfolioId: "core",
      tempo: "Liquid",
      executionMode: "live",
      accountId: "xtb-usd",
      instrumentId: "btc-usd",
      direction: "long",
      currency: "USD",
      lots: [{ quantity: 1, cost: 100, tier: "c1" }],
    },
    decision: DECISION,
  };
}

const createdDirs: string[] = [];

afterEach(() => {
  createdDirs.length = 0;
});

async function makeStore(options: { inbox?: unknown } = {}) {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-report-"));
  createdDirs.push(dir);
  const paths = resolveEventStorePaths(dir);
  await writeFile(paths.genesis, JSON.stringify(genesisSeed()), "utf8");
  if (options.inbox !== undefined) {
    await mkdir(resolve(dir, "inbox"), { recursive: true });
    await writeFile(paths.inbox, JSON.stringify(options.inbox), "utf8");
  }
  return paths;
}

describe("report on the fold — parity with the legacy snapshot path", () => {
  it("renders an identical composition report to the snapshot path for a no-event genesis", async () => {
    const paths = await makeStore();

    // The fold path report uses (no events) vs. the legacy snapshot path the old
    // report read. Same genesis content drives both; the load metadata is the
    // default for both so only the read model differs.
    const folded = await loadFoldedReview(paths);
    const snapshot = await loadFundReview(paths.genesis);

    expect(buildCompositionReport(folded)).toEqual(buildCompositionReport(snapshot));
  });
});

describe("report on the fold — no divergence from the app's read model", () => {
  it("folds durable-log activity into the report, so report cannot disagree with the app", async () => {
    const paths = await makeStore({ inbox: [openBtc()] });

    // The app's startup ingest writes the open to the durable log...
    await ingestInbox(paths);

    // ...and report, reading the SAME genesis + log via the SAME fold, sees it.
    const data = await loadFoldedReview(paths);
    const report = buildCompositionReport(data);

    expect(data.positions.some((position) => position.id === "btc-core")).toBe(true);
    const instrumentRows = report.dashboard.sections.find(
      (section) => section.id === "instruments",
    )?.rows;
    expect(instrumentRows?.some((row) => row.id === "instrument:btc-usd")).toBe(true);
  });
});
