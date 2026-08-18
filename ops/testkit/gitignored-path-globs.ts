/**
 * The vitest `exclude` globs for everything GIT ignores — the repo's test
 * DISCOVERY filter (see `vitest.config.ts`, which spreads the result after
 * `defaultExclude`).
 *
 * WHY GIT AND NOT A `.gitignore` PARSER. This module replaces one that read the
 * repo-root `.gitignore` as TEXT and translated the trailing-slash directory form
 * into globs. That approach was wrong in two ways at once, and both failed toward
 * green — the direction that deletes tests while the shortened suite still reports
 * success:
 *
 *   1. It filtered candidate names with a hand-maintained metacharacter denylist
 *      (`/[!*?[\]/]/`) that omitted `{`, `}` and `\`. Git has no brace expansion,
 *      so `{tmp,scratch}/` names ONE literal directory to git; picomatch — which
 *      vitest's `exclude` really runs through — brace-expands it into
 *      `**​/{tmp,scratch}/**` and eats every test under any `tmp/` or `scratch/`
 *      in the tree. A denylist of metacharacters is the same species of rot as the
 *      `SKIPPED_DIRS` denylist the source walker retired next door.
 *   2. It read the ROOT `.gitignore` only, so nested ones never reached discovery.
 *      `apps/web/.gitignore` declares `.nitro/ .tanstack/ .vercel/ .vinxi/`, two of
 *      which exist on disk and matched nothing in `defaultExclude`.
 *
 * So: stop parsing, and ask git. `git ls-files --others --ignored
 * --exclude-standard --directory --no-empty-directory -z` IS the answer to "what
 * does git ignore here", and it already implements nested `.gitignore` files,
 * negations, anchored paths, `.git/info/exclude` and the global excludes file.
 * Its entries are repo-root-relative, so the globs come out ANCHORED TO REAL PATHS
 * (`apps/web/.vercel/**`, not `**​/.vercel/**`) — narrower, and no longer a guess
 * about which directory an entry meant. Discovery and the source walker
 * (`repo-sources.testkit.ts`) become one idea: both ask git.
 *
 * WHY THE EXCLUDE FORM AND NOT AN INCLUDE FORM. The obvious alternative is to
 * derive vitest's `include` from `git ls-files` instead. That would require
 * re-implementing vitest's default include pattern
 * (`**​/*.{test,spec}.?(c|m)[jt]s?(x)`) as a hand-maintained filter — a new list
 * of exactly the kind this lane retires, whose failure mode is again
 * fail-toward-green: a `.spec.ts` silently not collected. The exclude form leaves
 * vitest's own `include` authoritative and computes nothing but "what does git
 * ignore".
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
import { execFileSync } from "node:child_process";

import { REPO_ROOT } from "./repo-sources.testkit.js";

/**
 * Glob metacharacters picomatch honours, each escapable with a backslash.
 *
 * ESCAPING, NOT DETECTING. The retired parser tried to RECOGNISE dangerous
 * characters and skip those entries, which meant its correctness depended on the
 * completeness of a character list — and it was incomplete. Escaping closes the
 * whole class instead: a real directory named `{a,b}` becomes the literal glob
 * `\{a,b\}/**` rather than brace-expanding into `a/` and `b/` and over-excluding
 * two directories that have nothing to do with it.
 */
const GLOB_METACHARACTERS = /[\\*?[\]{}()!+@]/g;

/**
 * The one vitest `exclude` glob implied by one `git ls-files` entry.
 *
 * Directory entries arrive with a trailing `/` and become `<path>/**` (everything
 * beneath them); file entries have no trailing slash and pass through as
 * themselves. Either way the literal path is escaped first, so nothing in a real
 * filename is ever read as a pattern.
 */
export function globForIgnoredEntry(entry: string): string {
  const escaped = entry.replace(GLOB_METACHARACTERS, "\\$&");
  return escaped.endsWith("/") ? `${escaped}**` : escaped;
}

/** `globForIgnoredEntry` over a whole listing, in the order git reported it. */
export function globsForIgnoredEntries(
  entries: readonly string[],
): string[] {
  return entries.map(globForIgnoredEntry);
}

/**
 * The exclude globs for everything git ignores in THIS checkout.
 *
 * `--directory --no-empty-directory` collapses a wholly-ignored directory to one
 * entry instead of listing every file inside it (15 entries here, not tens of
 * thousands of `node_modules` files), and `-z` keeps paths with spaces intact.
 * The default root is `REPO_ROOT`, imported rather than re-derived — the walker
 * and discovery agreeing on one root is the point, and inside a linked worktree
 * that root is the worktree's own.
 *
 * WHY `root` IS A PARAMETER. It is the seam that makes this derivation testable
 * without depending on WHICH CHECKOUT the suite happens to be running in. Git
 * lists only ignored paths that EXIST ON DISK — correct, and the reason the
 * exclude form is safe — but it also means the answer is a fact about one working
 * tree rather than about the repo. A fresh linked worktree has no `.claude/`, no
 * `coverage/`, no `apps/web/.tanstack/`, so a guard asserting against the live
 * result was green in the main checkout and red in every worktree; worse, the
 * assertion that most needed exercising — that the derivation reaches NESTED
 * `.gitignore` files and anchors them to their own directory — could never run
 * where this board actually does its work. Point `root` at an AUTHORED fixture
 * repo instead and the behaviour under test (nested ignores, anchoring, escaping
 * through a real git round-trip, `--no-empty-directory`, and the deliberate
 * silence about ignored paths that do not exist on disk) is pinned identically on
 * every machine. The default is unchanged, so `vitest.config.ts` calls this
 * exactly as it did before.
 */
export function gitignoredPathGlobs(root: string = REPO_ROOT): string[] {
  const listing = execFileSync(
    "git",
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "--directory",
      "--no-empty-directory",
      "-z",
    ],
    { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return globsForIgnoredEntries(
    listing.split("\0").filter((entry) => entry !== ""),
  );
}
