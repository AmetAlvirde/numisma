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
import { realpathSync } from "node:fs";

import { REPO_ROOT } from "./repo-sources.testkit.js";

/**
 * Throw unless `root` is the TOPLEVEL of a git repository.
 *
 * Compared through `realpathSync` on both sides because git answers with the
 * resolved path: on macOS a `mkdtemp` root is `/var/folders/…` and git calls the
 * same directory `/private/var/folders/…`. Comparing the raw strings there would
 * reject every legitimate temp-directory fixture, which is the only caller that
 * passes `root` at all.
 */
function assertRepositoryToplevel(
  root: string,
  env: NodeJS.ProcessEnv | undefined,
): void {
  let toplevel: string;
  try {
    toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      ...(env === undefined ? {} : { env }),
    }).trim();
  } catch (cause) {
    throw new Error(
      `gitignored-path-globs: ${root} is not inside a git repository, so ` +
        `\`git ls-files\` cannot say what is ignored there.`,
      { cause },
    );
  }
  if (realpathSync(toplevel) !== realpathSync(root)) {
    throw new Error(
      `gitignored-path-globs: ${root} is not a repository toplevel (that is ` +
        `${toplevel}). \`git ls-files\` reports paths relative to its cwd, so a ` +
        `subdirectory root yields globs anchored to the wrong base — they look ` +
        `right and exclude nothing. Pass the toplevel.`,
    );
  }
}

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
 *
 * `root` MUST BE A REPOSITORY TOPLEVEL, AND THAT IS CHECKED, NOT ASSUMED.
 * `git ls-files` reports paths relative to its cwd and descends only from there,
 * so pointing `root` at a SUBDIRECTORY of a repo does not fail — it returns
 * plausible-looking globs anchored to the wrong base. Handed `apps/web`, it
 * reports `.tanstack/**` where discovery needs `apps/web/.tanstack/**`, and that
 * glob silently excludes nothing (or, worse, excludes an unrelated root-level
 * directory of the same name). Fail-toward-green again, in the one module whose
 * entire purpose is to close that mode — so a non-toplevel `root` throws. The
 * check is skipped when `root` is the default, which is itself the output of
 * `git rev-parse --show-toplevel`: nothing to re-derive, and no subprocess added
 * to the config-load path that runs before every single test invocation.
 *
 * `options.env` REPLACES THE ENVIRONMENT OF THE GIT SUBPROCESS, and exists for the
 * same reason `root` does. Git reads `GIT_DIR`, `GIT_WORK_TREE` and
 * `GIT_INDEX_FILE` from the environment and they OUTRANK `cwd`, while
 * `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n` outrank even
 * repo-local config — so a fixture that pins `root` but inherits `process.env` is
 * only hermetic on a machine that happens not to export any of them (a `git
 * bisect run`, a hook, or a CI wrapper is not such a machine). Omitting the option
 * inherits `process.env` exactly as before, so the `vitest.config.ts` call site is
 * byte-identical in behaviour.
 */
export function gitignoredPathGlobs(
  root: string = REPO_ROOT,
  options: { readonly env?: NodeJS.ProcessEnv } = {},
): string[] {
  if (root !== REPO_ROOT) assertRepositoryToplevel(root, options.env);
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
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      ...(options.env === undefined ? {} : { env: options.env }),
    },
  );
  return globsForIgnoredEntries(
    listing.split("\0").filter((entry) => entry !== ""),
  );
}
