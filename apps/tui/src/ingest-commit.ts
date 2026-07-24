/**
 * The git-backed shell for the durable event log: after a successful ingest append,
 * capture a `head-digest.json` + the log into a commit in the dataDir (an accumulus git
 * checkout) and best-effort push it. Per ADR-001 all IO lives here in the runtime half,
 * NOT in `@numisma/engine`; the engine supplies only the two PURE derivations
 * (`deriveHeadDigest`, `formatIngestCommitMessage`).
 *
 * The load-bearing promise: this capture is BEST-EFFORT and never breaks the ingest.
 * The append already durably landed via temp+rename before we are called, so every git
 * failure here (not a repo, staging refused, commit refused, push rejected, timeout)
 * degrades to a LOUD warning and returns — it never throws, never blocks, never
 * corrupts the append. "Never blocks" rests on code, not on a primed credential helper:
 * every `git` runs with `GIT_TERMINAL_PROMPT=0` so a credential prompt on a controlling
 * TTY can never hang us, and the network-touching `commit`/`push` carry a bounded
 * timeout so a stuck child is killed and downgraded to one more loud warning.
 *
 * Ordering invariant: append → write head-digest → scoped stage → commit → push. Each
 * step's failure is terminal-and-loud; nothing after the (already durable) append can
 * throw out of this seam.
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
  deriveHeadDigest,
  formatIngestCommitMessage,
  type FundReviewData,
  type PortfolioEvent,
} from "@numisma/engine";

/** The durable files we stage each ingest, when present in the dataDir. */
const TRACKED_FILES = ["events.jsonl", "head-digest.json", "genesis.json", "preferences.jsonl"];

/**
 * Bounded timeouts (ms) for the git steps that can touch the network or a credential
 * helper. A `push` can hang on an interactive credential/host-key prompt or an
 * unreachable remote; `commit` normally cannot, but a signing hook or a wedged index
 * lock could stall it, so it is guarded defensively. A timeout kills the child and
 * becomes one more loud-warn downgrade — never an indefinite block on ingest return.
 */
const COMMIT_TIMEOUT_MS = 10_000;
const PUSH_TIMEOUT_MS = 15_000;

/** The outcome of one git invocation; `timedOut` flags a killed-by-timeout child. */
export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/**
 * Runs one git subcommand and reports its outcome without throwing. Injectable so the
 * seam's downgrade branches (staging refused, commit refused, push timeout) can be
 * driven deterministically in tests; production always uses {@link realGit}.
 */
export type GitRunner = (
  cwd: string,
  args: string[],
  options?: { timeoutMs?: number },
) => GitResult;

/**
 * Run a git subcommand in `cwd`, capturing status/output instead of throwing.
 *
 * `GIT_TERMINAL_PROMPT=0` is forced on every call so a missing/expired credential can
 * never open an interactive prompt on the controlling TTY and hang `spawnSync`; git
 * fails fast instead. An optional `timeoutMs` kills a child that outlives it — detected
 * via either the `ETIMEDOUT` error or the `SIGTERM` kill signal — and is surfaced as
 * `timedOut` so the caller can downgrade it loudly rather than block forever.
 */
function realGit(cwd: string, args: string[], options: { timeoutMs?: number } = {}): GitResult {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    ...(options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : {}),
  });
  const timedOut =
    result.signal === "SIGTERM" ||
    (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  if (result.error) {
    return { ok: false, stdout: "", stderr: result.error.message, timedOut };
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut,
  };
}

/** A conspicuous, single-line warning to stderr — never fatal, never swallowed. */
function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}

/**
 * The numisma workspace root (the directory holding `pnpm-workspace.yaml`), located by
 * walking up from this module. Used as the git dir {@link readAppVersion} stamps the
 * head-digest/commit from. Falls back to the process CWD if the marker is never found.
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
 * The numisma code version to stamp into a head-digest/commit: `git rev-parse --short
 * HEAD`, suffixed `-dirty` when the working tree has uncommitted changes. Falls back to
 * `"unknown"` if git is unavailable or `numismaRepoDir` is not a repo — a version we
 * cannot read must never fail an ingest.
 */
