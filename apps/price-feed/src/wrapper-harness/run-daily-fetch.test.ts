/**
 * THE COMMITTED TEST HARNESS FOR `ops/price-feed/run-daily-fetch.sh` (PRD #314, slice #316).
 *
 * ⚠️ **THIS SUITE CAN NEVER RUN IN CI AS CI EXISTS TODAY. A GREEN CI RUN DOES NOT MEAN
 * THIS HARNESS PASSED — IT MEANS IT WAS NOT ATTEMPTED.** CI is a single `ubuntu-latest`
 * job. This suite targets macOS `/bin/bash` 3.2.57, BSD `ps`/`pgrep`, and a watchdog that
 * is hand-rolled *because* macOS ships no `timeout(1)`. The same sentence is written in
 * `docs/price-feed-ops.md` and beside the test step in `.github/workflows/ci.yml`, which
 * is where someone reading a green check actually looks.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────
 * The wrapper's teardown has produced four real defects, and every one of them was found
 * by hand, after the fact, on a throwaway script that was then discarded: a stray `sleep`
 * orphaned into the run's process group holding launchd's per-label job slot; a `tee`
 * killed by the group TERM taking the heartbeat with it; a TERM-deaf grandchild surviving
 * a timeout; a decorated `LAST_STEP` silently breaking the marks-landed predicate. Three
 * of the four were caught by ONE observation — *is anything still in the run's process
 * group?* — and none of them was visible to a linter or to a single green run.
 *
 * ── WHAT IS ARMED, AND WHEN ───────────────────────────────────────────────────────────
 * The expensive block runs when its own subject changed (§7's ruling), never silently:
 * one always-running test reports the decision, the base SHA it compared against and the
 * path set, so every `pnpm test` carries a line about this harness whether or not it ran.
 * `pnpm test:wrapper` runs it on demand. `NUMISMA_WRAPPER_TEST=never` mutes it and says so.
 *
 * ── WHAT SLICE 1 CLAIMS, AND WHAT IT DOES NOT ─────────────────────────────────────────
 * Claims: the launcher, the isolation refusal, the fake-tool bin and its sentinel, the
 * assertion triple, 12-run repetition, the arming trigger and its three guard layers,
 * case 1 (healthy), case 7 (not a group leader) and the child-reap mutation control.
 * Does not: any timeout, external-stop or mark-window case — slices 2-4 — nor the `hangs`,
 * `exits 127` and TERM-deaf fakes those need. Case 7 here therefore proves the leader
 * DETECTION with a fast, succeeding run; slice 2 will additionally prove that a genuine
 * hang under a disabled watchdog does not time out, once the `hangs` behavior exists.
 *
 * ── A BLIND SPOT THIS DESIGN CREATES, NAMED RATHER THAN IMPLIED ───────────────────────
 * The fake `pnpm` is what makes every case fast and safe, and it is therefore exactly what
 * blinds this suite to the REAL pnpm. Rename a script in the root `package.json` and the
 * wrapper's `pnpm backfill` breaks in production while every case here stays green. That
 * is why §7.3 keeps the four command implementations OUT of the trigger set: the suite has
 * nothing to say about them, and a trigger that armed on them would be claiming otherwise.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HARNESS_PLATFORM,
  TRIGGER_PATH_SET,
  decideArming,
  matchesPathSet,
  parsePorcelain,
  readOverride,
  resolveTriggerFacts,
  type BaseResolution,
} from "./arming-trigger.testkit.js";
import {
  CHILD_REAP_MUTATION,
  LAUNCHD_BARE_PATH,
  caseEnv,
  makeCaseDir,
  mutateWrapper,
  type CaseOptions,
} from "./case-dir.testkit.js";
import { WRAPPER_PNPM_COMMANDS, installDecoyBin, sentinelNameFor } from "./fake-bin.testkit.js";
import { IsolationRefusal, WRAPPER_ENV_VARS, assertIsolated } from "./isolation.testkit.js";
import { launchWrapper, observedBashVersion, type RunRecord } from "./launcher.testkit.js";
import { REPETITION_FLOOR, resolveRunCount } from "./repetition.testkit.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const WRAPPER_RELATIVE_PATH = "ops/price-feed/run-daily-fetch.sh";
const WRAPPER_PATH = join(REPO_ROOT, WRAPPER_RELATIVE_PATH);

// ── THE ARMING DECISION, TAKEN ONCE ───────────────────────────────────────────────────
const override = readOverride(process.env.NUMISMA_WRAPPER_TEST);
const facts = resolveTriggerFacts(REPO_ROOT);
const decision = decideArming({
  changedPaths: facts.changedPaths,
  base: facts.base,
  pathSet: TRIGGER_PATH_SET,
  platform: process.platform,
  override,
});

/**
 * These five build a real repository and run several `git` processes against a brand-new
 * temp directory, which on this machine costs a second or two — comfortably over vitest's
 * 5s default once the machine is under parallel test load. Raised explicitly rather than
 * globally: it is a fixture cost, not a change to any assertion.
 */
