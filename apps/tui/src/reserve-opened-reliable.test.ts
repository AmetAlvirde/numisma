// Reliability locks for the tenth verb, `ReserveOpened` (spec #153 / slice #156),
// proven through the REAL durable path: parse → crossref → append. `event-store.ts`
// is UNCHANGED — it dispatches generically — so the verb reaches the real ingest
// path with no access-surface change.
//
// The lock that matters here is a REGRESSION on a measured, silent NAV-destruction
// path. See the batch test below for exactly what it replaces.
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { buildCompositionReport } from "@numisma/engine";
import { loadFoldedReview, resolveEventStorePaths, type EventStorePaths } from "@numisma/event-store";
import { ingestInbox } from "./event-store.js";
import { afterEach, describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";
const OPENED_AS_OF = "2026-06-15";

/** Genesis: one live USD reserve holding a synthetic 1000, split c1 600 / c2 400. */
function genesisSeed() {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "bitget-usd", name: "Bitget", platform: "BITGET", currency: "USD" }],
    instruments: [],
    reserves: [
      {
        id: "pulse-cash",
        portfolioId: "core",
        tempo: "Pulse",
        executionMode: "live",
        accountId: "bitget-usd",
        currency: "USD",
        amount: 1000,
        lots: [
          { quantity: 600, tier: "c1" },
          { quantity: 400, tier: "c2" },
        ],
      },
    ],
    positions: [],
  };
}

function openReserve(overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-open",
    asOf: OPENED_AS_OF,
    type: "ReserveOpened",
    reserve: {
      id: "capital-cash",
      portfolioId: "core",
      tempo: "Capital",
      executionMode: "live",
      accountId: "bitget-usd",
      currency: "USD",
      ...overrides,
    },
  };
}

function transferIntoIt() {
  return {
    id: "evt-move",
    asOf: OPENED_AS_OF,
    type: "Transfer",
    fromReserveId: "pulse-cash",
    toReserveId: "capital-cash",
    amount: 400,
    tier: "c2",
  };
}

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

/** Build a temp data dir with genesis + an optional inbox. */
async function makeStore(options: { inbox?: unknown } = {}): Promise<EventStorePaths> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-reserve-opened-"));
  createdDirs.push(dir);
  const paths = resolveEventStorePaths(dir);
  await writeFile(paths.genesis, JSON.stringify(genesisSeed()), "utf8");
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

async function navOf(paths: EventStorePaths): Promise<number> {
  return buildCompositionReport((await loadFoldedReview(paths)).data).totals.fundValueUsd;
}

describe("ReserveOpened through the real ingest path", () => {
  it("opens a live Reserve and funds it by Transfer with NAV conserved exactly", async () => {
    const paths = await makeStore({ inbox: [openReserve(), transferIntoIt()] });
    const before = await navOf(paths);

    await expect(ingestInbox(paths)).resolves.toMatchObject({
      newCount: 2,
      duplicateCount: 0,
    });

    const { data } = await loadFoldedReview(paths);
    const born = data.reserves.find((reserve) => reserve.id === "capital-cash");
    expect(born?.amount).toBe(400);
    // The tier rides across: a real c2 lot, not an untiered amount.
    expect(born?.lots).toEqual([{ quantity: 400, tier: "c2" }]);
    // Zero tolerance — reclassification moves capital between Tempos, never out.
    expect(await navOf(paths)).toBe(before);
  });

  // REGRESSION — the measured NAV-destruction pair.
  //
  // WHAT THIS REPLACES, so a later reader sees what is being prevented rather than
  // only that something is rejected. Before the cross-ref gate learned
  // `executionMode`, this exact inbox — a paper-mode `ReserveOpened` followed by a
  // Transfer of 400 into it, against the 1000-unit genesis above — was accepted:
  //
  //   * `parseEvent` returned `kind: "ok"` for BOTH events;
  //   * `crossReferenceEvent` returned `kind: "ok"` for BOTH events;
  //   * `ingestInbox` reported `newCount: 2` and appended both lines durably;
  //   * the 400 LEFT `pulse-cash` and landed in a Reserve that canonical
  //     normalization then DROPPED (`excluded.nonLive += 1`) with no warning;
  //   * so NAV fell 1000 → 600 and the report said `warnings: []`.
  //
  // Cash destroyed, silently, with a clean bill of health. It is new with this verb:
  // every genesis reserve is `live`, so a non-live Reserve was previously unmintable.
  //
  // The batch must now fail ALL-OR-NOTHING. The gate is at the MINT, not at the
  // movement — the Transfer below is never even reached, and does not need its own
  // executionMode check, because once no non-live Reserve can be minted there is no
  // such Reserve left for a movement to target.
  it("rejects [ReserveOpened in paper mode, Transfer into it] as a whole batch, moving no cash", async () => {
    const paths = await makeStore({
      inbox: [openReserve({ executionMode: "paper" }), transferIntoIt()],
    });
    const before = await navOf(paths);
    expect(before).toBe(1000);

    await expect(ingestInbox(paths)).rejects.toThrow(/executionMode/);

    // All-or-nothing: nothing appended at all — not the Transfer, not even the
    // ReserveOpened that was rejected first. The inbox stays for the operator to fix.
    expect(await exists(paths.log)).toBe(false);
    expect(await exists(paths.inbox)).toBe(true);

    // And the cash never moved: NAV is 1000, to the last digit, not 600.
    const { data } = await loadFoldedReview(paths);
    expect(data.reserves.map((reserve) => reserve.id)).toEqual(["pulse-cash"]);
    expect(data.reserves.find((reserve) => reserve.id === "pulse-cash")?.amount).toBe(1000);
    expect(await navOf(paths)).toBe(1000);

    // The report that used to certify the destruction with `warnings: []` now
    // describes an untouched fund: still no warnings, but also nothing excluded.
    const report = buildCompositionReport(data);
    expect(report.warnings).toEqual([]);
    expect(report.excluded).toEqual({ nonLive: 0, invalid: 0, shortDeferred: 0 });
  });
});
