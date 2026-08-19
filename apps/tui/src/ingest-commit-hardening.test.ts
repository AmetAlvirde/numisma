// Seam-robustness locks for the best-effort durable-log capture. The load-bearing
// promise is that the capture NEVER blocks and NEVER throws out of the seam: the
// append already landed durably before we run, so every git failure — staging
// refused, commit refused, a push that hangs and is killed by the bounded timeout —
// downgrades to a single loud stderr warning and returns. Fault branches are driven
// through the injectable git runner (deterministic, no real hang); the exec-safety,
// scoped-staging, and no-attribution invariants run against a REAL throwaway repo so
// the argv path to spawnSync is exercised for real.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureIngestCommit, type GitResult, type GitRunner } from "./ingest-commit.js";
import { foldedFixture, GENESIS, git, initGitRepo, logLine, MARK } from "./ingest-commit.fixtures.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
  vi.restoreAllMocks();
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(resolve(tmpdir(), prefix));
  createdDirs.push(dir);
  return dir;
}

/** A real throwaway repo seeded with genesis + a one-line events.jsonl. */
async function makeRepo(): Promise<string> {
  const dir = await tempDir("numisma-harden-");
  await writeFile(resolve(dir, "genesis.json"), JSON.stringify(GENESIS), "utf8");
  await writeFile(resolve(dir, "events.jsonl"), logLine(MARK), "utf8");
  initGitRepo(dir);
  return dir;
}

type Stage = "rev-parse" | "add" | "commit" | "push";

/** A deterministic git runner: every stage succeeds unless overridden. */
function fakeRunner(overrides: Partial<Record<Stage, GitResult>>): GitRunner {
  return (_cwd, args) => {
    const stage: Stage = args.includes("rev-parse")
      ? "rev-parse"
      : args[0] === "add"
        ? "add"
        : args[0] === "commit"
          ? "commit"
          : "push";
    const ok: GitResult = {
      ok: true,
      stdout: stage === "rev-parse" ? "true\n" : "",
      stderr: "",
      timedOut: false,
    };
    return overrides[stage] ?? ok;
  };
}

function spyStderr(): { warnings: () => string } {
  const spy = vi.spyOn(process.stderr, "write").mockReturnValue(true);
  return { warnings: () => spy.mock.calls.map((call) => String(call[0])).join("") };
}

describe("captureIngestCommit — degrades every fault to a loud warn, never throws", () => {
  it("downgrades a refused staging (git add fails)", async () => {
    const dir = await tempDir("numisma-stage-");
    const { folded, appended } = foldedFixture();
    const stderr = spyStderr();
    const runGit = fakeRunner({
      add: { ok: false, stdout: "", stderr: "permission denied", timedOut: false },
    });

    await expect(
      captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: "v", runGit }),
    ).resolves.toBeUndefined();

    expect(stderr.warnings()).toMatch(/add failed/i);
    // The head-digest was still written before the failed stage.
    await expect(readFile(resolve(dir, "head-digest.json"), "utf8")).resolves.toContain("headEventId");
  });

  it("downgrades a refused commit (git commit fails)", async () => {
    const dir = await tempDir("numisma-commitfail-");
    const { folded, appended } = foldedFixture();
    const stderr = spyStderr();
    const runGit = fakeRunner({
      commit: { ok: false, stdout: "", stderr: "nothing to commit", timedOut: false },
    });

    await expect(
      captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: "v", runGit }),
    ).resolves.toBeUndefined();

    expect(stderr.warnings()).toMatch(/commit failed/i);
  });

  it("downgrades a push that hangs and is killed by the bounded timeout (R-M1)", async () => {
    const dir = await tempDir("numisma-timeout-");
    const { folded, appended } = foldedFixture();
    const stderr = spyStderr();
    const runGit = fakeRunner({
      push: { ok: false, stdout: "", stderr: "git push ETIMEDOUT", timedOut: true },
    });

    await expect(
      captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: "v", runGit }),
    ).resolves.toBeUndefined();

    expect(stderr.warnings()).toMatch(/push timed out/i);
  });

  it("downgrades an unexpected exception (head-digest write throws) to a warn", async () => {
    // dataDir is a FILE, so writing `<dataDir>/head-digest.json` throws ENOTDIR — an
    // exception from inside the seam that must still be caught and downgraded.
    const parent = await tempDir("numisma-throw-");
    const filePath = resolve(parent, "not-a-dir");
    await writeFile(filePath, "x", "utf8");
    const { folded, appended } = foldedFixture();
    const stderr = spyStderr();

    await expect(
      captureIngestCommit({ dataDir: filePath, folded, appendedEvents: appended, appVersion: "v" }),
    ).resolves.toBeUndefined();

    expect(stderr.warnings()).toMatch(/errored/i);
  });
});

