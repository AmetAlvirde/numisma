// Footgun guards for the reliable durable-log cut (R-M2 + R-M5):
//   - The repo tree carries NO second copy of the sacred ledger — no working-tree
//     or git-tracked `data/events.jsonl` (nor the other retired in-repo ledger
//     files / the orphan `data/.gitignore`). Two sources of truth for the sacred
//     log cannot coexist; this is the tree guard the PRD mandates.
//   - `spine:reset` REFUSES to delete the log when the dataDir resolves to the
//     default accumulus ledger, and only proceeds against an explicit, non-default
//     `NUMISMA_DATA_DIR` throwaway dir.
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDataDir } from "@numisma/engine";
import { TRACKED_FILES } from "./ingest-commit.js";

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

// ---------------------------------------------------------------------------
// The durable-file floor: BOTH ENDS of the one contract (spec #163 S4 / #164).
//
// A durable file is only durable when TWO independent facts hold: the accumulus
// allowlist `.gitignore` does NOT ignore it (or every write is silently
// discarded), AND `TRACKED_FILES` names it (or nothing ever stages it). Either
// end alone is FALSE ASSURANCE — a green check over a file git is throwing away.
// So this guard asserts both, over the LIST rather than per filename: adding the
// NEXT durable file is a one-line change to EXPECTED_DURABLE_FILES. (It said "a
// sixth" while six already existed — a count in a comment goes stale on the very
// change it describes, so it no longer names one.)
//
// Membership test (ADR-006, amended): "is this durable, non-re-derivable truth?"
// ---------------------------------------------------------------------------
const EXPECTED_DURABLE_FILES = [
  "events.jsonl",
  "genesis.json",
  "head-digest.json",
  "orders.jsonl",
  "plans.jsonl",
  "preferences.jsonl",
  "reconciliations.jsonl",
].sort();

/**
 * The accumulus checkout, or `undefined` when it is absent on this machine.
 *
 * accumulus is a SEPARATE, private repo (ADR-006) that a fresh clone of numisma
 * will not have. Rather than go flaky there, the allowlist end is skipped with a
 * stated reason when the data dir is missing or is not a git checkout; the
 * `TRACKED_FILES` end is pure code and always runs.
 */
function accumulusDataDir(): string | undefined {
  const dir = resolveDataDir();
  if (!existsSync(dir)) {
    return undefined;
  }
  const inRepo = spawnSync("git", ["-C", dir, "rev-parse", "--git-dir"], { encoding: "utf8" });
  return inRepo.status === 0 ? dir : undefined;
}

/** True when git ignores `file` inside the accumulus data dir. */
function gitIgnores(dataDir: string, file: string): boolean {
  // `git check-ignore -q` exits 0 when the path IS ignored, 1 when it is not.
  // (`-v` would exit 0 for a NEGATED match too, which would invert this guard.)
  //
  // `--no-index` is load-bearing, not tidiness. Without it check-ignore consults the
  // INDEX first and reports a TRACKED path as "not ignored" whatever `.gitignore` says —
  // so four of the five durable files, already tracked, would pass this end vacuously,
  // and `orders.jsonl` would join them the moment the first daily fetch commits it. The
  // guard must interrogate the ALLOWLIST, which is the thing that can regress; being
  // already-tracked is not evidence the next write survives.
  return spawnSync("git", ["-C", dataDir, "check-ignore", "-q", "--no-index", "--", file])
    .status === 0;
}

/**
 * The forensic breadcrumb, which is the ONE durable file the wrapper must NOT stage.
 *
 * It may be intentionally ignored (the #132 shape keeps it out of history), `git add`
 * of an ignored path aborts the wrapper under `set -e`, and step 4 covers it in a
 * separate lenient `--ignored` arm that warns rather than fails. So the shell's strict
 * set is `TRACKED_FILES` MINUS this one — an exclusion the guard below asserts on
 * purpose, rather than leaving it to look like an oversight that someone later "fixes".
 */
const WRAPPER_EXCLUDED_FILE = "head-digest.json";

/**
 * The `DURABLE_STRICT_FILES=(...)` literal from the daily wrapper.
 *
 * THROWS rather than returning `[]` when it cannot find the array. Failing closed is
 * the whole point: a silent empty list would make the comparison below vacuously pass
 * on a wrapper that had stopped staging anything at all, which is a louder version of
 * the bug (#398) this guard exists to prevent.
 */
function wrapperStrictFiles(): string[] {
  const wrapper = join(repoRoot(), "ops", "price-feed", "run-daily-fetch.sh");
  const source = readFileSync(wrapper, "utf8");
  const literal = /^DURABLE_STRICT_FILES=\(([^)]*)\)/m.exec(source)?.[1];
  if (literal === undefined) {
    throw new Error(`no single-line DURABLE_STRICT_FILES=(...) literal in ${wrapper}`);
  }
  return literal.trim().split(/\s+/);
}

// End 3: THE SHELL END. `TRACKED_FILES` and the accumulus allowlist are the two ends
// the guard above pins, and pinning only those is what let #398 happen: the wrapper is
// a THIRD statement of the same list, and it silently kept staging five files against a
// seven-file contract. The daily run is the BACKSTOP — it exists for the runs where the
// in-process capture did not happen — so a file missing from it is uncommitted exactly
// when nothing else was going to commit it, and step 4 then reports the tree clean.
//
// Collapsing the wrapper's two literals into one array (#398) is what makes this a
// single assertion instead of two.
describe("durable-file floor — the wrapper stages the same list it checks", () => {
  it("end 3: DURABLE_STRICT_FILES is TRACKED_FILES minus the forensic breadcrumb", () => {
    const expected = TRACKED_FILES.filter((file) => file !== WRAPPER_EXCLUDED_FILE).sort();
    expect([...wrapperStrictFiles()].sort()).toEqual(expected);
  });

  it("end 3: the wrapper never stages head-digest.json (`git add` of an ignored path aborts)", () => {
    expect(wrapperStrictFiles()).not.toContain(WRAPPER_EXCLUDED_FILE);
  });
});

describe("durable-file floor — both ends of the allowlist/TRACKED_FILES contract", () => {
  const dataDir = accumulusDataDir();

  it("end 2: TRACKED_FILES names exactly the durable files", () => {
    expect([...TRACKED_FILES].sort()).toEqual(EXPECTED_DURABLE_FILES);
  });

  it.skipIf(dataDir === undefined)(
    "end 1: the accumulus allowlist ignores none of the durable files",
    () => {
      const ignored = EXPECTED_DURABLE_FILES.filter((file) => gitIgnores(dataDir!, file));
      expect(ignored).toEqual([]);

      // Control: the allowlist polarity is real, not an empty/absent .gitignore
      // that would make the assertion above pass vacuously.
      expect(gitIgnores(dataDir!, join("prices", "btc.json"))).toBe(true);
    },
  );
});
