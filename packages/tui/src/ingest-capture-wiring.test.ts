// End-to-end hook-wiring locks: drive the REAL `ingestInbox` against a temp GIT-REPO
// dataDir and prove the capture happy-path that was previously only manual — a commit
// lands with `checkpoint.json` staged, the deterministic message, and
// `headEventId === last appended id`. Plus the ingest-level reliability invariants: an
// append survives a capture failure (non-repo dataDir) with a normal report and a
// byte-intact log; the hook fires exactly once per ≥1-event ingest; and an empty ingest
// produces no commit at all.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { formatIngestCommitMessage } from "@numisma/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ingestInbox, resolveEventStorePaths } from "./event-store.js";
import { GENESIS, git, initGitRepo, MARK } from "./ingest-commit.fixtures.js";

// Each case spawns several real `git` children (plus a workspace-version read); under
// parallel load that outruns the 5s default, so give this git-heavy suite headroom.
vi.setConfig({ testTimeout: 30_000 });

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
  vi.restoreAllMocks();
});

/** A dataDir seeded with genesis + an inbox holding `events`; git-init'd on request. */
async function makeDataDir(options: { git?: boolean; inbox?: unknown[] } = {}): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-wiring-"));
  createdDirs.push(dir);
  await writeFile(resolve(dir, "genesis.json"), JSON.stringify(GENESIS), "utf8");
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
  it("lands a commit with checkpoint.json staged, the deterministic message, and the head id", async () => {
    const dir = await makeDataDir({ git: true, inbox: [MARK] });
    const paths = resolveEventStorePaths(dir);
    const before = Number(git(dir, ["rev-list", "--count", "HEAD"]).stdout.trim());
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    const report = await ingestInbox(paths);

    expect(report.newCount).toBe(1);

    // Exactly one new commit landed (hook fires once per ≥1-event ingest).
    const after = Number(git(dir, ["rev-list", "--count", "HEAD"]).stdout.trim());
    expect(after).toBe(before + 1);

    // checkpoint.json is part of that commit, with the appended head + version.
    const staged = git(dir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).stdout;
    expect(staged).toContain("checkpoint.json");
    expect(staged).toContain("events.jsonl");

    const checkpoint = JSON.parse(await readFile(resolve(dir, "checkpoint.json"), "utf8"));
    expect(checkpoint.headEventId).toBe("mark-aapl"); // === last appended id

    // The landed message is exactly the engine's deterministic format.
    const expected = formatIngestCommitMessage({
      verbs: { PriceMarked: 1 },
      totalCount: 1,
      asOf: checkpoint.asOf,
      appVersion: checkpoint.appVersion,
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

  it("makes no commit for an empty ingest (no ≥1-event append)", async () => {
    const dir = await makeDataDir({ git: true, inbox: [] });
    const paths = resolveEventStorePaths(dir);
    const before = Number(git(dir, ["rev-list", "--count", "HEAD"]).stdout.trim());

    const report = await ingestInbox(paths);

    expect(report.newCount).toBe(0);
    const after = Number(git(dir, ["rev-list", "--count", "HEAD"]).stdout.trim());
    expect(after).toBe(before);
    // Nothing was captured: no checkpoint.json written for a zero-event ingest.
    await expect(readFile(resolve(dir, "checkpoint.json"), "utf8")).rejects.toThrow();
  });
});