export function readAppVersion(numismaRepoDir: string): string {
  const head = realGit(numismaRepoDir, ["rev-parse", "--short", "HEAD"]);
  const sha = head.stdout.trim();
  if (!head.ok || sha === "") {
    return "unknown";
  }
  const status = realGit(numismaRepoDir, ["status", "--porcelain"]);
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
 * wrote ≥1 new event. Writes `head-digest.json` (via the engine's pure
 * `deriveHeadDigest`), stages the durable files, commits with the deterministic
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
  /** Test seam: override the git executor. Defaults to the real, TTY-safe runner. */
  runGit?: GitRunner;
}): Promise<void> {
  const { dataDir, folded, appendedEvents, appVersion } = input;
  const runGit = input.runGit ?? realGit;
  try {
    const headEventId =
      appendedEvents.length > 0 ? appendedEvents[appendedEvents.length - 1]!.id : null;

    // 1) head-digest.json — the compact folded head a reader can trust without replay.
    const headDigest = deriveHeadDigest(folded, headEventId, appVersion);
    await writeFile(
      join(dataDir, "head-digest.json"),
      `${JSON.stringify(headDigest, null, 2)}\n`,
      "utf8",
    );

    // Not an accumulus checkout: the append is still durable on disk. Warn once and stop
    // (no repo to commit into) — this is the expected shape in unit tests / a fresh box.
    const inside = runGit(dataDir, ["rev-parse", "--is-inside-work-tree"]);
    if (!inside.ok || inside.stdout.trim() !== "true") {
      warn(`⚠️ ${dataDir} is not a git checkout — ingest commit skipped (append is durable on disk).`);
      return;
    }

    // 2) stage ONLY the durable files that exist, EACH in its own `git add` (never
    //    `git add -A`, so a stray `prices/foo.json` or `*.tmp` in the dataDir can never
    //    be captured). Per-file, not one atomic add of the whole list: a single
    //    only-ignored pathspec (e.g. a stale accumulus allowlist that excludes
    //    head-digest) makes `git add` abort the ENTIRE batch, which is exactly how the
    //    durable log went uncaptured for 17 days. Each file that refuses to stage warns
    //    loudly and is skipped; the rest — the log above all — still commit. Q3's
    //    post-check is the hard backstop that reddens the job if the LOG is left dirty.
    const present = TRACKED_FILES.filter((file) => existsSync(join(dataDir, file)));
    let stagedAny = false;
    for (const file of present) {
      const add = runGit(dataDir, ["add", file]);
      if (add.ok) {
        stagedAny = true;
      } else {
        warn(`⚠️ accumulus git add failed for ${file} — that file not captured this ingest (append is durable). ${add.stderr.trim()}`);
      }
    }
    if (!stagedAny) {
      warn(`⚠️ accumulus git add staged nothing — ingest not captured in git (append is durable).`);
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
    const commit = runGit(dataDir, ["commit", "-m", message], { timeoutMs: COMMIT_TIMEOUT_MS });
    if (!commit.ok) {
      const why = commit.timedOut ? "timed out" : "failed";
      warn(`⚠️ accumulus git commit ${why} — ingest not captured in git (append is durable). ${commit.stderr.trim() || commit.stdout.trim()}`);
      return;
    }

    // 4) push — best effort. A local commit stands on its own if the remote is
    //    unreachable, and a bounded timeout keeps a credential/host-key hang from
    //    ever blocking the ingest's return.
    const push = runGit(dataDir, ["push"], { timeoutMs: PUSH_TIMEOUT_MS });
    if (!push.ok) {
      const why = push.timedOut ? "timed out" : "failed";
      warn(`⚠️ accumulus push ${why} — commit is local-only. ${push.stderr.trim()}`);
    }
  } catch (error) {
    // Any unexpected exception (a bad fold, an IO error writing head-digest) must never
    // fail the ingest: the append already landed. Downgrade to a loud warning.
    const detail = error instanceof Error ? error.message : String(error);
    warn(`⚠️ ingest commit capture errored — append is durable, but not captured in git. ${detail}`);
  }
}
