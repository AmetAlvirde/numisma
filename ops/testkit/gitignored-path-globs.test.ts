/**
 * The guard on test DISCOVERY itself.
 *
 * Every other guard in this lane fails loudly when it is wrong. This one does not:
 * the globs in `gitignoredPathGlobs()` decide which test files vitest can SEE, so
 * an over-broad glob removes real tests from the suite and the shortened suite
 * still reports success. Nothing downstream notices.
 *
 * THE MATCHER IS PICOMATCH, DELIBERATELY. The guard this file replaces re-rolled
 * its own tiny matcher (`dirNameOfGlob`, a regex with a `[^*?[\]/]` character
 * class) and so shared the exact bug it was commissioned to catch: its class
 * omitted `{`, `}` and `\` just as the parser's did, and the brace hole was
 * invisible to it. A guard that re-implements the thing under test agrees with it
 * by construction, including when it is wrong. picomatch is what vitest actually
 * matches with (tinyglobby → picomatch), so it is the only honest oracle here.
 *
 * THE FILE LIST AND THE TEST PATTERN BOTH COME FROM THEIR REAL SOURCES. Files come
 * from git via `repoFiles()`; "is this a test file" comes from vitest's own
 * `defaultInclude`, run through picomatch. The retired guard hardcoded
 * `[".test.ts", ".test.tsx"]` and was therefore blind to `.spec.ts`, `.test.mts`
 * and `.test.js` — it could not have seen those being eaten.
 *
 * FIXTURES ARE AUTHORED, ALWAYS. Every entry string in the unit tests below is
 * written by hand in this file. No expectation is seeded from real `git ls-files`
 * output: a fixture copied from the thing under test agrees with it, wrongness
 * included.
 *
 * AND THE DERIVATION ITSELF IS TESTED AGAINST AN AUTHORED FIXTURE REPO, NOT THIS
 * ONE. A guard that asserts against LIVE repository state gives a different
 * verdict in every checkout. `gitignoredPathGlobs()` reports only ignored paths
 * that exist ON DISK, so `.claude/**`, `coverage/**` and `apps/web/.tanstack/**`
 * are present in the main checkout and absent in a fresh linked worktree — and
 * this file's first version duly failed two of its eight tests in every worktree,
 * which is where this board does nearly all of its work. Worse than the false
 * red: the nested-`.gitignore` assertion was not merely failing there, it was
 * UNEXERCISABLE, because `apps/web/.tanstack/` cannot exist in a fresh worktree.
 * The assertion that most needed running was the one that could never run where
 * the work happens. So the derivation's behaviour is now pinned against a
 * hand-built git repo in a temp directory, hermetic against the ambient
 * environment, and the live-repo layer is kept deliberately thin — only claims
 * that hold in BOTH the main checkout and a fresh worktree.
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import picomatch from "picomatch";
import { defaultExclude, defaultInclude } from "vitest/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import rootConfig from "../../vitest.config.ts";
import {
  gitignoredPathGlobs,
  globForIgnoredEntry,
  globsForIgnoredEntries,
} from "./gitignored-path-globs.ts";
import { REPO_ROOT, repoFiles } from "./repo-sources.testkit.js";

/** Whether `path` (repo-root-relative, POSIX) is matched by any of `globs`. */
function matchesAny(globs: readonly string[], path: string): boolean {
  return picomatch(globs as string[], { dot: true })(path);
}

/**
 * The globs this repo contributes on top of vitest's own defaults — i.e. exactly
 * what `gitignoredPathGlobs()` put into the root config.
 */
const contributedGlobs: string[] = (rootConfig.test?.exclude ?? []).filter(
  (glob) => !defaultExclude.includes(glob),
);

