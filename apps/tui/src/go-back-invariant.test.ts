// The go-back invariant, as code: after a bad-but-valid event is appended and captured,
// `git revert` of that commit + a re-fold of the SURVIVING events re-derives a Head Digest
// byte-identical to the one from BEFORE the bad append. This is the reason the whole
// increment exists (PRD #114): the fold over events — not the committed breadcrumb — is the
// single source of truth, so reverting the bad line and re-folding restores the correct NAV.
//
// Everything runs against a throwaway git repo in the OS tmpdir (via the shared
// ingest-commit fixtures), so nothing touches the real accumulus checkout.
import { appendFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import {
  deriveHeadDigest,
  foldEvents,
  parseEvent,
  parseFundReview,
  type PortfolioEvent,
} from "@numisma/engine";
import { afterEach, describe, expect, it, vi } from "vitest";
import { captureIngestCommit } from "./ingest-commit.js";
import { GENESIS, git, initGitRepo, logLine, MARK } from "./ingest-commit.fixtures.js";

// Each case spawns several real `git` children plus a workspace-version read; give the
// git-heavy suite headroom over the 5s default under parallel load.
vi.setConfig({ testTimeout: 30_000 });

const APP_VERSION = "gobackv1";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
  vi.restoreAllMocks();
});

/** Parse an inbox event object into a domain event (throws on a bad fixture). */
function parse(event: Record<string, unknown>): PortfolioEvent {
  const result = parseEvent(event);
  if (result.kind !== "ok") throw new Error(`bad event fixture: ${JSON.stringify(event)}`);
  return result.value;
}

/** Fold the fixture genesis over `events`. */
function fold(events: PortfolioEvent[]): ReturnType<typeof foldEvents> {
  const parsedGenesis = parseFundReview(JSON.stringify(GENESIS));
  if (parsedGenesis.kind !== "ok") throw new Error("bad genesis fixture");
  return foldEvents(parsedGenesis.value, events);
}

// A SECOND PriceMarked that is structurally valid and folds cleanly, but carries a
// semantically-wrong price (a later mark that moves NAV) — the "bad-but-valid" append the
// whole feature exists to reverse.
const BAD_MARK = {
  id: "mark-aapl-bad",
  asOf: "2026-06-07",
  type: "PriceMarked",
  instrumentId: "aapl-usd",
  price: 210,
};

describe("go-back invariant: git revert + re-fold restores the pre-bad Head Digest", () => {
  it("re-derives a Head Digest byte-identical to the one before the bad append", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-goback-"));
    createdDirs.push(dir);
    initGitRepo(dir);
    await writeFile(resolve(dir, "genesis.json"), JSON.stringify(GENESIS), "utf8");
    git(dir, ["add", "genesis.json"]);
    git(dir, ["commit", "-q", "-m", "seed genesis"]);
    // Silence the capture seam's stderr (it is a real repo, so it commits happily).
    vi.spyOn(process.stderr, "write").mockReturnValue(true);

    // --- 1) GOOD append: land the first mark and capture its commit. ---------------
    const good = parse(MARK);
    await writeFile(resolve(dir, "events.jsonl"), logLine(MARK), "utf8");
    await captureIngestCommit({
      dataDir: dir,
      folded: fold([good]),
      appendedEvents: [good],
      appVersion: APP_VERSION,
    });
    const goodDigest = JSON.parse(await readFile(resolve(dir, "head-digest.json"), "utf8"));

    // --- 2) BAD-but-valid append: land the wrong mark and capture its commit. ------
    const bad = parse(BAD_MARK);
    await appendFile(resolve(dir, "events.jsonl"), logLine(BAD_MARK), "utf8");
    await captureIngestCommit({
      dataDir: dir,
      folded: fold([good, bad]),
      appendedEvents: [bad],
      appVersion: APP_VERSION,
    });
    const badCommit = git(dir, ["rev-parse", "HEAD"]).stdout.trim();
    const badDigest = JSON.parse(await readFile(resolve(dir, "head-digest.json"), "utf8"));

    // The bad append MUST actually have moved the head — otherwise the test proves nothing.
    expect(badDigest.headEventId).toBe("mark-aapl-bad");
    expect(badDigest.fundValueUsd).not.toBe(goodDigest.fundValueUsd);

    // --- 3) GO BACK: git revert the bad commit. ------------------------------------
    const revert = git(dir, ["revert", "--no-edit", badCommit]);
    expect(revert.status).toBe(0);

    // --- 4) RE-FOLD the SURVIVING events from disk and re-derive the Head Digest. ---
    const surviving = (await readFile(resolve(dir, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => parse(JSON.parse(line) as Record<string, unknown>));
    // The revert removed exactly the bad line; only the good mark survives.
    expect(surviving.map((event) => event.id)).toEqual(["mark-aapl"]);

    const headEventId = surviving.length > 0 ? surviving[surviving.length - 1]!.id : null;
    const reDerived = deriveHeadDigest(fold(surviving), headEventId, APP_VERSION);

    // The invariant: fold stays truth, breadcrumb is faithful. The re-derived digest
    // equals the pre-bad digest byte for byte — NAV, counts, head id, and version.
    expect(reDerived).toEqual(goodDigest);
  });
});
