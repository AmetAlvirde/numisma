// Footgun guards for the reliable durable-log cut (R-M2 + R-M5):
//   - The repo tree carries NO second copy of the sacred ledger — no working-tree
//     or git-tracked `data/events.jsonl` (nor the other retired in-repo ledger
//     files / the orphan `data/.gitignore`). Two sources of truth for the sacred
//     log cannot coexist; this is the tree guard the PRD mandates.
//   - `spine:reset` REFUSES to delete the log when the dataDir resolves to the
//     default accumulus ledger, and only proceeds against an explicit, non-default
//     `NUMISMA_DATA_DIR` throwaway dir.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// The spine:reset guard cases spawn `tsx` subprocesses; give them headroom under load.
vi.setConfig({ testTimeout: 30_000 });

/** Walk up from this test to the workspace root (the `pnpm-workspace.yaml` dir). */
function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error("workspace root (pnpm-workspace.yaml) not found");
    }
    dir = parent;
  }
}

describe("durable-log tree guard — no second copy of the sacred ledger (R-M2)", () => {
  it("carries no data/events.jsonl in the working tree", () => {
    expect(existsSync(join(repoRoot(), "data", "events.jsonl"))).toBe(false);
  });

  it("tracks none of the retired in-repo ledger files in git", () => {
    const root = repoRoot();
    const tracked = spawnSync(
      "git",
      [
        "-C",
        root,
        "ls-files",
        "data/events.jsonl",
        "data/genesis.json",
        "data/preferences.jsonl",
        "data/.gitignore",
      ],
      { encoding: "utf8" },
    );
    expect(tracked.stdout.trim()).toBe("");
  });
});

describe("spine:reset destructive-default guard (R-M5)", () => {
  const createdDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    createdDirs.length = 0;
  });

  /** Run the real `spine-reset.ts` script under tsx with a controlled env. */
  function runReset(dataDir?: string): { status: number | null; stderr: string; stdout: string } {
    const root = repoRoot();
    const script = join(root, "apps", "tui", "src", "spine-reset.ts");
    const tsx = join(root, "node_modules", ".bin", "tsx");
    const env = { ...process.env };
    delete env.NUMISMA_DATA_DIR;
    if (dataDir !== undefined) {
      env.NUMISMA_DATA_DIR = dataDir;
    }
    const result = spawnSync(tsx, [script], { encoding: "utf8", env });
    return { status: result.status, stderr: result.stderr ?? "", stdout: result.stdout ?? "" };
  }

  it("refuses (exit 1) at the default accumulus dataDir, never touching the durable log", () => {
    const result = runReset(undefined);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/refused/i);
    expect(result.stderr).toMatch(/accumulus/i);
  });

  it("proceeds against an explicit non-default throwaway dataDir", async () => {
    const dir = await mkdtemp(resolve(tmpdir(), "numisma-reset-"));
    createdDirs.push(dir);
    await writeFile(join(dir, "events.jsonl"), "x", "utf8");

    const result = runReset(dir);

    expect(result.status).toBe(0);
    expect(existsSync(join(dir, "events.jsonl"))).toBe(false);
  });
});