describe("test discovery", () => {
  /**
   * THE LOAD-BEARING ASSERTION. No test file git knows about may be excluded by a
   * glob this repo contributed. Over-exclusion is the failure that hides itself,
   * so this is the assertion the whole module exists to support.
   */
  it("eats no test file that git considers part of this branch", () => {
    const isTestFile = picomatch(defaultInclude as string[], { dot: true });
    const testFiles = repoFiles().filter((file) => isTestFile(file));
    // If this is empty the assertion below is vacuous, which would be a silent
    // hole of its own.
    expect(testFiles.length).toBeGreaterThan(0);
    const eaten = testFiles.filter((file) => matchesAny(contributedGlobs, file));
    expect(eaten).toEqual([]);
  });

  /**
   * THE MECHANISM-IS-NOT-A-NO-OP ASSERTION, and the honest replacement for the
   * discovery FLOOR this file used to carry. That floor counted test files from
   * `git ls-files`, which is completely independent of the exclude globs, so
   * `>= FLOOR` could not detect over-exclusion at all — it was credited with a
   * catch it cannot make. What actually needs pinning is the opposite direction:
   * `gitignoredPathGlobs()` returning `[]` would make every other assertion here
   * pass while the original bug came straight back.
   *
   * WHY NON-EMPTINESS IS THE STRONGEST CLAIM AVAILABLE HERE, AND WHY NO PATH IS
   * NAMED. An earlier version also asserted `toContain("node_modules/**")`, which
   * is the exact class this module retires: a claim about WHICH CHECKOUT the suite
   * is running in. A pnpm store-linked or symlinked `node_modules`, a CI cache
   * restored outside the tree, or a `--modules-dir` install emits no such entry,
   * and the guard goes red on completely correct code. `> 0` has none of that
   * fragility and is still not vacuous: running vitest at all requires an install,
   * an install puts at least one ignored directory somewhere on disk, and git
   * reports it — so this holds in the main checkout, in a fresh linked worktree,
   * and on a cold CI runner alike.
   *
   * BUT IT IS NOT THE SAME STRENGTH AS THE TRACKED-TEXT GUARD BELOW, and the
   * difference is worth being honest about. `.gitignore`'s bytes are identical in
   * every checkout of a commit, so reading them is environment-independent BY
   * CONSTRUCTION. `> 0` is an empirical claim about how installs behave — very
   * robust, not a tautology, and still the same KIND of claim as the
   * `node_modules/**` one just deleted, only far harder to falsify. It is kept
   * because the no-op direction genuinely needs a pin and nothing stronger is
   * available at this layer; if it ever goes red on correct code, delete it rather
   * than weaken it, because the fixture below is what actually guards the
   * behaviour. Everything about the derivation's BEHAVIOUR —
   * nested `.gitignore` files, anchoring, escaping, empty directories, and the
   * deliberate silence about ignored paths that are not on disk — is asserted
   * against the authored fixture repo below, where it holds on every machine.
   */
  it("contributes real globs in any checkout", () => {
    expect(contributedGlobs.length).toBeGreaterThan(0);
  });

  /**
   * THE ONE GUARD LEFT ON THE REAL REPO'S OWN IGNORE RULES, and it is not a
   * relapse into the live-state class the rest of this file retires. `.gitignore`
   * is a TRACKED file: at a given commit its bytes are identical in the main
   * checkout, in every linked worktree, and on every CI runner. Reading its TEXT
   * is therefore environment-independent by construction — unlike asking git what
   * it currently ignores ON DISK, which is a fact about one working tree.
   *
   * WHAT BREAKS IF THIS LINE GOES AWAY. #362: agent worktrees live under
   * `.claude/worktrees/`, so without `.claude/` in the root `.gitignore` every
   * worktree's copy of the tree is collected a second time — the same test files
   * discovered twice, from two paths. Moving the `.claude/` assertion into the
   * fixture repo (where it belongs, because that is where it is exercisable in
   * every checkout) proved the DERIVATION handles the rule, but left nothing at
   * all watching whether this repo still declares it. Delete the line and the
   * fixture stays green, the whole suite stays green, and #362 is simply back —
   * green while running the wrong set of tests, which is the fail-toward-green
   * mode this entire module exists to prevent.
   */
  it("still declares .claude/ in the repo's own tracked .gitignore", () => {
    // Tracked, not merely present: if `.gitignore` ever stopped being a file git
    // knows about, reading it off disk would be reading an untracked local file
    // and the claim would quietly become checkout-specific again.
    expect(repoFiles()).toContain(".gitignore");
    const lines = readFileSync(join(REPO_ROOT, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim());
    expect(lines).toContain(".claude/");
  });
});

/**
 * The derivation, run against a git repo authored BY HAND in a temp directory.
 *
 * The layout below is the whole point of this file: every behaviour asserted here
 * is a behaviour that either could not be exercised at all against the live repo
 * (the nested `.gitignore`, in a worktree) or was exercised only by accident of
 * what happened to be sitting on disk.
 *
 * HERMETIC ON PURPOSE, ON TWO AXES. `--exclude-standard` reads `.git/info/exclude`
 * and the user's GLOBAL `core.excludesFile` as well as the repo's `.gitignore`
 * files, so a fixture that did not neutralise them would assert something
 * different on a machine whose owner globally ignores, say, `coverage/`. That is
 * the CONFIG axis: the repo-local `core.excludesFile` override points at an empty
 * file inside `.git/`, and `.git/info/exclude` is truncated.
 *
 * The second axis is the ENVIRONMENT, and it is the dangerous one. Every git
 * process here — the fixture's own `git()` helper and the `gitignoredPathGlobs()`
 * call under test — would otherwise inherit `process.env`. `GIT_DIR`,
 * `GIT_WORK_TREE` and `GIT_INDEX_FILE` outrank both `-C` and `cwd`, so under
 * `git bisect run pnpm test`, or inside a hook, or in any wrapper that exports
 * them, this fixture's `git add -A` would stage the developer's REAL working tree.
 * `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` sit ABOVE repo-local
 * config in git's precedence order, so they beat the `core.excludesFile` override
 * the config axis relies on, and `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM` can point
 * git's config lookup anywhere. So both git surfaces run under `hermeticGitEnv()`,
 * an ALLOWLIST rather than a denylist of variables to drop — see the note there.
 *
 * No commit is made — `--others --ignored` reads the working tree — but the
 * non-ignored files ARE staged, for the reason recorded at the `git add -A` below.
 */
/**
 * The variables a git subprocess in this file is allowed to see, and NOTHING else.
 *
 * AN ALLOWLIST, DELIBERATELY — the same argument the module under test makes about
 * escaping instead of detecting. A denylist of hostile variables (`GIT_DIR`,
 * `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_CONFIG_*`, …) would be correct only for
 * as long as the list is complete, and git's environment surface is large and
 * growing: `GIT_COMMON_DIR`, `GIT_OBJECT_DIRECTORY`, `GIT_NAMESPACE`,
 * `GIT_CEILING_DIRECTORIES`, `GIT_ATTR_NOSYSTEM` and more all steer discovery or
 * config. Naming what may pass THROUGH closes the whole class at once, including
 * variables git has not shipped yet, and its failure mode is a loud broken
 * subprocess rather than a quietly redirected one.
 *
 * `HOME` is pointed inside the fixture and `GIT_CONFIG_GLOBAL`/`GIT_CONFIG_SYSTEM`
 * at `/dev/null`, which is belt AND braces with the repo-local `core.excludesFile`
 * override: the override alone is enough, but only while nothing above it in the
 * precedence order is set, and this env is exactly what guarantees that.
 */
const GIT_ENV_PASSTHROUGH = [
  "PATH",
  // Windows needs these three to spawn a process at all; absent elsewhere.
  "SystemRoot",
  "SYSTEMROOT",
  "COMSPEC",
] as const;

function hermeticGitEnv(home: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_SYSTEM: "/dev/null",
  };
  for (const name of GIT_ENV_PASSTHROUGH) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}

