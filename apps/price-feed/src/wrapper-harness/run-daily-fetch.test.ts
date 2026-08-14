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

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { JobHeartbeat } from "@numisma/event-store";
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
 * How long case 4 will wait for the run to actually be INSIDE the fetch step before it
 * signals. Bounded well under the timeout cases' 3s ceiling on purpose: the whole claim of
 * case 4 is that its signal arrives before the watchdog's, so a wait that could run into the
 * ceiling would be a wait that could silently turn case 4 into a second copy of case 2.
 */
const REACH_STEP_BOUND_MS = 2_000;

/**
 * Block until the fake has recorded `command`, so a signal aimed at a step lands while the
 * run is genuinely IN that step rather than somewhere earlier by luck — the step name in the
 * heartbeat is half of what case 4 asserts, and `LAST_STEP` is set just before the call the
 * sentinel proves happened.
 *
 * FAIL-CLOSED AND BOUNDED. A sentinel that never arrives means the run never reached the
 * step this signal is aimed at, which is a failure of the case; waiting for it with
 * unbounded patience would be indistinguishable from a run that hung before it got there.
 */
async function waitForFakeToReach(
  caseDir: string,
  command: string,
  label: string,
): Promise<number> {
  const sentinel = join(caseDir, "sentinels", sentinelNameFor(command));
  const startedAt = Date.now();
  while (!existsSync(sentinel)) {
    if (Date.now() - startedAt >= REACH_STEP_BOUND_MS) {
      throw new Error(
        `${label}: the fake never recorded \`${command}\` within ${REACH_STEP_BOUND_MS}ms — ` +
          "the run never reached the step this signal is aimed at",
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
      // Recorded, not merely passed: a regression from 0.1s to 1.9s is inside the window
      // and would otherwise be invisible.
      console.log(`[wrapper harness] case 1 settle ms: ${settles.join(", ")}`);
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
      console.log(
        `[wrapper harness] case 7 survived (ms, ceiling+grace=${ceilingAndGraceMs}): ${survivals.join(", ")}`,
      );
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
      console.log(
        `[wrapper harness] case 2 settle ms (bound ${timeoutSettleDeadlineMs(TIMEOUT_CASE_OPTIONS)}): ` +
          settles.join(", "),
      );
    },
    600_000,
  );

  it(
    `case 3 — watchdog timeout with a TERM-DEAF grandchild, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      const settles: number[] = [];
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
      console.log(
        `[wrapper harness] case 3 settle ms (bound ${timeoutSettleDeadlineMs(TIMEOUT_CASE_OPTIONS)}): ` +
          settles.join(", "),
      );
    },
    600_000,
  );

  it(
    `case 5 — an early non-zero exit, ${RUNS_PER_CASE} consecutive times`,
    async () => {
      const settles: number[] = [];
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
        // AND THE SETTLE WINDOW STAYS THE SHORT ONE. This is not a timeout path, so the
        // watchdog was cancelled — subshell and forked `sleep` both — before the shell left.
        // Giving this case the grace-derived bound would let a watchdog left sleeping out
        // its full ceiling over an already-dead run pass unnoticed, which is precisely the
        // held-job-slot failure the wrapper's own cancellation exists to prevent.

        assertTriple(record, dirs.caseDir, {
          exitCode: 127,
          lastStep: "prices-fetch",
          pnpmReached: ["prices:fetch"],
          mark: CASE_OPTIONS.mark,
          label,
        });
        settles.push(record.settleMs);
      }
      console.log(`[wrapper harness] case 5 settle ms: ${settles.join(", ")}`);
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
   * first — four fake `pnpm` invocations, a `git add`/`git commit` against the case's own
   * repo, and a `git status` post-check — and only then wedge. A healthy run does that in
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
   * This one succeeds through `spine`, `commit`, `post-check` and `gap-report` and wedges
   * at `backfill` — the derived, networked step — so the marks ARE in the log and an
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

        // THE HANG CAME FROM THE DISPATCH, and it is proven rather than assumed. Three
        // `succeeds` and one `hangs`, selected by the fake on its FIRST ARGUMENT — which
        // is the capability a single-behavior fake does not have and the reason this case
        // is expressible at all.
        for (const command of ["prices:fetch", "spine", "gap-report"]) {
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
      console.log(`[wrapper harness] case 6 in-window settle ms: ${settles.join(", ")}`);
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
      console.log(`[wrapper harness] case 6 out-of-window settle ms: ${settles.join(", ")}`);
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
            reaches.push(await waitForFakeToReach(dirs.caseDir, "prices:fetch", label));
            // BEFORE THE CEILING, ASSERTED RATHER THAN ASSUMED. If the watchdog got there
            // first this is case 2 wearing case 4's name — a run that would still exit 124
            // and still pass an exit-code-only test of "something stopped it".
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
        expect(
          record.durationMs,
          `${label}: the run outlived its own ${ceilingMs}ms ceiling, so the ending it recorded ` +
            "may be the watchdog's rather than the harness's",
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
      console.log(
        `[wrapper harness] case 4 reached the step in (ms): ${reaches.join(", ")} · ran for (ms, ` +
          `ceiling ${ceilingMs}): ${durations.join(", ")} · settle ms: ${settles.join(", ")}`,
      );
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

    console.log(
      `[wrapper harness] the pair — ${timeout.label}: exit ${timeout.heartbeat.exitCode} at ` +
        `\`${timeout.heartbeat.lastStep}\`, card ${timeout.watchdogCard} · ${external.label}: ` +
        `exit ${external.heartbeat.exitCode} at \`${external.heartbeat.lastStep}\`, card ` +
        `${external.watchdogCard}`,
    );
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
        console.log(`[wrapper harness] tee-deafness mutation outcomes: ${outcomes.join(", ")}`);

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
