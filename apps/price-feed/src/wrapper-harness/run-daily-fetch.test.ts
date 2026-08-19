/**
 * THE COMMITTED TEST HARNESS FOR `ops/price-feed/run-daily-fetch.sh` (PRD #314, slices
 * #316, #317 and #318).
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
 * ── WHAT SLICES 1-3 CLAIM, AND WHAT THEY DO NOT ───────────────────────────────────────
 * Slice 1: the launcher, the isolation refusal, the fake-tool bin and its sentinel, the
 * assertion triple, 12-run repetition, the arming trigger and its three guard layers,
 * case 1 (healthy), case 7 (not a group leader) and the child-reap mutation control.
 *
 * Slice 2 — the TIMEOUT FAMILY: the `hangs`, `exits 127`, `ignores TERM` and TERM-deaf
 * grandchild fakes; cases 2, 3 and 5; the grace-bounded settle assertion; and the
 * `tee`-deafness mutation control. **It also completes case 7**, which slice 1 could only
 * half-prove: with nothing but the `succeeds` fake, "the run does not time out" was
 * unfalsifiable, because nothing could have timed out anyway. Case 7 now HANGS under a
 * disabled watchdog, is observed still alive well past its own ceiling and grace with no
 * calling card, and is then released to finish normally.
 *
 * Slice 3 — case 4 and THE DISCRIMINATION THE TERM HANDLER MAKES: the same `hangs` fake as
 * case 2, signalled by the harness with a bare group SIGTERM BEFORE the ceiling can fire,
 * and the pair-comparison test that holds cases 2 and 4 against each other. **Cases 2 and 4
 * run inside ONE suite run, and that is a requirement rather than an accident of layout**
 * (#312): watchdog-TERM and external-TERM are the two halves of a single branch, and split
 * across two suites or two gates they drift apart silently — a handler that stopped
 * discriminating would leave each half green on its own. Do not separate them.
 *
 * ── WHAT SLICE 3 DOES NOT PROVE, SAID PLAINLY ─────────────────────────────────────────
 * **This harness delivers the SIGNAL, not the SENDER.** A bare SIGTERM to the run's pgid is
 * signal-identical to what `launchctl stop`, `launchctl unload`, a logout and a shutdown all
 * deliver, and signal-identical is exactly what the TERM handler branches on — its whole
 * discriminator is whether the watchdog's calling card is on disk. So case 4 proves the
 * HANDLER'S DISCRIMINATION soundly, and it proves nothing whatever about launchd. Therefore:
 *
 * - `launchctl stop` and `launchctl unload` mid-run each remain worth ONE MANUAL
 *   confirmation against the real installed LaunchAgent, recorded in #312. This suite makes
 *   them cheap to trust; it does not replace them. Nothing here drives `launchctl`.
 * - **Logout or shutdown mid-run is inherently manual and automatable by nobody.** The
 *   failure mode is the filesystem going away underneath a single `printf` from an EXIT
 *   trap; no in-process harness reproduces a real session teardown, and no future harness
 *   work should be scheduled against it.
 *
 * Anyone about to write "the external-stop path is covered" should read this paragraph first.
 *
 * No slice yet claims the mark window, or cases 6 and 8 (slice 4).
 *
 * ── A BLIND SPOT THIS DESIGN CREATES, NAMED RATHER THAN IMPLIED ───────────────────────
 * The fake `pnpm` is what makes every case fast and safe, and it is therefore exactly what
 * blinds this suite to the REAL pnpm. Rename a script in the root `package.json` and the
 * wrapper's `pnpm backfill` breaks in production while every case here stays green. That
 * is why §7.3 keeps the four command implementations OUT of the trigger set: the suite has
 * nothing to say about them, and a trigger that armed on them would be claiming otherwise.
 */

