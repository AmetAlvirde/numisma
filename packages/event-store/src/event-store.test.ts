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
import { deriveHeadDigest } from "@numisma/engine";
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

/**
 * A `Transfer` whose BOTH legs name reserves the fold has no record of — ONE event, two
 * skip RECORDS, one finding. Authored here; the ids are invented for this test.
 */
function transferBothLegsGhost(id = "transfer-both-ghost") {
  return {
    id,
    asOf: "2026-06-08",
    type: "Transfer",
    fromReserveId: "ghost-cash-a",
    toReserveId: "ghost-cash-b",
    amount: 100,
    tier: "c1",
  };
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

  it("the digest and the unattended line report the SAME number for the same log", async () => {
    // The two surfaces are read by the same operator hours apart — the evening line as it
    // prints, the digest whenever a bad NAV sends someone back through `head-digest.json`
    // — and the digest is the half that cannot be re-derived to settle a disagreement,
    // because it is committed and the run that wrote it is gone. So they must count the
    // same thing, by construction rather than by two definitions happening to agree.
    //
    // THE FIXTURE CHANGED IN #371, AND SO DID WHY IT WORKS. This used to be ONE
    // `Transfer` with both legs absent, which wrote two skip RECORDS about ONE event
    // because each leg reported for itself — a raw `skipped.length` said 2 where the
    // verdict said 1. That arm now checks both reserves before either moves and records
    // ONCE, so no single event can produce two records any more and that shape no longer
    // separates the two numbers. Two DISTINCT dropped events do.
    const paths = await makeStore({
      log:
        `${JSON.stringify(openBtc())}\n` +
        `${JSON.stringify(closeGhost())}\n` +
        `${JSON.stringify(transferBothLegsGhost())}\n`,
    });
    const folded = await loadFoldedReview(paths);
    expect(folded.skipped).toHaveLength(2);

    const digest = deriveHeadDigest(folded, "transfer-both-ghost", "0.7.2");
    const verdict = unattendedFoldVerdict(folded);

    expect(digest.discardedEventCount).toBe(2);
    expect(verdict.messages[0]).toContain(`${digest.discardedEventCount} event(s)`);
  });

  it("no single event yields two skip records — the two counts cannot diverge on one fold", async () => {
    // THE INVARIANT THAT REPLACED THE OLD FIXTURE (#371). Every reason in the closed
    // vocabulary now means the fold applied NOTHING, and each arm records once and
    // stops, so within a single fold `skipped.length` and `discardedEventCount` agree by
    // construction. The `Transfer` missing BOTH reserves is the event that used to break
    // this and is kept here as the standing tripwire on it.
    //
    // `dedupeFoldSkips` is NOT thereby vestigial: ingest re-folds the whole log once per
    // accepted event (ADR-015), so the SAME standing drop is seen n times across n folds.
    // That repeat is what it collapses, and it is exercised on the ingest path.
    const paths = await makeStore({
      log: `${JSON.stringify(openBtc())}\n${JSON.stringify(transferBothLegsGhost())}\n`,
    });
    const folded = await loadFoldedReview(paths);

    expect(folded.skipped).toHaveLength(1);
    expect(folded.skipped[0]!.reason).toBe("reserve-absent");
    expect(deriveHeadDigest(folded, "transfer-both-ghost", "0.7.2").discardedEventCount).toBe(
      folded.skipped.length,
    );
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

// #348. `resolveEventStorePaths` owns the two most consequential paths in the repo —
// `genesis.json` and the append-only `events.jsonl` — and it took its default as a
// default PARAMETER (`dataDir = resolveDataDirDefault()`). A JS default parameter fires
// on `undefined` and on NOTHING ELSE, so an explicit `""` walked past it into
// `resolve("")`, which is the process's CWD. Measured before the fix:
// `resolveEventStorePaths("").log` was `<cwd>/events.jsonl`. That is not a stale read —
// there is no ledger there, so a caller whose env expansion came out blank would find no
// genesis, seed a SECOND one beside wherever the job started, and append to it. Every
// fixture here is a string; nothing in this block touches a filesystem, let alone a real
// data dir.
describe("resolveEventStorePaths — a BLANK dataDir is REFUSED, not defaulted and never CWD (#348)", () => {
  it("the CWD paths are never produced — the specific regression, named in the failure", () => {
    const cwdLog = resolve(process.cwd(), "events.jsonl");
    let produced: EventStorePaths | undefined;
    try {
      produced = resolveEventStorePaths("");
    } catch {
      produced = undefined;
    }
    expect(
      produced?.log,
      `resolveEventStorePaths("") must never resolve the event log against the process CWD (${cwdLog})`,
    ).not.toBe(cwdLog);
    // Any other returned root is equally a failure to refuse — a quiet fall-through to
    // the default would append this deployment's events to the REAL accumulus ledger.
    expect(
      produced,
      'resolveEventStorePaths("") must throw rather than return any paths at all',
    ).toBeUndefined();
  });

  it("refuses both spellings of blank, in the resolver's own voice", () => {
    expect(() => resolveEventStorePaths("")).toThrow(
      /event-store data directory must not be empty/,
    );
    // Whitespace-only is what a shell produces most often, and what a bare `=== ""`
    // check would wave through.
    expect(() => resolveEventStorePaths("   ")).toThrow(
      /event-store data directory must not be empty/,
    );
    expect(() => resolveEventStorePaths("\t\n")).toThrow(
      /event-store data directory must not be empty/,
    );
  });

  it("the refusal names the consequence AND the two ways out", () => {
    let message = "";
    try {
      resolveEventStorePaths("");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/not .?unset.?/i);
    expect(message).toMatch(/working directory/);
    expect(message).toMatch(/second genesis and event log/i);
    expect(message).toMatch(/Pass no data directory/);
    expect(message).toMatch(/absolute path/);
  });

  it("a GENUINELY absent override still defaults — the refusal must not swallow `undefined`", () => {
    const saved = process.env.NUMISMA_DATA_DIR;
    const authoredRoot = resolve("/tmp/numisma-authored-store-348");
    try {
      process.env.NUMISMA_DATA_DIR = authoredRoot;
      // No filesystem call is made — this is pure path algebra against an authored root.
      expect(resolveEventStorePaths(undefined).log).toBe(resolve(authoredRoot, "events.jsonl"));
      expect(resolveEventStorePaths().genesis).toBe(resolve(authoredRoot, "genesis.json"));
      expect(() => resolveEventStorePaths()).not.toThrow();
    } finally {
      if (saved === undefined) {
        delete process.env.NUMISMA_DATA_DIR;
      } else {
        process.env.NUMISMA_DATA_DIR = saved;
      }
    }
  });

  it("an ABSOLUTE dataDir is still honored verbatim — existing callers are unchanged", () => {
    const explicit = resolve("/tmp/numisma-explicit-store-348");
    expect(resolveEventStorePaths(explicit).log).toBe(resolve(explicit, "events.jsonl"));
  });
});
