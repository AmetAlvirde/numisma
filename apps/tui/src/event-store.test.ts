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
import { fileURLToPath } from "node:url";
import {
  loadEventLog,
  loadFoldedReview,
  quarantineLogPath,
  resolveEventStorePaths,
  type EventStorePaths,
} from "@numisma/event-store";
import { ingestInbox, migrateLegacyLog, writeLogImage } from "./event-store.js";
import type { SuppliedCashLeg } from "@numisma/engine";
import { afterEach, describe, expect, it, vi } from "vitest";

// Every case here is FILESYSTEM-bound: each one builds a real temp store (mkdir +
// writes), folds it, and ingests — and the archive cases ingest twice. Under
// `pnpm test` this file is scheduled alongside the real-`git`-subprocess suites
// (ingest-commit-hardening, go-back-invariant, ingest-commit), whose individual
// cases run 3–9s of subprocess and disk work. Measured on this tree: the archive
// case ("never clobbers a prior archive…") costs ~540ms run in isolation and
// 1.2–1.9s under full-suite load — a ~3x amplification that leaves the 5s vitest
// DEFAULT under 3x of headroom. #178 saw it cross that line twice on a busier
// machine, timing out the whole suite while passing in isolation.
//
// So the number is not a tolerance for slow code; it is headroom over scheduler
// contention we do not control. 30_000 matches what the git-heavy tui suites
// already set for the same reason — one convention, not a new number. Nothing
// here awaits an unbounded operation (the archive's collision-suffix loop is
// bounded by the first free name), so a case that actually reaches 30s is a real
// hang and should be read as a defect, not raised again.
vi.setConfig({ testTimeout: 30_000 });

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

/** An InvalidationMarked on the genesis-open aapl-core position. */
function markInvalidation(
  overrides: {
    id?: string;
    asOf?: string;
    positionId?: string;
    price?: number;
    direction?: "below" | "above";
  } = {},
) {
  return {
    id: overrides.id ?? "mark-inval",
    asOf: overrides.asOf ?? "2026-06-08",
    type: "InvalidationMarked",
    positionId: overrides.positionId ?? "aapl-core",
    price: overrides.price ?? 120,
    direction: overrides.direction ?? "below",
  };
}