import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JobHeartbeat } from "@numisma/event-store";
import { describe, expect, it, onTestFinished } from "vitest";
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
  TEE_DEAFNESS_MUTATION,
  caseEnv,
  makeCaseDir,
  mutateWrapper,
  type CaseOptions,
} from "./case-dir.testkit.js";
import {
  INVOCATION_LOG_NAME,
  TERM_DEAF_CHILD_NAME,
  TERM_DEAF_CHILD_SENTINEL,
  WRAPPER_PNPM_COMMANDS,
  dispatchRecordNameFor,
  installDecoyBin,
  releaseFakeHang,
  sentinelNameFor,
  setFakeBehavior,
} from "./fake-bin.testkit.js";
import { IsolationRefusal, WRAPPER_ENV_VARS, assertIsolated } from "./isolation.testkit.js";
import {
  AUTHORED_PRIOR_STAMP,
  AUTHORED_V1_CARRY,
  CONTRACT_MARK_CONFIG,
  expectedMarkWindow,
  markConfigFor,
  seedInWindowDiedBeforeSpineHeartbeat,
  seedMarkedEveningHeartbeat,
  seedV1Heartbeat,
  type MarkConfig,
} from "./mark-window.testkit.js";
import {
  launchWrapper,
  observedBashVersion,
  processesInPgid,
  type RunRecord,
} from "./launcher.testkit.js";
import {
  AUTHORED_CLEAN_OUTCOME,
  AUTHORED_FAILED_OUTCOME,
  AUTHORED_SENTINEL_FRAGMENT,
  AUTHORED_SENTINEL_NOTICE,
  AUTHORED_WEDGED_OUTCOME,
  EXIT_TRAP_SCOPE_TAIL,
  STEP_0_SCOPE_TAIL,
  armFakeOperatorNoticeWrite,
  expectedFailureFragment,
  readOperatorNotice,
  seedHeartbeatOutcome,
  seedOperatorNotice,
} from "./operator-notice.testkit.js";
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

    /**
     * THE SHAPE THE REAL PRODUCER EMITS — a TRACKED wrapper, MODIFIED IN PLACE.
     *
     * This test used to write the wrapper into a fresh fixture dir, where git reports
     * `"?? ops/price-feed/run-daily-fetch.sh"`. That form has NO leading whitespace, so it
     * survived `git()`'s old whole-output `.trim()` intact and this test passed for as long
     * as the defect lived. The form an actual uncommitted wrapper edit takes is `" M path"`
     * — the two-column porcelain status field, leading space and all — and the trim ate that
     * space on the FIRST line of the output, leaving `parsePorcelain`'s `line.slice(3)` one
     * character short: `ps/price-feed/run-daily-fetch.sh`, matching nothing, so the harness
     * skipped with the wrapper visibly modified. The test passed because it pinned a shape
     * the real producer never emits, which is the failure mode this whole suite is built to
     * refuse.
     *
     * THE WRAPPER IS THE ONLY DIRTY FILE, and that is deliberate rather than minimal: the
     * old trim damaged the FIRST line of the output and no other, so a fixture with an
     * alphabetically earlier dirty path would have absorbed the damage somewhere harmless
     * and gone green over the same bug. Alone, the wrapper IS line one, and the character
     * it used to lose is the character this assertion is about.
     */
    it("sees an UNCOMMITTED edit to the TRACKED wrapper — the moment you most want the suite", () => {
      const { dir, git } = makeTempRepo();
      writeIn(dir, WRAPPER_RELATIVE_PATH, "# authored fixture standing in for the wrapper\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "base");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      // Tracked and now modified in place, which git reports as ` M <path>` — leading
      // space and all. Writing it into a fresh dir instead would produce `?? <path>`, and
      // that is the shape the defect could not touch.
      writeIn(dir, WRAPPER_RELATIVE_PATH, "# authored fixture, edited in place\n");

      const changed = resolveTriggerFacts(dir).changedPaths;
      expect(changed).toContain(WRAPPER_RELATIVE_PATH);
      expect(
        decideArming({
          changedPaths: changed,
          base: { kind: "resolved", sha: git("rev-parse", "HEAD") },
          pathSet: TRIGGER_PATH_SET,
          platform: HARNESS_PLATFORM,
          override: "auto",
        }).run,
        "the trigger skipped on a modified tracked wrapper — the exact silence §7 forbids",
      ).toBe(true);
    }, GIT_FIXTURE_TIMEOUT_MS);

    /**
     * AND THE UNTRACKED SHAPE STILL ARMS — kept, because it is a real case and not merely
     * the old test's residue: a brand-new wrapper, or a whole new harness directory, arrives
     * as `??` and is exactly what `--untracked-files=all` was added for.
     */
    it("sees a BRAND-NEW untracked wrapper — the `??` shape `--untracked-files=all` exists for", () => {
      const { dir, git } = makeTempRepo();
      writeIn(dir, "README.md", "authored fixture\n");
      git("add", "-A");
      git("commit", "--quiet", "-m", "base");
      git("update-ref", "refs/remotes/origin/main", "HEAD");
      writeIn(dir, WRAPPER_RELATIVE_PATH, "# authored fixture, never committed\n");

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
 * is load-bearing in the child-reap control: the mutation leaves a stray `sleep` with PART
 * of a watchdog poll hop still to run, so a generous window here would outlast the stray on
 * every run and the control would prove nothing.
 *
 * HOW MUCH of the hop is left is not a property of this number. It is decided by where in
 * the watchdog's repeating poll cycle the run happened to finish, which is ambient — a
 * phase, not a budget, and no value here makes it one. That is why the control repeats
 * instead of trusting a single reading; #394 is the red that taught it to.
 *
 * As a bound on an ordinary case this is generous rather than tight. A healthy run reaps the
 * watchdog and its child from inside the EXIT trap, so its pgid is already empty at the
 * instant the shell exits and none of this window is ever spent.
 */
const SETTLE_DEADLINE_MS = 2_000;

/**
 * A case's own ceiling. Comfortably above a fake-tool run, far below the harness cap.
 *
 * `mark` IS THE CONTRACT'S OWN PAIR, stated rather than defaulted. For every case written
 * before the zone became an input the case's zone simply IS the contract's zone, so
 * naming it here changes nothing about what those cases assert — and it means no case
 * anywhere can inherit its side of the mark window from the time of day.
 */
const CASE_OPTIONS: CaseOptions = {
  maxRunSeconds: 30,
  watchdogGraceSeconds: 2,
  mark: CONTRACT_MARK_CONFIG,
};

/**
 * A ceiling a case can actually WAIT OUT. Every timeout case pays it in full, twelve times,
 * so it is as short as the wrapper's own arithmetic allows and no shorter: the watchdog
 * clamps its poll to the ceiling when the ceiling is the smaller of the two, and a ceiling
 * under a second would measure `sleep`'s rounding rather than the watchdog's decision.
 */
const TIMEOUT_CASE_OPTIONS: CaseOptions = {
  maxRunSeconds: 3,
  watchdogGraceSeconds: 2,
  mark: CONTRACT_MARK_CONFIG,
};

/** How long past its own ceiling AND grace case 7's hang is observed still alive. */
const CASE_7_OBSERVE_MARGIN_MS = 1_000;

/**
 * THE WRAPPER'S OWN POLL LENGTH, READ OFF THE SUBJECT rather than guessed. The settle bound
 * below is grace + one poll + a margin, so a poll that moved in the wrapper while a literal
 * `5` sat here would silently loosen or tighten every timeout case's only bound. Fail-closed
 * for the same reason `mutateWrapper` throws on a rotted anchor: a bound derived from text
 * that has moved is not a bound.
 */
function wrapperPollSeconds(): number {
  const match = /^\s*WATCHDOG_POLL_SECONDS=(\d+)\s*$/m.exec(readFileSync(WRAPPER_PATH, "utf8"));
  if (match === null) {
    throw new Error(
      "wrapper harness: WATCHDOG_POLL_SECONDS could not be read out of the wrapper. Every " +
        "timeout case's settle bound derives from it, and a guessed bound is not a bound.",
    );
  }
  return Number(match[1]);
}

/**
 * THE GRACE-BOUNDED SETTLE WINDOW, and it is wrong in BOTH directions if unbounded.
 *
 * On the timeout path the watchdog is DELIBERATELY left alive — `write_heartbeat` skips its
 * own cancellation when `TIMED_OUT=true` — so that it can serve its grace and then group-
 * SIGKILL whatever ignored the TERM. The run's pgid is therefore legitimately occupied for
 * the whole grace AFTER the shell has exited. Asserting emptiness immediately is a false
 * red; asserting it with unbounded patience is a false green, because the historical stray
 * `sleep` DID eventually exit — after holding launchd's per-label job slot through the next
 * fire.
 *
 * Grace + one watchdog poll + a margin: the grace is what the escalation waits, the poll is
 * the most a `sleep` the watchdog forked can outlive it by (§ the wrapper's own bound on a
 * lost child), and the margin is process teardown on a loaded machine. The observed settle
 * time is printed on every case, so a regression from a fifth of the bound to nearly all of
 * it is VISIBLE rather than merely passing.
 */
function timeoutSettleDeadlineMs(options: CaseOptions): number {
  // The wrapper CLAMPS its poll to the ceiling when the ceiling is smaller, so that a small
  // ceiling is still honoured rather than rounded up. Mirrored here rather than approximated
  // by the unclamped 5: a bound that ignored the clamp would be seconds looser than the
  // watchdog it is bounding, which is most of the way back to unbounded patience.
  const pollSeconds = Math.min(wrapperPollSeconds(), options.maxRunSeconds);
  return (options.watchdogGraceSeconds + pollSeconds) * 1_000 + 1_500;
}

/**
 * WHICH STEPS MEAN THE DAY'S MARKS ACTUALLY LANDED — the wrapper's own `MARKS_LANDED_STEPS`,
 * authored here as the oracle the heartbeat assertion needs. `pnpm spine` appends the marks,
 * so every step after it implies they landed; a run that died at `prices-fetch` is in-window
 * and marked NOTHING, and a harness that expected a stamp there would be demanding the
 * wrapper record a failure as evidence the day was covered.
 */
const MARKS_LANDED_STEPS: readonly string[] = [
  "commit",
  "post-check",
  "gap-report",
  "backfill",
  "complete",
];

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Whether the watchdog has left its calling card in a case's log dir, read DURING a run. */
function watchdogCardPresent(logDir: string): boolean {
  return existsSync(logDir) && readdirSync(logDir).some((name) => name.endsWith(".watchdog-fired"));
}

/**
 * THE ANTI-HANG BACKSTOP ON CASE 4'S WAIT — deliberately NOT a budget, and the distinction
 * is the whole point of this constant's existence.
 *
 * It used to be one: a flat 2000 ms, chosen as a safety strip under the timeout cases' 3 s
 * ceiling, on the reasoning that a wait which ran into the ceiling could silently turn case
 * 4 into a second copy of case 2. The reasoning was right; the mechanism was a PROXY for it,
 * and the proxy is what went red. #372 recorded this exact wait failing under a full
 * parallel suite with the message "the run never reached the step this signal is aimed at" —
 * a statement that was simply FALSE. The run reached the step. The machine was busy.
 *
 * Measured on 2026-08-19, twelve runs per suite run: on a quiet machine the reach costs
 * 388-678 ms across 60 samples, but with a second suite running concurrently — the board's
 * ordinary condition, one worktree per lane — the worst run of each set was 1473, 1460 and
 * 1282 ms. That is 74% of the old bound consumed by scheduler contention alone, and #372's
 * original sighting is the same series crossing it.
 *
 * So the wait no longer races a clock at all. It races {@link watchdogCardPresent}, which is
 * the thing case 4's premise is ACTUALLY about, and this number is what remains: a bound on
 * a run that is neither reaching its step nor being timed out by its own watchdog, which is
 * a broken wrapper rather than a busy machine.
 *
 * WHY IT IS DERIVED FROM CEILING + GRACE AND NOT FROM THE CEILING ALONE, since the card is
 * the event the wait is actually racing and the card lands AT the ceiling, before the TERM
 * and therefore before the grace (`run-daily-fetch.sh`, the watchdog subshell). Sitting
 * above the card would be enough if the card were guaranteed, and it is not: the wrapper
 * writes it best-effort, `: > "$WATCHDOG_FIRED_FILE" 2>/dev/null || true`, precisely so a
 * failed write costs a mislabel rather than the kill. On that path the wait sees no card,
 * and the last thing the watchdog still guarantees is the SIGKILL at ceiling + grace. So
 * the bound is "above everything the watchdog does", which is what makes reaching it mean
 * a watchdog that never armed at all. Compare {@link timeoutSettleDeadlineMs} and case 7,
 * where the same `(ceiling + grace)` arithmetic is derived from the escalation itself.
 */
const REACH_STEP_BACKSTOP_MS =
  (TIMEOUT_CASE_OPTIONS.maxRunSeconds + TIMEOUT_CASE_OPTIONS.watchdogGraceSeconds) * 1_000 +
  2_000;

/**
 * Block until the fake has recorded `command`, so a signal aimed at a step lands while the
 * run is genuinely IN that step rather than somewhere earlier by luck — the step name in the
 * heartbeat is half of what case 4 asserts, and `LAST_STEP` is set just before the call the
 * sentinel proves happened.
 *
 * FAIL-CLOSED, AND IT RACES THE WATCHDOG RATHER THAN A CLOCK. What case 4 needs is not "the
 * step arrived inside N milliseconds" but "the step arrived before the watchdog fired", and
 * those two are only the same statement on an unloaded machine. The watchdog announces
 * itself: it touches its calling card BEFORE it signals the group
 * (`run-daily-fetch.sh`, the watchdog subshell), so the losing condition is directly
 * observable and needs no proxy. A watchdog that genuinely got there first still fails —
 * and fails saying so, instead of claiming the run never reached a step it plainly reached.
 * See {@link REACH_STEP_BACKSTOP_MS} for the measurements that retired the stopwatch.
 *
 * WHAT THIS DOES NOT BUY, stated because an earlier version of this comment claimed it did:
 * it does not make case 4 immune to a slow machine. It removes the 2000 ms strip, which was
 * the tightest bound and the one #372 crossed, and hands the reach the whole ceiling. Past
 * the ceiling the case still reds — here as "the watchdog beat the harness", and slightly
 * earlier at the `durationMs < ceilingMs` assertion in the case body, which is now the
 * binding wall-clock bound and says so in its own comment. The honest claim is that the
 * headroom went from 2000 ms to roughly the ceiling minus the signal-to-exit tail, against
 * a measured contended worst of 1541 ms, and that the red at the far end now names the
 * watchdog rather than accusing the run of never arriving.
 *
 * THREE EXITS, EACH MEANING EXACTLY ONE THING:
 *   - the sentinel appears — the run is in the step, and the elapsed time is returned for
 *     the report line;
 *   - the calling card appears — the watchdog beat the harness, so this run is case 2
 *     wearing case 4's name and there is nothing left to signal;
 *   - the backstop expires — neither happened, which is a wrapper that is not running and
 *     not being bounded by its own watchdog.
 */
async function waitForFakeToReach(
  caseDir: string,
  command: string,
  label: string,
  logDir: string,
): Promise<number> {
  const sentinel = join(caseDir, "sentinels", sentinelNameFor(command));
  const startedAt = Date.now();
  while (!existsSync(sentinel)) {
    // CHECKED BEFORE THE BACKSTOP, because it is the informative half: a run the watchdog
    // has already claimed should say THAT, not report a generic expiry.
    if (watchdogCardPresent(logDir)) {
      throw new Error(
        `${label}: the watchdog left its calling card after ${Date.now() - startedAt}ms, ` +
          `before the fake recorded \`${command}\` — the watchdog beat the harness to this ` +
          "run, so it is a second copy of case 2 rather than an external stop",
      );
    }
    if (Date.now() - startedAt >= REACH_STEP_BACKSTOP_MS) {
      throw new Error(
        `${label}: the fake never recorded \`${command}\` within ` +
          `${REACH_STEP_BACKSTOP_MS}ms, and the watchdog never fired either — the run ` +
          "reached neither its step nor its own ceiling",
      );
    }
    await sleep(25);
  }
  return Date.now() - startedAt;
}

/**
 * ONE HALF OF THE PAIR CASES 2 AND 4 FORM — kept so the two can be compared against each
 * other rather than only against their own expectations. Two independent per-case assertions
 * cannot see a change that moves BOTH cases in the same direction; the comparison can.
 */
interface TermPathObservation {
  readonly label: string;
  readonly heartbeat: JobHeartbeat;
  /** The watchdog's calling card — the TERM handler's entire discriminator. */
  readonly watchdogCard: boolean;
}

let watchdogTermObserved: TermPathObservation | undefined;
let externalTermObserved: TermPathObservation | undefined;

/** Snapshot a finished run for the pair comparison, refusing a run with no heartbeat. */
function observeTermPath(record: RunRecord, label: string): TermPathObservation {
  const heartbeat = record.heartbeat;
  if (heartbeat === undefined) {
    throw new Error(`${label}: no heartbeat to compare — ${record.heartbeatRaw ?? "(absent)"}`);
  }
  return { label, heartbeat, watchdogCard: record.watchdogFired };
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
  expected: {
    exitCode: number;
    lastStep: string;
    /**
     * The `pnpm` sub-commands this case must have reached, as a PREFIX of
     * {@link WRAPPER_PNPM_COMMANDS}. The ones after it are asserted ABSENT, which is how a
     * case that dies at `prices-fetch` proves the wrapper's central contract — a non-zero
     * fetch HALTS the run before `spine`, so a doomed mark is never appended.
     */
    pnpmReached: readonly string[];
    /**
     * THE CASE'S OWN MARK CONFIGURATION, and the oracle below judges `markWindow` against
     * IT rather than against the contract's. While the zone was a literal the two were the
     * same thing; now that a case chooses its side, an oracle still reading the contract
     * zone would judge an in-window case against the wrong side — permanently red, or
     * worse, green for the wrong reason for the six hours a day the two happen to agree.
     */
    mark: MarkConfig;
    /**
     * The `lastMarkWindowFinishedAt` the run found ALREADY ON DISK, or `undefined` for a
     * fresh case dir. It is what a run that did not mark must re-emit unchanged, and what
     * a run that DID mark must overwrite — the two halves of the carry-forward contract,
     * indistinguishable from each other unless a prior stamp exists to tell them apart.
     */
    carriedStamp?: string;
    label: string;
  },
): void {
  const where = `${expected.label}: `;

  // (0) The fake won. Asserted first, because if it did not, everything below is a
  //     description of a live run against real, private data.
  for (const command of WRAPPER_PNPM_COMMANDS) {
    const reached = expected.pnpmReached.includes(command);
    expect(
      existsSync(join(caseDir, "sentinels", sentinelNameFor(command))),
      reached
        ? `${where}the fake pnpm never recorded \`${command}\` — the REAL pnpm may have run`
        : `${where}the fake pnpm recorded \`${command}\`, which this case must never reach`,
    ).toBe(reached);
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
  const inWindow = expectedMarkWindow(heartbeat.startedAt, expected.mark);
  expect(
    heartbeat.markWindow,
    `${where}heartbeat markWindow, against the case's configured zone ` +
      `${expected.mark.timeZone} and hour ${expected.mark.hour}`,
  ).toBe(inWindow);
  // IN-WINDOW ALONE IS NOT ENOUGH, and the decorated step name is not a step name: the
  // wrapper compares the BARE `LAST_STEP` against its landed-steps list and only decorates
  // at print time, so the oracle has to undecorate before it asks the same question.
  const marksLanded = MARKS_LANDED_STEPS.includes(expected.lastStep.replace(/^timeout:/, ""));
  if (inWindow && marksLanded) {
    // `complete` is in MARKS_LANDED_STEPS, so an in-window run that reached it stamps
    // ITSELF as the last in-window finish.
    expect(heartbeat.lastMarkWindowFinishedAt, `${where}lastMarkWindowFinishedAt`).toBe(
      heartbeat.finishedAt,
    );
  } else if (expected.carriedStamp === undefined) {
    // A fresh case dir carries nothing forward, and the writer must INVENT nothing — least
    // of all on a run that died before `spine` and therefore marked nothing at all.
    expect(heartbeat.lastMarkWindowFinishedAt, `${where}lastMarkWindowFinishedAt`).toBeUndefined();
  } else {
    // A PRIOR STAMP WAS ON DISK AND THIS RUN DID NOT EARN A NEW ONE, so it must re-emit
    // that one byte for byte. `toBe`, not merely "defined": a run that replaced it with
    // its OWN finish would still be defined, and that substitution is precisely the defect
    // — a run that marked nothing claiming the day as covered.
    expect(heartbeat.lastMarkWindowFinishedAt, `${where}lastMarkWindowFinishedAt`).toBe(
      expected.carriedStamp,
    );
    expect(
      heartbeat.lastMarkWindowFinishedAt,
      `${where}lastMarkWindowFinishedAt was RE-STAMPED with this run's own finish by a run ` +
        "that marked nothing — the carried value must survive untouched",
    ).not.toBe(heartbeat.finishedAt);
  }

  // (3) Zero processes remaining in the run's process group.
  expect(
    record.pgidResidue,
    `${where}${record.pgidResidue.length} process(es) still in pgid ${record.pgid} after ` +
      `${record.settleMs}ms: ${record.pgidResidue.join(" | ")}`,
  ).toEqual([]);
}

describe.runIf(decision.run)("wrapper harness — the real wrapper, armed", () => {
  // ── THE ARMED SUITE LAUNCHES SOMETHING, ASSERTED RATHER THAN REASONED ─────────────
  //
  // `RUNS_PER_CASE` is the loop bound of every case below, and it is `0` whenever the
  // trigger says not to run. Were it ever 0 INSIDE this block, all eight cases and both
  // mutation controls would go green having launched nothing — the exact failure this
  // suite exists to be incapable of. It is unreachable today (`resolveRunCount` refuses
  // anything below the floor and never returns 0), but every other claim in this file is
  // held to a bar higher than "unreachable by an argument about another module", and this
  // is the claim the rest of them rest on.
  it("has a repetition count, so a case cannot pass by looping zero times", () => {
    expect(
      RUNS_PER_CASE,
      "the armed suite would launch nothing and every case below would pass vacuously",
    ).toBeGreaterThanOrEqual(REPETITION_FLOOR);
  });

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

    it("refuses when ANY of the nine overrides is unset", () => {
      const dirs = makeCaseDir(CASE_OPTIONS);
      // NINE SINCE #315, not seven: `NUMISMA_MARK_TZ` and `NUMISMA_MARK_HOUR` joined the
      // set, and they are refused unset for the same reason as the other seven even though
      // neither is path-valued — an unset one lets the wrapper fall back to the contract
      // zone, and a case that meant to be in-window is then in-window only between 18:00
      // and 23:59 CDMX. Green while asserting nothing, arriving through the clock.
      expect(WRAPPER_ENV_VARS).toHaveLength(9);
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
      // ── THE DIAGNOSTICS SURVIVE A THROW, WHICH IS THE ONLY TIME THEY MATTER ────────
      //
      // Every case in this file records a per-run series and prints it at the end. Printed
      // after the loop, that print is skipped by exactly the event it exists to explain: a
      // red on run 9 reports `expected 143 to be …` and takes the whole history with it,
      // so a one-off is indistinguishable from a drift and the next intermittent failure
      // is a mystery rather than evidence. `onTestFinished` runs whether the test passed
      // or threw — a `try`/`finally` around each loop with none of the re-indentation —
      // and the series is captured by reference, so whatever the loop managed to record
      // before it died is what gets printed.
      onTestFinished(() => {
        // Recorded, not merely passed: a regression from 0.1s to 1.9s is inside the
        // window and would otherwise be invisible.
        console.log(`[wrapper harness] case 1 settle ms: ${settles.join(", ")}`);
      });
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

        assertTriple(record, dirs.caseDir, {
          exitCode: 0,
          lastStep: "complete",
          pnpmReached: WRAPPER_PNPM_COMMANDS,
          mark: CASE_OPTIONS.mark,
          label,
        });
        settles.push(record.settleMs);
      }
    },
    240_000,
  );

  // ── CASE 7 · THE ANTI-VACUITY CONTROL ─────────────────────────────────────────────
  it(
    `case 7 — a HANG under a watchdog disabled for not leading its group, ${RUNS_PER_CASE} times`,
    async () => {
      // The inverse of the suite's most important line. If this case ever starts arming
      // the watchdog, leader detection has changed; if the timeout cases stop timing out
      // while this still passes, the suite has gone green-and-empty. Neither state is
      // visible from any other case.
      //
      // IT HANGS, and until slice 2 it could not. With only the `succeeds` fake, "a
      // disabled watchdog does not time out" was unfalsifiable — nothing in the run could
      // have timed out under an ARMED watchdog either, so the claim cost nothing to make.
      // Now the same fake that drives case 2 to exit 124 at its ceiling drives this run,
      // which is observed still alive well past that ceiling AND its grace with no calling
      // card, and is then released to finish normally. A hang with no release would only
      // ever reach the harness cap, which is a failure of the case rather than a proof of
      // anything; a run killed from outside would be the external-stop path, which is a
      // different slice's subject entirely.
      const ceilingAndGraceMs =
        (TIMEOUT_CASE_OPTIONS.maxRunSeconds + TIMEOUT_CASE_OPTIONS.watchdogGraceSeconds) * 1_000;
      const observeAtMs = ceilingAndGraceMs + CASE_7_OBSERVE_MARGIN_MS;
      const survivals: number[] = [];
      onTestFinished(() => {
        console.log(
          `[wrapper harness] case 7 survived (ms, ceiling+grace=${ceilingAndGraceMs}): ${survivals.join(", ")}`,
        );
      });

      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const dirs = makeCaseDir(TIMEOUT_CASE_OPTIONS);
        setFakeBehavior(dirs.caseDir, "prices:fetch", "hangs");
        const label = `case 7 run ${run}/${RUNS_PER_CASE}`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, TIMEOUT_CASE_OPTIONS),
          groupLeader: false,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 120_000,
          duringRun: async (pgid) => {
            await sleep(observeAtMs);
            // STILL ALIVE, past a ceiling and a grace that would have ended case 2 twice.
            const alive = processesInPgid(pgid);
            expect(
              alive.join(" | "),
              `${label}: the wrapper was gone ${observeAtMs}ms in — a disabled watchdog killed it`,
            ).toContain("run-daily-fetch.sh");
            expect(
              watchdogCardPresent(dirs.logDir),
              `${label}: a DISABLED watchdog left a calling card`,
            ).toBe(false);
            releaseFakeHang(dirs.caseDir, "prices:fetch");
          },
        });

        expect(record.logText, `${label}: the wrapper did not notice it was not the leader`).toContain(
          "watchdog DISABLED (not a process-group leader:",
        );
        expect(record.logText, `${label}: the watchdog armed anyway`).not.toContain("watchdog armed:");
        // AND IT DOES NOT TIME OUT: it outlived its own ceiling and grace, left no calling
        // card, exited 0, and its step name carries no `timeout:` decoration.
        expect(
          record.durationMs,
          `${label}: the run ended before it could outlive its own ceiling and grace`,
        ).toBeGreaterThan(ceilingAndGraceMs);
        expect(record.watchdogFired, `${label}: a disabled watchdog left a calling card`).toBe(false);
        expect(record.exitCode, `${label}: a disabled watchdog produced a timeout exit`).not.toBe(124);
        expect(record.heartbeat?.lastStep ?? "", `${label}: decorated step`).not.toContain("timeout:");

        assertTriple(record, dirs.caseDir, {
          exitCode: 0,
          lastStep: "complete",
          pnpmReached: WRAPPER_PNPM_COMMANDS,
          mark: TIMEOUT_CASE_OPTIONS.mark,
          label,
        });
        survivals.push(record.durationMs);
      }
    },
    600_000,
  );

  // ── THE TIMEOUT FAMILY · CASES 2, 3 AND 5 ─────────────────────────────────────────
  //
  // These are the racy ones. The historical `tee` defect reproduced on roughly three runs
  // in five, and a single lucky green had already pronounced it fixed once — which is the
  // entire argument for the 12-run floor being a floor and not a default.
  //
  // Each pays a real ceiling and a real grace, twelve times, and each asserts the fake-pnpm
  // sentinel: a case that "hangs" because the REAL pnpm was slow, or that "exits 127"
  // because a real binary was missing, is indistinguishable from a passing case without it.

  /**
   * The settle assertion, bounded in BOTH directions and recorded either way.
   *
   * LOWER: the watchdog is still serving its grace when the shell exits, so the pgid CANNOT
   * be empty yet. A harness that found it empty there would be asserting emptiness before
   * grace had been served — a false red waiting to happen, and the reason the launcher
   * samples the group at the instant of exit as well as after the wait.
   *
   * UPPER: the launcher stops polling at the deadline this case passed it, so a pgid still
   * occupied past grace + one poll + margin arrives at assertion 3 as residue and goes red.
   * The bound is derived from the wrapper's own numbers, never guessed.
   */
  function assertGraceBoundedSettle(record: RunRecord, label: string, options: CaseOptions): void {
    const graceMs = options.watchdogGraceSeconds * 1_000;
    expect(
      record.residueAtExit.length,
      `${label}: the pgid was ALREADY empty when the shell exited — the watchdog is supposed ` +
        "to outlive it and serve the grace, so either it was cancelled on the timeout path " +
        "or this run never timed out at all",
    ).toBeGreaterThan(0);
    expect(
      record.settleMs,
      `${label}: the pgid emptied in ${record.settleMs}ms, far inside the ${graceMs}ms grace — ` +
        "the escalation cannot have waited what it claims to wait",
    ).toBeGreaterThanOrEqual(graceMs / 2);
    expect(
      record.settleMs,
      `${label}: the pgid took ${record.settleMs}ms to empty, past the derived bound`,
    ).toBeLessThan(timeoutSettleDeadlineMs(options));
  }

  it(
    "the fake's `ignores-term` behavior really is deaf — the dispatch entry is not a comment",
    async () => {
      // The one behavior in the table that no case drives end-to-end, exercised directly so
      // it cannot rot into a fake that quietly dies on TERM. A later case that reached for
      // it would then be a timeout case that no longer needs an escalation, which is the
      // shape of a test that has stopped testing anything.
      const dirs = makeCaseDir(TIMEOUT_CASE_OPTIONS);
      setFakeBehavior(dirs.caseDir, "prices:fetch", "ignores-term");
      const child = spawn(join(dirs.binDir, "pnpm"), ["prices:fetch"], {
        cwd: dirs.caseDir,
        env: caseEnv(dirs, TIMEOUT_CASE_OPTIONS),
        detached: true,
        stdio: "ignore",
      });
      const pid = child.pid ?? -1;
      expect(pid).toBeGreaterThan(0);
      try {
        await sleep(750);
        expect(
          existsSync(join(dirs.caseDir, "sentinels", sentinelNameFor("prices:fetch"))),
          "the fake never started",
        ).toBe(true);
        process.kill(-pid, "SIGTERM");
        await sleep(1_000);
        expect(
          processesInPgid(pid).length,
          "the `ignores-term` fake died of the very TERM it exists to ignore",
        ).toBeGreaterThan(0);
      } finally {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* already gone */
        }
      }
    },
    60_000,
  );

  it(
    `case 2 — watchdog timeout with a REACTIVE child, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      const settles: number[] = [];
      onTestFinished(() => {
        console.log(
          `[wrapper harness] case 2 settle ms (bound ${timeoutSettleDeadlineMs(TIMEOUT_CASE_OPTIONS)}): ` +
            settles.join(", "),
        );
      });
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const dirs = makeCaseDir(TIMEOUT_CASE_OPTIONS);
        // The fake hangs at the fetch step, reactively: neither it nor its `sleep` traps
        // anything, so the watchdog's group TERM is what ends it — and the wrapper's own
        // TERM handler is what turns that into an orderly exit 124 with a breadcrumb.
        setFakeBehavior(dirs.caseDir, "prices:fetch", "hangs");
        const label = `case 2 run ${run}/${RUNS_PER_CASE}`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, TIMEOUT_CASE_OPTIONS),
          groupLeader: true,
          settleDeadlineMs: timeoutSettleDeadlineMs(TIMEOUT_CASE_OPTIONS),
          maxWaitMs: 120_000,
        });

        expect(record.logText, `${label}: the watchdog did not arm — was the child detached?`).toContain(
          "watchdog armed:",
        );
        expect(record.logText, `${label}: the watchdog never fired`).toContain(
          `WATCHDOG: run exceeded ${TIMEOUT_CASE_OPTIONS.maxRunSeconds}s`,
        );
        // THE CALLING CARD. It is the TERM handler's only discriminator between the
        // watchdog's signal and an operator's, and it is what makes the 124 honest.
        expect(record.watchdogFired, `${label}: the watchdog left no calling card`).toBe(true);
        assertGraceBoundedSettle(record, label, TIMEOUT_CASE_OPTIONS);

        assertTriple(record, dirs.caseDir, {
          exitCode: 124,
          lastStep: "timeout:prices-fetch",
          pnpmReached: ["prices:fetch"],
          mark: TIMEOUT_CASE_OPTIONS.mark,
          label,
        });
        // KEPT FOR THE PAIR COMPARISON below, which is how the watchdog-TERM and
        // external-TERM halves of one branch are held against each other.
        watchdogTermObserved = observeTermPath(record, label);
        settles.push(record.settleMs);
      }
    },
    600_000,
  );

  it(
    `case 3 — watchdog timeout with a TERM-DEAF grandchild, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      const settles: number[] = [];
      onTestFinished(() => {
        console.log(
          `[wrapper harness] case 3 settle ms (bound ${timeoutSettleDeadlineMs(TIMEOUT_CASE_OPTIONS)}): ` +
            settles.join(", "),
        );
      });
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const dirs = makeCaseDir(TIMEOUT_CASE_OPTIONS);
        // The historical shape verbatim: the grandchild ignores TERM and holds the
        // inherited write end of the log pipe, so it survived the group TERM and kept `tee`
        // alive with it — both sitting in the run's process group holding launchd's
        // per-label job slot long after the run itself was gone.
        setFakeBehavior(dirs.caseDir, "prices:fetch", "hangs-with-term-deaf-grandchild");
        const label = `case 3 run ${run}/${RUNS_PER_CASE}`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, TIMEOUT_CASE_OPTIONS),
          groupLeader: true,
          settleDeadlineMs: timeoutSettleDeadlineMs(TIMEOUT_CASE_OPTIONS),
          maxWaitMs: 120_000,
        });

        expect(record.logText, `${label}: the watchdog did not arm`).toContain("watchdog armed:");
        expect(record.watchdogFired, `${label}: the watchdog left no calling card`).toBe(true);
        expect(
          existsSync(join(dirs.caseDir, "sentinels", TERM_DEAF_CHILD_SENTINEL)),
          `${label}: the TERM-deaf grandchild never started — this case has silently become case 2`,
        ).toBe(true);
        // GONE, NOT MERELY ORPHANED. It has to be visible in the group at the instant the
        // shell exited — it ignored the TERM — and absent once the SIGKILL escalation has
        // run. Assertion 3 below is the half that says "absent"; this is the half that says
        // there was something there to reap.
        expect(
          record.residueAtExit.join(" | "),
          `${label}: the deaf grandchild was not in the pgid when the shell exited`,
        ).toContain(TERM_DEAF_CHILD_NAME);
        assertGraceBoundedSettle(record, label, TIMEOUT_CASE_OPTIONS);
        expect(
          record.pgidResidue.join(" | "),
          `${label}: the deaf grandchild survived the SIGKILL escalation`,
        ).not.toContain(TERM_DEAF_CHILD_NAME);

        assertTriple(record, dirs.caseDir, {
          exitCode: 124,
          lastStep: "timeout:prices-fetch",
          pnpmReached: ["prices:fetch"],
          mark: TIMEOUT_CASE_OPTIONS.mark,
          label,
        });
        settles.push(record.settleMs);
      }
    },
    600_000,
  );

  it(
    `case 5 — an early non-zero exit, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      const settles: number[] = [];
      onTestFinished(() => {
        console.log(`[wrapper harness] case 5 settle ms: ${settles.join(", ")}`);
      });
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        // The FULL ceiling, deliberately: this run must end on its own terms long before
        // any watchdog could touch it, and a short ceiling would blur those two endings.
        const dirs = makeCaseDir(CASE_OPTIONS);
        // Exit 127 is the shape a missing `pnpm` or an invisible `node` takes in
        // production, and it is the case that justifies the heartbeat writer being pure
        // bash: on this path nothing node-shaped can run.
        setFakeBehavior(dirs.caseDir, "prices:fetch", "exits-127");
        const label = `case 5 run ${run}/${RUNS_PER_CASE}`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, CASE_OPTIONS),
          groupLeader: true,
          // THE SHORT WINDOW, AS ON EVERY NON-TIMEOUT PATH. This run ends on its own terms,
          // so its EXIT trap cancels the watchdog — subshell and forked `sleep` both —
          // before the shell leaves. Giving this case the grace-derived bound would let a
          // watchdog left sleeping out its full ceiling over an already-dead run pass
          // unnoticed, which is precisely the held-job-slot failure the cancellation exists
          // to prevent.
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });

        expect(record.logText, `${label}: the watchdog did not arm`).toContain("watchdog armed:");
        expect(record.logText, `${label}: the wrapper did not report the failed fetch`).toContain(
          "prices:fetch exited 127 — NOT running spine.",
        );
        // NOT A TIMEOUT, and the step name says so: no calling card, no `timeout:` prefix.
        // The step is undecorated because the run ended on its own terms.
        expect(record.watchdogFired, `${label}: a run that was never timed out left a calling card`).toBe(
          false,
        );

        assertTriple(record, dirs.caseDir, {
          exitCode: 127,
          lastStep: "prices-fetch",
          pnpmReached: ["prices:fetch"],
          mark: CASE_OPTIONS.mark,
          label,
        });
        settles.push(record.settleMs);
      }
    },
    600_000,
  );

  // ── S8 · THE MARK WINDOW — CASES 6 AND 8 ──────────────────────────────────────────
  //
  // BOTH CASES CHOOSE THEIR SIDE OF THE WINDOW BY SETTING A VALUE, never by hoping the
  // suite runs in the evening. Every case below computes its configuration FRESH, inside
  // the loop, from `markConfigFor` — see `mark-window.testkit.ts` for why the zone it
  // picks leaves ~23 hours of margin on both sides and therefore cannot be straddled by a
  // run of this suite.
  //
  // EACH CASE ALSO ASSERTS THE SIDE IT ASKED FOR, in so many words, and that assertion is
  // not redundant with the triple. The triple judges `markWindow` against an ORACLE, and
  // an oracle agrees with the run just as happily when both say `false` — so an in-window
  // case whose configuration silently stopped working would still pass the triple while
  // asserting nothing about the stamp it exists to prove. The bare `toBe(true)` /
  // `toBe(false)` below is what makes that impossible.

  /** A case's configuration for one run, on the side of the window it asks for. */
  function markCaseOptions(window: "in" | "out", base: CaseOptions): CaseOptions {
    return { ...base, mark: markConfigFor(window) };
  }

  /**
   * CASE 6'S CEILING IS DELIBERATELY LOOSER THAN EVERY OTHER TIMEOUT CASE'S, and the extra
   * seconds are the whole difference between a cry-wolf case and a second copy of case 2.
   *
   * Cases 2, 3 and 4 hang at the FIRST step, so their run has nothing to accomplish before
   * the ceiling and 3 seconds is generous. Case 6 has to get all the way to the LAST step
   * first — five fake `pnpm` invocations plus the wrapper's whole git step against the
   * case's own repo (`rev-parse`, the explicit `add`, `diff --cached` and the `status`
   * post-check) — and only then wedge. What it does NOT traverse is a `git commit`: the
   * fixture commits an EMPTY `events.jsonl` and the fake `spine` writes nothing, so
   * `git diff --cached --quiet` succeeds and the wrapper takes its documented
   * "no tracked data changes to commit" no-op arm. An earlier version of this comment
   * claimed the commit as part of the traversal it is buying margin for; the margin is
   * real, the commit is not. A healthy run does all of it in
   * about 0.7s (case 1 measures it every suite run), but a 3-second ceiling gave only ~4x
   * margin and lost the race on a loaded machine: the run timed out at an earlier step and
   * the case quietly became case 2 with a different label. Widened, not removed — the
   * timeout still has to happen, it just has to happen at the step this case names.
   */
  const CASE_6_OPTIONS: CaseOptions = { ...TIMEOUT_CASE_OPTIONS, maxRunSeconds: 5 };

  /**
   * The dispatch assertion's failure message, carrying the step the run ACTUALLY died at.
   * Without it, "expected undefined to be 'hangs'" says nothing about whether the run
   * wedged early or never wedged at all — the two failures needing opposite fixes.
   */
  function dispatchContext(record: RunRecord): string {
    return (
      `run ended at \`${record.heartbeat?.lastStep ?? "<no heartbeat>"}\` after ` +
      `${record.durationMs}ms`
    );
  }

  /**
   * The `pnpm` first-arguments the fake recorded, in the order the wrapper made them.
   *
   * Read off the fake's own append-only log rather than off the sentinels, because the
   * sentinels are a SET and case 6's whole claim is about ORDER: the three steps before
   * `backfill` succeeded and the run wedged at `backfill` itself.
   */
  function invocationOrder(caseDir: string): string[] {
    const logPath = join(caseDir, "sentinels", INVOCATION_LOG_NAME);
    if (!existsSync(logPath)) {
      return [];
    }
    return readFileSync(logPath, "utf8")
      .split("\n")
      .filter((line) => line.startsWith("pnpm "))
      .map((line) => line.slice("pnpm ".length).split(" ")[0] ?? "");
  }

  /** The behavior the fake's per-first-argument dispatch selected for one sub-command. */
  function dispatchedBehavior(caseDir: string, command: string): string | undefined {
    const path = join(caseDir, "sentinels", dispatchRecordNameFor(command));
    return existsSync(path) ? readFileSync(path, "utf8").trim() : undefined;
  }

  /**
   * CASE 6 · THE CRY-WOLF RUN — a timeout AFTER the day's marks are already in the log.
   *
   * Cases 2 and 3 hang at `prices-fetch`, so nothing landed and nothing may be stamped.
   * This one succeeds through `spine`, `commit`, `post-check`, `gap-report` and the
   * `operator-notice` step and wedges at `backfill` — the derived, networked step — so the marks ARE in the log and an
   * in-window run must say so even though it exited 124. Under-stamping here is what
   * would make the next morning claim "nothing recorded" for a day the log plainly holds.
   *
   * IT IS ALSO THE WORST PLACE IN THE SUITE FOR THE `PATH` MISTAKE. "Succeeds through the
   * spine step, then hangs at the backfill" is precisely what a REAL pipeline does against
   * a slow hosted database — so a case 6 that accidentally resolved the real `pnpm` would
   * look like a passing cry-wolf case while having appended to the real event log and
   * committed it. The sentinel assertions inside the triple are the guard, and the
   * dispatch record below is what proves the hang came from the fake's own per-argument
   * table rather than from anything real being slow.
   */
  it(
    `case 6 — cry-wolf: a timeout at \`backfill\` IN the mark window, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      const settles: number[] = [];
      onTestFinished(() => {
        console.log(`[wrapper harness] case 6 in-window settle ms: ${settles.join(", ")}`);
      });
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const options = markCaseOptions("in", CASE_6_OPTIONS);
        const dirs = makeCaseDir(options);
        // THE ONE BEHAVIOR ENTRY THAT MAKES THIS CASE ITSELF. Everything before `backfill`
        // falls through to the fake's default `succeeds`, so the run reaches the last step
        // with the day's marks appended and committed, and only then wedges.
        setFakeBehavior(dirs.caseDir, "backfill", "hangs");
        const label = `case 6 run ${run}/${RUNS_PER_CASE} (in-window, ${options.mark.timeZone} hour ${options.mark.hour})`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, options),
          groupLeader: true,
          settleDeadlineMs: timeoutSettleDeadlineMs(options),
          maxWaitMs: 120_000,
        });

        expect(record.logText, `${label}: the watchdog did not arm — was the child detached?`).toContain(
          "watchdog armed:",
        );
        expect(record.logText, `${label}: the watchdog never fired`).toContain(
          `WATCHDOG: run exceeded ${options.maxRunSeconds}s`,
        );
        expect(record.watchdogFired, `${label}: the watchdog left no calling card`).toBe(true);
        assertGraceBoundedSettle(record, label, options);

        // THE HANG CAME FROM THE DISPATCH, and it is proven rather than assumed. Four
        // `succeeds` and one `hangs`, selected by the fake on its FIRST ARGUMENT — which
        // is the capability a single-behavior fake does not have and the reason this case
        // is expressible at all.
        for (const command of ["prices:fetch", "spine", "gap-report", "operator-notice"]) {
          expect(
            dispatchedBehavior(dirs.caseDir, command),
            `${label}: the fake did not take its \`succeeds\` branch for \`${command}\``,
          ).toBe("succeeds");
        }
        expect(
          dispatchedBehavior(dirs.caseDir, "backfill"),
          `${label}: the fake did not take its \`hangs\` branch for \`backfill\` — this run wedged ` +
            "somewhere the harness did not put a hang, which is what a REAL slow backfill would " +
            `look like (${dispatchContext(record)})`,
        ).toBe("hangs");
        // AND IN THAT ORDER. The sentinels are a set; the wedge is a position.
        expect(invocationOrder(dirs.caseDir), `${label}: the wrapper's step order`).toEqual([
          ...WRAPPER_PNPM_COMMANDS,
        ]);

        assertTriple(record, dirs.caseDir, {
          exitCode: 124,
          lastStep: "timeout:backfill",
          pnpmReached: WRAPPER_PNPM_COMMANDS,
          mark: options.mark,
          label,
        });

        // THE SIDE THIS CASE ASKED FOR, stated bare. Without it the triple's oracle would
        // be satisfied by an out-of-window run agreeing with an out-of-window oracle, and
        // the stamp assertion below would never be reached.
        expect(
          record.heartbeat?.markWindow,
          `${label}: the configured zone did not put this run IN the window — every ` +
            "assertion about the stamp below is vacuous until it does",
        ).toBe(true);
        // THE PAYLOAD OF THE WHOLE CASE. `backfill` is past `spine`, so the marks landed;
        // in-window and landed means this run IS the day's last in-window finish, and the
        // heartbeat has to say so even though the run itself timed out.
        expect(
          record.heartbeat?.lastMarkWindowFinishedAt,
          `${label}: a run that appended and committed the day's marks and THEN wedged left ` +
            "the day unstamped — the next morning would read it as nothing recorded",
        ).toBe(record.heartbeat?.finishedAt);

        settles.push(record.settleMs);
      }
    },
    900_000,
  );

  /**
   * CASE 6, THE OTHER SIDE — the same run, out of the window, must CARRY rather than stamp.
   *
   * A prior stamp is seeded, and seeding it is what makes this case say anything: with a
   * fresh case dir "carried the previous value forward" and "invented nothing" are the same
   * observation, and only one of them is the contract. The heartbeat has ONE slot, so this
   * is the run that would erase the evening's evidence if it stamped itself.
   */
  it(
    `case 6 — the same cry-wolf run OUT of the window carries the prior stamp, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      const settles: number[] = [];
      onTestFinished(() => {
        console.log(`[wrapper harness] case 6 out-of-window settle ms: ${settles.join(", ")}`);
      });
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const options = markCaseOptions("out", CASE_6_OPTIONS);
        const dirs = makeCaseDir(options);
        seedMarkedEveningHeartbeat(dirs.dataDir);
        setFakeBehavior(dirs.caseDir, "backfill", "hangs");
        const label = `case 6 run ${run}/${RUNS_PER_CASE} (out-of-window, ${options.mark.timeZone} hour ${options.mark.hour})`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, options),
          groupLeader: true,
          settleDeadlineMs: timeoutSettleDeadlineMs(options),
          maxWaitMs: 120_000,
        });

        expect(record.watchdogFired, `${label}: the watchdog left no calling card`).toBe(true);
        assertGraceBoundedSettle(record, label, options);
        expect(
          dispatchedBehavior(dirs.caseDir, "backfill"),
          `${label}: the fake did not take its \`hangs\` branch for \`backfill\` ` +
            `(${dispatchContext(record)})`,
        ).toBe("hangs");
        expect(invocationOrder(dirs.caseDir), `${label}: the wrapper's step order`).toEqual([
          ...WRAPPER_PNPM_COMMANDS,
        ]);

        assertTriple(record, dirs.caseDir, {
          exitCode: 124,
          lastStep: "timeout:backfill",
          pnpmReached: WRAPPER_PNPM_COMMANDS,
          mark: options.mark,
          carriedStamp: AUTHORED_PRIOR_STAMP,
          label,
        });

        expect(
          record.heartbeat?.markWindow,
          `${label}: the configured zone did not put this run OUT of the window`,
        ).toBe(false);

        settles.push(record.settleMs);
      }
    },
    900_000,
  );

  /**
   * CASE 8 · THE HEARTBEAT CARRY-FORWARD, and the join it is the only case to exercise.
   *
   * The heartbeat has a BASH WRITER and a TYPESCRIPT READER with nothing else joining them
   * at runtime. That is why the event-store's heartbeat module is in the arming path set,
   * and it is why this case is not droppable: without it the suite arms on a file whose
   * behavior no case verifies.
   *
   * Both directions run OUT of the window deliberately. An in-window run that reaches
   * `complete` stamps ITSELF, which would overwrite whatever it carried and make both
   * halves below unobservable — the carry is only visible on a run that did not earn a
   * stamp of its own.
   *
   * Deterministic and therefore cheap: the fake succeeds everywhere, so there is no
   * ceiling to wait out and the twelve runs cost a second each.
   */
  it(
    `case 8 — a schemaVersion-1 file's \`finishedAt\` is CARRIED, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const options = markCaseOptions("out", CASE_OPTIONS);
        const dirs = makeCaseDir(options);
        // v1 predates the mark-window field entirely, and every v1 run was read as
        // in-window — so its `finishedAt` IS the last in-window finish, and the wrapper
        // migrates it forward. This is the ONLY path on which the wrapper derives a stamp
        // from a field that is not one.
        seedV1Heartbeat(dirs.dataDir);
        const label = `case 8 run ${run}/${RUNS_PER_CASE} (v1 carry, ${options.mark.timeZone} hour ${options.mark.hour})`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, options),
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });

        expect(record.logText, `${label}: the watchdog did not arm`).toContain("watchdog armed:");
        expect(record.watchdogFired, `${label}: a healthy run left a calling card`).toBe(false);

        assertTriple(record, dirs.caseDir, {
          exitCode: 0,
          lastStep: "complete",
          pnpmReached: WRAPPER_PNPM_COMMANDS,
          mark: options.mark,
          carriedStamp: AUTHORED_V1_CARRY,
          label,
        });

        expect(
          record.heartbeat?.markWindow,
          `${label}: the configured zone did not put this run OUT of the window — an ` +
            "in-window run stamps itself and the carry becomes unobservable",
        ).toBe(false);
        // AND THE FILE IT WROTE IS v2. The migration is one-way: reading a v1 file must
        // not re-emit one, or the next run would migrate the same value again forever.
        expect(record.heartbeat?.schemaVersion, `${label}: heartbeat schemaVersion`).toBe(2);
      }
    },
    600_000,
  );

  it(
    `case 8 — an in-window v2 file that died before \`spine\` yields NO stamp, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const options = markCaseOptions("out", CASE_OPTIONS);
        const dirs = makeCaseDir(options);
        // THE DEFECT THAT OPENED THIS LINE OF WORK, seeded verbatim. The v1 fallback used
        // to be gated NEGATIVELY — it fired whenever the file did not say
        // `"markWindow": false` — which is true of this perfectly ordinary v2 file: an
        // in-window run that died before `spine` correctly omits the stamp (it marked
        // nothing) while carrying `"markWindow": true`. The old gate read that omission as
        // v1 and promoted the FAILURE's own `finishedAt` into a marked-day stamp,
        // manufacturing evidence that the day was covered and silencing the staleness
        // warning on exactly the morning it was needed.
        seedInWindowDiedBeforeSpineHeartbeat(dirs.dataDir);
        const label = `case 8 run ${run}/${RUNS_PER_CASE} (no invention, ${options.mark.timeZone} hour ${options.mark.hour})`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, options),
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });

        assertTriple(record, dirs.caseDir, {
          exitCode: 0,
          lastStep: "complete",
          pnpmReached: WRAPPER_PNPM_COMMANDS,
          mark: options.mark,
          label,
        });

        expect(
          record.heartbeat?.markWindow,
          `${label}: the configured zone did not put this run OUT of the window`,
        ).toBe(false);
        // NAMED, not merely "undefined". The seeded file's `finishedAt` is the exact value
        // the negatively-gated fallback would have promoted, so this is the assertion that
        // would have gone red on the defect.
        expect(
          record.heartbeat?.lastMarkWindowFinishedAt,
          `${label}: the wrapper promoted a failed run's \`finishedAt\` into a marked-day ` +
            "stamp — a day that was never covered now reads as covered",
        ).not.toBe(AUTHORED_PRIOR_STAMP);
      }
    },
    600_000,
  );

  // ── CASE 9 · STEP 0, THE NOTICE WRITTEN BEFORE THE TOOLCHAIN EXISTS (#357 S3) ─────
  //
  // Step 5b writes `operator-notice.txt` through `pnpm operator-notice` and says more than
  // step 0 ever can. It also only runs on a run that GETS there. The two failures this
  // whole channel was built for are the runs that do not — an unresolvable `pnpm`/`node`,
  // and a run that died partway — and on the first of those every node-shaped writer in
  // the repo is unreachable. So the wrapper writes the same file in bash, before
  // `resolve-tools`, from a positive read of the PREVIOUS run's heartbeat.
  //
  // WHAT THESE FOUR CASES ASSERT IS THE FILE'S CONTENT ON DISK, never a log line and never
  // a notifier. There is no notifier to fake: the transport is `cat` from a shell profile,
  // so the file IS the delivery. Nothing here touches launchd or a plist, for the reason
  // the suite header already gives about `launchctl` — this harness delivers the signal,
  // not the sender.
  //
  // ALL FIVE RUN OUT OF THE MARK WINDOW, so no run stamps itself and the heartbeat
  // assertions stay about the notice rather than about the carry-forward contract cases 6
  // and 8 own.
  //
  // ── THERE ARE NOW TWO BASH WRITERS, AND THAT SETS THESE CASES' SHAPE (#376) ──────────
  // The EXIT trap writes this same file, through the same shared function, on any non-zero
  // exit — because a notice that carries only DATA findings is EMPTY on a run whose data
  // was clean and which then died at `backfill`, and an empty notice reads as health for as
  // long as it takes the next fire to notice. The trap is therefore the LAST writer on
  // every failing run, which is exactly what 9e asserts.
  //
  // The consequence for 9a-9c is that step 0's own write is no longer observable at the end
  // of a run that FAILED: the trap has overwritten it by then, correctly. So those three
  // now run to COMPLETION and read the file afterwards. That is not a weaker vehicle, it is
  // two claims for the price of one — the notice standing at the end of a clean run can
  // only be what step 0 left there, AND the trap's zero-exit restraint (it must not
  // truncate, `:>`, or otherwise touch the file when the run succeeded) is what makes that
  // sentence true. A trap that cleared the file unconditionally fails all three at once.
  //
  // WHICH WRITER WROTE IS ASSERTED THROUGH THE SCOPE TAIL, never through the FAILED line:
  // the two callers share that line verbatim on purpose, and `STEP_0_SCOPE_TAIL` /
  // `EXIT_TRAP_SCOPE_TAIL` are the only place they differ.

  /**
   * CASE 9a · THE PREVIOUS RUN FAILED, SO THE NOTICE SAYS SO — naming BOTH fields.
   *
   * Exit code and step, not merely "the last run failed": exit 127 at `resolve-tools` is a
   * PATH problem on this machine and exit 124 at `timeout:backfill` is a wedged network
   * call, and a notice that could not tell them apart would send the operator to the wrong
   * place on the one channel that reaches them unasked.
   *
   * THE RUN ITSELF IS HEALTHY, and since #376 that is the only shape in which this claim
   * can be read at all: on a failing run the EXIT trap overwrites step 0's lines with this
   * run's own failure, which is the whole point of the trap. A clean run leaves the trap
   * silent, so the file still holds what step 0 put there — a notice about the PREVIOUS run
   * standing over a successful one, which is exactly what production does until step 5b
   * replaces it.
   */
  it(
    `case 9a — a FAILED previous heartbeat is written into the notice, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const options = markCaseOptions("out", CASE_OPTIONS);
        const dirs = makeCaseDir(options);
        seedHeartbeatOutcome(dirs.dataDir, AUTHORED_FAILED_OUTCOME);
        const label = `case 9a run ${run}/${RUNS_PER_CASE}`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, options),
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });

        assertTriple(record, dirs.caseDir, {
          exitCode: 0,
          lastStep: "complete",
          pnpmReached: WRAPPER_PNPM_COMMANDS,
          mark: options.mark,
          label,
        });

        const notice = readOperatorNotice(dirs.dataDir);
        expect(
          notice,
          `${label}: step 0 wrote no notice at all for a previous run that failed`,
        ).toBeDefined();
        expect(notice ?? "", `${label}: the notice does not name the previous failure`).toContain(
          expectedFailureFragment(AUTHORED_FAILED_OUTCOME),
        );
        // The house voice, asserted so the notice cannot drift into a second vocabulary for
        // a channel the operator reads in two seconds.
        expect(notice ?? "", `${label}: the notice's lines do not begin \`Numisma: \``).toMatch(
          /^Numisma: /,
        );
        // AND IT WAS STEP 0 THAT WROTE IT. The FAILED line is shared verbatim with the EXIT
        // trap, so only the scope tail can say which caller produced the file — and a trap
        // that had written here on a ZERO exit would have replaced a real notice with one
        // about a run that succeeded.
        expect(
          notice ?? "",
          `${label}: the notice standing after a CLEAN run is not step 0's — something else wrote it`,
        ).toContain(STEP_0_SCOPE_TAIL);
        expect(
          notice ?? "",
          `${label}: the EXIT trap wrote a notice on a run that exited 0`,
        ).not.toContain(EXIT_TRAP_SCOPE_TAIL);
      }
    },
    600_000,
  );

  /**
   * CASE 9b · THE WRITE RULE — a clean previous run leaves the file COMPLETELY ALONE.
   *
   * This is the case the whole block turns on, and the argument is worth restating where
   * someone might otherwise "tidy" step 0 into an unconditional write.
   *
   * The file standing on disk at the start of a run was written by the PREVIOUS run's step
   * 5b, and it may name real lost days. Truncate it here — at the start, before this run
   * has proved it can do anything — and then die at step 3, and the operator is left with
   * an EMPTY notice over a real loss. `cat` of an empty file prints nothing, empty is the
   * channel's HEALTHY state, and the channel has manufactured the exact false all-clear it
   * exists to end. Self-clearing is step 5b's job alone, because step 5b runs only once the
   * day's work is actually done.
   *
   * So: an authored sentinel notice, a CLEAN heartbeat, and a run that finishes. The
   * sentinel must survive BYTE FOR BYTE — `toBe`, never `toContain`, because a step 0 that
   * appended to it rather than truncating it would also be wrong and `toContain` would
   * shrug.
   *
   * AND IT IS NOW THE SAME CASE FOR THE EXIT TRAP (#376). Two writers of one file are held
   * to one restraint here: the run exits 0, so the trap's notice branch must not fire, and
   * a trap that wrote unconditionally would delete this sentinel just as surely as a step 0
   * that truncated. `pnpm operator-notice` is deliberately left UNARMED, so the fake writes
   * nothing at 5b and the bytes on disk at the end can only be the seed.
   */
  it(
    `case 9b — a CLEAN previous heartbeat leaves the notice untouched, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const options = markCaseOptions("out", CASE_OPTIONS);
        const dirs = makeCaseDir(options);
        seedOperatorNotice(dirs.dataDir, AUTHORED_SENTINEL_NOTICE);
        seedHeartbeatOutcome(dirs.dataDir, AUTHORED_CLEAN_OUTCOME);
        const label = `case 9b run ${run}/${RUNS_PER_CASE}`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, options),
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });

        assertTriple(record, dirs.caseDir, {
          exitCode: 0,
          lastStep: "complete",
          pnpmReached: WRAPPER_PNPM_COMMANDS,
          mark: options.mark,
          label,
        });

        // THE RUN REALLY DID REACH 5b, stated rather than assumed: the unarmed fake writing
        // nothing there is what makes the survival below attributable to the two bash
        // writers rather than to a run that stopped before anything could write.
        expect(
          existsSync(join(dirs.caseDir, "sentinels", sentinelNameFor("operator-notice"))),
          `${label}: the run never reached step 5b, so this case cannot say what it proves`,
        ).toBe(true);
        expect(
          readOperatorNotice(dirs.dataDir),
          `${label}: a notice a HEALTHY previous run had left was rewritten or truncated — ` +
            "by step 0 at the start, or by the EXIT trap on a run that exited 0; either way " +
            "an empty file over a real lost day reads as health",
        ).toBe(AUTHORED_SENTINEL_NOTICE);
      }
    },
    600_000,
  );

  /**
   * CASE 9c · NO HEARTBEAT AT ALL — say nothing, write nothing.
   *
   * A fresh machine that has never run this job has no breadcrumb, and telling it on its
   * first morning that the last run failed is cry-wolf on day one, spent from the only
   * account this channel has. Step 0 speaks only on a POSITIVE read of both fields, so an
   * absent — or truncated, or hand-mangled — heartbeat produces no file at all.
   *
   * The assertion is `toBeUndefined`, and the distinction from `""` is the case: an empty
   * notice is the healthy SELF-CLEARED state, and a step 0 that truncated unconditionally
   * would produce exactly that and sail past a reader which flattened the two.
   *
   * THE RUN SUCCEEDS, so this is the no-writer case end to end (#376): step 0 has no
   * breadcrumb to speak from, the EXIT trap's branch is gated on a non-zero exit, and the
   * unarmed fake at 5b writes nothing. IN THIS HARNESS, therefore, no writer touches the
   * file and it must not exist at all — the strongest form of "say nothing, write nothing"
   * the two BASH writers have.
   *
   * SAID PRECISELY, BECAUSE THE PRODUCTION SENTENCE IS THE OPPOSITE: with a real toolchain
   * a fresh machine's first healthy run DOES create `operator-notice.txt`, empty, because
   * `writeOperatorNoticeFile` always writes including the empty case — that unconditional
   * write is the self-clearing contract. What this case isolates is the bash half: with 5b
   * inert, `undefined` vs `""` separates "no bash writer spoke" from "step 0 truncated
   * unconditionally", and only the first is correct.
   */
  it(
    `case 9c — no heartbeat means no notice, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const options = markCaseOptions("out", CASE_OPTIONS);
        const dirs = makeCaseDir(options);
        // Deliberately no seed of any kind — `makeCaseDir` leaves a fresh data dir.
        const label = `case 9c run ${run}/${RUNS_PER_CASE}`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, options),
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });

        assertTriple(record, dirs.caseDir, {
          exitCode: 0,
          lastStep: "complete",
          pnpmReached: WRAPPER_PNPM_COMMANDS,
          mark: options.mark,
          label,
        });

        expect(
          readOperatorNotice(dirs.dataDir),
          `${label}: a failure report was invented on a machine with no breadcrumb and a ` +
            "run that succeeded — cry-wolf on day one, from the one channel whose only " +
            "asset is being believed",
        ).toBeUndefined();
      }
    },
    600_000,
  );

  /**
   * CASE 9d · THE LOAD-BEARING ONE — step 0 speaks THROUGH a broken toolchain.
   *
   * Without this case slice 3 has no reason to exist. Every other notice this repo writes
   * is written by node, and the failure the channel was built for is precisely the one
   * where node cannot be found: launchd hands the job a bare
   * `/usr/bin:/bin:/usr/sbin:/sbin`, and if the prepend does not resolve `pnpm` — or
   * resolves it while asdf's `node` stays behind an absent shims dir — the run dies at
   * `resolve-tools` with exit 127 and nothing node-shaped ever runs.
   *
   * SO THE PREPEND HERE HOLDS NO TOOLS AT ALL. An empty directory inside the case dir, not
   * the fake bin: the isolation contract still passes (every entry is absolute and inside
   * the case dir), the real `pnpm` is in neither the prepend nor the inherited launchd
   * PATH, and the wrapper's own `command -v pnpm` guard is what ends the run. That the
   * notice is on disk afterwards is the proof that the channel ran BEFORE that guard and
   * survived it.
   *
   * WHICH OF THE TWO BASH WRITERS IS ON TRIAL HERE CHANGED WITH #376, and the case is
   * sharper for it. Both write on this path — step 0 about the SEEDED wedged run, then the
   * EXIT trap about THIS run's exit 127 — and the trap is last. So the file at the end must
   * name `resolve-tools`, not the seed, and that single assertion carries two facts: the
   * notice channel still speaks with no toolchain at all, and the trap is the writer that
   * stands. Step 0's own bytes are unobservable from here for the same reason; 9a is where
   * they are read.
   */
  it(
    `case 9d — the notice survives an unresolvable toolchain, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const options = markCaseOptions("out", CASE_OPTIONS);
        const dirs = makeCaseDir(options);
        // The wedged shape, chosen so the notice's contents cannot be confused with this
        // run's own outcome: this run exits 127 at `resolve-tools`, the seed says 124 at
        // `timeout:backfill`, and a `timeout:` step name is also the case that proves
        // "clean" is an equality against `complete` rather than a check for a bare step.
        seedHeartbeatOutcome(dirs.dataDir, AUTHORED_WEDGED_OUTCOME);
        const toollessBin = join(dirs.caseDir, "toolless-bin");
        mkdirSync(toollessBin, { recursive: true });
        const label = `case 9d run ${run}/${RUNS_PER_CASE}`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: { ...caseEnv(dirs, options), NUMISMA_PATH_PREPEND: toollessBin },
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });

        // The wrapper's own named refusal, not a bare 127 from somewhere else in the run.
        expect(record.logText, `${label}: the wrapper did not refuse an unresolvable pnpm`).toContain(
          "FATAL: 'pnpm' not found on PATH",
        );
        assertTriple(record, dirs.caseDir, {
          exitCode: 127,
          lastStep: "resolve-tools",
          pnpmReached: [],
          mark: options.mark,
          label,
        });

        const notice = readOperatorNotice(dirs.dataDir);
        expect(
          notice,
          `${label}: with the toolchain gone there is no node-shaped writer — the bash ` +
            "channel said nothing at all",
        ).toBeDefined();
        expect(
          notice ?? "",
          `${label}: the notice does not name THIS run's refusal, which is the failure the ` +
            "operator has to act on",
        ).toContain(expectedFailureFragment({ exitCode: 127, lastStep: "resolve-tools" }));
        expect(
          notice ?? "",
          `${label}: the standing notice is not the EXIT trap's — the trap writes last on ` +
            "every failing run, including this one, where nothing node-shaped ever ran",
        ).toContain(EXIT_TRAP_SCOPE_TAIL);
        // AND THE SEED IS GONE. Step 0 wrote it moments earlier; a notice still naming the
        // PREVIOUS wedged run would mean the trap never fired on an `exit 127` — the exact
        // path the whole pure-bash argument is built on.
        expect(
          notice ?? "",
          `${label}: the notice still names the PREVIOUS wedged run — the EXIT trap did not ` +
            "fire on the toolchain refusal",
        ).not.toContain(expectedFailureFragment(AUTHORED_WEDGED_OUTCOME));
      }
    },
    600_000,
  );

  /**
   * CASE 9e · THE NEW SEAM — TWO WRITERS, ONE FILE, ORDERING MATTERS (#376).
   *
   * Since the job half came off step 5b, the notice carries DATA findings only. So a 23:00
   * fire whose data is genuinely clean writes an EMPTY notice at 23:04 and then wedges at
   * `backfill` at 23:49: the 08:00 terminal prints nothing, step 0 does not speak until the
   * 18:00 fire, and an all-clear stands over a known-failed run for nineteen hours — on the
   * channel that exists because a lost day reached no one. The EXIT trap closes that by
   * writing the same file, through the same shared function, on a non-zero exit.
   *
   * THE FAKE `pnpm operator-notice` ACTUALLY WRITES HERE, and that is what makes this a
   * case rather than a restatement of 9d. Everywhere else the fake succeeds silently, so
   * "the trap wrote" and "nobody else wrote" are the same observation. Armed with an
   * authored payload, 5b leaves bytes on disk mid-run and the run then dies AFTER it — so
   * the assertion is about ORDER: the trap's lines are there and the payload is not.
   *
   * THAT THE PAYLOAD IS DISCARDED IS THE RULED TRADE, NOT AN ACCIDENT. Those lines were
   * true — but from the trap's position they are unmaintainable text of unknown vintage,
   * and the wrapper's own step 0 comment already ruled that a bounded currently-true
   * message beats a preserved one nothing can retire. The same bytes were discarded before
   * this change too, by step 0 at the NEXT fire; all that moves is when the operator finds
   * out. The `not.toContain` below is that ruling, written where it can go red.
   *
   * NOTHING HERE GOES NEAR THE REAL CLI. The payload is authored, the target path comes
   * from the same imported `OPERATOR_NOTICE_FILENAME` the rest of this module uses, and the
   * pnpm sentinel proves the fake — not a real toolchain — is what ran.
   */
  it(
    `case 9e — the EXIT trap REPLACES step 5b's notice when the run dies after it, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const options = markCaseOptions("out", CASE_OPTIONS);
        const dirs = makeCaseDir(options);
        // No heartbeat seed: step 0 must stay SILENT, so the only writers in this run are
        // 5b and the trap and the ordering claim cannot be satisfied by a leftover.
        armFakeOperatorNoticeWrite(dirs.caseDir, dirs.dataDir, AUTHORED_SENTINEL_NOTICE);
        // The step AFTER the notice, which is the whole geometry of the hole: everything
        // 5b knows was already written, and the run then failed.
        setFakeBehavior(dirs.caseDir, "backfill", "exits-127");
        const label = `case 9e run ${run}/${RUNS_PER_CASE}`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, options),
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });

        assertTriple(record, dirs.caseDir, {
          exitCode: 127,
          lastStep: "backfill",
          pnpmReached: WRAPPER_PNPM_COMMANDS,
          mark: options.mark,
          label,
        });

        const notice = readOperatorNotice(dirs.dataDir);
        expect(
          notice,
          `${label}: no notice at all after a run that died past 5b — the file the fake ` +
            "wrote is gone and nothing replaced it",
        ).toBeDefined();
        expect(
          notice ?? "",
          `${label}: the notice does not name THIS run's failure, so the terminal prints an ` +
            "all-clear over a run that died at backfill",
        ).toContain(expectedFailureFragment({ exitCode: 127, lastStep: "backfill" }));
        expect(
          notice ?? "",
          `${label}: the standing notice is not the EXIT trap's`,
        ).toContain(EXIT_TRAP_SCOPE_TAIL);
        expect(
          notice ?? "",
          `${label}: step 5b's lines are still there — the trap APPENDED rather than ` +
            "replacing, which puts two vintages in one voice",
        ).not.toContain(AUTHORED_SENTINEL_FRAGMENT);
      }
    },
    600_000,
  );

  // ── THE ZONE INPUT REFUSES, IT DOES NOT DEGRADE ───────────────────────────────────
  //
  // The input cases 6 and 8 are driven by is only as good as its failure mode. Bash does
  // not fail on a bad `TZ` the way `Intl` does — `TZ=Not/AZone date +%H` prints the UTC
  // hour, silently and with a zero exit — and UTC is DISJOINT from the CDMX evening
  // window, so one typo would classify every run out-of-window while the runs themselves
  // kept marking correctly. That is case 6 made vacuous again, through the input rather
  // than through the clock, which is why the guard is asserted here and not taken on
  // trust.
  //
  // AND IT REFUSES OUT LOUD, WHICH IS A SEPARATE CLAIM FROM REFUSING. These guards are the
  // newest way for EVERY scheduled fire to die, so where they die decides whether anyone
  // finds out. They used to run before the EXIT trap and before the log existed: a typo'd
  // zone in the plist killed all six fires of an evening leaving no per-run log and no
  // breadcrumb, `job-heartbeat.json` went on describing the last good run, and the TUI read
  // "healthy" until the staleness channel aged out days later — the same silent rot the
  // guard exists to prevent, re-entered through the guard. They now run after the trap and
  // the log, so the refusal lands as a FATAL log line and a breadcrumb reading `exit 1 at
  // step 'startup'`, and these cases assert exactly that.
  //
  // IT STILL REFUSES: no `pnpm` sentinel exists, `lastStep` never left `startup`, and
  // `markWindow` is `false` — which DECLINES a side rather than claiming one. A run that
  // died in its own startup guards marked nothing, so `false` is what "was this run capable
  // of marking?" honestly answers, and the stamp is neither written nor erased.
  describe("the configured mark window refuses a value it cannot resolve", () => {
    for (const [name, value, expected] of [
      ["NUMISMA_MARK_TZ", "Not/AZone", "is not a resolvable IANA zone"],
      ["NUMISMA_MARK_HOUR", "evening", "is not an hour of the day"],
    ] as const) {
      it(`exits 1 naming the value when \`${name}\` is \`${value}\``, async () => {
        const dirs = makeCaseDir(CASE_OPTIONS);
        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: { ...caseEnv(dirs, CASE_OPTIONS), [name]: value },
          groupLeader: true,
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          maxWaitMs: 60_000,
        });

        expect(record.exitCode, `${name}=${value}: exit code`).toBe(1);
        expect(record.stdout, `${name}=${value}: the refusal names the value it refused`).toContain(
          `'${value}'`,
        );
        expect(record.stdout).toContain(expected);
        // IT REFUSED BEFORE IT RAN ANYTHING. A guard that fired after the fetch would have
        // let a run with an unknowable window append to the log first.
        for (const command of WRAPPER_PNPM_COMMANDS) {
          expect(
            existsSync(join(dirs.caseDir, "sentinels", sentinelNameFor(command))),
            `${name}=${value}: the wrapper reached \`${command}\` despite refusing its own configuration`,
          ).toBe(false);
        }
        // AND IT SAID SO ON BOTH CHANNELS THAT REACH A HUMAN. The per-run log is the one an
        // operator reads; the heartbeat is the one the TUI reads. A refusal that produced
        // neither is indistinguishable from a machine that was switched off.
        expect(
          record.logText,
          `${name}=${value}: the refusal left no per-run log — every fire of the evening would ` +
            "die on the one channel that reaches nobody",
        ).toContain("FATAL");
        expect(
          record.heartbeat,
          `${name}=${value}: the refusal left no breadcrumb, so job-heartbeat.json goes on ` +
            "describing the last good run and the TUI reads healthy",
        ).toBeDefined();
        expect(record.heartbeat?.exitCode, `${name}=${value}: heartbeat exit code`).toBe(1);
        expect(record.heartbeat?.lastStep, `${name}=${value}: heartbeat step`).toBe("startup");
        // DECLINED, NOT CLAIMED — and nothing stamped: a run that died at `startup` marked
        // nothing, which is exactly what `markWindow: false` says.
        expect(record.heartbeat?.markWindow, `${name}=${value}: heartbeat markWindow`).toBe(false);
        expect(
          record.heartbeat?.lastMarkWindowFinishedAt,
          `${name}=${value}: a run that refused its own configuration invented a marked-day stamp`,
        ).toBeUndefined();
        expect(record.pgidResidue, `${name}=${value}: processes left in pgid ${record.pgid}`).toEqual([]);
      });
    }
  });

  // ── CASE 4 · THE EXTERNAL STOP ────────────────────────────────────────────────────
  //
  // THE SAME FAKE, THE SAME CEILING AND THE SAME STEP AS CASE 2. Everything about this run
  // is case 2 except WHO SIGNALLED IT, which is the only variable the TERM handler branches
  // on — so the two cases are a matched pair by construction, and the comparison below can
  // therefore mean something.
  //
  // IT DELIVERS THE SIGNAL, NOT THE SENDER, and that limit is not a hedge. `launchctl stop`,
  // `launchctl unload`, a logout and a shutdown all deliver this same bare SIGTERM to this
  // same process group; the handler cannot tell them apart and does not try. What it asks is
  // whether the watchdog left its calling card first. So this case proves the handler's
  // discrimination and says nothing about launchd — see the file header before writing that
  // the external-stop path is covered anywhere.
  //
  // WHY THE SIGNAL IS SENT ON A SENTINEL RATHER THAN A TIMER. The run must be INSIDE the
  // fetch step when it arrives (that is the step name half of the assertion) and the signal
  // must beat the ceiling (that is the calling-card half). Waiting for the fake's own
  // sentinel gets both without racing a clock: the sentinel is written by the process the
  // wrapper is blocked on, so it cannot appear early, and it appears in a fraction of the
  // 3-second ceiling.
  it(
    `case 4 — an EXTERNAL stop before the ceiling, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      const settles: number[] = [];
      const reaches: number[] = [];
      const durations: number[] = [];
      const ceilingMs = TIMEOUT_CASE_OPTIONS.maxRunSeconds * 1_000;
      // THREE SERIES, AND THIS IS THE CASE THAT NEEDS THEM MOST. It carries the suite's
      // tightest wall-clock margins, so a red here is exactly the failure where knowing
      // whether run 9 was slow — or whether every run had been drifting — is the whole
      // diagnosis. Printed after the loop, none of it survives the throw.
      //
      // EACH SERIES IS PRINTED AGAINST THE BOUND IT IS JUDGED BY, with the worst run's
      // headroom named. A bare list of milliseconds needs the reader to remember which
      // constant each one is racing, and #372 records the cost of getting that wrong: the
      // file's 475s wall clock looked like the signal and was noise, while the number that
      // actually moved was one step running at ~60% of the flat 2000ms budget the reach
      // used to carry. Headroom is the quantity that goes to zero before a bound flips red,
      // so it is the one printed.
      //
      // That budget is gone — the reach now races the watchdog's calling card rather than a
      // stopwatch (see `waitForFakeToReach`), so its series is judged against the ceiling
      // like the duration beside it. The series is still worth printing, and arguably worth
      // more: it is now the only place the contention this case actually runs under is
      // visible at all, and the measurements in `REACH_STEP_BACKSTOP_MS` came from reading
      // exactly this line across quiet and contended runs.
      onTestFinished(() => {
        const against = (series: readonly number[], bound: number): string => {
          if (series.length === 0) {
            return "none recorded";
          }
          const worst = Math.max(...series);
          return `${series.join(", ")} — worst ${worst} of ${bound}, ${bound - worst} to spare`;
        };
        console.log(
          // JUDGED AGAINST THE CEILING, because that is the bound the wait now races: the
          // watchdog's card lands there, and the backstop above it only catches a wrapper
          // that never ran. Reporting these against the retired 2000ms strip would print
          // headroom this case no longer spends.
          //
          // THE TWO HEADROOMS ARE NOT INDEPENDENT and must not be added: the duration
          // CONTAINS the reach, and both are printed against the same ceiling from two
          // different zeros — the duration from `spawn`, which is conservative because the
          // watchdog's clock starts later, and the reach against a bare 3000 when its real
          // deadline is `arm + 3000`, which is conservative in the other direction. Read
          // each as "how close this run came to its own bound", never as spare budget.
          `[wrapper harness] case 4 · reached the step (ms, ceiling ${ceilingMs}): ` +
            `${against(reaches, ceilingMs)} · ran for (ms, ceiling ${ceilingMs}): ` +
            `${against(durations, ceilingMs)} · settled (ms, deadline ${SETTLE_DEADLINE_MS}): ` +
            `${against(settles, SETTLE_DEADLINE_MS)}`,
        );
      });

      for (let run = 1; run <= RUNS_PER_CASE; run += 1) {
        const dirs = makeCaseDir(TIMEOUT_CASE_OPTIONS);
        setFakeBehavior(dirs.caseDir, "prices:fetch", "hangs");
        const label = `case 4 run ${run}/${RUNS_PER_CASE}`;

        const record = await launchWrapper({
          caseDir: dirs.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(dirs, TIMEOUT_CASE_OPTIONS),
          groupLeader: true,
          // The SHORT window, as on every non-timeout path: this run never sets `TIMED_OUT`,
          // so its EXIT trap cancels the watchdog — subshell and forked `sleep` both — before
          // the shell leaves. Handing it the grace-derived bound would let a watchdog left
          // sleeping over an already-dead run pass unnoticed, which is the held-job-slot
          // failure the cancellation exists to prevent.
          settleDeadlineMs: SETTLE_DEADLINE_MS,
          // A REAL CAP, and it matters more here than anywhere else: this is the one case
          // whose premise is that the wrapper's own watchdog has NOT fired, so the watchdog
          // cannot be its bound. A TERM that failed to be delivered must arrive as a red
          // test, never as a wedged worker.
          maxWaitMs: 60_000,
          duringRun: async (pgid) => {
            reaches.push(await waitForFakeToReach(dirs.caseDir, "prices:fetch", label, dirs.logDir));
            // BEFORE THE CEILING, ASSERTED RATHER THAN ASSUMED. If the watchdog got there
            // first this is case 2 wearing case 4's name — a run that would still exit 124
            // and still pass an exit-code-only test of "something stopped it".
            //
            // THE WAIT ABOVE ALREADY RACES THIS CARD, so what is left here is the last
            // instant it cannot cover: the wait only reads the card while the sentinel is
            // ABSENT, so a run whose sentinel and card land in the same poll gap would come
            // back "reached" and be signalled anyway. Re-reading it immediately before the
            // kill closes that gap. Cheap, and the alternative is signalling a run the
            // watchdog has already claimed.
            expect(
              watchdogCardPresent(dirs.logDir),
              `${label}: the watchdog fired BEFORE the harness could signal — this run is a ` +
                "second copy of case 2, not an external stop",
            ).toBe(false);
            // THE EXTERNAL STOP ITSELF: a bare SIGTERM to the run's own process group, with
            // no calling card, from outside the run. Byte-for-byte what `launchctl stop`
            // delivers; nothing here goes near `launchctl`.
            process.kill(-pgid, "SIGTERM");
          },
        });

        expect(record.logText, `${label}: the watchdog did not arm — was the child detached?`).toContain(
          "watchdog armed:",
        );
        // THE DISCRIMINATOR, ASSERTED DIRECTLY AND NOT INFERRED FROM THE EXIT CODE. The
        // calling card is the only thing the TERM handler reads, so its ABSENCE is the fact
        // that makes the 143 honest. A handler that had stopped discriminating entirely
        // would still satisfy an exit-code assertion on one side of the pair.
        expect(
          record.watchdogFired,
          `${label}: a calling card was left on a run the watchdog never timed out`,
        ).toBe(false);
        expect(record.logText, `${label}: the watchdog fired after all`).not.toContain(
          "WATCHDOG: run exceeded",
        );
        // THE BINDING WALL-CLOCK BOUND OF THIS CASE, now that the reach's 2000ms strip is
        // gone — and it is measured from a DIFFERENT ZERO than the ceiling it names.
        // `durationMs` starts immediately before `spawn` (`launcher.testkit.ts`), while the
        // watchdog's `SECONDS=0` is set inside a subshell forked well into the script, after
        // the log dir, the `tee`, the stamp, the prior-heartbeat read and the operator
        // notice. So this is strictly TIGHTER than the wrapper's own ceiling by the whole
        // arming offset: it can red on a run the watchdog never timed out, which is why the
        // message below reports what was measured instead of accusing the watchdog. Kept
        // deliberately conservative — an ending that arrives this late is worth knowing
        // about even when it is the machine — and the two assertions above are what actually
        // establish the watchdog did not fire.
        expect(
          record.durationMs,
          `${label}: the run took ${record.durationMs}ms from spawn to exit, past the ` +
            `${ceilingMs}ms ceiling — measured from spawn, so it includes the arming offset ` +
            "the watchdog's own clock does not. The assertions above already establish the " +
            "watchdog did NOT fire, so this is either a machine slow enough to be worth " +
            "recording or a ceiling that stopped being enforced; the report line's reach and " +
            "duration series say which",
        ).toBeLessThan(ceilingMs);

        assertTriple(record, dirs.caseDir, {
          exitCode: 143,
          // UNDECORATED, and the bareness is the payload: `timeout:` here would be the
          // wrapper telling the next morning's TUI that a run someone stopped by hand had
          // hung, spending the credibility the breadcrumb exists to hold.
          lastStep: "prices-fetch",
          pnpmReached: ["prices:fetch"],
          mark: TIMEOUT_CASE_OPTIONS.mark,
          label,
        });
        externalTermObserved = observeTermPath(record, label);
        settles.push(record.settleMs);
        durations.push(record.durationMs);
      }
    },
    600_000,
  );

  // ── THE PAIR · CASES 2 AND 4 HELD AGAINST EACH OTHER ──────────────────────────────
  //
  // #312's explicit requirement is that these two run inside ONE suite run, and this is
  // where that requirement is written down rather than merely satisfied by layout. They are
  // the two branches of a single `if` in the wrapper's TERM handler. Split across two suites
  // or two gates they drift apart in silence: each half keeps passing on its own while the
  // handler stops telling them apart. Do not separate them, and do not let one of them be
  // skipped while the other runs — the guard below turns that into a red test rather than a
  // quiet one.
  it("cases 2 and 4 differ in EXACTLY three things — and the same suite run proves it", () => {
    const timeout = watchdogTermObserved;
    const external = externalTermObserved;
    expect(
      timeout,
      "case 2 left no observation — the watchdog-TERM half of the pair did not run in THIS " +
        "suite run, so the comparison would be vacuous",
    ).toBeDefined();
    expect(
      external,
      "case 4 left no observation — the external-TERM half of the pair did not run in THIS " +
        "suite run, so the comparison would be vacuous",
    ).toBeDefined();
    if (timeout === undefined || external === undefined) {
      return;
    }
    // Same reasoning as every case loop: the summary of what the two halves actually
    // recorded is worth most when one of the comparisons below has just gone red.
    onTestFinished(() => {
      console.log(
        `[wrapper harness] the pair — ${timeout.label}: exit ${timeout.heartbeat.exitCode} at ` +
          `\`${timeout.heartbeat.lastStep}\`, card ${timeout.watchdogCard} · ${external.label}: ` +
          `exit ${external.heartbeat.exitCode} at \`${external.heartbeat.lastStep}\`, card ` +
          `${external.watchdogCard}`,
      );
    });

    // ── THE THREE THINGS THAT MUST DIFFER ───────────────────────────────────────────
    // (1) The exit code. `not.toBe` as well as the two literals, because the literals alone
    //     would still pass if a future handler collapsed both paths onto whichever number
    //     each side happens to expect — the point of a comparison is to see them MOVE APART.
    expect(timeout.heartbeat.exitCode, "case 2's exit code").toBe(124);
    expect(external.heartbeat.exitCode, "case 4's exit code").toBe(143);
    expect(
      timeout.heartbeat.exitCode,
      "the two TERM paths recorded the SAME exit code — the handler is no longer discriminating",
    ).not.toBe(external.heartbeat.exitCode);

    // (2) The step DECORATION, and nothing else about the step. Undecorating case 2's step
    //     must yield case 4's exactly: same fake, same step, so any difference beyond the
    //     `timeout:` prefix means the two runs did not die in the same place and the rest of
    //     this comparison is between two things that were never comparable.
    expect(
      timeout.heartbeat.lastStep,
      "the two TERM paths recorded the SAME step name — one of them lost its decoration, or " +
        "the other gained one",
    ).not.toBe(external.heartbeat.lastStep);
    expect(timeout.heartbeat.lastStep, "case 2's step is decorated").toMatch(/^timeout:/);
    expect(external.heartbeat.lastStep, "case 4's step is BARE").not.toMatch(/^timeout:/);
    expect(
      timeout.heartbeat.lastStep.replace(/^timeout:/, ""),
      "the pair died at DIFFERENT steps, so they are not a matched pair at all",
    ).toBe(external.heartbeat.lastStep);

    // (3) The calling card — the fact the handler actually branches on, and the reason the
    //     other two differences are what they are.
    expect(timeout.watchdogCard, "case 2's calling card").toBe(true);
    expect(external.watchdogCard, "case 4's calling card").toBe(false);
    expect(
      timeout.watchdogCard,
      "both TERM paths agreed about the calling card — the discriminator has stopped " +
        "discriminating, and the exit codes above are then true only by coincidence",
    ).not.toBe(external.watchdogCard);

    // ── AND NO OTHERS, WHICH IS THE HALF THAT NEEDS CARE ────────────────────────────
    // "No others" cannot mean "every field is equal": two runs minutes apart legitimately
    // carry different clocks. So every field is CLASSIFIED, and an unclassified one is a
    // failure rather than a default — a field added to the heartbeat later must be placed in
    // one of these three buckets deliberately, not slip past a comparison that is silent
    // about it.
    const MUST_DIFFER: readonly string[] = ["exitCode", "lastStep"];
    /**
     * Wall-clock, or derived from wall-clock. These CANNOT be compared across the pair
     * without being either vacuous or permanently red, so each is pinned individually below
     * instead — `markWindow` in particular is a function of the run's own `startedAt` read in
     * `America/Mexico_City`, so a suite straddling 18:00 CDMX legitimately produces one of
     * each, and demanding they match would go red once a day for a correct wrapper.
     */
    const MAY_VARY: readonly string[] = ["startedAt", "finishedAt", "markWindow"];
    /** Everything else: identical across the pair, presence and value alike. */
    const MUST_MATCH: readonly string[] = ["schemaVersion", "lastMarkWindowFinishedAt"];

    const timeoutKeys = Object.keys(timeout.heartbeat).sort();
    const externalKeys = Object.keys(external.heartbeat).sort();
    expect(
      timeoutKeys,
      "the two heartbeats do not even carry the same FIELDS — one of them recorded something " +
        "the other omitted",
    ).toEqual(externalKeys);
    const classified = new Set([...MUST_DIFFER, ...MAY_VARY, ...MUST_MATCH]);
    for (const key of timeoutKeys) {
      expect(
        classified.has(key),
        `\`${key}\` is a heartbeat field this comparison never classified — classify it as ` +
          "MUST_DIFFER, MAY_VARY or MUST_MATCH rather than leaving the comparison silent about it",
      ).toBe(true);
    }
    for (const key of MUST_MATCH) {
      const left = (timeout.heartbeat as unknown as Record<string, unknown>)[key];
      const right = (external.heartbeat as unknown as Record<string, unknown>)[key];
      expect(left, `\`${key}\` diverged across the pair, and only these three may`).toEqual(right);
    }

    // The fields that may vary are pinned individually, so "may vary" never becomes
    // "unchecked". Each run's window is judged against the CONTRACT's zone, the same oracle
    // the per-case triple uses, rather than against the other run's clock.
    for (const observed of [timeout, external]) {
      expect(
        Number.isNaN(Date.parse(observed.heartbeat.startedAt)),
        `${observed.label}: unparseable startedAt`,
      ).toBe(false);
      expect(
        Date.parse(observed.heartbeat.finishedAt),
        `${observed.label}: finished before it started`,
      ).toBeGreaterThanOrEqual(Date.parse(observed.heartbeat.startedAt));
      expect(
        observed.heartbeat.markWindow,
        `${observed.label}: markWindow disagrees with the contract's own zone`,
      ).toBe(expectedMarkWindow(observed.heartbeat.startedAt, CONTRACT_MARK_CONFIG));
    }

  });

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
        // WHY THIS REPEATS, and it is the same argument as the tee-deafness control's: what
        // the mutation produces is RACY, so one reading of it decides nothing.
        //
        // The orphan the mutation leaves behind is a `sleep` of ONE WATCHDOG POLL HOP, and
        // the hop was already running when the shell exited. How much of it is left is
        // therefore decided by WHERE IN THE POLL CYCLE the run finished — a phase, not a
        // budget. Quiet, a fake run finishes early in a hop and the stray has most of five
        // seconds left, which is why a single reading looked solid for months. Under load the
        // run's own duration wanders across the cycle, and a run that finished near a hop
        // boundary leaves a stray with milliseconds to live, gone before the settle window
        // closes. Measured at 3 contended runs in 5 when #394 was filed, and 3 in 6 again on
        // the machine this repetition was added on.
        //
        // There is nothing to widen here: the phase is uniform, so a longer window makes the
        // control blinder and a shorter one makes assertion 3's own reading unrepresentative.
        // What DOES collapse it is asking more than once. At the measured miss rate a single
        // reading is a coin flip; twelve independent ones miss together about four times in a
        // thousand, and every attempt is on the record either way.
        //
        // NOTHING HERE ACCEPTS AN ABSENCE AS A PASS. Each attempt still asserts, race-free,
        // that the mutation orphaned a `sleep` at the instant of exit — a wrapper that has
        // stopped orphaning fails on attempt 1 rather than after twelve — and the loop as a
        // whole still demands that assertion 3's own field, read through assertion 3's own
        // window, came back occupied at least once.
        const attempts: string[] = [];
        let seen = 0;
        // The attempt-by-attempt series is the whole diagnosis if this control ever fails:
        // "expired on all 12" and "the mutation orphaned nothing on attempt 1" are different
        // problems, and only the series tells them apart. It must survive a throw in the loop.
        onTestFinished(() => {
          console.log(`[wrapper harness] child-reap mutation outcomes: ${attempts.join(", ")}`);
        });
        for (let attempt = 1; attempt <= RUNS_PER_CASE && seen === 0; attempt += 1) {
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
          expect(record.exitCode, `attempt ${attempt}: the mutated run did not succeed`).toBe(0);
          expect(
            record.heartbeat?.lastStep,
            `attempt ${attempt}: the mutated run did not reach the end`,
          ).toBe("complete");

          // THE HALF THAT OWES NOTHING TO THE PHASE, asserted on EVERY attempt. The stray is
          // sleeping out its hop when the shell exits whatever the phase is, so this reading
          // is the one the race cannot reach — and a red here says the mutation has stopped
          // biting, which no amount of repeating would fix and which the loop below would
          // otherwise report as an expiry.
          expect(
            record.residueAtExit.join(" | "),
            `attempt ${attempt}: the child-reap mutation orphaned NOTHING into the pgid at the ` +
              `instant of exit (${record.residueAtExit.length} process(es) there) — the reap it ` +
              "removes is no longer what keeps the group clean",
          ).toMatch(/sleep/);

          // AND THE HALF ASSERTION 3 ACTUALLY TAKES: the same field, after the same window.
          if (record.pgidResidue.length > 0) {
            expect(
              record.pgidResidue.join(" | "),
              `attempt ${attempt}: something outlived the settle window, but it is not the ` +
                "watchdog's orphaned timer",
            ).toMatch(/sleep/);
            seen += 1;
          }
          attempts.push(
            `${record.pgidResidue.length > 0 ? "SEEN" : "expired"}` +
              `(run=${record.durationMs}ms, settle=${record.settleMs}ms)`,
          );
        }

        expect(
          seen,
          `the child-reap mutation orphaned a \`sleep\` on every one of ${attempts.length} runs and ` +
            `it had expired before the ${SETTLE_DEADLINE_MS}ms settle window closed every time, so ` +
            "assertion 3 has not been seen red and this control is guarding nothing: " +
            attempts.join(", "),
        ).toBeGreaterThan(0);

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
      600_000,
    );
  });

  // ── S6 · THE `tee`-DEAFNESS MUTATION CONTROL ──────────────────────────────────────
  describe("the `tee`-deafness mutation — assertion 2 is seen RED before it is trusted", () => {
    it("fails LOUDLY when its anchor text is gone, rather than mutating nothing", () => {
      const dirs = makeCaseDir(TIMEOUT_CASE_OPTIONS);
      expect(() =>
        mutateWrapper(WRAPPER_PATH, dirs.caseDir, {
          name: "an anchor that has rotted away",
          anchor: "exec > >(trap '' TERM PIPE; tee -a \"$LOG_FILE_THAT_NEVER_EXISTED\") 2>&1",
          replacement: ":",
        }),
      ).toThrow(/anchor has rotted/);
      // And the REAL anchor is still there — the half that catches the rot rather than
      // merely reporting that a made-up string is missing.
      expect(() => mutateWrapper(WRAPPER_PATH, dirs.caseDir, TEE_DEAFNESS_MUTATION)).not.toThrow();
    });

    it(
      "makes case 2 go RED by losing the heartbeat on the timeout path",
      async () => {
        // WHY THIS REPEATS. The defect is RACY: whether the shell dies of SIGPIPE depends on
        // whether the group-TERM has already taken `tee` by the time the shell writes its
        // next byte to the log pipe. It was measured at roughly three runs in five, and a
        // single lucky green had already pronounced it fixed once — so a control that ran
        // the mutation ONCE and saw the heartbeat survive would report "the guard was seen
        // red" about a run that proved nothing. It attempts up to the repetition floor and
        // stops at the first observed loss.
        const outcomes: string[] = [];
        let losses = 0;
        // The attempt-by-attempt series is the whole diagnosis if this control ever fails:
        // "kept on all 12" and "threw on attempt 3" are different problems, and only the
        // series tells them apart. It must survive a throw inside the loop.
        onTestFinished(() => {
          console.log(`[wrapper harness] tee-deafness mutation outcomes: ${outcomes.join(", ")}`);
        });
        for (let attempt = 1; attempt <= RUNS_PER_CASE && losses === 0; attempt += 1) {
          const dirs = makeCaseDir(TIMEOUT_CASE_OPTIONS);
          setFakeBehavior(dirs.caseDir, "prices:fetch", "hangs");
          // The committed wrapper is never touched: the mutation lives and dies in the case
          // dir, exactly as the child-reap control's does.
          const mutated = mutateWrapper(WRAPPER_PATH, dirs.caseDir, TEE_DEAFNESS_MUTATION);
          expect(mutated.startsWith(dirs.caseDir)).toBe(true);

          const record = await launchWrapper({
            caseDir: dirs.caseDir,
            wrapperPath: mutated,
            env: caseEnv(dirs, TIMEOUT_CASE_OPTIONS),
            groupLeader: true,
            settleDeadlineMs: timeoutSettleDeadlineMs(TIMEOUT_CASE_OPTIONS),
            maxWaitMs: 120_000,
          });

          // The watchdog still fired — this run really is the timeout path, so a lost
          // heartbeat is the mutation's doing and not a run that never timed out.
          expect(record.watchdogFired, `attempt ${attempt}: the watchdog never fired`).toBe(true);
          if (record.heartbeat === undefined) {
            losses += 1;
          }
          outcomes.push(
            `${record.heartbeat === undefined ? "LOST" : "kept"}` +
              `(exit=${record.exitCode ?? `signal ${record.signal ?? "?"}`})`,
          );
        }

        expect(
          losses,
          `the tee-deafness mutation never lost the heartbeat in ${outcomes.length} runs, so ` +
            "assertion 2 has not been seen red and this control is guarding nothing: " +
            outcomes.join(", "),
        ).toBeGreaterThan(0);

        // AND THE UNMUTATED WRAPPER KEEPS IT, on the same case and the same path — so what
        // went red is the missing `trap '' TERM PIPE` and not the timeout path itself.
        const clean = makeCaseDir(TIMEOUT_CASE_OPTIONS);
        setFakeBehavior(clean.caseDir, "prices:fetch", "hangs");
        const healthy = await launchWrapper({
          caseDir: clean.caseDir,
          wrapperPath: WRAPPER_PATH,
          env: caseEnv(clean, TIMEOUT_CASE_OPTIONS),
          groupLeader: true,
          settleDeadlineMs: timeoutSettleDeadlineMs(TIMEOUT_CASE_OPTIONS),
          maxWaitMs: 120_000,
        });
        expect(healthy.watchdogFired).toBe(true);
        expect(healthy.exitCode, "the unmutated timeout path exited by signal").toBe(124);
        expect(
          healthy.heartbeat?.lastStep,
          "the unmutated wrapper lost the heartbeat too — the `tee` trap is not what is keeping it",
        ).toBe("timeout:prices-fetch");
      },
      600_000,
    );
  });
});

