/**
 * `.gitignore` text to vitest `exclude` globs — the pure half of the repo's
 * gitignore-derived test DISCOVERY (see `vitest.config.ts`, which reads the file
 * and calls this).
 *
 * WHY THIS IS ITS OWN MODULE. It used to be a private function inside
 * `vitest.config.ts`, where nothing could import it and therefore nothing could
 * test it. That is the wrong place for it, because of every guard in this lane it
 * is the only one that fails TOWARD GREEN: it decides which test files exist, so
 * an over-broad glob deletes real tests from the suite and the shortened suite
 * still reports success. A loud guard can go untested for a while; a quiet one
 * cannot.
 *
 * WHY IT TAKES TEXT AND NOT A PATH. Keeping the `readFileSync` in the config
 * leaves this a total function of its input, which is what makes the dangerous
 * cases — the ones that must be SKIPPED rather than mistranslated — cheap to pin
 * with authored fixtures. Same shape and same reason as `workspaceGroupsIn(yaml)`
 * in `repo-sources.testkit.ts` next door.
 *
 * WHY NOT `.testkit.ts`, LIVING IN `ops/testkit/`. The suffix is load-bearing in
 * this repo: the coverage config excludes it as "test-only substrate, exercised by
 * the tests that import it, not product code to measure". This module is not that.
 * `vitest.config.ts` imports it, so it runs on every single test invocation,
 * before any test does — it is tooling the build depends on, and claiming a
 * test-only exemption for it would be a false label on the one file in this lane
 * that most needs to be looked at. It sits in `ops/testkit/` anyway because that
 * is where the repo's discovery/walking substrate lives and a reader looking for
 * one will look for the other; the missing suffix is the honest part.
 */

/**
 * The directory-exclusion globs implied by `gitignoreText`, in the order the file
 * lists them.
 *
 * DELIBERATELY NARROW: comments, blank lines and the trailing-slash DIRECTORY form
 * only. Negations, anchored or nested paths, wildcard entries, and bare entries
 * (which may name a file, e.g. the repo's own `.vercel`) are AMBIGUOUS in this
 * translation, so they are SKIPPED rather than guessed at.
 *
 * The asymmetry is the whole design. Under-excluding costs nothing — vitest's own
 * `defaultExclude` still does its job and at worst a few extra files get
 * collected. Over-excluding silently removes real tests from the suite and the
 * suite still passes. When in doubt, emit nothing.
 */
export function gitignoredDirGlobs(gitignoreText: string): string[] {
  return (
    gitignoreText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
      // Trailing-slash directory form only; anything else is skipped (see above).
      .filter((line) => line.endsWith("/"))
      // The name itself must be a plain directory name: no negation, no wildcard,
      // no character class, and no interior separator (which would make it an
      // anchored or nested path rather than a name matchable anywhere).
      .filter((line) => !/[!*?[\]/]/.test(line.slice(0, -1)))
      .map((line) => `**/${line}**`)
  );
}
