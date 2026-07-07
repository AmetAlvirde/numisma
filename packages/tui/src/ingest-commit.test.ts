// Git-shell tests (mvi portable-durable-log). The engine owns the two PURE derivations
// (deriveHeadDigest / formatIngestCommitMessage, tested there); this suite locks the
// IO/git shell around them: that captureIngestCommit writes head-digest.json and lands a
// commit with the deterministic message in a real (throwaway) git repo, and — the
// load-bearing reliability promise — that a push failure (or a non-repo dataDir)
// degrades to a warning WITHOUT ever throwing. All against a temp repo in the OS tmpdir,
// so nothing touches the real accumulus checkout.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  EVENT_SCHEMA_VERSION,
  foldEvents,
  formatIngestCommitMessage,
  parseEvent,
  parseFundReview,
  type PortfolioEvent,
} from "@numisma/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureIngestCommit, readAppVersion } from "./ingest-commit.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
  vi.restoreAllMocks();
});

function git(cwd: string, args: string[]): { status: number; stdout: string } {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "" };
}

const GENESIS = {
  fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
  review: { asOf: "2026-06-01", usdMxn: 20 },
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

const MARK = { id: "mark-aapl", asOf: "2026-06-06", type: "PriceMarked", instrumentId: "aapl-usd", price: 160 };

/** A folded read model + the one parsed event, from the fixtures above. */
function foldedFixture(): { folded: ReturnType<typeof foldEvents>; appended: PortfolioEvent[] } {
  const parsedGenesis = parseFundReview(JSON.stringify(GENESIS));
  if (parsedGenesis.kind !== "ok") throw new Error("bad genesis fixture");
  const parsedMark = parseEvent(MARK);
  if (parsedMark.kind !== "ok") throw new Error("bad mark fixture");
  const appended = [parsedMark.value];
  const folded = foldEvents(parsedGenesis.value, appended);
  return { folded, appended };
}

/** A throwaway git repo seeded with genesis + events.jsonl; optionally with a remote. */
async function makeRepo(options: { withRemote?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-commit-"));
  createdDirs.push(dir);
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@example.com"]);
  git(dir, ["config", "user.name", "Test Operator"]);
  await writeFile(resolve(dir, "genesis.json"), JSON.stringify(GENESIS), "utf8");
  await writeFile(
    resolve(dir, "events.jsonl"),
    `${JSON.stringify({ schemaVersion: EVENT_SCHEMA_VERSION, ...MARK })}\n`,
    "utf8",
  );
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "seed"]);
  if (options.withRemote) {
    // A remote that can never accept a push (a non-existent local path) exercises the
    // push-failure degradation without any network.
    git(dir, ["remote", "add", "origin", resolve(dir, "does-not-exist.git")]);
  }
  return dir;
}

describe("captureIngestCommit — lands a head-digest + commit in the dataDir repo", () => {
  it("writes head-digest.json and commits with the deterministic message", async () => {
    const dir = await makeRepo();
    const { folded, appended } = foldedFixture();

    await captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: "abc1234" });

    // head-digest.json exists, is valid JSON, and carries the appended head + version.
    const headDigest = JSON.parse(await readFile(resolve(dir, "head-digest.json"), "utf8"));
    expect(headDigest.headEventId).toBe("mark-aapl");
    expect(headDigest.appVersion).toBe("abc1234");
    expect(headDigest.asOf).toBe(folded.review.asOf);

    // A new commit exists on top of the seed, with the engine's deterministic message.
    const expected = formatIngestCommitMessage({
      verbs: { PriceMarked: 1 },
      totalCount: 1,
      asOf: folded.review.asOf,
      appVersion: "abc1234",
      timestamp: "ignored",
    });
    const body = git(dir, ["log", "-1", "--format=%B"]).stdout.trim();
    expect(body).toBe(expected.trim());

    // The commit is authored by the repo's configured user, not any tooling.
    expect(git(dir, ["log", "-1", "--format=%an"]).stdout.trim()).toBe("Test Operator");
    expect(git(dir, ["log", "-1", "--format=%b"]).stdout).not.toMatch(/Co-Authored-By/i);
  });
});

describe("captureIngestCommit — degrades, never throws", () => {
  it("warns and keeps the local commit when push fails (unreachable remote)", async () => {
    const dir = await makeRepo({ withRemote: true });
    const { folded, appended } = foldedFixture();
    const warn = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await expect(
      captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: "v" }),
    ).resolves.toBeUndefined();

    // The commit landed locally even though the push could not be delivered.
    expect(git(dir, ["log", "-1", "--format=%s"]).stdout).toMatch(/^data: ingest 1 event/);
    const warnings = warn.mock.calls.map((c) => String(c[0])).join("");
    expect(warnings).toMatch(/push failed/i);
  });

  it("warns and does not throw when dataDir is not a git repo", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-norepo-"));
    createdDirs.push(dir);
    await writeFile(resolve(dir, "events.jsonl"), "", "utf8");
    const { folded, appended } = foldedFixture();
    const warn = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    await expect(
      captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: "v" }),
    ).resolves.toBeUndefined();

    // The head-digest is still written even with no repo to commit into.
    await expect(readFile(resolve(dir, "head-digest.json"), "utf8")).resolves.toContain("headEventId");
    const warnings = warn.mock.calls.map((c) => String(c[0])).join("");
    expect(warnings).toMatch(/not a git checkout/i);
  });
});

describe("readAppVersion", () => {
  it("returns the short HEAD sha, suffixed -dirty when the tree is unclean", async () => {
    const dir = await makeRepo();
    const clean = readAppVersion(dir);
    expect(clean).toMatch(/^[0-9a-f]{7,}$/);

    await writeFile(resolve(dir, "genesis.json"), JSON.stringify({ ...GENESIS, extra: 1 }), "utf8");
    expect(readAppVersion(dir)).toBe(`${clean}-dirty`);
  });

  it("falls back to 'unknown' when the dir is not a git repo", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-nogit-"));
    createdDirs.push(dir);
    expect(readAppVersion(dir)).toBe("unknown");
  });
});