describe("captureIngestCommit — exec safety + scoped staging in a real repo", () => {
  // These temp repos have no remote, so the best-effort push fails and downgrades to a
  // loud warn (the intended behavior); silence it so the run's stderr stays clean.
  beforeEach(() => {
    vi.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  it("passes a message with \", backtick, $(...), and a newline verbatim (no shell:true)", async () => {
    const dir = await makeRepo();
    const { folded, appended } = foldedFixture();
    // The appVersion flows into the commit body's `numisma-version:` line. If the
    // message were ever routed through a shell, these metacharacters would break the
    // argv or expand `$(...)`. Via distinct spawnSync argv they must land verbatim.
    const dangerous = 'v"1 `id` $(whoami)\nSECOND-LINE';

    await captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: dangerous });

    const body = git(dir, ["log", "-1", "--format=%B"]).stdout;
    expect(body).toContain(`numisma-version: ${dangerous}`);
    // The metacharacters survived unexpanded (no shell ran them).
    expect(body).toContain("$(whoami)");
    expect(body).toContain("`id`");
  });

  it("stages only the durable files — never `git add -A`, so a stray file is not captured", async () => {
    const dir = await makeRepo();
    const { folded, appended } = foldedFixture();
    // Drop disposable cruft the allowlist `.gitignore` would exclude in accumulus but
    // that is stageable in this bare test repo: scoped staging must skip them anyway.
    await writeFile(resolve(dir, "stray.tmp"), "junk", "utf8");
    await mkdir(resolve(dir, "prices"), { recursive: true });
    await writeFile(resolve(dir, "prices", "foo.json"), "{}", "utf8");

    await captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: "v" });

    const committed = git(dir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).stdout;
    expect(committed).toContain("head-digest.json");
    expect(committed).not.toContain("stray.tmp");
    expect(committed).not.toContain("prices/foo.json");
    // The stray files remain untracked in the working tree (never staged).
    const status = git(dir, ["status", "--porcelain"]).stdout;
    expect(status).toMatch(/\?\? stray\.tmp/);
    expect(status).toMatch(/\?\? prices\//);
  });

  it("stamps a dirty-numisma appVersion into a real landed commit body", async () => {
    const dir = await makeRepo();
    const { folded, appended } = foldedFixture();

    await captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: "abc1234-dirty" });

    const body = git(dir, ["log", "-1", "--format=%B"]).stdout;
    expect(body).toContain("numisma-version: abc1234-dirty");
  });

  it("adds no tooling attribution even when GIT_AUTHOR_* is set in the env (D10)", async () => {
    const dir = await makeRepo();
    const { folded, appended } = foldedFixture();
    const prevName = process.env.GIT_AUTHOR_NAME;
    const prevEmail = process.env.GIT_AUTHOR_EMAIL;
    process.env.GIT_AUTHOR_NAME = "Env Override";
    process.env.GIT_AUTHOR_EMAIL = "env@example.com";
    try {
      await captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: "v" });
    } finally {
      if (prevName === undefined) delete process.env.GIT_AUTHOR_NAME;
      else process.env.GIT_AUTHOR_NAME = prevName;
      if (prevEmail === undefined) delete process.env.GIT_AUTHOR_EMAIL;
      else process.env.GIT_AUTHOR_EMAIL = prevEmail;
    }

    // The env identity is honored (our code passes NO `--author` overriding it) and
    // NO `Co-Authored-By` trailer is injected — the capture never attributes to tooling.
    expect(git(dir, ["log", "-1", "--format=%an"]).stdout.trim()).toBe("Env Override");
    expect(git(dir, ["log", "-1", "--format=%B"]).stdout).not.toMatch(/Co-Authored-By/i);
  });
});

