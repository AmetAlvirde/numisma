/**
 * PROTOTYPE (mvi portable-durable-log). The git-backed shell for the durable event
 * log: after a successful ingest append, capture a `checkpoint.json` + the log into a
 * commit in the dataDir (an accumulus git checkout) and best-effort push it. Per
 * ADR-001 all IO lives here in the runtime half, NOT in `@numisma/engine`; the engine
 * supplies only the two PURE derivations (`deriveCheckpoint`, `formatIngestCommitMessage`).
 *
 * The load-bearing promise: this capture is BEST-EFFORT and never breaks the ingest.
 * The append already durably landed via temp+rename before we are called, so every git
 * failure here (not a repo, commit refused, push rejected) degrades to a LOUD warning
 * and returns — it never throws, never blocks, never corrupts the append.
 *
 * Author = the repo's configured git user (we pass no --author and add no trailers), so
 * the commit is attributed to the human operator, not any tooling.
 */
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveCheckpoint,
  formatIngestCommitMessage,
  type FundReviewData,
  type PortfolioEvent,
} from "@numisma/engine";

/** The durable files we stage each ingest, when present in the dataDir. */
const TRACKED_FILES = ["events.jsonl", "checkpoint.json", "genesis.json", "preferences.jsonl"];

/** Run a git subcommand in `cwd`, capturing status/output instead of throwing. */
function git(cwd: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.error) {
    return { ok: false, stdout: "", stderr: result.error.message };
  }
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** A conspicuous, single-line warning to stderr — never fatal, never swallowed. */
function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * The numisma workspace root (the directory holding `pnpm-workspace.yaml`), located by
 * walking up from this module. Used as the git dir {@link readAppVersion} stamps the
 * checkpoint/commit from. Falls back to the process CWD if the marker is never found.
 */
export function resolveWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return process.cwd();
    }
    dir = parent;
  }
}

/**
 * The numisma code version to stamp into a checkpoint/commit: `git rev-parse --short
 * HEAD`, suffixed `-dirty` when the working tree has uncommitted changes. Falls back to
 * `"unknown"` if git is unavailable or `numismaRepoDir` is not a repo — a version we
 * cannot read must never fail an ingest.
 */
export function readAppVersion(numismaRepoDir: string): string {
  const head = git(numismaRepoDir, ["rev-parse", "--short", "HEAD"]);
  const sha = head.stdout.trim();
  if (!head.ok || sha === "") {
    return "unknown";
  }
  const status = git(numismaRepoDir, ["status", "--porcelain"]);
  const dirty = status.ok && status.stdout.trim() !== "";
  return dirty ? `${sha}-dirty` : sha;
}

/** Tally each appended event's verb (its `type`) for the deterministic commit summary. */
function verbCounts(events: PortfolioEvent[]): Record<string, number> {
  const verbs: Record<string, number> = {};
  for (const event of events) {
    verbs[event.type] = (verbs[event.type] ?? 0) + 1;
  }
  return verbs;
}

/**
 * Best-effort durable-log capture, called right after a successful ingest append that
 * wrote ≥1 new event. Writes `checkpoint.json` (via the engine's pure
 * `deriveCheckpoint`), stages the durable files, commits with the deterministic
 * `formatIngestCommitMessage`, then pushes — every failure downgraded to a loud warning.
 *
 * `headEventId` is the id of the log's head, i.e. the LAST appended event (appends go to
 * the tail), or `null` when nothing was appended.
 */
export async function captureIngestCommit(input: {
  dataDir: string;
  folded: FundReviewData;
  appendedEvents: PortfolioEvent[];
  appVersion: string;
}): Promise<void> {
  const { dataDir, folded, appendedEvents, appVersion } = input;
  try {
    const headEventId =
      appendedEvents.length > 0 ? appendedEvents[appendedEvents.length - 1]!.id : null;

    // 1) checkpoint.json — the compact folded head a reader can trust without replay.
    const checkpoint = deriveCheckpoint(folded, headEventId, appVersion);
    await writeFile(
      join(dataDir, "checkpoint.json"),
      `${JSON.stringify(checkpoint, null, 2)}\n`,
      "utf8",
    );

    // Not an accumulus checkout: the append is still durable on disk. Warn once and stop
    // (no repo to commit into) — this is the expected shape in unit tests / a fresh box.
    const inside = git(dataDir, ["rev-parse", "--is-inside-work-tree"]);
    if (!inside.ok || inside.stdout.trim() !== "true") {
      warn(`⚠️ ${dataDir} is not a git checkout — ingest commit skipped (append is durable on disk).`);
      return;
    }

    // 2) stage the durable files that exist (checkpoint always; genesis/preferences if present).
    const present = TRACKED_FILES.filter((file) => existsSync(join(dataDir, file)));
    const add = git(dataDir, ["add", ...present]);
    if (!add.ok) {
      warn(`⚠️ accumulus git add failed — ingest not captured in git (append is durable). ${add.stderr.trim()}`);
      return;
    }

    // 3) commit under the repo's configured author (no --author, no trailers).
    const message = formatIngestCommitMessage({
      verbs: verbCounts(appendedEvents),
      totalCount: appendedEvents.length,
      asOf: folded.review.asOf,
      appVersion,
      timestamp: new Date().toISOString(),
    });
    const commit = git(dataDir, ["commit", "-m", message]);
    if (!commit.ok) {
      warn(`⚠️ accumulus git commit failed — ingest not captured in git (append is durable). ${commit.stderr.trim() || commit.stdout.trim()}`);
      return;
    }

    // 4) push — best effort. A local commit stands on its own if the remote is unreachable.
    const push = git(dataDir, ["push"]);
    if (!push.ok) {
      warn(`⚠️ accumulus push failed — commit is local-only. ${push.stderr.trim()}`);
    }
  } catch (error) {
    // Any unexpected exception (a bad fold, an IO error writing checkpoint) must never
    // fail the ingest: the append already landed. Downgrade to a loud warning.
    const detail = error instanceof Error ? error.message : String(error);
    warn(`⚠️ ingest commit capture errored — append is durable, but not captured in git. ${detail}`);
  }
}
