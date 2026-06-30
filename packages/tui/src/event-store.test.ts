// Ingest-boundary tests (ADR-003 slice 2). The engine owns the validation logic
// (parseEvent / crossReferenceEvent / magnitude guard); this suite locks the
// access-surface contract `ingestInbox` wraps around it: cross-reference against
// the loaded genesis ids, and — the load-bearing reliability promise — that ANY
// rejection leaves the durable log byte-for-byte unchanged and the inbox in place
// so the user can fix it. A small explicit genesis fixture makes the cross-
// reference cases legible.
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { ingestInbox, resolveEventStorePaths, type EventStorePaths } from "./event-store.js";
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

function openBtc(id = "open-btc") {
  return {
    id,
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

function markAapl(price: number, id = "mark-aapl") {
  return { id, asOf: "2026-06-06", type: "PriceMarked", instrumentId: "aapl-usd", price };
}

const createdDirs: string[] = [];

afterEach(() => {
  createdDirs.length = 0;
});

/** Build a temp data dir with genesis + optional pre-existing log and inbox. */
async function makeStore(options: {
  inbox?: unknown;
  log?: string;
}): Promise<EventStorePaths> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-ingest-"));
  createdDirs.push(dir);
  const paths = resolveEventStorePaths(dir);
  await writeFile(paths.genesis, JSON.stringify(genesisSeed()), "utf8");
  if (options.log !== undefined) {
    await writeFile(paths.log, options.log, "utf8");
  }
  if (options.inbox !== undefined) {
    await mkdir(resolve(dir, "inbox"), { recursive: true });
    await writeFile(paths.inbox, JSON.stringify(options.inbox), "utf8");
  }
  return paths;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

describe("ingestInbox — accepts valid cross-referenced events", () => {
  it("ingests a valid open + mark, appends to the log, archives the inbox", async () => {
    const paths = await makeStore({ inbox: [openBtc(), markAapl(160)] });

    const report = await ingestInbox(paths);

    expect(report).toMatchObject({ newCount: 2, duplicateCount: 0 });
    const log = (await readFile(paths.log, "utf8")).trim().split("\n");
    expect(log).toHaveLength(2);
    expect(JSON.parse(log[0]!).id).toBe("open-btc");
    // Inbox consumed (moved to the archive), not left behind.
    expect(await exists(paths.inbox)).toBe(false);
    expect(report.archivedTo).toBeDefined();
  });

  it("dedups a re-dropped event by stable id against the existing log", async () => {
    const existingLog = `${JSON.stringify(markAapl(160))}\n`;
    const paths = await makeStore({ inbox: [markAapl(160), markAapl(165, "mark-2")], log: existingLog });

    const report = await ingestInbox(paths);

    expect(report).toMatchObject({ newCount: 1, duplicateCount: 1 });
  });

  it("accepts a close that references a position opened earlier in the same batch", async () => {
    const close = { id: "close-btc", asOf: "2026-06-07", type: "PositionClosed", positionId: "btc-core" };
    const paths = await makeStore({ inbox: [openBtc(), close] });

    await expect(ingestInbox(paths)).resolves.toMatchObject({ newCount: 2 });
  });

  it("accepts a price mark within the magnitude threshold", async () => {
    const paths = await makeStore({ inbox: [markAapl(200)] }); // +33% of last close 150

    await expect(ingestInbox(paths)).resolves.toMatchObject({ newCount: 1 });
  });

  it("reports zero for a missing inbox without touching anything", async () => {
    const paths = await makeStore({});
    await expect(ingestInbox(paths)).resolves.toEqual({ newCount: 0, duplicateCount: 0 });
  });
});

describe("ingestInbox — fail-loud rejection leaves the log unchanged and inbox in place", () => {
  const existingLog = `${JSON.stringify(markAapl(160))}\n`;

  async function expectRejectedUnchanged(inbox: unknown, messagePattern: RegExp) {
    const paths = await makeStore({ inbox, log: existingLog });
    const logBefore = await readFile(paths.log, "utf8");

    await expect(ingestInbox(paths)).rejects.toThrowError(messagePattern);

    // Durable log byte-for-byte unchanged; inbox still present for the user to fix.
    expect(await readFile(paths.log, "utf8")).toBe(logBefore);
    expect(await exists(paths.inbox)).toBe(true);
  }

  it("rejects a PositionClosed for an unknown id (MF1)", async () => {
    const close = { id: "x", asOf: "2026-06-07", type: "PositionClosed", positionId: "ghost" };
    await expectRejectedUnchanged([close], /cross-reference.*positionId/);
  });

  it("rejects a PriceMarked for an unknown instrument id (MF1)", async () => {
    const mark = { id: "m", asOf: "2026-06-06", type: "PriceMarked", instrumentId: "ghost-usd", price: 1 };
    await expectRejectedUnchanged([mark], /cross-reference.*instrumentId/);
  });

  it("rejects a PositionOpened whose id collides with a genesis position id (MF1)", async () => {
    const collide = {
      ...openBtc("collide"),
      position: { ...openBtc().position, id: "aapl-core" },
    };
    await expectRejectedUnchanged([collide], /cross-reference.*position\.id/);
  });

  it("rejects a PositionOpened whose id collides with a genesis reserve id (MF1)", async () => {
    const collide = {
      ...openBtc("collide"),
      position: { ...openBtc().position, id: "cash-core" },
    };
    await expectRejectedUnchanged([collide], /cross-reference.*position\.id/);
  });

  it("rejects an implausible fat-finger price mark beyond the threshold (MF3)", async () => {
    await expectRejectedUnchanged([markAapl(3000, "bad-mark")], /cross-reference.*price/);
  });

  it("rejects a structurally invalid event before any write", async () => {
    const malformed = { id: "bad", asOf: "2026-06-06", type: "PriceMarked", instrumentId: "aapl-usd", price: -5 };
    await expectRejectedUnchanged([malformed], /is invalid.*price/);
  });

  it("aborts the whole batch when any one event is rejected (all-or-nothing)", async () => {
    // A valid open followed by a bad mark: the valid one must NOT be appended.
    const paths = await makeStore({ inbox: [openBtc(), markAapl(3000, "bad-mark")], log: existingLog });
    const logBefore = await readFile(paths.log, "utf8");

    await expect(ingestInbox(paths)).rejects.toThrowError(/cross-reference/);

    expect(await readFile(paths.log, "utf8")).toBe(logBefore);
    expect(await readOrUndefined(paths.log)).not.toContain("open-btc");
  });
});
