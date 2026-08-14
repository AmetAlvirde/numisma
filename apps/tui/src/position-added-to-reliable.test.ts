// Reliability locks for the `PositionAddedTo` verb (PRD #96 / slice #99) proven
// through the REAL durable path the in-memory prototype deliberately avoids:
// parse → crossref → persist → reload → fold. `event-store.ts` is UNCHANGED — it
// dispatches generically, so an add round-trips with zero access-surface change.
//
// Locks here:
//   T1  — a valid add persists, reloads, and folds: a distinct lot is APPENDED
//         (own entry FX / tier preserved, never weighted-average-merged, ADR-002),
//         the funding reserve is debited, and NO realized P&L / no closed-book row
//         is produced (a scale-in is not a close).
//   append-never-merge — two adds to the SAME tier remain TWO distinct lots.
//   fail-loud (R7) — a dangling `positionId` add is rejected at ingest (log left
//         byte-for-byte unchanged, inbox in place); an add on an already-closed id
//         is rejected; and the read path refuses to fold a partial log (a malformed
//         add line quarantines and `loadFoldedReview` throws rather than skew NAV).
//
// Prior art: the #94 InvalidationMarked round-trip + ingest-fail-loud suite in
// `event-store.test.ts`.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCompositionReport } from "@numisma/engine";
import {
  loadEventLog,
  loadFoldedReview,
  resolveEventStorePaths,
  type EventStorePaths,
} from "@numisma/event-store";
import { ingestInbox } from "./event-store.js";
import { afterEach, describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";

/** Genesis with one OPEN c1 position (`aapl-core`) and a funding reserve. */
function genesisSeed() {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" }],
    instruments: [{ id: "aapl-usd", name: "Apple Inc.", symbol: "AAPL", currency: "USD" }],
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

/** An add onto `aapl-core`. Funded at mark (1 × 150) so NAV is conserved. The lot
 * carries its OWN `entryFx` distinct from the genesis lot to prove preservation. */
function addAapl(
  overrides: {
    id?: string;
    asOf?: string;
    positionId?: string;
    lot?: { tier: string; quantity: number; cost: number; entryFx?: number };
    funding?: { reserveId: string; amount: number };
  } = {},
) {
  return {
    id: overrides.id ?? "add-1",
    asOf: overrides.asOf ?? "2026-06-05",
    type: "PositionAddedTo",
    positionId: overrides.positionId ?? "aapl-core",
    lot: overrides.lot ?? { tier: "c1", quantity: 1, cost: 150, entryFx: 18.5 },
    funding: overrides.funding ?? { reserveId: "cash-core", amount: 150 },
  };
}

/** A conserving full close of `aapl-core` (2 lots × mark 150 ≈ 300). */
function closeAapl(id = "close-aapl") {
  return {
    id,
    asOf: "2026-06-04",
    type: "PositionClosed",
    positionId: "aapl-core",
    settlement: { reserveId: "cash-core", proceeds: 300 },
  };
}

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

/** Build a temp data dir with genesis + optional pre-existing log and inbox. */
async function makeStore(options: { inbox?: unknown; log?: string }): Promise<EventStorePaths> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-add-"));
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

describe("PositionAddedTo round-trip through event-store (T1)", () => {
  it("persists, reloads, and folds an appended lot (own entry FX / tier), debits the funding reserve, books no realized P&L", async () => {
    // Baseline NAV from a store that only folds genesis (no events).
    const baseline = buildCompositionReport((await loadFoldedReview(await makeStore({}))).data)
      .totals.fundValueUsd;

    const paths = await makeStore({ inbox: [addAapl()] });
    const report = await ingestInbox(paths);
    expect(report).toMatchObject({ newCount: 1, duplicateCount: 0 });

    // Persisted durably (schemaVersion-stamped) and reloads via the read path clean.
    const logged = (await readFile(paths.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(logged[0]).toMatchObject({
      schemaVersion: 2,
      type: "PositionAddedTo",
      positionId: "aapl-core",
    });
    const { events, quarantined } = await loadEventLog(paths.log);
    expect(quarantined).toHaveLength(0);
    expect(events.map((event) => event.id)).toEqual(["add-1"]);

    // Folds: the new lot is APPENDED as a distinct element preserving its own entry
    // FX and tier — never blended into the genesis lot's weighted average (ADR-002).
    const { data } = await loadFoldedReview(paths);
    const aapl = data.positions.find((position) => position.id === "aapl-core");
    expect(aapl?.lots).toEqual([
      { quantity: 2, cost: 100, tier: "c1" },
      { quantity: 1, cost: 150, tier: "c1", entryFx: 18.5 },
    ]);

    // Funding reserve debited by exactly the funding amount.
    expect(data.reserves.find((reserve) => reserve.id === "cash-core")?.amount).toBeCloseTo(850, 6);

    // A scale-in is NOT a close: no realized P&L, no closed-book row.
    const composed = buildCompositionReport(data);
    expect(composed.closedBook.rows).toHaveLength(0);

    // NAV conserved: asset in at mark == cash out (funded at mark 150).
    expect(composed.totals.fundValueUsd).toBeCloseTo(baseline, 6);
  });
});

describe("PositionAddedTo — append-never-merge (ADR-002)", () => {
  it("two adds to the same tier remain two distinct lots, never a weighted-average blend", async () => {
    const paths = await makeStore({
      inbox: [
        addAapl({ id: "add-a", lot: { tier: "c1", quantity: 1, cost: 150 }, funding: { reserveId: "cash-core", amount: 150 } }),
        addAapl({ id: "add-b", asOf: "2026-06-06", lot: { tier: "c1", quantity: 1, cost: 160 }, funding: { reserveId: "cash-core", amount: 160 } }),
      ],
    });

    const report = await ingestInbox(paths);
    expect(report).toMatchObject({ newCount: 2, duplicateCount: 0 });

    const { data } = await loadFoldedReview(paths);
    const c1Lots = data.positions.find((p) => p.id === "aapl-core")?.lots.filter((l) => l.tier === "c1");
    // Genesis lot + two appended lots = THREE distinct c1 lots, none merged.
    expect(c1Lots).toEqual([
      { quantity: 2, cost: 100, tier: "c1" },
      { quantity: 1, cost: 150, tier: "c1" },
      { quantity: 1, cost: 160, tier: "c1" },
    ]);
    // A weighted-average merge would have collapsed these into a single c1 lot.
    expect(c1Lots).toHaveLength(3);
  });
});

describe("PositionAddedTo — fail-loud ingest posture (R7)", () => {
  it("rejects a dangling-id add at ingest, leaving the log unchanged and inbox in place", async () => {
    const existingLog = `${JSON.stringify({ id: "seed-mark", asOf: "2026-06-02", type: "PriceMarked", instrumentId: "aapl-usd", price: 150 })}\n`;
    const paths = await makeStore({ inbox: [addAapl({ positionId: "ghost" })], log: existingLog });

    await expect(ingestInbox(paths)).rejects.toThrow(/cross-reference.*positionId/);

    // Durable log byte-for-byte unchanged; inbox still present for the user to fix.
    expect(await readFile(paths.log, "utf8")).toBe(existingLog);
    expect(await exists(paths.inbox)).toBe(true);
  });

  it("rejects an add onto an already-closed position (closed in a prior durable log line)", async () => {
    const existingLog = `${JSON.stringify(closeAapl())}\n`;
    const paths = await makeStore({ inbox: [addAapl()], log: existingLog });

    await expect(ingestInbox(paths)).rejects.toThrow(/already closed/);

    expect(await readFile(paths.log, "utf8")).toBe(existingLog);
    expect(await exists(paths.inbox)).toBe(true);
  });

  it("the read path refuses to fold a partial log containing a malformed add line", async () => {
    // A valid add followed by a malformed add (missing its required funding leg).
    // `loadEventLog` quarantines the bad line; `loadFoldedReview` must then refuse
    // to fold rather than silently drop it and skew NAV (ADR-003 R7 posture).
    const goodAdd = JSON.stringify(addAapl({ id: "good-add" }));
    const malformedAdd = JSON.stringify({
      id: "bad-add",
      asOf: "2026-06-07",
      type: "PositionAddedTo",
      positionId: "aapl-core",
      lot: { tier: "c1", quantity: 1, cost: 150 },
      // funding leg deliberately omitted -> parse fails -> quarantined.
    });
    const paths = await makeStore({ log: `${goodAdd}\n${malformedAdd}\n` });

    // The bad line is diverted to quarantine on load...
    const { quarantined } = await loadEventLog(paths.log);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.reason).toContain("funding");

    // ...and the fold read path refuses to run on the partial log.
    await expect(loadFoldedReview(paths)).rejects.toThrow(/unloadable line/i);

    // The log file itself is never mutated on read.
    expect(await readOrUndefined(paths.log)).toBe(`${goodAdd}\n${malformedAdd}\n`);
  });
});
