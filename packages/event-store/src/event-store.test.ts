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
  unattendedFoldVerdict,
  type EventStorePaths,
} from "./event-store.js";
import { genesisSeed } from "./genesis-seed.testkit.js";
import { afterEach, describe, expect, it } from "vitest";

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

/** A close whose target the fold has no record of — one silent drop, authored here. */
function closeGhost(id = "close-ghost") {
  return {
    id,
    asOf: "2026-06-07",
    type: "PositionClosed",
    positionId: "ghost-core",
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

  it("numbers a quarantined line by its PHYSICAL position, blank lines included", async () => {
    // The number the operator hand-edits by. Blank lines are skipped as records but
    // still consume a line number, so the reported number matches what an editor
    // shows — and matches what the one-shot migration reports for the same bytes
    // (apps/tui `migrateLegacyLog`). The two halves must never disagree.
    const log = `${JSON.stringify(openBtc())}\n\n\nthis is not json\n`;
    const paths = await makeStore({ log });

    const { quarantined } = await loadEventLog(paths.log);

    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]).toMatchObject({ lineNumber: 4, line: "this is not json" });
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

  it("refuses what could not be read, reports what was read and then dropped", async () => {
    // PRD #323 seam B, the pair in one test because the pair is the point: the shell
    // REFUSES a log it could not fully read, and REPORTS what it read and then dropped.
    // The first is remediable (fix the line, the next run is clean); the second is a
    // standing fact about an append-only log, so it reports and never refuses (ADR-020,
    // `context/adr/ADR-020-the-discard-channel-report-never-refuse.md`).
    const dropped = `${JSON.stringify(openBtc())}\n${JSON.stringify(closeGhost())}\n`;

    // REPORT: the drop rides out on the envelope, unmodified — the shell is a pipe.
    const clean = await makeStore({ log: dropped });
    const folded = await loadFoldedReview(clean);
    expect(folded.skipped).toHaveLength(1);
    expect(folded.skipped[0]).toMatchObject({
      eventId: "close-ghost",
      index: 1,
      verb: "PositionClosed",
      reason: "position-absent",
    });
    // And the fold itself is untouched: the open still applied.
    expect(folded.data.positions.map((position) => position.id)).toContain("btc-core");

    // REFUSE: the same log with one unloadable line throws BEFORE any envelope exists.
    const partial = await makeStore({ log: `${dropped}{ broken\n` });
    await expect(loadFoldedReview(partial)).rejects.toThrow(/unloadable line/i);
  });

  it("the fold's verdict is PROSE ONLY — the type has no exit code to set", async () => {
    // PRD #323 R7. The consequence is a clause-4 verdict function beside the loader, and
    // its whole shape is the ruling: `unattendedPreferencesVerdict` returns
    // `{exitCode, messages}` because a malformed sidecar line is an ERRAND that
    // extinguishes when the operator edits it; this one returns messages ALONE because a
    // dropped event's locator points into append-only history and never extinguishes.
    // A permanently red errand channel is one nobody reads.
    const paths = await makeStore({
      log: `${JSON.stringify(openBtc())}\n${JSON.stringify(closeGhost())}\n`,
    });

    const verdict = unattendedFoldVerdict(await loadFoldedReview(paths));

    // ONE line, carrying the count and nothing else that varies — never an enumeration,
    // regardless of how many events dropped, because it prints unasked and daily.
    expect(verdict.messages).toHaveLength(1);
    expect(verdict.messages[0]).toContain("1 event(s)");
    expect(verdict.messages[0]).not.toContain("close-ghost");
    expect(verdict.messages[0]).not.toContain("PositionClosed");
    // The member is ABSENT, not zero. `Object.keys` rather than a `toBeUndefined`, which
    // would also pass on a verdict that simply forgot to set one.
    expect(Object.keys(verdict)).toEqual(["messages"]);
  });

  it("says NOTHING over a clean log — the daily run stays byte-identical", async () => {
    const paths = await makeStore({ log: `${JSON.stringify(openBtc())}\n` });

    expect(unattendedFoldVerdict(await loadFoldedReview(paths)).messages).toEqual([]);
  });

  it("self-heals: a clean log removes a stale quarantine lane", async () => {
    const paths = await makeStore({ log: `${JSON.stringify(openBtc())}\n` });
    await writeFile(quarantineLogPath(paths.log), "stale\n", "utf8");

    const { quarantined } = await loadEventLog(paths.log);

    expect(quarantined).toHaveLength(0);
    expect(await exists(quarantineLogPath(paths.log))).toBe(false);
  });
});