const GIT_FIXTURE_TIMEOUT_MS = 60_000;

/** An isolated git environment, so a temp repo cannot inherit this machine's config. */
function gitEnv(home: string): NodeJS.ProcessEnv {
  return {
    PATH: LAUNCHD_BARE_PATH,
    HOME: home,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_AUTHOR_NAME: "numisma wrapper harness",
    GIT_AUTHOR_EMAIL: "harness@invalid",
    GIT_COMMITTER_NAME: "numisma wrapper harness",
    GIT_COMMITTER_EMAIL: "harness@invalid",
    GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z",
    GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z",
  };
}

/**
 * A throwaway repository for the trigger's REAL git behavior. The decision function can be
 * unit-tested over authored inputs, but "a wrapper edit three commits back on a branch
 * still arms" is a claim about `git merge-base` and the `base...HEAD` range — it is only
 * provable against real git, and it is exactly the claim that separates a correct base
 * from a lazy `HEAD~1`.
 */
function makeTempRepo(): { dir: string; env: NodeJS.ProcessEnv; git: (...args: string[]) => string } {
  const dir = mkdtempSync(join(tmpdir(), "numisma-trigger-repo-"));
  const env = gitEnv(join(dir, "home"));
  mkdirSync(join(dir, "home"), { recursive: true });
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet", "--initial-branch", "main");
  return { dir, env, git };
}

function writeIn(dir: string, relativePath: string, contents: string): void {
  const full = join(dir, relativePath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, contents, "utf8");
}

