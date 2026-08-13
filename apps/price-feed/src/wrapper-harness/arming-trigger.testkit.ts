/**
 * S7 · THE ARMING TRIGGER — the runner boundary of the wrapper harness (PRD #314 §7).
 *
 * It owns one decision — *should the wrapper suite run at all?* — and, when the answer
 * is no, it owns saying so out loud.
 *
 * IT IS A MODULE AND NOT AN `if`, because the decision has to be a PURE function of
 * `(changedPaths, base, pathSet, platform, override)`. A trigger embedded in the runner
 * cannot be proven to fire, and an unfireable trigger is the exact failure the harness
 * exists to eliminate, relocated one level up: a typo'd glob (`ops/price-feeed/**`)
 * matches nothing, the suite skips forever, every PR is green, and the skip line reads
 * perfectly normal. Nothing else in the harness can detect that — which is why
 * {@link decideArming} is unit-tested against authored inputs, why {@link TRIGGER_PATH_SET}
 * is fed the REAL wrapper path in a separate assertion, and why every glob in the set is
 * checked for liveness. All three of those live in the ALWAYS-RUNNING part of the suite,
 * so they survive the very skip they guard against.
 *
 * TWO DIRECTIONS, DELIBERATELY OPPOSITE:
 *
 *   - **The trigger fails toward RUNNING.** An unresolvable base — detached HEAD, a
 *     shallow clone, no `origin/main`, git unavailable — arms the suite and says why.
 *     Failing closed here would buy silence, which is the one thing §7 exists to prevent.
 *   - **The isolation contract (S2) fails toward REFUSING.** See `isolation.testkit.ts`.
 *
 * The asymmetry is the point: failing open there means writing to the real durable log,
 * failing open here costs one slow test run.
 *
 * GATE ORDER IS LOAD-BEARING: PLATFORM FIRST, TRIGGER SECOND. CI is a single
 * `ubuntu-latest` job whose `actions/checkout` sets no `fetch-depth`, so CI clones
 * shallow and has no `origin/main` to merge-base against. Evaluate the trigger first and
 * every CI run fails open into a suite that cannot work on Linux at all — turning the
 * fail-open rule into a guaranteed red. The platform gate evaluating first makes that
 * unreachable, and a test asserts the ordering directly rather than trusting the reading.
 */

import { execFileSync } from "node:child_process";

/** The one platform this suite can run on. See the darwin caveat in the suite header. */
export const HARNESS_PLATFORM = "darwin";

/**
 * WHAT THE HARNESS CAN FALSIFY — not everything topically related (§7.3).
 *
 * - `ops/price-feed/**` — the subject. The wrapper, the launchd plist template (the
 *   oracle for the watchdog ceiling and the source of the `/bin/bash` invocation the
 *   launcher mirrors) and the reinstall runbook.
 * - the harness's own directory — a change to the harness must run the harness. The
 *   easiest entry to omit, and omitting it means you can break the suite and sail past
 *   on a green PR.
 * - `packages/event-store/src/heartbeat.ts` — the ORACLE assertion 2 parses against. The
 *   heartbeat has a bash writer and a TypeScript reader with nothing else joining them at
 *   runtime, so if the reader's accepted schema versions or ISO-instant validation move,
 *   the wrapper's `printf` can start producing a file the reader condemns and this suite
 *   is the only thing positioned to notice.
 *
 * DELIBERATELY OUT OF SET: the four commands the wrapper shells out to
 * (`apps/price-feed/src/cli.ts`, `apps/tui/src/spine.ts`,
 * `apps/web/src/push/{gap-report,backfill}.ts`), because the harness fakes all four by
 * construction and so cannot change its verdict when they change; and
 * `apps/price-feed/src/schedule-window.test.ts`, which asserts the wrapper's TEXT, has no
 * bearing on its RUNTIME, and already runs unconditionally on every `pnpm test`.
 */
export const TRIGGER_PATH_SET: readonly string[] = [
  "ops/price-feed/**",
  "apps/price-feed/src/wrapper-harness/**",
  "packages/event-store/src/heartbeat.ts",
];