// ── THE BLANK `NUMISMA_DATA_DIR` REFUSAL (#348) ───────────────────────────────────────
//
// THIS BLOCK IS NOT ARMED, AND THAT IS DELIBERATE. Everything above is gated behind
// `decision.run` because it launches the whole wrapper — watchdog, fake pnpm, minutes of
// wall clock. This refusal fires in the wrapper's `DATA_DIR` configuration block,
// before the log dir, before the heartbeat trap, before `cd` and before anything named
// `pnpm` is looked for. Running it costs one bash startup, so it runs everywhere, always,
// including on the CI box this suite otherwise cannot use.
//
// WHAT IT GUARDS. The wrapper read `${NUMISMA_DATA_DIR:-$HOME/Dev/accumulus/data}`, and
// the COLON form substitutes on unset OR empty. So a blank env var — `NUMISMA_DATA_DIR=""`,
// or `"${SCRATCH}"` with `SCRATCH` unset — silently pointed the entire run at the
// operator's REAL accumulus ledger, which is arm 2 of the three `sidecar-io.ts` weighs.
// And because `:-` does NOT substitute for whitespace, `"   "` survived as a literal
// relative path that `HEARTBEAT_FILE` and `git -C "$DATA_DIR"` then resolved against the
// process CWD — arm 1, the one ADR-006 forbids outright. One operator mistake, two
// different silent ledgers, depending on how many spaces they typed.
//
// NO REAL DATA DIR IS TOUCHED. `HOME` is redirected to a fresh temp dir for every case,
// so even the paths the wrapper merely NAMES cannot be the real ones, and the environment
// is built from an explicit allowlist rather than spread from `process.env` — a developer
// running this with a live `NUMISMA_DATA_DIR` exported must not change the result.
describe("wrapper config — a blank NUMISMA_DATA_DIR is REFUSED (always runs)", () => {
  /** sysexits.h EX_CONFIG. Distinct from the wrapper's 1 / 124 / 127 / 143. */
  const EX_CONFIG = 78;

  function runWrapperConfig(env: Record<string, string>): {
    status: number | null;
    stdout: string;
    stderr: string;
    home: string;
  } {
    const home = mkdtempSync(join(tmpdir(), "numisma-wrapper-blank-"));
    onTestFinished(() => {
      rmSync(home, { recursive: true, force: true });
    });
    const result = spawnSync("/bin/bash", [WRAPPER_PATH], {
      encoding: "utf8",
      // An ALLOWLIST, not a spread: the ambient shell may well export a real
      // NUMISMA_DATA_DIR, and inheriting it would make these cases lie.
      env: { PATH: LAUNCHD_BARE_PATH, HOME: home, ...env },
      input: "",
      timeout: 30_000,
    });
    return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "", home };
  }

  it('refuses an EMPTY NUMISMA_DATA_DIR with EX_CONFIG, naming the variable and the hazard', () => {
    const run = runWrapperConfig({ NUMISMA_DATA_DIR: "" });

    expect(run.status, "a blank data dir must be a configuration refusal, not a run").toBe(
      EX_CONFIG,
    );
    expect(run.stderr).toMatch(/FATAL: NUMISMA_DATA_DIR is set to a blank value/);
    // The consequence, not just the rule — this is the sentence that tells the operator
    // why the job refused instead of quietly doing the wrong thing.
    expect(run.stderr).toMatch(/REAL default ledger/);
    expect(run.stderr).toMatch(/Unset NUMISMA_DATA_DIR/);
  });

  it('refuses a WHITESPACE-ONLY NUMISMA_DATA_DIR — the arm `${VAR:-}` could never catch', () => {
    // `:-` treats "   " as set-and-non-empty, so the old read passed it through as a
    // relative path. This is the case that proves the fix is a real predicate and not
    // just a swapped colon.
    const run = runWrapperConfig({ NUMISMA_DATA_DIR: "   " });

    expect(run.status).toBe(EX_CONFIG);
    expect(run.stderr).toMatch(/is set to a blank value \(got '   '\)/);
  });

  it("says plainly that NO heartbeat was written, and writes none", () => {
    // The wrapper's whole heartbeat design is "every failure leaves a breadcrumb", so a
    // failure that deliberately leaves none has to SAY so — otherwise the next reader
    // treats the silence as the bug rather than as the finding.
    const run = runWrapperConfig({ NUMISMA_DATA_DIR: "" });

    expect(run.stderr).toMatch(/No heartbeat was written/);
    // And it is not merely claimed. The refusal precedes both the wrapper's
    // `HEARTBEAT_FILE=` assignment and its `exec … tee` log redirect (named, not pinned
    // to line numbers, which drift), so nothing at all is on disk under the fake HOME:
    // no `Dev/accumulus`, no `Library/Logs`.
    expect(existsSync(join(run.home, "Dev"))).toBe(false);
    expect(existsSync(join(run.home, "Library"))).toBe(false);
  });

  it("an UNSET NUMISMA_DATA_DIR still takes the default — the refusal must not swallow unset", () => {
    // Driven only as far as the mark-timezone guard, which is a deliberate, named early
    // exit well before `cd "$REPO_DIR"` and any `pnpm`. Reaching it at all is the proof:
    // it lives hundreds of lines BELOW the data-dir block, so an unset var got past the
    // refusal and took the default. Exit 1 (the TZ guard) is specifically NOT 78.
    const run = runWrapperConfig({
      NUMISMA_MARK_TZ: "Not/AZone",
      NUMISMA_PRICEFEED_LOG_DIR: join(mkdtempSync(join(tmpdir(), "numisma-wrapper-logs-")), "logs"),
    });

    expect(run.status, "unset must not be refused as a misconfiguration").not.toBe(EX_CONFIG);
    expect(run.status).toBe(1);
    expect(run.stdout).toMatch(/mark timezone 'Not\/AZone' is not a resolvable IANA zone/);
  });
});
