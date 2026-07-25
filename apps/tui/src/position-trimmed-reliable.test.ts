// Reliable-conversion locks for PositionTrimmed on the REAL persist path (PRD #96,
// slice #98). The engine owns the validation/fold logic; this suite proves the verb
// survives the durable `event-store.ts` spine end-to-end with ZERO access-surface
// change (event-store.ts is untouched), mirroring the #94 InvalidationMarked round-trip:
//   T1 — a PositionTrimmed parses -> crossrefs -> persists (schemaVersion-stamped) ->
//        reloads -> folds to a partial closed-book row, the position surviving reduced.
//   T3 — batch-aware sufficiency across the real ingest loop (a later trim in one inbox
//        sees the shrunk position); an over-removing batch fails loud, log unchanged.
//   T4 — a full-retirement trim is REJECTED at ingest; the log stays byte-for-byte
//        unchanged and the inbox stays in place for the operator to fix.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  loadEventLog,
  loadFoldedReview,
  resolveEventStorePaths,
  type EventStorePaths,
} from "@numisma/event-store";
import { ingestInbox } from "./event-store.js";
import { buildCompositionReport } from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";

/** A one-position seed: 4 c1 + 4 c2 (two c2 lots) units of BTC, mark 100. */
function genesisSeed() {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "binance-usd", name: "Desk", platform: "BINANCE", currency: "USD" }],
    instruments: [{ id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" }],
    reserves: [
      {
        id: "sink-usdt",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "binance-usd",
        currency: "USD",
        amount: 100,
      },
    ],
    positions: [
      {
        id: "btc-pos",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        markPrice: 100,
        currency: "USD",
        lots: [
          { quantity: 4, cost: 50, tier: "c1" },
          { quantity: 2, cost: 60, tier: "c2" },
          { quantity: 2, cost: 80, tier: "c2" },
        ],
      },
    ],
  };
}

function trim(overrides: {
  id?: string;
  asOf?: string;
  removals: Array<{ tier: "c1" | "c2" | "c3"; quantity: number }>;
  proceeds: number;
}) {
  return {
    id: overrides.id ?? "trim-1",
    asOf: overrides.asOf ?? "2026-06-02",
    type: "PositionTrimmed",
    positionId: "btc-pos",
    removals: overrides.removals,
    settlement: { reserveId: "sink-usdt", proceeds: overrides.proceeds },
  };
}

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

async function makeStore(options: { inbox?: unknown; log?: string }): Promise<EventStorePaths> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-trim-"));
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

describe("PositionTrimmed round-trip through event-store (T1)", () => {
  it("accepts a trim, persists it schemaVersion-stamped, reloads, and folds a partial row", async () => {
    // Remove all 4 c2 units at mark 100 -> proceeds 400 (settle-at-mark).
    const paths = await makeStore({
      inbox: [trim({ removals: [{ tier: "c2", quantity: 4 }], proceeds: 400 })],
    });

    const report = await ingestInbox(paths);
    expect(report).toMatchObject({ newCount: 1, duplicateCount: 0 });

    // Persisted durably, schemaVersion-stamped, and reloads via the read path clean.
    const logged = (await readFile(paths.log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(logged[0]).toMatchObject({
      schemaVersion: 2,
      type: "PositionTrimmed",
      positionId: "btc-pos",
      removals: [{ tier: "c2", quantity: 4 }],
      settlement: { reserveId: "sink-usdt", proceeds: 400 },
    });
    const { events, quarantined } = await loadEventLog(paths.log);
    expect(quarantined).toHaveLength(0);
    expect(events.map((event) => event.id)).toEqual(["trim-1"]);

    // Folds correctly: a partial closed-book row on the removed portion, the position
    // survives with only its c1 lot, and the settlement reserve is credited.
    const data = await loadFoldedReview(paths);
    const book = buildCompositionReport(data);
    const row = book.closedBook.rows.find((r) => r.positionId === "btc-pos");
    expect(row?.partial).toBe(true);
    expect(row?.proceedsUsd).toBeCloseTo(400, 6);
    expect(row?.realizedPnlUsd).toBeCloseTo(120, 6); // 400 - (2*60 + 2*80)
    expect(row?.markVsFill?.deltaUsd).toBeCloseTo(0, 6);

    const survivor = data.positions.find((p) => p.id === "btc-pos");
    expect(survivor?.lots).toEqual([{ quantity: 4, cost: 50, tier: "c1" }]);
    expect(data.reserves.find((r) => r.id === "sink-usdt")?.amount).toBeCloseTo(500, 6);
  });
});

describe("PositionTrimmed batch-aware sufficiency on the real ingest loop (T3)", () => {
  it("accepts two trims in one batch, the second seeing the shrunk position", async () => {
    // Trim1 removes all 4 c2; Trim2 removes 2 of the remaining c1 (leaving 2). Both valid.
    const paths = await makeStore({
      inbox: [
        trim({ id: "trim-a", removals: [{ tier: "c2", quantity: 4 }], proceeds: 400 }),
        trim({ id: "trim-b", asOf: "2026-06-03", removals: [{ tier: "c1", quantity: 2 }], proceeds: 200 }),
      ],
    });

    const report = await ingestInbox(paths);
    expect(report).toMatchObject({ newCount: 2, duplicateCount: 0 });

    const data = await loadFoldedReview(paths);
    const survivor = data.positions.find((p) => p.id === "btc-pos");
    expect(survivor?.lots).toEqual([{ quantity: 2, cost: 50, tier: "c1" }]);
    // Two partial rows, one lineage id.
    const rows = buildCompositionReport(data).closedBook.rows.filter((r) => r.positionId === "btc-pos");
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.partial === true)).toBe(true);
  });

  it("fails loud when a later trim in the batch over-removes the shrunk tier, log unchanged", async () => {
    // Trim1 removes all 4 c2; Trim2 tries to remove 1 more c2 the batch no longer holds.
    const paths = await makeStore({
      inbox: [
        trim({ id: "trim-a", removals: [{ tier: "c2", quantity: 4 }], proceeds: 400 }),
        trim({ id: "trim-b", asOf: "2026-06-03", removals: [{ tier: "c2", quantity: 1 }], proceeds: 100 }),
      ],
    });

    await expect(ingestInbox(paths)).rejects.toThrow(/cross-reference.*holds only 0/);

    // All-or-nothing: neither trim is appended, inbox stays in place.
    expect(await readOrUndefined(paths.log)).toBeUndefined();
    expect(await exists(paths.inbox)).toBe(true);
  });
});

describe("PositionTrimmed full-retirement REJECT at ingest (T4)", () => {
  it("rejects a would-empty trim, leaving the log unchanged and inbox in place", async () => {
    const paths = await makeStore({
      inbox: [trim({ removals: [{ tier: "c1", quantity: 4 }, { tier: "c2", quantity: 4 }], proceeds: 800 })],
    });

    await expect(ingestInbox(paths)).rejects.toThrow(/full retirement|PositionClosed/);

    expect(await readOrUndefined(paths.log)).toBeUndefined();
    expect(await exists(paths.inbox)).toBe(true);

    // The position survives untouched: a fresh fold still shows all 8 units open.
    const data = await loadFoldedReview(paths);
    const survivor = data.positions.find((p) => p.id === "btc-pos");
    expect(survivor?.lots.reduce((s, l) => s + l.quantity, 0)).toBeCloseTo(8, 9);
  });
});
