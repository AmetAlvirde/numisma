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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { repoFiles } from "./repo-sources.testkit.js";

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
   * WHY THIS LAYER IS ONLY TWO ASSERTIONS WIDE. Anything more specific about the
   * live repo is a claim about WHICH CHECKOUT the suite is running in.
   * `node_modules/` is the one ignored directory that exists in the main checkout
   * and in every linked worktree alike, so it is the only named path this layer
   * may mention. Everything about the derivation's behaviour — nested
   * `.gitignore` files, anchoring, escaping, empty directories, and the
   * deliberate silence about ignored paths that are not on disk — is asserted
   * against the authored fixture repo below, where it holds on every machine.
   */
  it("contributes real globs in any checkout", () => {
    expect(contributedGlobs.length).toBeGreaterThan(0);
    expect(contributedGlobs).toContain("node_modules/**");
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
 * HERMETIC ON PURPOSE. `--exclude-standard` reads `.git/info/exclude` and the
 * user's GLOBAL `core.excludesFile` as well as the repo's `.gitignore` files, so
 * a fixture that did not neutralise both would assert something different on a
 * machine whose owner globally ignores, say, `coverage/`. The repo-local
 * `core.excludesFile` override points at an empty file inside `.git/`, and
 * `.git/info/exclude` is truncated. No commit is made — `--others --ignored`
 * reads the working tree — but the non-ignored files ARE staged, for the reason
 * recorded at the `git add -A` below.
 */
describe("gitignoredPathGlobs against an authored fixture repo", () => {
  let fixtureRoot: string;
  let globs: string[];

  /** Write one fixture file, creating its parent directories. */
  function write(relative: string, contents: string): void {
    const target = join(fixtureRoot, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }

  /** Run one git command inside the fixture, output discarded. */
  function git(...args: string[]): void {
    execFileSync("git", ["-C", fixtureRoot, ...args], { stdio: "ignore" });
  }

  beforeAll(() => {
    fixtureRoot = mkdtempSync(join(tmpdir(), "gitignored-path-globs-"));
    git("init");
    // Neutralise the ambient environment: an empty global excludes file, and an
    // empty per-repo exclude. Both live inside `.git/`, so neither is itself a
    // path `ls-files` can report.
    writeFileSync(join(fixtureRoot, ".git", "empty-excludes"), "", "utf8");
    git("config", "core.excludesFile", join(fixtureRoot, ".git", "empty-excludes"));
    writeFileSync(join(fixtureRoot, ".git", "info", "exclude"), "", "utf8");

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

    globs = gitignoredPathGlobs(fixtureRoot);
  });

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true });
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
