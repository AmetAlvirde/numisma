// Read-path tests for the durable log, moved verbatim out of the TUI's
// `event-store.test.ts` when the read path was extracted into this package. The
// engine owns the validation logic (parseEvent); this suite locks the read
// boundary's contract: a corrupt line is quarantined and durably surfaced rather
// than aborting the load, the fold path REFUSES a partial log (never a silently
// skewed NAV), and a fixed log self-heals its stale quarantine lane. A small
// explicit genesis fixture makes the cases legible.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  loadEventLog,
  loadFoldedReview,
  quarantineLogPath,
  resolveEventStorePaths,
  type EventStorePaths,
} from "./event-store.js";
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
    funding: { reserveId: "cash-core", amount: 100 },
  };
}

function markAapl(price: number, id = "mark-aapl") {
  return { id, asOf: "2026-06-06", type: "PriceMarked", instrumentId: "aapl-usd", price };
}

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
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

describe("loadEventLog — log-line quarantine", () => {
  it("quarantines one corrupt line, loads the rest, and surfaces the bad line", async () => {
    const good = JSON.stringify(openBtc());
    const later = JSON.stringify(markAapl(160));
    const log = `${good}\nthis is not json\n${later}\n`;
    const paths = await makeStore({ log });

    const { events, quarantined } = await loadEventLog(paths.log);

    expect(events.map((event) => event.id)).toEqual(["open-btc", "mark-aapl"]);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({ lineNumber: 2, line: "this is not json" });
    // The bad line is durably surfaced to the side lane for the user to fix.
    const lane = await readFile(quarantineLogPath(paths.log), "utf8");
    expect(lane).toContain("this is not json");
  });

  it("fails loud on the fold path when any line is unloadable (never a partial fold)", async () => {
    // ADR-003 amendment (M1): the fold/ingest read no longer degrades gracefully —
    // a dropped line would silently skew NAV, so loadFoldedReview refuses to fold a
    // partial log. The quarantine side lane is still surfaced for diagnostics.
    const log = `${JSON.stringify(openBtc())}\n{ broken\n`;
    const paths = await makeStore({ log });

    await expect(loadFoldedReview(paths)).rejects.toThrow(/unloadable line/i);

    // The bad line is still surfaced to the side lane for the operator to fix.
    const lane = await readFile(quarantineLogPath(paths.log), "utf8");
    expect(lane).toContain("{ broken");
  });

  it("self-heals: a clean log removes a stale quarantine lane", async () => {
    const paths = await makeStore({ log: `${JSON.stringify(openBtc())}\n` });
    await writeFile(quarantineLogPath(paths.log), "stale\n", "utf8");

    const { quarantined } = await loadEventLog(paths.log);

    expect(quarantined).toHaveLength(0);
    expect(await exists(quarantineLogPath(paths.log))).toBe(false);
  });
});
