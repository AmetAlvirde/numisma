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

// The real-repo cases spawn several git children each; give them headroom under load.
vi.setConfig({ testTimeout: 30_000 });

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
    // The checkpoint was still written before the failed stage.
    await expect(readFile(resolve(dir, "checkpoint.json"), "utf8")).resolves.toContain("headEventId");
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

  it("downgrades an unexpected exception (checkpoint write throws) to a warn", async () => {
    // dataDir is a FILE, so writing `<dataDir>/checkpoint.json` throws ENOTDIR — an
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
    expect(committed).toContain("checkpoint.json");
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
