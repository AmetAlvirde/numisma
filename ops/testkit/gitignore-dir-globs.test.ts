/**
 * The guard on test DISCOVERY itself.
 *
 * Every other guard in this lane fails loudly when it is wrong. This one does not:
 * `gitignoredDirGlobs()` decides which test files vitest can see, so an over-broad
 * glob removes real tests from the suite and the shortened suite still reports
 * success. Nothing downstream notices. So the assertions here are weighted toward
 * the SKIP cases — proving the parser emits NOTHING for the ambiguous forms — and
 * the file closes with a floor on how many tests discovery may find.
 *
 * FIXTURES ARE AUTHORED, ALWAYS. Every input below is a gitignore string written
 * by hand in this file. The repo's real `.gitignore` is never read as a fixture and
 * no expectation is seeded from real output: a fixture copied from the thing under
 * test agrees with it by construction, including when it is wrong.
 */
import { defaultExclude } from "vitest/config";
import { describe, expect, it } from "vitest";

import rootConfig from "../../vitest.config.ts";
import { gitignoredDirGlobs } from "./gitignore-dir-globs.ts";
import { sourceFiles } from "./repo-sources.testkit.js";

describe("gitignoredDirGlobs", () => {
  it("turns trailing-slash directory entries into globs, in file order", () => {
    expect(gitignoredDirGlobs("node_modules/\ndist/\ncoverage/\n")).toEqual([
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
    ]);
  });

  it("ignores comments and blank lines", () => {
    const gitignore = [
      "# agent scratch space",
      "",
      ".claude/",
      "   ",
      "\t# indented comment",
      "  dist/  ",
      "",
    ].join("\n");
    expect(gitignoredDirGlobs(gitignore)).toEqual([
      "**/.claude/**",
      "**/dist/**",
    ]);
  });

  it("emits nothing at all for a file of only comments and blanks", () => {
    expect(gitignoredDirGlobs("# nothing here\n\n#  \n")).toEqual([]);
    expect(gitignoredDirGlobs("")).toEqual([]);
  });

  // ---- The skip cases. Each one asserts an ABSENCE. ------------------------
  // A wrong glob here deletes tests, so the parser must decline to guess rather
  // than translate a form whose meaning it does not actually know.

  it("skips bare entries with no trailing slash — they may name a file", () => {
    // `.vercel` is the repo's own live example: a bare entry that is a directory
    // here but is not required to be one, and `.env` right beside it is a file.
    // Guessing "directory" and excluding a whole subtree is the expensive wrong
    // answer; emitting nothing costs at most a few extra collected files.
    expect(gitignoredDirGlobs(".vercel\n.env\nbuild\n")).toEqual([]);
  });

  it("skips negations rather than mistranslating them", () => {
    // `!foo/` UN-ignores. Translating it as an exclusion inverts its meaning and
    // deletes exactly the tests the author was trying to keep.
    expect(gitignoredDirGlobs("!foo/\n!.claude/\n")).toEqual([]);
    // And a negation must not be rescued by a neighbour: the plain entry passes,
    // the negation does not.
    expect(gitignoredDirGlobs("dist/\n!keep/\n")).toEqual(["**/dist/**"]);
  });

  it("skips wildcard and character-class entries", () => {
    expect(gitignoredDirGlobs("*.log\nfoo*/\na[bc]/\n?tmp/\n**/gen/\n")).toEqual(
      [],
    );
  });

  it("skips anchored and nested paths", () => {
    // `/build/` is anchored to the repo root and `a/b/` is a specific nested
    // path; the emitted form matches a bare directory NAME anywhere in the tree,
    // which is a strictly broader claim than either entry makes. Broader is the
    // dangerous direction, so both are skipped.
    expect(gitignoredDirGlobs("/build/\na/b/\nsrc/generated/\n")).toEqual([]);
  });

  it("skips every ambiguous form even when they arrive together", () => {
    const gitignore = [
      "# a realistic mixed file",
      "node_modules/",
      "*.log",
      "!important/",
      "/build/",
      ".vercel",
      "a/b/",
      "coverage/",
    ].join("\n");
    // Only the two unambiguous directory names survive.
    expect(gitignoredDirGlobs(gitignore)).toEqual([
      "**/node_modules/**",
      "**/coverage/**",
    ]);
  });

  // ---- Teeth in the other direction: the bug this closed. ------------------

  it("produces a glob that excludes a test file inside a .claude agent worktree", () => {
    const globs = gitignoredDirGlobs(".claude/\n");
    const buried = ".claude/worktrees/probe/apps/web/src/foo.test.ts";
    expect(globs).toEqual(["**/.claude/**"]);
    expect(matchesAny(globs, buried)).toBe(true);
    // ...and it must not reach the same path outside the ignored directory.
    expect(matchesAny(globs, "apps/web/src/foo.test.ts")).toBe(false);
  });
});

