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
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCompositionReport, formatCompositionReport } from "@numisma/engine";
import { loadFoldedReview, resolveEventStorePaths } from "@numisma/event-store";
import { ingestInbox } from "./event-store.js";
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
    funding: { reserveId: "cash-core", amount: 100 },
  };
}

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

async function makeStore(options: { inbox?: unknown; genesis?: unknown } = {}) {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-report-"));
  createdDirs.push(dir);
  const paths = resolveEventStorePaths(dir);
  await writeFile(paths.genesis, JSON.stringify(options.genesis ?? genesisSeed()), "utf8");
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

// T6 (PRD #82 C2 + C3): fold→report round-trip for the reserve reconciliation line.
// The fold now MUTATES reserves via the cash legs (`reserves = [...reserves.values()]`),
// so the report must render the FOLDED balance — never the stale genesis balance —
// and it must do so as a dedicated reconciliation line the operator eyeballs against
// the real venues.
describe("reserve reconciliation report line — folded balances (C2/C3)", () => {
  it("renders the POST-FOLD reserve balance, not the stale genesis balance", async () => {
    // Genesis funds cash-core at 1000; opening BTC debits 100 through the funding
    // cash leg, so the fold lands cash-core at 900. The reconciliation line must
    // report 900 (folded), and the genesis-snapshot path must still show 1000 —
    // proving the report reads the folded reserves, not genesis.
    const paths = await makeStore({ inbox: [openBtc()] });
    await ingestInbox(paths);

    const folded = await loadFoldedReview(paths);
    const foldedReport = buildCompositionReport(folded);
    const foldedLine = foldedReport.reserveReconciliation.find(
      (line) => line.reserveId === "cash-core",
    );
    expect(foldedLine).toMatchObject({
      reserveId: "cash-core",
      venueLabel: "XTB: Main Broker",
      currency: "USD",
      balance: 900,
      usdValue: 900,
    });

    // The pre-fold genesis snapshot reports the untouched 1000 — so a consumer that
    // (wrongly) read genesis would diverge from what the reconciliation line renders.
    const snapshot = await loadFundReview(paths.genesis);
    const snapshotLine = buildCompositionReport(snapshot).reserveReconciliation.find(
      (line) => line.reserveId === "cash-core",
    );
    expect(snapshotLine?.balance).toBe(1000);

    // The rendered CLI report carries a Reserve Reconciliation section showing the
    // folded balance, so the operator eyeballs 900 (not 1000) against the venue.
    const rendered = formatCompositionReport(foldedReport);
    expect(rendered).toContain("Reserve Reconciliation");
    expect(rendered).toContain("Post-fold balances to eyeball against the real venues.");
    expect(rendered).toMatch(/cash-core\b.*XTB: Main Broker.*\$900\.00.*\$900\.00/);
  });

  it("preserves genesis Reserve insertion order in the reconciliation line", async () => {
    // Three reserves whose insertion order (small, large, medium) deliberately
    // differs from a value ranking, so a re-sort would be caught. The composition
    // sections sort by value; the reconciliation line must NOT.
    const genesis = {
      fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
      review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
      portfolios: [{ id: "core", name: "Core" }],
      accounts: [
        { id: "acct-a", name: "Alpha", platform: "XTB", currency: "USD" },
        { id: "acct-b", name: "Bravo", platform: "BINANCE", currency: "USD" },
        { id: "acct-c", name: "Charlie", platform: "BITGET", currency: "USD" },
      ],
      instruments: [],
      reserves: [
        {
          id: "reserve-small",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "acct-a",
          currency: "USD",
          amount: 50,
        },
        {
          id: "reserve-large",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "acct-b",
          currency: "USD",
          amount: 900,
        },
        {
          id: "reserve-medium",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "acct-c",
          currency: "USD",
          amount: 300,
        },
      ],
      positions: [],
    };
    const paths = await makeStore({ genesis });

    const report = buildCompositionReport(await loadFoldedReview(paths));

    // Insertion order preserved — NOT the descending-value order (large, medium, small).
    expect(report.reserveReconciliation.map((line) => line.reserveId)).toEqual([
      "reserve-small",
      "reserve-large",
      "reserve-medium",
    ]);

    // And the rendered report lists them in that same insertion order.
    const rendered = formatCompositionReport(report);
    const order = ["reserve-small", "reserve-large", "reserve-medium"].map((id) =>
      rendered.indexOf(id),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});