/** `NUMISMA_WRAPPER_TEST`. `auto` lets the trigger decide; the other two overrule it. */
export type WrapperTestOverride = "auto" | "always" | "never";

/**
 * The comparison point for "has the subject changed?", or the reason there isn't one.
 * Unresolved is not an error — it is an input, and it arms the suite.
 */
export type BaseResolution =
  | { readonly kind: "resolved"; readonly sha: string }
  | { readonly kind: "unresolved"; readonly why: string };

export interface ArmingInput {
  readonly changedPaths: readonly string[];
  readonly base: BaseResolution;
  readonly pathSet: readonly string[];
  readonly platform: string;
  readonly override: WrapperTestOverride;
}

export interface ArmingDecision {
  readonly run: boolean;
  /** Which gate decided. Lets a test assert the ORDER, not merely the outcome. */
  readonly gate: "platform" | "override" | "base" | "changes";
  /** The one line printed on every `pnpm test`, armed or not. Never empty. */
  readonly reason: string;
  /** The in-set paths that armed it, for the report line. */
  readonly matched: readonly string[];
}

/**
 * Does one changed path fall in the set? Two forms only, both exact about what they mean:
 * a trailing `/**` matches everything beneath that directory, anything else is an exact
 * file path. Nothing fuzzy — a fuzzy matcher would make the typo'd-glob failure this
 * module is built around HARDER to detect, not easier.
 */
export function matchesPathSet(path: string, pathSet: readonly string[]): boolean {
  return pathSet.some((glob) => {
    if (glob.endsWith("/**")) {
      return path.startsWith(`${glob.slice(0, -2)}`);
    }
    return path === glob;
  });
}

/**
 * The pure decision. **An empty path set is a hard error, not a skip** — an empty set is
 * definitionally a trigger that can never fire, which is precisely the silent failure
 * this module is built to make impossible. Refusing loudly is the only honest answer.
 */
export function decideArming(input: ArmingInput): ArmingDecision {
  if (input.pathSet.length === 0) {
    throw new Error(
      "wrapper harness: the trigger path set is EMPTY — a trigger that can never fire is " +
        "indistinguishable from a healthy skip, so this is a hard error rather than a skip.",
    );
  }

  // PLATFORM FIRST. Before the override and before the base, unconditionally: this suite
  // targets macOS bash 3.2, BSD ps/pgrep and a watchdog hand-rolled because macOS ships
  // no timeout(1). Nothing downstream can make it work elsewhere, so nothing downstream
  // gets a vote. `pnpm test:wrapper` and `NUMISMA_WRAPPER_TEST=always` bypass the
  // trigger; neither bypasses this.
  if (input.platform !== HARNESS_PLATFORM) {
    return {
      run: false,
      gate: "platform",
      reason: `harness skipped: platform is ${input.platform}, this suite is darwin-only`,
      matched: [],
    };
  }

  if (input.override === "never") {
    return {
      run: false,
      gate: "override",
      // A mute button on this channel must announce itself.
      reason: "harness skipped: NUMISMA_WRAPPER_TEST=never (explicitly disabled)",
      matched: [],
    };
  }

  if (input.override === "always") {
    return {
      run: true,
      gate: "override",
      reason: "harness armed: NUMISMA_WRAPPER_TEST=always (trigger bypassed, platform gate not)",
      matched: [],
    };
  }

  if (input.base.kind === "unresolved") {
    // FAIL TOWARD RUNNING, and say why. A slow test run is the whole cost; silence is not.
    return {
      run: true,
      gate: "base",
      reason: `harness armed: base could not be resolved (${input.base.why}) — failing toward running`,
      matched: [],
    };
  }

  const matched = input.changedPaths.filter((path) => matchesPathSet(path, input.pathSet));
  if (matched.length === 0) {
    return {
      run: false,
      gate: "changes",
      // The base SHA and the path set are both in the message on purpose: a skip that
      // does not say what it compared against cannot be distinguished from a broken glob.
      reason: `harness skipped: no changes under ${input.pathSet.join(", ")} since ${input.base.sha}`,
      matched: [],
    };
  }
  return {
    run: true,
    gate: "changes",
    reason:
      `harness armed: ${matched.length} changed path(s) under ${input.pathSet.join(", ")} ` +
      `since ${input.base.sha} (e.g. ${matched[0]})`,
    matched,
  };
}