/**
 * The DISCOVERY FLOOR.
 *
 * The unit tests above pin the parser against authored text. This suite pins the
 * consequence: that the globs the parser actually contributes to the root config,
 * from this checkout's real `.gitignore`, do not eat any test file that belongs to
 * the branch.
 *
 * WHY IT IS SHAPED THIS WAY. An exact count (`toBe(156)`) would red on every
 * legitimately-added test file, which trains people to bump the number without
 * reading it — a guard that is routinely edited to make it pass is not a guard. So
 * the assertion has two halves: an exact, non-brittle one (NO git-known test file
 * may be excluded — adding a test file cannot break that) and a floor
 * (`>= FLOOR`), which catches a shrink in the walker's own view of the repo.
 *
 * WHY NOT SHELL OUT TO `vitest list`. Running vitest from inside a vitest test
 * risks recursion and is slow. The two inputs that actually decide discovery are
 * the config's resolved `exclude` and the set of test files git knows about, and
 * both are readable directly.
 */
describe("test discovery floor", () => {
  /**
   * Raise this ONLY when the branch's real test count has grown well clear of it,
   * and never to make a red test green — a red here means discovery SHRANK, and
   * the question to answer is which files went missing and why.
   *
   * Set below the 156 measured on this branch with the probe worktree live, with
   * enough slack that deleting or merging a handful of test files in normal work
   * does not red the suite, and little enough that losing a directory's worth does.
   */
  const FLOOR = 140;

  const contributedGlobs = (rootConfig.test?.exclude ?? []).filter(
    (glob) => !defaultExclude.includes(glob),
  );
  const testFiles = sourceFiles({ extensions: [".test.ts", ".test.tsx"] });

  it("contributes only gitignore-derived directory globs on top of vitest's defaults", () => {
    // The matcher below understands exactly one shape. If the parser ever emits
    // something else, this reds rather than letting the next assertion silently
    // stop checking anything.
    expect(contributedGlobs.length).toBeGreaterThan(0);
    for (const glob of contributedGlobs) {
      expect(dirNameOfGlob(glob), `unrecognised exclude glob: ${glob}`).not.toBe(
        undefined,
      );
    }
  });

  it("excludes no test file that git considers part of this branch", () => {
    const eaten = testFiles.filter((file) => matchesAny(contributedGlobs, file));
    expect(eaten).toEqual([]);
  });

  it("still finds at least the floor's worth of test files", () => {
    expect(testFiles.length).toBeGreaterThanOrEqual(FLOOR);
  });
});

/**
 * The directory name inside a glob of the one shape this parser emits, or
 * `undefined` for any other shape.
 *
 * A hand-rolled matcher rather than a glob library because there is no glob
 * matcher resolvable at the repo root, and because narrowness is a feature here:
 * it refuses anything it does not recognise instead of quietly matching nothing.
 */
function dirNameOfGlob(glob: string): string | undefined {
  return /^\*\*\/(?<dir>[^*?[\]/]+)\/\*\*$/.exec(glob)?.groups?.dir;
}

/** Whether `path` (repo-root-relative, POSIX) falls under any of `globs`. */
function matchesAny(globs: readonly string[], path: string): boolean {
  const segments = path.split("/");
  return globs.some((glob) => {
    const dir = dirNameOfGlob(glob);
    if (dir === undefined) return false;
    // The glob matches when the directory name appears as a segment with at
    // least one segment after it — i.e. the path is INSIDE that directory.
    const at = segments.indexOf(dir);
    return at !== -1 && at < segments.length - 1;
  });
}
