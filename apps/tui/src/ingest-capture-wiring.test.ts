// End-to-end hook-wiring locks: drive the REAL `ingestInbox` against a temp GIT-REPO
// dataDir and prove the capture happy-path that was previously only manual — a commit
// lands with `head-digest.json` staged, the deterministic message, and
// `headEventId === last appended id`. Plus the ingest-level reliability invariants: an
// append survives a capture failure (non-repo dataDir) with a normal report and a
// byte-intact log; the hook fires exactly once per ≥1-event ingest; and an empty ingest
// produces no commit at all.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { formatIngestCommitMessage } from "@numisma/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEventStorePaths } from "@numisma/event-store";
import { ingestInbox } from "./event-store.js";
import { GENESIS, GHOST_CLOSE, git, initGitRepo, logLine, MARK } from "./ingest-commit.fixtures.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
  vi.restoreAllMocks();
});

/** A dataDir seeded with genesis + an inbox holding `events`; git-init'd on request. */
async function makeDataDir(
  options: { git?: boolean; inbox?: unknown[]; priorLog?: Record<string, unknown>[] } = {},
): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-wiring-"));
  createdDirs.push(dir);
  await writeFile(resolve(dir, "genesis.json"), JSON.stringify(GENESIS), "utf8");
  if (options.priorLog !== undefined) {
    await writeFile(resolve(dir, "events.jsonl"), options.priorLog.map(logLine).join(""), "utf8");
  }
  if (options.inbox !== undefined) {
    await mkdir(resolve(dir, "inbox"), { recursive: true });
    await writeFile(resolve(dir, "inbox", "transactions.json"), JSON.stringify(options.inbox), "utf8");
  }
  if (options.git) {
    initGitRepo(dir);
    git(dir, ["add", "genesis.json"]);
    git(dir, ["commit", "-q", "-m", "seed genesis"]);
  }
  return dir;
}

