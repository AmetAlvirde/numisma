// Startup-seam tests (ADR-003 slice 5). `prepareStartup` is the half of the app's
// startup that runs BEFORE the openTUI renderer — the data path `app.ts` and the
// openTUI verification harness share. openTUI itself needs Bun, but this seam is
// pure Node IO + engine calls, so the surfaced ingest report, the as-of / source
// wiring, and the fail-loud contract are pinned here in the regular suite; the
// render itself is exercised by `pnpm smoke:startup` under Bun.
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { resolveEventStorePaths, type EventStorePaths } from "./event-store.js";
import { formatIngestReport, prepareStartup } from "./startup.js";
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

async function makeStore(options: { inbox?: unknown; log?: string } = {}): Promise<EventStorePaths> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-startup-"));
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

describe("formatIngestReport — the surfaced count line", () => {
  it("reports new and duplicate counts in the user-facing wording", () => {
    expect(formatIngestReport({ newCount: 2, duplicateCount: 1 })).toBe(
      "Numisma: 2 new transaction(s) ingested, 1 duplicate(s) skipped.",
    );
  });

  it("reports zeros for a missing inbox", () => {
    expect(formatIngestReport({ newCount: 0, duplicateCount: 0 })).toBe(
      "Numisma: 0 new transaction(s) ingested, 0 duplicate(s) skipped.",
    );
  });
});

describe("prepareStartup — ingests, surfaces the report, and wires the fold loader", () => {
  it("ingests the inbox, emits the count report, and folds current state", async () => {
    const paths = await makeStore({ inbox: [openBtc()] });
    const emitted: string[] = [];

    const plan = await prepareStartup(paths, ["node", "app"], {
      emit: (line) => emitted.push(line),
    });

    expect(emitted).toEqual(["Numisma: 1 new transaction(s) ingested, 0 duplicate(s) skipped."]);
    expect(plan.asOf).toBeUndefined();
    expect(plan.sourcePath).toBe(paths.log);
    // The loader the renderer mounts folds the durable log: the opened position is there.
    const data = await plan.loadData();
    expect(data.positions.some((position) => position.id === "btc-core")).toBe(true);
  });

  it("surfaces a duplicate skip on a re-dropped event", async () => {
    const paths = await makeStore({
      inbox: [openBtc()],
      log: `${JSON.stringify(openBtc())}\n`,
    });
    const emitted: string[] = [];

    await prepareStartup(paths, ["node", "app"], { emit: (line) => emitted.push(line) });

    expect(emitted).toEqual(["Numisma: 0 new transaction(s) ingested, 1 duplicate(s) skipped."]);
  });

  it("resolves --as-of into the source label and a windowed fold", async () => {
    const paths = await makeStore({ inbox: [openBtc()] });

    // --as-of 2026-06-04 is BEFORE the BTC open (2026-06-05): the fold excludes it.
    const plan = await prepareStartup(paths, ["node", "app", "--as-of", "2026-06-04"], {
      emit: () => {},
    });

    expect(plan.asOf).toBe("2026-06-04");
    expect(plan.sourcePath).toBe(`${paths.log} as-of 2026-06-04`);
    const data = await plan.loadData();
    expect(data.positions.some((position) => position.id === "btc-core")).toBe(false);
  });

  it("throws on a malformed --as-of before ingesting (fail-loud)", async () => {
    const paths = await makeStore({ inbox: [openBtc()] });
    const emitted: string[] = [];

    await expect(
      prepareStartup(paths, ["node", "app", "--as-of", "nope"], {
        emit: (line) => emitted.push(line),
        // A spy ingest proves ingest is never reached when --as-of is rejected first.
        ingest: async () => {
          throw new Error("ingest should not run when --as-of is invalid");
        },
      }),
    ).rejects.toThrow(/--as-of/);
    expect(emitted).toEqual([]);
  });

  it("propagates a fail-loud ingest rejection without emitting a count", async () => {
    const paths = await makeStore({ inbox: [openBtc()] });
    const emitted: string[] = [];

    await expect(
      prepareStartup(paths, ["node", "app"], {
        emit: (line) => emitted.push(line),
        ingest: async () => {
          throw new Error("cross-reference: unknown instrumentId");
        },
      }),
    ).rejects.toThrow(/cross-reference/);
    // No count is surfaced for a rejected startup — the host surfaces the error instead.
    expect(emitted).toEqual([]);
  });
});
