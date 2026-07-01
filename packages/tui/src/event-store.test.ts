// Ingest-boundary tests (ADR-003 slice 2). The engine owns the validation logic
// (parseEvent / crossReferenceEvent / magnitude guard); this suite locks the
// access-surface contract `ingestInbox` wraps around it: cross-reference against
// the loaded genesis ids, and — the load-bearing reliability promise — that ANY
// rejection leaves the durable log byte-for-byte unchanged and the inbox in place
// so the user can fix it. A small explicit genesis fixture makes the cross-
// reference cases legible.
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  ingestInbox,
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
    const close = { id: "close-btc", asOf: "2026-06-07", type: "PositionClosed", positionId: "btc-core", settlement: { reserveId: "cash-core", proceeds: 100 } };
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
    const close = { id: "x", asOf: "2026-06-07", type: "PositionClosed", positionId: "ghost", settlement: { reserveId: "cash-core", proceeds: 100 } };
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

// Durability hardening (ADR-003 slice 3): atomic append, log-line quarantine, and
// a wall-clock-stamped, non-overwriting archive that no-ops on a zero-new re-drop.
const FIXED_INGEST_MOMENT = new Date("2026-06-29T14:03:22.123Z");
const FIXED_STAMP = "2026-06-29T14-03-22-123Z";
const fixedClock = () => FIXED_INGEST_MOMENT;

async function writeInbox(paths: EventStorePaths, items: unknown): Promise<void> {
  await mkdir(dirname(paths.inbox), { recursive: true });
  await writeFile(paths.inbox, JSON.stringify(items), "utf8");
}

describe("appendEvents — atomic append (temp + rename)", () => {
  it("appends without leaving a temp file and keeps every line valid JSON", async () => {
    // Existing log with NO trailing newline exercises the separator path too.
    const paths = await makeStore({
      inbox: [openBtc()],
      log: JSON.stringify(markAapl(165, "pre-mark")),
    });

    await ingestInbox(paths, { now: fixedClock });

    const content = await readFile(paths.log, "utf8");
    expect(content.endsWith("\n")).toBe(true);
    const lines = content.split("\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // The temp image is renamed away, never left behind.
    expect(await exists(`${paths.log}.tmp`)).toBe(false);
  });
});

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

  it("does not abort startup: the fold still renders with a corrupt line present", async () => {
    const log = `${JSON.stringify(openBtc())}\n{ broken\n`;
    const paths = await makeStore({ log });

    const data = await loadFoldedReview(paths);

    // The good event folded through (the corrupt line was skipped, not fatal).
    expect(data.positions.some((position) => position.id === "btc-core")).toBe(true);
  });

  it("self-heals: a clean log removes a stale quarantine lane", async () => {
    const paths = await makeStore({ log: `${JSON.stringify(openBtc())}\n` });
    await writeFile(quarantineLogPath(paths.log), "stale\n", "utf8");

    const { quarantined } = await loadEventLog(paths.log);

    expect(quarantined).toHaveLength(0);
    expect(await exists(quarantineLogPath(paths.log))).toBe(false);
  });
});

describe("ingestInbox — wall-clock-stamped, non-overwriting archive", () => {
  it("stamps the archive with the ingest moment", async () => {
    const paths = await makeStore({ inbox: [openBtc()] });

    const report = await ingestInbox(paths, { now: fixedClock });

    expect(report.archivedTo).toContain(FIXED_STAMP);
  });

  it("never clobbers a prior archive when two batches share an instant", async () => {
    const paths = await makeStore({ inbox: [openBtc()] });
    const first = await ingestInbox(paths, { now: fixedClock });

    await writeInbox(paths, [markAapl(160)]);
    const second = await ingestInbox(paths, { now: fixedClock });

    expect(second.archivedTo).not.toBe(first.archivedTo);
    const archives = await readdir(paths.ingestedDir);
    expect(archives).toHaveLength(2);
    // The first archive's content is preserved, not overwritten by the second.
    const firstArchive = JSON.parse(await readFile(first.archivedTo!, "utf8"));
    expect(firstArchive[0].id).toBe("open-btc");
  });

  it("no-ops on a zero-new re-drop: archives nothing and leaves the inbox", async () => {
    const existingLog = `${JSON.stringify(markAapl(160))}\n`;
    const paths = await makeStore({ inbox: [markAapl(160)], log: existingLog });

    const report = await ingestInbox(paths, { now: fixedClock });

    expect(report).toEqual({ newCount: 0, duplicateCount: 1 });
    expect(report.archivedTo).toBeUndefined();
    // Nothing archived (the archive dir was never even created) and the durable log
    // is unchanged.
    expect(await exists(paths.ingestedDir)).toBe(false);
    expect(await readFile(paths.log, "utf8")).toBe(existingLog);
    expect(await exists(paths.inbox)).toBe(true);
  });
});

describe("ingestInbox — restart survival", () => {
  it("re-renders identical state from genesis + log with the inbox absent", async () => {
    const paths = await makeStore({ inbox: [openBtc(), markAapl(160)] });
    await ingestInbox(paths, { now: fixedClock });
    // Inbox consumed; only genesis + log remain.
    expect(await exists(paths.inbox)).toBe(false);

    const first = await loadFoldedReview(paths);
    const second = await loadFoldedReview(paths);

    expect(second).toEqual(first);
    expect(first.positions.some((position) => position.id === "btc-core")).toBe(true);
  });
});

// Decision round-trip (MF4, ADR-003 slice 4). The open-gate enforces the five
// decision fields at ingest; this locks that the decision context is durably
// RETAINED, not validate-then-discarded — captured-and-logged. A PositionOpened
// written to the log reloads with all five fields intact and is RE-VALIDATED on
// read (parseEvent runs per line on load), and a log line missing any field fails
// to load (it is quarantined, not silently accepted). The decision is not yet in
// the fold's read model — surfacing it is the named next increment; logged durably
// is this slice's contract.
describe("decision round-trip — durable retention of the five decision fields (MF4)", () => {
  it("reloads a logged PositionOpened with all five decision fields intact", async () => {
    const paths = await makeStore({ inbox: [openBtc()] });
    await ingestInbox(paths);

    const { events, quarantined } = await loadEventLog(paths.log);

    expect(quarantined).toHaveLength(0);
    const reopened = events.find((event) => event.type === "PositionOpened");
    expect(reopened).toBeDefined();
    // Intact and re-validated on read (loadEventLog re-runs parseEvent per line).
    expect(reopened && "decision" in reopened ? reopened.decision : undefined).toEqual(DECISION);
  });

  it("persists the decision durably to events.jsonl on disk", async () => {
    const paths = await makeStore({ inbox: [openBtc()] });
    await ingestInbox(paths);

    // Read the raw durable log, not the in-memory event: the decision is on disk.
    const logged = JSON.parse((await readFile(paths.log, "utf8")).trim().split("\n")[0]!);
    expect(logged.decision).toEqual(DECISION);
  });

  it("fails to load a log line missing any decision field (quarantined, not accepted)", async () => {
    const open = openBtc();
    const { strategy: _omitted, ...incompleteDecision } = open.decision;
    const badLine = JSON.stringify({ ...open, decision: incompleteDecision });
    const paths = await makeStore({ log: `${badLine}\n` });

    const { events, quarantined } = await loadEventLog(paths.log);

    // The missing-field open never becomes an event; it is surfaced for the user to fix.
    expect(events).toHaveLength(0);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.reason).toMatch(/decision\.strategy/);
  });
});