describe("captureIngestCommit — allowlist (.gitignore) repos mirroring accumulus (#132)", () => {
  // A fresh appended mark, so the durable LOG is genuinely dirty when capture runs —
  // the real daily shape (the append lands first, then capture commits it). Without
  // this the log is unchanged since seed and the scenario can't prove it was captured.
  const DAY2 = { ...MARK, id: "mark-aapl-day2", asOf: "2026-06-07" };

  // The allowlist strategy inlined here (root-relative, since the test's dataDir IS the
  // repo root) mirrors accumulus's PATTERN — ignore all, then negate the durable files —
  // WITHOUT reading the sibling repo's real .gitignore, so the suite stays decoupled.
  const FIXED_ALLOWLIST = [
    "*",
    "!/.gitignore",
    "!/genesis.json",
    "!/events.jsonl",
    "!/preferences.jsonl",
    "!/head-digest.json",
  ];
  // The pre-fix drift (issue #132): the 4th durable file is still negated under its DEAD
  // name, so the real head-digest.json falls under the `*` catch-all and is IGNORED.
  const DRIFTED_ALLOWLIST = [
    "*",
    "!/.gitignore",
    "!/genesis.json",
    "!/events.jsonl",
    "!/preferences.jsonl",
    "!/checkpoint.json",
  ];

  /**
   * A throwaway repo seeded like accumulus: an allowlist `.gitignore`, a committed
   * genesis + one-line events log, then a SECOND mark appended to the log left dirty in
   * the working tree (the state capture is called in). No remote, so the best-effort
   * push warns — callers spy stderr to keep it quiet / assert on it.
   */
  async function makeAllowlistRepo(ignoreLines: string[]): Promise<string> {
    const dir = await tempDir("numisma-allowlist-");
    await writeFile(resolve(dir, ".gitignore"), `${ignoreLines.join("\n")}\n`, "utf8");
    await writeFile(resolve(dir, "genesis.json"), JSON.stringify(GENESIS), "utf8");
    await writeFile(resolve(dir, "events.jsonl"), logLine(MARK), "utf8");
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "test@example.com"]);
    git(dir, ["config", "user.name", "Test Operator"]);
    git(dir, ["config", "commit.gpgsign", "false"]);
    git(dir, ["add", ".gitignore", "genesis.json", "events.jsonl"]);
    git(dir, ["commit", "-q", "-m", "seed"]);
    // The day's append: now events.jsonl is dirty, exactly as after a real ingest.
    await writeFile(resolve(dir, "events.jsonl"), logLine(MARK) + logLine(DAY2), "utf8");
    return dir;
  }

  it("captures both the appended log AND head-digest under the correct allowlist (locks Q1's fixed state)", async () => {
    const dir = await makeAllowlistRepo(FIXED_ALLOWLIST);
    const { folded, appended } = foldedFixture();
    const stderr = spyStderr();

    await captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: "v" });

    // head-digest.json is now tracked (allowlisted) and the new commit captured it...
    expect(git(dir, ["ls-files"]).stdout).toContain("head-digest.json");
    const committed = git(dir, ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"]).stdout;
    expect(committed).toContain("head-digest.json");
    // ...alongside the day's appended mark (the log landed, not just the seed).
    expect(git(dir, ["show", "HEAD:events.jsonl"]).stdout).toContain("mark-aapl-day2");
    // No durable file was refused.
    expect(stderr.warnings()).not.toMatch(/add failed/i);
  });

  it("still captures the LOG when head-digest is only-ignored — per-file add never aborts the batch (Q2 vs. the 17-day outage)", async () => {
    // The drifted allowlist ignores head-digest.json. The OLD atomic `git add
    // events.jsonl head-digest.json …` aborted WHOLESALE on that only-ignored pathspec,
    // dropping the durable log too — the exact silent miss. Per-file staging must let
    // the log through and only warn on the file that truly can't stage.
    const dir = await makeAllowlistRepo(DRIFTED_ALLOWLIST);
    const { folded, appended } = foldedFixture();
    const stderr = spyStderr();

    await captureIngestCommit({ dataDir: dir, folded, appendedEvents: appended, appVersion: "v" });

    // The appended log DID land in a new commit (old atomic code left it uncommitted).
    expect(git(dir, ["show", "HEAD:events.jsonl"]).stdout).toContain("mark-aapl-day2");
    // head-digest.json is genuinely ignored here — it never sneaks into history.
    expect(git(dir, ["ls-files"]).stdout).not.toContain("head-digest.json");
    // The refused file warned loudly and by name (reaches an operator, unlike a drop).
    expect(stderr.warnings()).toMatch(/add failed for head-digest\.json/i);
  });
});