describe("ingestInbox → durable-log capture, wired end-to-end against a temp git repo", () => {
  it("lands a commit with head-digest.json staged, the deterministic message, and the head id", async () => {
    const dir = await makeDataDir({ git: true, inbox: [MARK] });
    const paths = resolveEventStorePaths(dir);
    const before = Number(git(dir, ["rev-list", "--count", "HEAD"]).stdout.trim());
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const report = await ingestInbox(paths);

    expect(report.newCount).toBe(1);

    // Exactly one new commit landed (hook fires once per ≥1-event ingest).
    const after = Number(git(dir, ["rev-list", "--count", "HEAD"]).stdout.trim());
    expect(after).toBe(before + 1);

    // head-digest.json is part of that commit, with the appended head + version.
    const staged = git(dir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).stdout;
    expect(staged).toContain("head-digest.json");
    expect(staged).toContain("events.jsonl");

    const headDigest = JSON.parse(await readFile(resolve(dir, "head-digest.json"), "utf8"));
    expect(headDigest.headEventId).toBe("mark-aapl"); // === last appended id

    // The landed message is exactly the engine's deterministic format.
    const expected = formatIngestCommitMessage({
      verbs: { PriceMarked: 1 },
      totalCount: 1,
      asOf: headDigest.asOf,
      appVersion: headDigest.appVersion,
      timestamp: "ignored",
    });
    const body = git(dir, ["log", "-1", "--format=%B"]).stdout.trim();
    expect(body).toBe(expected.trim());
  });

  it("returns a normal report and keeps the log byte-intact when capture fails (non-repo)", async () => {
    const dir = await makeDataDir({ git: false, inbox: [MARK] });
    const paths = resolveEventStorePaths(dir);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const report = await ingestInbox(paths);

    // The ingest still succeeds — the capture failure is a loud warn, not a throw.
    expect(report.newCount).toBe(1);
    expect(report.archivedTo).toBeDefined();
    const warnings = stderr.mock.calls.map((call) => String(call[0])).join("");
    expect(warnings).toMatch(/not a git checkout/i);

    // The appended log line is durable and intact on disk.
    const log = await readFile(paths.log, "utf8");
    expect(log.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(log.trim())).toMatchObject({ id: "mark-aapl", type: "PriceMarked" });
  });

  // --- The digest stops laundering the damage (ADR-020, HeadDigest v2) -------------
  //
  // The drop shape is HISTORICAL, and it has to be: the ingest gates refuse an
  // unapplicable event at the door, so a drop can only enter through history logged
  // before those gates existed. `events.jsonl` is seeded with a close naming a position
  // that was never opened — parseable, so the log loads fully; unapplicable, so the
  // capture fold discards it. A clean mark is then ingested on top.

  it("commits a head-digest carrying the capture fold's discard count, not an unqualified clean head", async () => {
    const dir = await makeDataDir({ git: true, inbox: [MARK], priorLog: [GHOST_CLOSE] });
    const paths = resolveEventStorePaths(dir);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const report = await ingestInbox(paths);
    expect(report.newCount).toBe(1);

    // The digest COMMITTED into the repo — read back out of the tree, not off disk, so
    // this pins the durable artifact a future reader actually opens.
    const staged = git(dir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).stdout;
    expect(staged).toContain("head-digest.json");
    const committed = git(dir, ["show", "HEAD:head-digest.json"]).stdout;
    const headDigest = JSON.parse(committed);

    expect(headDigest.schemaVersion).toBe(2);
    expect(headDigest.discardedEventCount).toBe(1);

    // A count, not the list: the committed bytes carry no locator, verb or reason.
    expect(committed).not.toContain("close-ghost");
    expect(committed).not.toContain("never-opened");
    expect(committed).not.toContain("position-absent");
    expect(committed).not.toContain("skipped");
  });

  it("commits a discard count of 0 over a clean history — present, not absent", async () => {
    const dir = await makeDataDir({ git: true, inbox: [MARK] });
    const paths = resolveEventStorePaths(dir);
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await ingestInbox(paths);

    const headDigest = JSON.parse(git(dir, ["show", "HEAD:head-digest.json"]).stdout);
    expect(headDigest.discardedEventCount).toBe(0);
  });

  it("still succeeds and leaves the log intact when the capture fails over a damaged fold", async () => {
    // Best-effort is load-bearing and the discard channel must not weaken it: a fold that
    // discarded an event AND a dataDir that is no git checkout still yields a normal
    // report and a byte-intact append. The capture never fails the ingest.
    const dir = await makeDataDir({ git: false, inbox: [MARK], priorLog: [GHOST_CLOSE] });
    const paths = resolveEventStorePaths(dir);
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const report = await ingestInbox(paths);

    expect(report.newCount).toBe(1);
    expect(report.archivedTo).toBeDefined();
    expect(stderr.mock.calls.map((call) => String(call[0])).join("")).toMatch(
      /not a git checkout/i,
    );

    // Both the historical line and the new append are on disk, untouched.
    const log = (await readFile(paths.log, "utf8")).trim().split("\n");
    expect(log).toHaveLength(2);
    expect(JSON.parse(log[1]!)).toMatchObject({ id: "mark-aapl", type: "PriceMarked" });

    // The digest was still written (the write precedes the git steps) and is qualified.
    const headDigest = JSON.parse(await readFile(resolve(dir, "head-digest.json"), "utf8"));
    expect(headDigest.discardedEventCount).toBe(1);
  });

  it("makes no commit for an empty ingest (no ≥1-event append)", async () => {
    const dir = await makeDataDir({ git: true, inbox: [] });
    const paths = resolveEventStorePaths(dir);
    const before = Number(git(dir, ["rev-list", "--count", "HEAD"]).stdout.trim());

    const report = await ingestInbox(paths);

    expect(report.newCount).toBe(0);
    const after = Number(git(dir, ["rev-list", "--count", "HEAD"]).stdout.trim());
    expect(after).toBe(before);
    // Nothing was captured: no head-digest.json written for a zero-event ingest.
    await expect(readFile(resolve(dir, "head-digest.json"), "utf8")).rejects.toThrow();
  });
});