/** A conserving close of the genesis-open aapl-core (2 lots × last close 150 ≈ 300). */
function closeAapl(id = "close-aapl") {
  return {
    id,
    asOf: "2026-06-07",
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

// Magnitude-guard override (Finding 6): the documented recovery for a GENUINE
// >50% move. Default ingest keeps the engine's ±50% guard; an operator-set
// `magnitudeThreshold` widens ONLY the magnitude guard for that one conscious run.
// A +100% mark (last close 150 → 300) is beyond the default band, inside a ±150%
// band, so it pins both the reject-by-default and accept-on-override behaviors.
describe("ingestInbox — magnitude override lands a genuine big move (Finding 6)", () => {
  it("rejects a >50% move by default (no override) with the engine ±50% guard", async () => {
    const paths = await makeStore({ inbox: [markAapl(300, "big-move")] }); // +100% of 150
    const logBefore = await readOrUndefined(paths.log);

    await expect(ingestInbox(paths)).rejects.toThrowError(/cross-reference.*price/);

    // Fail-loud, all-or-nothing: nothing written, inbox preserved for the override run.
    expect(await readOrUndefined(paths.log)).toBe(logBefore);
    expect(await exists(paths.inbox)).toBe(true);
  });

  it("accepts the SAME mark when the override raises the threshold", async () => {
    const paths = await makeStore({ inbox: [markAapl(300, "big-move")] }); // +100% of 150

    const report = await ingestInbox(paths, { magnitudeThreshold: 1.5 }); // ±150%

    expect(report).toMatchObject({ newCount: 1, duplicateCount: 0 });
    const log = (await readFile(paths.log, "utf8")).trim().split("\n");
    expect(JSON.parse(log[0]!).id).toBe("big-move");
    expect(await exists(paths.inbox)).toBe(false);
  });

  it("applies the override only to the magnitude guard, not structural validation", async () => {
    // A negative price is a STRUCTURAL failure — a huge override must not smuggle it in.
    const malformed = { id: "neg", asOf: "2026-06-06", type: "PriceMarked", instrumentId: "aapl-usd", price: -5 };
    const paths = await makeStore({ inbox: [malformed] });

    await expect(ingestInbox(paths, { magnitudeThreshold: 100 })).rejects.toThrowError(/is invalid.*price/);
  });

  it("leaves default behavior byte-for-byte unchanged when no override is passed", async () => {
    // Same inbox, once with an explicit-undefined-free default call and once via the
    // options-less call: both must land identically (engine keeps its own ±50%).
    const withoutOptions = await makeStore({ inbox: [markAapl(200, "in-band")] }); // +33%
    const withEmptyOptions = await makeStore({ inbox: [markAapl(200, "in-band")] });

    const a = await ingestInbox(withoutOptions);
    const b = await ingestInbox(withEmptyOptions, {});

    expect(a).toMatchObject({ newCount: 1, duplicateCount: 0 });
    expect(b).toMatchObject({ newCount: 1, duplicateCount: 0 });
    // A +33% mark is inside ±50%; a >50% mark stays rejected without an override.
    const rejects = await makeStore({ inbox: [markAapl(300, "big")] });
    await expect(ingestInbox(rejects)).rejects.toThrowError(/cross-reference.*price/);
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

describe("writeLogImage — concurrent writers cannot corrupt each other", () => {
  it("leaves the log byte-identical to exactly one writer's image, never a blend", async () => {
    const paths = await makeStore({});
    const dir = dirname(paths.log);

    // Multi-megabyte images on purpose: with a tiny payload the write completes inside
    // one turn and the writers never really overlap. At this size the open/write/rename
    // steps genuinely interleave, so a SHARED temp name loses the race deterministically
    // — one writer truncating another's half-written temp, or renaming it out from under
    // it. Every byte here is authored filler: a distinct marker line per writer, repeated.
    const WRITERS = 4;
    const LINES = 60_000; // ~4 MB per image at 68 bytes/line.
    const images = Array.from(
      { length: WRITERS },
      (_, index) => `${`writer-${index}`.padEnd(66, String.fromCharCode(97 + index))}\n`.repeat(LINES),
    );

    const results = await Promise.allSettled(images.map((image) => writeLogImage(paths.log, image)));
    // Every writer must SUCCEED: a rejection here is the shared-temp collision itself
    // (the sibling renamed the source away), not an incidental failure.
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected.map((result) => String((result as PromiseRejectedResult).reason))).toEqual([]);

    const content = await readFile(paths.log, "utf8");

    // No blend: a surviving image is one writer's marker line, repeated — nothing else.
    const distinctLines = new Set(content.split("\n").filter((line) => line.length > 0));
    expect([...distinctLines]).toHaveLength(1);
    // No truncation: full length, and byte-identical to one of the inputs. Compared as a
    // boolean so a failure reports a flag rather than dumping megabytes of diff.
    expect(content.length).toBe(images[0]!.length);
    expect(images.some((image) => image === content)).toBe(true);

    // And no litter: every temp image was renamed away or cleaned up.
    const leftovers = (await readdir(dir)).filter((name) => name.includes(".tmp"));
    expect(leftovers).toEqual([]);
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

// T1 (M1 / C1 / ADR-003 amendment): a durable log written before the cash leg
// existed. A legacy-shape close fails loud on load (never a silent quarantine that
// skews the fold), and the one-shot `migrateLegacyLog` upgrades it in place with an
// operator-supplied settlement — fail-loud and lossless. `aapl-core` is the genesis
// position closed here (markPrice 150 × qty 2 → expected ≈ 300 for the magnitude
// gate); `cash-core` is the settling reserve. Fixtures synthetic.
describe("durable-log migration — legacy-shape events fail loud, then migrate deterministically", () => {
  /** A v1-shape close of the genesis position: no settlement cash leg. */
  const legacyClose = {
    id: "legacy-close-aapl",
    asOf: "2026-06-07",
    type: "PositionClosed",
    positionId: "aapl-core",
  };

  it("loadFoldedReview fails loud on a legacy close, never folding without it", async () => {
    const paths = await makeStore({ log: `${JSON.stringify(legacyClose)}\n` });

    // The whole load stops loud — the position is NOT silently left open with the
    // cash credited nowhere (the exact plausible-but-wrong NAV M1 eliminates).
    await expect(loadFoldedReview(paths)).rejects.toThrow(/unloadable line/i);
    const lane = await readFile(quarantineLogPath(paths.log), "utf8");
    expect(lane).toMatch(/migrate/i);
  });

  it("ingestInbox fails loud when the existing log holds a legacy line, log unchanged", async () => {
    const log = `${JSON.stringify(legacyClose)}\n`;
    const paths = await makeStore({ log, inbox: [markAapl(160)] });

    await expect(ingestInbox(paths)).rejects.toThrow(/unloadable line/i);

    // Fail-loud is all-or-nothing: the durable log is left byte-for-byte unchanged.
    expect(await readFile(paths.log, "utf8")).toBe(log);
    expect(await exists(paths.inbox)).toBe(true);
  });

  it("migrateLegacyLog upgrades the legacy close in place; the log then folds cleanly", async () => {
    const paths = await makeStore({ log: `${JSON.stringify(legacyClose)}\n` });
    const cashLegs = new Map<string, SuppliedCashLeg>([
      ["legacy-close-aapl", { settlement: { reserveId: "cash-core", proceeds: 290 } }],
    ]);

    const report = await migrateLegacyLog(paths, cashLegs);
    expect(report.migratedCount).toBe(1);

    // The rewritten line is v2-shaped and schemaVersion-stamped.
    const logged = JSON.parse((await readFile(paths.log, "utf8")).trim().split("\n")[0]!);
    expect(logged.schemaVersion).toBe(2);
    expect(logged.settlement).toEqual({ reserveId: "cash-core", proceeds: 290 });

    // And the fold now succeeds: the position is retired, the proceeds credited.
    const data = await loadFoldedReview(paths);
    expect(data.positions.some((position) => position.id === "aapl-core")).toBe(false);
    expect(data.reserves.find((reserve) => reserve.id === "cash-core")?.amount).toBe(1290);
  });

  it("numbers lines the way the reader does, so both halves name the SAME line", async () => {
    // Blank lines are records to neither half — but the reader counts them toward the
    // line number and the migration must too. When they disagree the operator hand-edits
    // whichever line the second message named, corrupting a *good* line of the durable,
    // append-only log. Two blanks before the legacy close: physical line 4.
    const log = `${JSON.stringify(markAapl(160, "pre-mark"))}\n\n\n${JSON.stringify(legacyClose)}\n`;
    const paths = await makeStore({ log });

    // What the READ half calls it.
    const { quarantined } = await loadEventLog(paths.log);
    expect(quarantined[0]?.lineNumber).toBe(4);

    // What the WRITE half calls it — the same number, or the operator edits the wrong line.
    await expect(migrateLegacyLog(paths, new Map())).rejects.toThrow(/line 4: PositionClosed/);
  });

  it("migrateLegacyLog writes through writeLogImage — no second temp+rename writer", async () => {
    const paths = await makeStore({ log: `${JSON.stringify(legacyClose)}\n` });
    const cashLegs = new Map<string, SuppliedCashLeg>([
      ["legacy-close-aapl", { settlement: { reserveId: "cash-core", proceeds: 290 } }],
    ]);

    await migrateLegacyLog(paths, cashLegs);

    // The temp image is renamed away, never left behind (the writeLogImage contract).
    expect(await exists(`${paths.log}.tmp`)).toBe(false);

    // And structurally: the migration holds no writer of its own. `writeLogImage` is
    // documented as "the only way the log is written" — any hardening landed there
    // (fsync before rename, a distinct temp name) must cover the one path that rewrites
    // the WHOLE durable log, so this body must delegate rather than hand-roll.
    const source = await readFile(resolve(dirname(fileURLToPath(import.meta.url)), "event-store.ts"), "utf8");
    const startIdx = source.indexOf("export async function migrateLegacyLog");
    expect(startIdx).toBeGreaterThan(-1);
    // Bound by the function's own closing brace (first column-0 `}` after the
    // start) so a docstring reword or a function reorder elsewhere in the file
    // cannot silently widen or empty the slice.
    const closingBraceIdx = source.indexOf("\n}", startIdx);
    expect(closingBraceIdx).toBeGreaterThan(startIdx);
    const body = source.slice(startIdx, closingBraceIdx + 2);
    expect(body).toContain("writeLogImage(");
    expect(body).not.toMatch(/\b(?:rename|renameSync|writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/);
  });

  it("migrateLegacyLog fails loud (writes nothing) when a legacy record has no supplied leg", async () => {
    const log = `${JSON.stringify(legacyClose)}\n`;
    const paths = await makeStore({ log });

    await expect(migrateLegacyLog(paths, new Map())).rejects.toThrow(/legacy-close-aapl/);
    // Nothing written: the log is untouched.
    expect(await readFile(paths.log, "utf8")).toBe(log);
  });

  it("migrateLegacyLog fails loud when a supplied settlement is non-conserving (magnitude gate)", async () => {
    const log = `${JSON.stringify(legacyClose)}\n`;
    const paths = await makeStore({ log });
    const cashLegs = new Map<string, SuppliedCashLeg>([
      // ~26× the expected ≈ 300 → the settlement-magnitude gate rejects it.
      ["legacy-close-aapl", { settlement: { reserveId: "cash-core", proceeds: 8000 } }],
    ]);

    await expect(migrateLegacyLog(paths, cashLegs)).rejects.toThrow(/cross-reference/i);
    expect(await readFile(paths.log, "utf8")).toBe(log);
  });
});

// T2 + R4 (PRD #90, ADR-003 realized-P&L amendment). The 7th verb proven through
// the REAL durable path the in-memory prototype deliberately avoids: parse →
// crossref → persist → reload → fold. `event-store.ts` is unchanged — it dispatches
// generically, so an InvalidationMarked round-trips with zero access-surface change.
// R4 decision LOCKED here: a post-close mark is REJECTED at ingest (fail-loud),
// never accepted as a silent no-op.
describe("InvalidationMarked round-trip through event-store (T2 / R4)", () => {
  it("accepts a valid mark, persists it schemaVersion-stamped, reloads, and folds latest-wins", async () => {
    const paths = await makeStore({
      inbox: [
        markInvalidation({ id: "inval-1", asOf: "2026-06-08", price: 120 }),
        markInvalidation({ id: "inval-2", asOf: "2026-06-09", price: 115 }),
      ],
    });

    const report = await ingestInbox(paths);
    expect(report).toMatchObject({ newCount: 2, duplicateCount: 0 });

    // Persisted durably, schemaVersion-stamped, and reloads via the read path unchanged.
    const logged = (await readFile(paths.log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(logged[0]).toMatchObject({ schemaVersion: 2, type: "InvalidationMarked", positionId: "aapl-core", price: 120, direction: "below" });
    const { events, quarantined } = await loadEventLog(paths.log);
    expect(quarantined).toHaveLength(0);
    expect(events.map((event) => event.id)).toEqual(["inval-1", "inval-2"]);

    // Folds latest-wins onto the still-open position: the newer mark (115) wins.
    const data = await loadFoldedReview(paths);
    const aapl = data.positions.find((position) => position.id === "aapl-core");
    expect(aapl?.invalidation).toEqual({ price: 115, direction: "below" });
  });

  it("fails loud on a dangling-id mark, leaving the log unchanged and inbox in place", async () => {
    const existingLog = `${JSON.stringify(markAapl(160))}\n`;
    const paths = await makeStore({ inbox: [markInvalidation({ positionId: "ghost" })], log: existingLog });

    await expect(ingestInbox(paths)).rejects.toThrow(/cross-reference.*positionId/);

    expect(await readFile(paths.log, "utf8")).toBe(existingLog);
    expect(await exists(paths.inbox)).toBe(true);
  });

  it("rejects a post-close mark at ingest (R4 fail-loud, not a silent no-op)", async () => {
    // One batch: close aapl-core, then try to mark its invalidation. The close
    // retires the id; the follow-on mark must fail loud, and all-or-nothing leaves
    // the durable log byte-for-byte unchanged (the close is not appended either).
    const paths = await makeStore({ inbox: [closeAapl(), markInvalidation({ id: "post-close-mark", positionId: "aapl-core" })] });

    await expect(ingestInbox(paths)).rejects.toThrow(/already closed/);

    expect(await readOrUndefined(paths.log)).toBeUndefined();
    expect(await exists(paths.inbox)).toBe(true);
  });

  it("rejects a mark whose target was closed in a PRIOR durable log line (R4 across reload)", async () => {
    // The close lives in the already-persisted log; a fresh inbox mark on the retired
    // id must still fail loud — the closed-flag is rebuilt from the log on reload.
    const existingLog = `${JSON.stringify(closeAapl())}\n`;
    const paths = await makeStore({ inbox: [markInvalidation({ positionId: "aapl-core" })], log: existingLog });

    await expect(ingestInbox(paths)).rejects.toThrow(/already closed/);

    expect(await readFile(paths.log, "utf8")).toBe(existingLog);
    expect(await exists(paths.inbox)).toBe(true);
  });
});
