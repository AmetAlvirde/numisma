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
 */
import picomatch from "picomatch";
import { defaultExclude, defaultInclude } from "vitest/config";
import { describe, expect, it } from "vitest";

import rootConfig from "../../vitest.config.ts";
import {
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
   */
  it("still excludes agent worktrees under .claude/ — the bug this closed", () => {
    expect(contributedGlobs.length).toBeGreaterThan(0);
    const buried = ".claude/worktrees/probe/apps/web/src/foo.test.ts";
    expect(matchesAny(contributedGlobs, buried)).toBe(true);
    // ...and the same path outside the ignored directory stays collectable.
    expect(matchesAny(contributedGlobs, "apps/web/src/foo.test.ts")).toBe(false);
  });

  it("reaches nested .gitignore files, anchored to their own directory", () => {
    // `apps/web/.gitignore` declares `.tanstack/` and `.vercel/`; the retired
    // root-only text parser never saw either.
    expect(contributedGlobs).toContain("apps/web/.tanstack/**");
    expect(contributedGlobs).toContain("apps/web/.vercel/**");
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