// ══════════════════════════════════════════════════════════════════════════════════════
// ALWAYS RUNS. Everything below this line survives the very skip it is guarding against —
// that is the whole point of §7.5. A conditional suite's new silent failure is "always
// skipped", and it is indistinguishable from healthy: a typo'd glob matches nothing, the
// suite skips forever, every PR is green, and the skip line reads perfectly normal.
// ══════════════════════════════════════════════════════════════════════════════════════
describe("wrapper harness — the arming trigger (always runs)", () => {
  it("reports its decision out loud, with the base it compared against and the path set", () => {
    const base: BaseResolution = facts.base;
    // The point of this test IS the line it prints — §7.4's "it never skips silently".
    console.log(
      `[wrapper harness] ${decision.reason}\n` +
        `[wrapper harness] base: ${base.kind === "resolved" ? base.sha : `unresolved (${base.why})`}\n` +
        `[wrapper harness] path set: ${TRIGGER_PATH_SET.join(", ")}\n` +
        `[wrapper harness] platform: ${process.platform} · override: ${override} · ` +
        `runs per case: ${resolveRunCount(process.env.NUMISMA_WRAPPER_TEST_RUNS)}` +
        (process.platform === HARNESS_PLATFORM ? ` · shell: ${observedBashVersion()}` : ""),
    );
    expect(decision.reason.length).toBeGreaterThan(0);
    expect(decision.reason.startsWith(decision.run ? "harness armed" : "harness skipped")).toBe(true);
  });

  // ── GUARD-THE-GUARD, LAYER (a): the decision function over authored inputs ──────────
  describe("layer (a) — the decision function, over authored inputs", () => {
    const armedInput = {
      base: { kind: "resolved", sha: "0000000000000000000000000000000000000000" } as BaseResolution,
      pathSet: TRIGGER_PATH_SET,
      platform: HARNESS_PLATFORM,
      override: "auto" as const,
    };

    it("arms on a wrapper edit", () => {
      const result = decideArming({ ...armedInput, changedPaths: [WRAPPER_RELATIVE_PATH] });
      expect(result.run).toBe(true);
      expect(result.gate).toBe("changes");
      expect(result.matched).toEqual([WRAPPER_RELATIVE_PATH]);
    });

    it("arms on a plist edit — the oracle for the ceiling and the /bin/bash invocation", () => {
      const result = decideArming({
        ...armedInput,
        changedPaths: ["ops/price-feed/com.numisma.pricefeed.daily.plist"],
      });
      expect(result.run).toBe(true);
    });

    it("arms on an edit to the harness itself — omit this and you can break the suite and sail past green", () => {
      const result = decideArming({
        ...armedInput,
        changedPaths: ["apps/price-feed/src/wrapper-harness/launcher.testkit.ts"],
      });
      expect(result.run).toBe(true);
    });

    it("arms on an edit to the heartbeat oracle", () => {
      const result = decideArming({
        ...armedInput,
        changedPaths: ["packages/event-store/src/heartbeat.ts"],
      });
      expect(result.run).toBe(true);
    });

    it("does NOT arm on an unrelated edit, and says what it compared against", () => {
      const result = decideArming({ ...armedInput, changedPaths: ["apps/web/src/lib/dashboard.ts"] });
      expect(result.run).toBe(false);
      expect(result.gate).toBe("changes");
      expect(result.reason).toContain("no changes under");
      expect(result.reason).toContain("0000000000000000000000000000000000000000");
      expect(result.reason).toContain("ops/price-feed/**");
    });

    it("does NOT arm on the four faked command implementations — the suite cannot falsify them", () => {
      const result = decideArming({
        ...armedInput,
        changedPaths: [
          "apps/price-feed/src/cli.ts",
          "apps/tui/src/spine.ts",
          "apps/web/src/push/gap-report.ts",
          "apps/web/src/push/backfill.ts",
          "apps/price-feed/src/schedule-window.test.ts",
        ],
      });
      expect(result.run).toBe(false);
    });

    it("arms when the base cannot be resolved, and says why — it fails TOWARD running", () => {
      const result = decideArming({
        ...armedInput,
        changedPaths: [],
        base: { kind: "unresolved", why: "shallow clone" },
      });
      expect(result.run).toBe(true);
      expect(result.gate).toBe("base");
      expect(result.reason).toContain("shallow clone");
      expect(result.reason).toContain("failing toward running");
    });

    it("treats an EMPTY path set as a hard error, never as a skip", () => {
      // An empty set is definitionally a trigger that can never fire. A skip here would be
      // the silent failure this whole layer exists to make impossible.
      expect(() => decideArming({ ...armedInput, changedPaths: [], pathSet: [] })).toThrow(
        /path set is EMPTY/,
      );
    });

    it("prints three DISTINCT skip reasons — they mean opposite things about whether to worry", () => {
      const noChanges = decideArming({ ...armedInput, changedPaths: [] }).reason;
      const wrongPlatform = decideArming({ ...armedInput, changedPaths: [], platform: "linux" }).reason;
      const muted = decideArming({ ...armedInput, changedPaths: [], override: "never" }).reason;
      expect(new Set([noChanges, wrongPlatform, muted]).size).toBe(3);
      expect(noChanges).toContain("no changes under");
      expect(wrongPlatform).toContain("darwin-only");
      expect(muted).toContain("NUMISMA_WRAPPER_TEST=never");
    });

    it("bypasses the trigger for `always` — but never the platform gate", () => {
      const forced = decideArming({ ...armedInput, changedPaths: [], override: "always" });
      expect(forced.run).toBe(true);
      expect(forced.gate).toBe("override");

      const forcedOnLinux = decideArming({
        ...armedInput,
        changedPaths: [],
        override: "always",
        platform: "linux",
      });
      expect(forcedOnLinux.run).toBe(false);
      expect(forcedOnLinux.gate).toBe("platform");
    });

    it("evaluates the PLATFORM gate before the trigger, including in CI's exact configuration", () => {
      // CI checks out shallow, so it has no `origin/main` to merge-base against. Evaluate
      // the trigger first and every CI run fails open into a suite that cannot work on
      // Linux — converting the fail-open rule into a guaranteed red. Reversing the two
      // gates fails THIS assertion: with an unresolvable base the trigger would say `run`.
      const ciShaped = decideArming({
        ...armedInput,
        changedPaths: [WRAPPER_RELATIVE_PATH],
        base: { kind: "unresolved", why: "shallow clone" },
        platform: "linux",
      });
      expect(ciShaped.run).toBe(false);
      expect(ciShaped.gate).toBe("platform");
    });

    it("refuses an unrecognised NUMISMA_WRAPPER_TEST rather than defaulting to `auto`", () => {
      expect(readOverride(undefined)).toBe("auto");
      expect(readOverride("always")).toBe("always");
      expect(readOverride("never")).toBe("never");
      expect(() => readOverride("nver")).toThrow(/not one of auto/);
    });
  });

  // ── GUARD-THE-GUARD, LAYER (b): the real config against the real subject ────────────
  it("layer (b) — the COMMITTED path set arms on the REAL wrapper path", () => {
    // Layer (a) uses its own fixtures and would pass happily beside a typo'd real glob
    // (`ops/price-feeed/**`). This is the layer that actually catches the typo, which is
    // how a conditional suite dies in practice.
    expect(existsSync(WRAPPER_PATH)).toBe(true);
    const result = decideArming({
      changedPaths: [WRAPPER_RELATIVE_PATH],
      base: { kind: "resolved", sha: "deadbeef" },
      pathSet: TRIGGER_PATH_SET,
      platform: HARNESS_PLATFORM,
      override: "auto",
    });
    expect(result.run).toBe(true);
    expect(matchesPathSet(WRAPPER_RELATIVE_PATH, TRIGGER_PATH_SET)).toBe(true);
  });

  // ── GUARD-THE-GUARD, LAYER (c): liveness ───────────────────────────────────────────
  it("layer (c) — every glob in the path set matches at least one existing file", () => {
    // A set with a dead entry is a set that has already started rotting.
    for (const glob of TRIGGER_PATH_SET) {
      const relative = glob.endsWith("/**") ? glob.slice(0, -3) : glob;
      const absolute = join(REPO_ROOT, relative);
      expect(existsSync(absolute), `${glob} matches nothing that exists`).toBe(true);
      if (glob.endsWith("/**")) {
        expect(readdirSync(absolute).length, `${glob} is an empty directory`).toBeGreaterThan(0);
      }
    }
  });

  // ── THE TRIGGER'S REAL GIT BEHAVIOR ────────────────────────────────────────────────
  describe("the base is a merge-base, not HEAD~1 — proven against real git", () => {
    it("arms on a wrapper edit made THREE COMMITS BACK on a branch", () => {
      const { dir, git } = makeTempRepo();
      writeIn(dir, "README.md", "authored fixture\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "base");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      git("checkout", "--quiet", "-b", "feature");

      writeIn(dir, WRAPPER_RELATIVE_PATH, "# authored fixture standing in for the wrapper\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "edit the wrapper");
      writeIn(dir, "README.md", "authored fixture, second\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "unrelated 1");
      writeIn(dir, "README.md", "authored fixture, third\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "unrelated 2");

      const resolved = resolveTriggerFacts(dir);
      expect(resolved.base.kind).toBe("resolved");
      expect(resolved.changedPaths).toContain(WRAPPER_RELATIVE_PATH);
      // `HEAD~1` would see only "unrelated 2" and skip — this is the assertion that pins
      // the range as `base...HEAD`.
      expect(
        decideArming({
          changedPaths: resolved.changedPaths,
          base: resolved.base,
          pathSet: TRIGGER_PATH_SET,
          platform: HARNESS_PLATFORM,
          override: "auto",
        }).run,
      ).toBe(true);
    }, GIT_FIXTURE_TIMEOUT_MS);

    it("skips on an unrelated edit, printing the resolved base SHA and the path set", () => {
      const { dir, git } = makeTempRepo();
      writeIn(dir, "README.md", "authored fixture\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "base");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      git("checkout", "--quiet", "-b", "feature");
      writeIn(dir, "apps/web/src/lib/dashboard.ts", "// authored fixture\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "unrelated");

      const resolved = resolveTriggerFacts(dir);
      const result = decideArming({
        changedPaths: resolved.changedPaths,
        base: resolved.base,
        pathSet: TRIGGER_PATH_SET,
        platform: HARNESS_PLATFORM,
        override: "auto",
      });
      expect(result.run).toBe(false);
      expect(resolved.base.kind).toBe("resolved");
      if (resolved.base.kind === "resolved") {
        expect(result.reason).toContain(resolved.base.sha);
      }
      expect(result.reason).toContain("ops/price-feed/**");
    }, GIT_FIXTURE_TIMEOUT_MS);

    it("sees an UNCOMMITTED wrapper edit — the moment you most want the suite", () => {
      const { dir, git } = makeTempRepo();
      writeIn(dir, "README.md", "authored fixture\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "base");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      writeIn(dir, WRAPPER_RELATIVE_PATH, "# authored fixture, uncommitted\n");

      expect(resolveTriggerFacts(dir).changedPaths).toContain(WRAPPER_RELATIVE_PATH);
    }, GIT_FIXTURE_TIMEOUT_MS);

    it("falls back to HEAD~1 on the default branch, where the merge-base degenerates to HEAD", () => {
      const { dir, git } = makeTempRepo();
      writeIn(dir, "README.md", "authored fixture\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "base");
      const first = git("rev-parse", "HEAD");
      writeIn(dir, WRAPPER_RELATIVE_PATH, "# authored fixture\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "edit the wrapper on main");
      git("update-ref", "refs/remotes/origin/main", "HEAD");

      const resolved = resolveTriggerFacts(dir);
      expect(resolved.base).toEqual({ kind: "resolved", sha: first });
      expect(resolved.changedPaths).toContain(WRAPPER_RELATIVE_PATH);
    }, GIT_FIXTURE_TIMEOUT_MS);

    it("returns an UNRESOLVED base — which arms the suite — when there is no origin/main", () => {
      const { dir, git } = makeTempRepo();
      writeIn(dir, "README.md", "authored fixture\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "base");

      const resolved = resolveTriggerFacts(dir);
      expect(resolved.base.kind).toBe("unresolved");
      expect(
        decideArming({
          changedPaths: resolved.changedPaths,
          base: resolved.base,
          pathSet: TRIGGER_PATH_SET,
          platform: HARNESS_PLATFORM,
          override: "auto",
        }).run,
      ).toBe(true);
    }, GIT_FIXTURE_TIMEOUT_MS);

    it("reads a rename's NEW path out of `git status --porcelain`", () => {
      expect(parsePorcelain(" M ops/price-feed/run-daily-fetch.sh")).toEqual([WRAPPER_RELATIVE_PATH]);
      expect(parsePorcelain("R  old/path.sh -> ops/price-feed/run-daily-fetch.sh")).toEqual([
        WRAPPER_RELATIVE_PATH,
      ]);
      expect(parsePorcelain("")).toEqual([]);
    });
  });

  // ── S5 · THE REPETITION FLOOR ──────────────────────────────────────────────────────
  describe("the repetition floor is a floor, not a default", () => {
    it("is 12 when unset", () => {
      expect(resolveRunCount(undefined)).toBe(REPETITION_FLOOR);
      expect(REPETITION_FLOOR).toBe(12);
    });

    it("can be RAISED for a deliberate soak", () => {
      expect(resolveRunCount("50")).toBe(50);
    });

    it("REFUSES a value below the floor rather than clamping it", () => {
      expect(() => resolveRunCount("1")).toThrow(/below the committed floor/);
      expect(() => resolveRunCount("11")).toThrow(/below the committed floor/);
      expect(() => resolveRunCount("many")).toThrow(/not a whole number/);
    });
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════
// ARMED. Everything below launches the real wrapper.
// ══════════════════════════════════════════════════════════════════════════════════════

const RUNS_PER_CASE = decision.run ? resolveRunCount(process.env.NUMISMA_WRAPPER_TEST_RUNS) : 0;

/**
 * The settle window for a case with no timeout in it. Short ON PURPOSE, and the shortness
 * is load-bearing: the child-reap mutation leaves a stray `sleep` with most of a
 * 5-second watchdog poll still to run, so a generous window here would let the mutated run
 * pass and the control would prove nothing.
 */
const SETTLE_DEADLINE_MS = 2_000;

/** A case's own ceiling. Comfortably above a fake-tool run, far below the harness cap. */
const CASE_OPTIONS: CaseOptions = { maxRunSeconds: 30, watchdogGraceSeconds: 2 };

/**
 * Whether this run was in the mark window, computed the way the CONTRACT computes it —
 * `America/Mexico_City`, hour ≥ 18 — rather than from the machine's local clock, which
 * would agree only by coincidence of an OS setting. Read off the heartbeat's own
 * `startedAt` so a run that straddles 18:00 CDMX is still judged against the instant the
 * wrapper judged itself at.
 */
function expectedMarkWindow(startedAt: string): boolean {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date(startedAt));
  return Number(hour) >= 18;
}

/**
 * S4 · THE ASSERTION TRIPLE, applied uniformly and never selectively. (1) the exit code,
 * (2) the heartbeat's contents parsed by the reader that reads it in production, (3) zero
 * processes remaining in the run's process group — historically the highest-value
 * assertion, and the one that caught three of the four defects.
 *
 * The fake-tool sentinel is asserted alongside them on every case (§6): without it a
 * `NUMISMA_PATH_PREPEND` mistake is not a red test, it is a real run against real data
 * that happens to pass.
 */
function assertTriple(
  record: RunRecord,
  caseDir: string,
  expected: { exitCode: number; lastStep: string; label: string },
): void {
  const where = `${expected.label}: `;

  // (0) The fake won. Asserted first, because if it did not, everything below is a
  //     description of a live run against real, private data.
  for (const command of WRAPPER_PNPM_COMMANDS) {
    expect(
      existsSync(join(caseDir, "sentinels", sentinelNameFor(command))),
      `${where}the fake pnpm never recorded \`${command}\` — the REAL pnpm may have run`,
    ).toBe(true);
  }
  expect(
    existsSync(join(caseDir, "sentinels", "node-executed")),
    `${where}the fake node was EXECUTED, which the wrapper is not supposed to do`,
  ).toBe(false);

  // (1) Exit code.
  expect(record.exitCode, `${where}exit code (signal=${record.signal})`).toBe(expected.exitCode);

  // (2) Heartbeat, through the production reader.
  expect(record.heartbeat, `${where}the heartbeat was unreadable or absent: ${record.heartbeatRaw}`).toBeDefined();
  const heartbeat = record.heartbeat;
  if (heartbeat === undefined) {
    return;
  }
  expect(heartbeat.exitCode, `${where}heartbeat exitCode`).toBe(expected.exitCode);
  expect(heartbeat.lastStep, `${where}heartbeat lastStep`).toBe(expected.lastStep);
  const inWindow = expectedMarkWindow(heartbeat.startedAt);
  expect(heartbeat.markWindow, `${where}heartbeat markWindow`).toBe(inWindow);
  if (inWindow) {
    // `complete` is in MARKS_LANDED_STEPS, so an in-window run that reached it stamps
    // ITSELF as the last in-window finish.
    expect(heartbeat.lastMarkWindowFinishedAt, `${where}lastMarkWindowFinishedAt`).toBe(
      heartbeat.finishedAt,
    );
  } else {
    // A fresh case dir carries nothing forward, and the writer must INVENT nothing.
    expect(heartbeat.lastMarkWindowFinishedAt, `${where}lastMarkWindowFinishedAt`).toBeUndefined();
  }

  // (3) Zero processes remaining in the run's process group.
  expect(
    record.pgidResidue,
    `${where}${record.pgidResidue.length} process(es) still in pgid ${record.pgid} after ` +
      `${record.settleMs}ms: ${record.pgidResidue.join(" | ")}`,
  ).toEqual([]);
}

describe.runIf(decision.run)("wrapper harness — the real wrapper, armed", () => {
  // ── THE FAKE MUST HAVE WON, AND IT IS PROVEN, NOT ASSUMED ─────────────────────────
  it("resolves `pnpm` the way the WRAPPER's own re-exported PATH does — to the case dir's fake", () => {
    const dirs = makeCaseDir(CASE_OPTIONS);
    const env = caseEnv(dirs, CASE_OPTIONS);

    // The replication below is only faithful while the wrapper still builds its PATH this
    // way. Pinned, fail-closed: if that line moves, this assertion must break loudly
    // rather than keep resolving a PATH the subject no longer uses.
    const wrapperSource = readFileSync(WRAPPER_PATH, "utf8");
    expect(wrapperSource).toContain('export PATH="$PATH_PREPEND:$PATH"');
    expect(wrapperSource).toContain('PATH_PREPEND="${NUMISMA_PATH_PREPEND:-');

    const resolvePnpmAsWrapperWould = (candidate: NodeJS.ProcessEnv): string =>
      execFileSync(
        "/bin/bash",
        ["-c", 'export PATH="${NUMISMA_PATH_PREPEND}:$PATH"; command -v pnpm'],
        { env: candidate, encoding: "utf8" },
      ).trim();

    expect(resolvePnpmAsWrapperWould(env)).toBe(join(dirs.binDir, "pnpm"));

    // AND THE NEGATIVE HALF, which is the whole reason this assertion exists. Install the
    // fake on the INHERITED PATH instead — the intuitive, wrong thing — and the wrapper's
    // own prepend overrides it. In this repo the decoy stands in for what that prepend
    // really holds by default: the directories where the REAL pnpm lives. The consequence
    // in production is a real `prices:fetch`, a real `spine` append, a real commit against
    // the durable event log and a real `backfill` — all passing green.
    const decoyDir = installDecoyBin(dirs.caseDir);
    const misinstalled: NodeJS.ProcessEnv = {
      ...env,
      PATH: `${dirs.binDir}:${LAUNCHD_BARE_PATH}`,
      NUMISMA_PATH_PREPEND: decoyDir,
    };
    const wrongly = resolvePnpmAsWrapperWould(misinstalled);
    expect(wrongly).toBe(join(decoyDir, "pnpm"));
    expect(wrongly).not.toBe(join(dirs.binDir, "pnpm"));
  });

  it("launches `/bin/bash` explicitly, and records the version it observed", () => {
    const version = observedBashVersion();
    expect(version).toMatch(/^GNU bash, version /);
    // 3.2.57 is what launchd runs, and it is what every assertion in this suite was
    // written against. If /bin/bash has genuinely moved to 4 or 5, the suite's assumptions
    // must be RE-VERIFIED against the new shell — not loosened here.
    expect(version, `/bin/bash is no longer 3.2 — re-verify this suite, do not relax it`).toContain(
      "version 3.2",
    );
  });

  // ── S2 · THE ISOLATION REFUSAL ────────────────────────────────────────────────────
  describe("the isolation contract refuses, it never falls back", () => {
    it("accepts a properly isolated case", () => {
      const dirs = makeCaseDir(CASE_OPTIONS);
      expect(() => assertIsolated(caseEnv(dirs, CASE_OPTIONS), dirs.caseDir)).not.toThrow();
    });

    it("refuses when ANY of the seven overrides is unset", () => {
      const dirs = makeCaseDir(CASE_OPTIONS);
      expect(WRAPPER_ENV_VARS).toHaveLength(7);
      for (const name of WRAPPER_ENV_VARS) {
        const env = { ...caseEnv(dirs, CASE_OPTIONS) };
        delete env[name];
        expect(() => assertIsolated(env, dirs.caseDir), `${name} unset must refuse`).toThrow(
          IsolationRefusal,
        );
      }
    });

    it("refuses a path-valued override that resolves OUTSIDE the case dir", () => {
      const dirs = makeCaseDir(CASE_OPTIONS);
      const outside: Array<[string, string]> = [
        ["NUMISMA_DATA_DIR", join(process.env.HOME ?? "/tmp", "Dev/accumulus/data")],
        ["NUMISMA_REPO_DIR", REPO_ROOT],
        ["NUMISMA_PRICEFEED_LOG_DIR", join(process.env.HOME ?? "/tmp", "Library/Logs/numisma")],
        ["NUMISMA_PRICEFEED_ENV", join(process.env.HOME ?? "/tmp", ".config/numisma/price-feed.env")],
        ["NUMISMA_PATH_PREPEND", "/opt/homebrew/bin"],
      ];
      for (const [name, value] of outside) {
        const env = { ...caseEnv(dirs, CASE_OPTIONS), [name]: value };
        expect(() => assertIsolated(env, dirs.caseDir), `${name}=${value} must refuse`).toThrow(
          IsolationRefusal,
        );
      }
    });

    it("refuses a PATH_PREPEND whose LAST entry escapes — every entry is checked, not the first", () => {
      // The wrapper's own default is a colon list, so this is the shape a careless edit
      // takes: the fake bin, and then "just one more" real directory.
      const dirs = makeCaseDir(CASE_OPTIONS);
      const env = {
        ...caseEnv(dirs, CASE_OPTIONS),
        NUMISMA_PATH_PREPEND: `${dirs.binDir}:/opt/homebrew/bin`,
      };
      expect(() => assertIsolated(env, dirs.caseDir)).toThrow(/resolves OUTSIDE/);
    });

    it("refuses a non-integer ceiling or grace", () => {
      const dirs = makeCaseDir(CASE_OPTIONS);
      expect(() =>
        assertIsolated(
          { ...caseEnv(dirs, CASE_OPTIONS), NUMISMA_PRICEFEED_MAX_RUN_SECONDS: "30s" },
          dirs.caseDir,
        ),
      ).toThrow(IsolationRefusal);
    });

    it("is enforced by the LAUNCHER, not left to the caller", async () => {
      const dirs = makeCaseDir(CASE_OPTIONS);
      const env = { ...caseEnv(dirs, CASE_OPTIONS) };
      delete env.NUMISMA_DATA_DIR;
      await expect(
        launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env,
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        }),
      ).rejects.toThrow(IsolationRefusal);
    });
  });

  // ── CASE 1 · THE HEALTHY RUN ──────────────────────────────────────────────────────
  it(
    `case 1 — healthy run, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      const settles: number[] = [];
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const dirs = makeCaseDir(CASE_OPTIONS);
        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, CASE_OPTIONS),
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });
        const label = `case 1 run ${run}/${RUNS_PER_CASE}`;

        // THE ANTI-VACUITY ASSERTION FOR THE WHOLE SUITE'S MOST IMPORTANT LINE. `detached`
        // is what makes the wrapper its own process-group leader; drop it and the wrapper
        // itself prints `watchdog DISABLED` and the watchdog no-ops, and every later
        // slice's timeout case passes while testing nothing. This is the assertion that
        // goes red when that happens.
        expect(record.logText, `${label}: the watchdog did not arm — was the child detached?`).toContain(
          "watchdog armed:",
        );
        expect(record.logText).not.toContain("watchdog DISABLED");
        // A healthy run is not a timeout: the watchdog left no calling card and the step
        // name carries no `timeout:` decoration.
        expect(record.watchdogFired, `${label}: the watchdog's calling card was left behind`).toBe(false);

        assertTriple(record, dirs.caseDir, { exitCode: 0, lastStep: "complete", label });
        settles.push(record.settleMs);
      }
      // Recorded, not merely passed: a regression from 0.1s to 1.9s is inside the window
      // and would otherwise be invisible.
      console.log(`[wrapper harness] case 1 settle ms: ${settles.join(", ")}`);
    },
    240_000,
  );

  // ── CASE 7 · THE ANTI-VACUITY CONTROL ─────────────────────────────────────────────
  it(
    `case 7 — watchdog disabled because the wrapper is NOT a process-group leader, ${RUNS_PER_CASE} times`,
    async () => {
      // The inverse of the suite's most important line. If this case ever starts arming
      // the watchdog, leader detection has changed; if the timeout cases in slice 2 stop
      // timing out while this still passes, the suite has gone green-and-empty. Neither
      // state is visible from any other case.
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const dirs = makeCaseDir(CASE_OPTIONS);
        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, CASE_OPTIONS),
          groupLeader: false,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });
        const label = `case 7 run ${run}/${RUNS_PER_CASE}`;

        expect(record.logText, `${label}: the wrapper did not notice it was not the leader`).toContain(
          "watchdog DISABLED (not a process-group leader:",
        );
        expect(record.logText, `${label}: the watchdog armed anyway`).not.toContain("watchdog armed:");
        // AND IT DOES NOT TIME OUT: no calling card, no 124, no `timeout:` decoration.
        expect(record.watchdogFired, `${label}: a disabled watchdog left a calling card`).toBe(false);
        expect(record.exitCode, `${label}: a disabled watchdog produced a timeout exit`).not.toBe(124);
        expect(record.heartbeat?.lastStep ?? "", `${label}: decorated step`).not.toContain("timeout:");

        assertTriple(record, dirs.caseDir, { exitCode: 0, lastStep: "complete", label });
      }
    },
    240_000,
  );

  // ── S6 · THE CHILD-REAP MUTATION CONTROL ──────────────────────────────────────────
  describe("the child-reap mutation — assertion 3 is seen RED before it is trusted", () => {
    it("fails LOUDLY when its anchor text is gone, rather than mutating nothing", () => {
      const dirs = makeCaseDir(CASE_OPTIONS);
      expect(() =>
        mutateWrapper(WRAPPER_PATH, dirs.caseDir, {
          name: "an anchor that has rotted away",
          anchor: "kill -KILL $WATCHDOG_GRANDCHILDREN_THAT_NEVER_EXISTED",
          replacement: ":",
        }),
      ).toThrow(/anchor has rotted/);
    });

    it(
      "makes the healthy case go RED on a stray process left in the run's pgid",
      async () => {
        const dirs = makeCaseDir(CASE_OPTIONS);
        // The committed wrapper is never touched: the mutation is applied to a copy that
        // lives and dies inside the case dir.
        const mutated = mutateWrapper(WRAPPER_PATH, dirs.caseDir, CHILD_REAP_MUTATION);
        expect(mutated.startsWith(dirs.caseDir)).toBe(true);

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: mutated,
          env: caseEnv(dirs, CASE_OPTIONS),
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });

        // The run itself still reports success — that is precisely the danger. Without the
        // reaped child the wrapper's own EXIT trap SIGKILLs the watchdog subshell and
        // orphans its `sleep` into the run's process group, where it holds launchd's
        // per-label job slot and keeps the log `tee` alive. Assertion 3 is the only thing
        // that sees it.
        expect(record.exitCode).toBe(0);
        expect(record.heartbeat?.lastStep).toBe("complete");
        expect(
          record.pgidResidue.length,
          "the child-reap mutation left NOTHING in the pgid — assertion 3 is no longer guarding anything",
        ).toBeGreaterThan(0);
        expect(record.pgidResidue.join(" | ")).toMatch(/sleep/);

        // And the same assertion, applied to the same case, passes on the UNMUTATED
        // wrapper — so what went red is the mutation and not the settle window.
        const clean = makeCaseDir(CASE_OPTIONS);
        const healthy = await launchWrapper({
          caseDir: clean.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(clean, CASE_OPTIONS),
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });
        expect(healthy.pgidResidue).toEqual([]);
      },
      120_000,
    );
  });
});