describe("gitignoredPathGlobs against an authored fixture repo", () => {
  let fixtureRoot: string;
  let fixtureEnv: NodeJS.ProcessEnv;
  let globs: string[];

  /** Write one fixture file, creating its parent directories. */
  function write(relative: string, contents: string): void {
    const target = join(fixtureRoot, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }

  /** Run one git command inside the fixture, output discarded. */
  function git(...args: string[]): void {
    execFileSync("git", ["-C", fixtureRoot, ...args], {
      stdio: "ignore",
      env: fixtureEnv,
    });
  }

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "gitignored-path-globs-"));
    const home = join(fixtureRoot, ".git-home");
    mkdirSync(home, { recursive: true });
    fixtureEnv = hermeticGitEnv(home);
    git("init");
    // Neutralise the ambient CONFIG: an empty global excludes file, and an empty
    // per-repo exclude. Both live inside `.git/`, so neither is itself a path
    // `ls-files` can report. (The ambient ENVIRONMENT is neutralised by
    // `fixtureEnv` above, which every git process here runs under.)
    writeFileSync(join(fixtureRoot, ".git", "empty-excludes"), "", "utf8");
    git("config", "core.excludesFile", join(fixtureRoot, ".git", "empty-excludes"));
    // `init.templateDir` can produce a `.git/` with no `info/` directory at all,
    // in which case writing straight to `info/exclude` dies ENOENT and errors
    // every test in this describe.
    const excludeFile = join(fixtureRoot, ".git", "info", "exclude");
    mkdirSync(dirname(excludeFile), { recursive: true });
    writeFileSync(excludeFile, "", "utf8");

    // ---- The authored layout. ------------------------------------------
    // Root ignores: two directories that exist and are wholly ignored, one that
    // exists but is EMPTY, one literal braced name, and one that is NOT on disk.
    write(".gitignore", ".claude/\nnode_modules/\ncoverage/\nsecrets/\n{tmp,scratch}/\n");
    write(".claude/worktrees/probe/apps/web/src/foo.test.ts", "// ignored\n");
    write("node_modules/left-pad/index.js", "// ignored\n");
    write("{tmp,scratch}/note.test.ts", "// ignored, literally braced\n");
    mkdirSync(join(fixtureRoot, "coverage"), { recursive: true });
    // `secrets/` is deliberately never created.

    // A NESTED `.gitignore`, the case a root-only reader cannot see: `.tanstack/`
    // exists on disk, `.vercel/` does not.
    write("pkg/web/.gitignore", ".tanstack/\n.vercel/\n");
    write("pkg/web/.tanstack/cache.json", "{}\n");

    // Untracked-but-not-ignored files, including a test file, all of which must
    // survive every glob produced.
    write("pkg/web/src/app.ts", "export const a = 1;\n");
    write("pkg/web/src/app.test.ts", "// collectable\n");
    write("README.md", "# fixture\n");

    // STAGE THE NON-IGNORED FILES. No commit is needed, but the index cannot be
    // left empty: `--directory` collapses a directory that git knows NOTHING
    // about into a single untracked entry and does not descend into it, so with
    // an empty index the nested `pkg/web/.gitignore` would never be reached and
    // the fixture would quietly under-report. `git add -A` honours `.gitignore`,
    // so everything ignored above stays unstaged and therefore still "other".
    git("add", "-A");

    // The env matters just as much HERE as in `git()`: `gitignoredPathGlobs`
    // spawns its own git, and without the seam that process would inherit an
    // ambient `GIT_DIR` and answer about a different repository entirely while
    // looking perfectly healthy.
    globs = gitignoredPathGlobs(fixtureRoot, { env: fixtureEnv });
  });

  afterAll(() => {
    // `mkdtempSync` can throw, leaving `fixtureRoot` undefined; `rmSync` would
    // then throw ERR_INVALID_ARG_TYPE from the cleanup and bury the real cause.
    if (fixtureRoot !== undefined) {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("derives exactly one anchored glob per ignored path that is on disk", () => {
    expect([...globs].sort()).toEqual(
      [
        ".claude/**",
        "node_modules/**",
        "pkg/web/.tanstack/**",
        "\\{tmp,scratch\\}/**",
      ].sort(),
    );
  });

  /**
   * THE CENTRE OF THIS FIX. `pkg/web/.gitignore` declares `.tanstack/`, and the
   * glob must be anchored to that directory — `pkg/web/.tanstack/**`, never the
   * unanchored `**​/.tanstack/**` a text parser would guess at. This is the
   * assertion that could not run at all in a linked worktree.
   */
  it("reaches nested .gitignore files, anchored to their own directory", () => {
    expect(globs).toContain("pkg/web/.tanstack/**");
    expect(globs).not.toContain("**/.tanstack/**");
    expect(matchesAny(globs, "pkg/web/.tanstack/cache.json")).toBe(true);
    // An identically named directory elsewhere is NOT ignored here, and the
    // anchored glob must leave it collectable.
    expect(matchesAny(globs, "pkg/api/.tanstack/x.test.ts")).toBe(false);
  });

  /** The bug this module closed, now exercisable in every checkout. */
  it("still excludes agent worktrees under .claude/", () => {
    expect(globs).toContain(".claude/**");
    const buried = ".claude/worktrees/probe/apps/web/src/foo.test.ts";
    expect(matchesAny(globs, buried)).toBe(true);
    // ...and the same path outside the ignored directory stays collectable.
    expect(matchesAny(globs, "apps/web/src/foo.test.ts")).toBe(false);
  });

  /**
   * INTENT, NOT AN OVERSIGHT. An ignore rule for a directory that does not exist
   * on disk contributes NOTHING, because there is nothing there to exclude. This
   * is the behaviour that produced the false red in every worktree — `.claude/`
   * and `apps/web/.tanstack/` simply are not there yet — and it is CORRECT: the
   * exclude form is safe precisely because it never guesses about paths git has
   * not seen. Pinned here so nobody "fixes" it by parsing `.gitignore` text again.
   */
  it("contributes nothing for an ignored directory that is not on disk", () => {
    expect(globs.some((glob) => glob.startsWith("secrets"))).toBe(false);
    expect(globs).not.toContain("pkg/web/.vercel/**");
    expect(matchesAny(globs, "secrets/a.test.ts")).toBe(false);
    expect(matchesAny(globs, "pkg/web/.vercel/a.test.ts")).toBe(false);
  });

  /** `--no-empty-directory`: an ignored directory with nothing in it is not listed. */
  it("contributes nothing for an ignored directory that is empty", () => {
    expect(globs).not.toContain("coverage/**");
    expect(globs.some((glob) => glob.startsWith("coverage"))).toBe(false);
  });

  /**
   * The brace hole, pinned end to end through a REAL git round-trip rather than
   * against a hand-written entry string. `{tmp,scratch}` is one literal directory
   * to git and two to picomatch; the escaping has to survive the whole path from
   * `.gitignore` to matcher, not just the pure function.
   */
  it("escapes a literal braced directory so it does not brace-expand", () => {
    expect(globs).toContain("\\{tmp,scratch\\}/**");
    expect(matchesAny(globs, "{tmp,scratch}/note.test.ts")).toBe(true);
    expect(matchesAny(globs, "tmp/note.test.ts")).toBe(false);
    expect(matchesAny(globs, "scratch/note.test.ts")).toBe(false);
  });

  /**
   * THE PRECONDITION ON `root`, MADE LOUD. `git ls-files` descends only from its
   * cwd and reports relative paths, so a `root` one level down does not fail — it
   * returns `.tanstack/**` where discovery needed `pkg/web/.tanstack/**`, a glob
   * that reads correctly and excludes nothing. Prose alone would leave that
   * silent, and silent-and-plausible is the exact failure this module exists to
   * close, so the seam refuses instead.
   */
  it("refuses a root that is not the repository toplevel", () => {
    expect(() =>
      gitignoredPathGlobs(join(fixtureRoot, "pkg", "web"), { env: fixtureEnv }),
    ).toThrow(/not a repository toplevel/);
  });

  /** Over-exclusion, the failure that hides itself, on an authored file list. */
  it("eats none of the fixture's non-ignored files", () => {
    const collectable = [
      "pkg/web/src/app.ts",
      "pkg/web/src/app.test.ts",
      "pkg/web/.gitignore",
      "README.md",
      ".gitignore",
    ];
    expect(collectable.filter((file) => matchesAny(globs, file))).toEqual([]);
  });
});

describe("globsForIgnoredEntries", () => {
  it("turns directory entries into subtree globs and passes files through", () => {
    expect(
      globsForIgnoredEntries([
        "coverage/",
        "apps/web/.tanstack/",
        "apps/web/.env",
      ]),
    ).toEqual(["coverage/**", "apps/web/.tanstack/**", "apps/web/.env"]);
  });

  it("emits nothing for an empty listing", () => {
    expect(globsForIgnoredEntries([])).toEqual([]);
  });

  // ---- The escaping fixtures: the direct pin on the brace hole. ------------
  // Git has no brace expansion, so `{tmp,scratch}/` is ONE literal directory
  // name. picomatch does, so an unescaped glob would delete every test under any
  // `tmp/` or `scratch/` in the tree — the exact bug the retired parser's
  // metacharacter denylist let through.

  it("escapes braces so a literal braced directory does not brace-expand", () => {
    const glob = globForIgnoredEntry("{tmp,scratch}/");
    expect(glob).toBe("\\{tmp,scratch\\}/**");
    expect(matchesAny([glob], "{tmp,scratch}/a.test.ts")).toBe(true);
    expect(matchesAny([glob], "tmp/a.test.ts")).toBe(false);
    expect(matchesAny([glob], "scratch/a.test.ts")).toBe(false);
  });

  it("escapes the rest of picomatch's metacharacters too", () => {
    expect(globForIgnoredEntry("weird\\dir/")).toBe("weird\\\\dir/**");
    expect(globForIgnoredEntry("a[bc]/")).toBe("a\\[bc\\]/**");
    expect(globForIgnoredEntry("star*dir/")).toBe("star\\*dir/**");
    expect(globForIgnoredEntry("q?dir/")).toBe("q\\?dir/**");
    expect(globForIgnoredEntry("!bang/")).toBe("\\!bang/**");
    expect(globForIgnoredEntry("(paren)/")).toBe("\\(paren\\)/**");
    expect(globForIgnoredEntry("plus+at@/")).toBe("plus\\+at\\@/**");
  });

  it("keeps a character class from matching its expansion", () => {
    const glob = globForIgnoredEntry("a[bc]/");
    expect(matchesAny([glob], "a[bc]/x.test.ts")).toBe(true);
    expect(matchesAny([glob], "ab/x.test.ts")).toBe(false);
    expect(matchesAny([glob], "ac/x.test.ts")).toBe(false);
  });
});