/** Reads `NUMISMA_WRAPPER_TEST`, refusing a value it does not recognise rather than guessing. */
export function readOverride(raw: string | undefined): WrapperTestOverride {
  if (raw === undefined || raw === "" || raw === "auto") {
    return "auto";
  }
  if (raw === "always" || raw === "never") {
    return raw;
  }
  throw new Error(
    `wrapper harness: NUMISMA_WRAPPER_TEST=${raw} is not one of auto | always | never. ` +
      "Refused rather than defaulted: silently reading an unknown value as `auto` would " +
      "make a typo'd `nver` look like a working mute button.",
  );
}

function git(repoRoot: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Parse `git status --porcelain` into paths. Renames report `R  old -> new`; the NEW path
 * is the one that exists to be tested.
 */
export function parsePorcelain(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => {
      const body = line.slice(3);
      const arrow = body.indexOf(" -> ");
      const path = arrow === -1 ? body : body.slice(arrow + 4);
      return path.replace(/^"|"$/g, "");
    });
}

/**
 * The impure half: ask git what changed and against what.
 *
 * BASE = `git merge-base HEAD origin/main`, so a branch that edited the wrapper three
 * commits back still arms — the range is `base...HEAD`, never `HEAD~1`. On the default
 * branch itself that merge-base degenerates to HEAD, and there the base is `HEAD~1`.
 *
 * CHANGED SET = that diff UNIONED with `git status --porcelain`, because a wrapper edit
 * that has not been committed yet is exactly when you most want the suite.
 *
 * `--untracked-files=all`, NOT THE DEFAULT. Plain porcelain collapses an untracked
 * directory to `?? ops/`, which matches nothing in a path set made of file paths — so a
 * brand-new wrapper, or a whole new harness directory, would not arm the suite it is the
 * whole reason to arm.
 *
 * Every failure path returns an UNRESOLVED base rather than throwing: unresolved arms.
 */
export function resolveTriggerFacts(repoRoot: string): {
  base: BaseResolution;
  changedPaths: string[];
} {
  const dirty: string[] = [];
  try {
    dirty.push(...parsePorcelain(git(repoRoot, ["status", "--porcelain", "--untracked-files=all"])));
  } catch {
    return { base: { kind: "unresolved", why: "git is unavailable or this is not a repo" }, changedPaths: [] };
  }

  let base: BaseResolution;
  try {
    if (git(repoRoot, ["rev-parse", "--is-shallow-repository"]) === "true") {
      // A shallow clone can resolve a merge-base that is wrong for this purpose, which is
      // worse than resolving none. This is the configuration CI actually presents.
      return { base: { kind: "unresolved", why: "shallow clone" }, changedPaths: dirty };
    }
    const head = git(repoRoot, ["rev-parse", "HEAD"]);
    git(repoRoot, ["rev-parse", "--verify", "refs/remotes/origin/main"]);
    const mergeBase = git(repoRoot, ["merge-base", "HEAD", "refs/remotes/origin/main"]);
    base = {
      kind: "resolved",
      sha: mergeBase === head ? git(repoRoot, ["rev-parse", "HEAD~1"]) : mergeBase,
    };
  } catch {
    return {
      base: { kind: "unresolved", why: "no origin/main, no parent commit, or a detached/empty HEAD" },
      changedPaths: dirty,
    };
  }

  let committed: string[] = [];
  try {
    committed = git(repoRoot, ["diff", "--name-only", `${base.sha}...HEAD`])
      .split("\n")
      .filter((line) => line.length > 0);
  } catch {
    return { base: { kind: "unresolved", why: "the base...HEAD range could not be diffed" }, changedPaths: dirty };
  }

  return { base, changedPaths: [...new Set([...committed, ...dirty])] };
}
