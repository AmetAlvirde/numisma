/**
 * The ONE repo-source walker the repo-wide guard tests share (TEST INPUT ONLY).
 *
 * WHY THIS EXISTS. Ten guard tests each walked the tree with their own recursive
 * `readdirSync` filtered by a hand-maintained denylist of directory names
 * (`node_modules`, `.git`, `dist`, ...). A denylist rots by construction: it only
 * skips what someone remembered to add. The live proof was `.claude/` — line 2 of
 * `.gitignore`, absent from every denylist — so the moment an agent worktree was
 * checked out under `.claude/worktrees/`, `apps/web/src/calendar-contract.test.ts`
 * saw the whole repo a second time and failed on "duplicate" declarations that
 * were the same file viewed twice. Adding `.claude` to the denylists would have
 * closed that instance and none of the class; the next tool to drop a directory at
 * the repo root would be the next false red.
 *
 * The fix is to stop guessing. `git ls-files --cached --others --exclude-standard`
 * IS the definition of "the files git considers part of this repo": tracked files,
 * plus untracked files that are not ignored, with `.gitignore` honoured by
 * `--exclude-standard`. Gitignore-aware and worktree-safe by construction rather
 * than by vigilance.
 *
 * WHY `--others` AND NOT `--cached` ALONE. These walks feed *guards*. `--cached`
 * alone lists only what is in the index, so a source file a developer has written
 * but not yet `git add`-ed would be invisible — and a guard that cannot see a new
 * file passes on a violation it was written to catch. `--others
 * --exclude-standard` closes that hole. `-z` (NUL-delimited) keeps paths with
 * spaces intact.
 *
 * WORKTREES ARE NOT A SPECIAL CASE. The root comes from `git rev-parse
 * --show-toplevel` run in THIS file's own directory, so it is independent of the
 * caller's cwd. Run from inside a linked worktree, that resolves to the
 * worktree's own root and the listing is the worktree's own files — which is
 * correct, not a bug: a checkout is a repo.
 *
 * ⛔ NOT FOR BUILD OUTPUT. Anything git cannot see is invisible here, by design.
 * `apps/web/src/client-bundle.integration.test.ts` walks
 * `apps/web/.vercel/output/static`, which is generated and gitignored; converting
 * it to this walker would silently empty that guard rather than fix it. It stays
 * on `readdirSync` deliberately. Same for the price-feed wrapper-harness walks,
 * which scan temp log directories outside the repo entirely.
 *
 * Lives in `ops/` — repo tooling, beside the launch-agent scripts — rather than in
 * a package `src/`, for two reasons: two guards take a census of the workspace's own
 * packages, and this file reads `pnpm-workspace.yaml` to know where they live, so a
 * new package under a workspace group would change the very shape it reports on; and
 * a repo-wide test utility has no business inside the trading engine. Imported by
 * relative path; no export-map entry. Named with the repo's `.testkit.ts` suffix so
 * the coverage config's existing testkit exclusion glob covers it if the include
 * globs ever widen.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * The root of the checkout this file is part of — a linked worktree's own root
 * when running inside one. Derived from git, not from counting `..` segments, so
 * moving this file cannot silently repoint it.
 */
export const REPO_ROOT: string = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: HERE,
  encoding: "utf8",
}).trim();

let cachedRepoFiles: readonly string[] | undefined;

/**
 * Every file git considers part of the repo: repo-root-relative POSIX paths,
 * deduplicated and sorted, with paths that no longer exist on disk dropped
 * (`--cached` still lists files deleted in the working tree).
 *
 * Shells out ONCE per process and memoizes — nine guard files each re-listing the
 * repo per assertion is a real cost, and the callers that hoist their walk are
 * hoisting it for exactly this reason.
 */
export function repoFiles(): readonly string[] {
  if (cachedRepoFiles !== undefined) return cachedRepoFiles;
  const listing = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: REPO_ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const unique = new Set<string>();
  for (const file of listing.split("\0")) {
    if (file === "" || unique.has(file)) continue;
    if (!existsSync(join(REPO_ROOT, file))) continue;
    unique.add(file);
  }
  cachedRepoFiles = [...unique].sort();
  return cachedRepoFiles;
}

/** How a returned path is expressed. */
export type PathStyle =
  /** Relative to the repo root, e.g. `apps/web/src/main.tsx`. */
  | "repo"
  /** Relative to the scanned `dir`, e.g. `main.tsx`. */
  | "dir"
  /** Absolute, ready for `readFileSync`. */
  | "absolute";

export interface SourceFilesOptions {
  /**
   * Directory to scan — absolute, or relative to the repo root. Defaults to the
   * repo root. Must be inside the repo.
   */
  readonly dir?: string;
  /** Descend into subdirectories. Default `true`; `false` lists that one directory. */
  readonly recursive?: boolean;
  /** How to express the returned paths. Default `"repo"`. */
  readonly as?: PathStyle;
  /**
   * Which file extensions count as source, each written with its leading dot and
   * matched case-sensitively against the end of the path. Default `[".ts", ".tsx"]`.
   *
   * WHY THIS IS OPT-IN AND NOT THE DEFAULT. The sites converted to this walker were
   * checked to scan a byte-identical set afterwards. Three of the `apps/web`
   * blast-radius import guards were the exception: before conversion they each
   * declared six extensions of their own (see `GUARD_SOURCE_EXTENSIONS`), and taking
   * the walker's default silently narrowed them. Membership is identical today — git
   * reports no `.js`, `.jsx`, `.mts` or `.cts` file under `apps/web` — so nothing
   * went red, which is exactly the danger: a guard stops guarding QUIETLY, and the
   * first `.js` dropped into `apps/web/src` would walk past three confinement rules
   * that used to catch it. Narrowing a guard inside the very change that exists to
   * stop guards from rotting would defeat the change. So the breadth comes back where
   * it was lost, as an explicit request from the callers that had it.
   *
   * WIDENING THE DEFAULT WOULD BE THE WRONG REPAIR. The default is shared with
   * repo-root-rooted callers — `apps/web/src/calendar-contract.test.ts` scans from
   * the repo root — and a broader default would start feeding them `.js` files that
   * exist elsewhere in the tree, changing a passing guard's input without anyone
   * asking. Breadth belongs to the caller that needs breadth; the default stays put.
   */
  readonly extensions?: readonly string[];
}

/** `.ts` and `.tsx`. Callers that want a narrower set filter the result. */
const DEFAULT_SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx"];

/**
 * The six extensions the three `apps/web` blast-radius import guards
 * (`event-store-`, `preferences-` and `plans-import-guard.test.ts`) each declared for
 * themselves before conversion, restored verbatim.
 *
 * ONE constant rather than three re-declarations, because three hand-kept copies of
 * one list is precisely the drift this walker exists to end: the guards are siblings
 * by design and must widen or narrow together, and a reader of any one of them lands
 * here and sees that the set is a restoration rather than an invention. Verbatim
 * means verbatim — `.mjs` and `.cjs` are absent because they were absent before, and
 * adding them would be a new decision wearing a repair's clothes.
 */
export const GUARD_SOURCE_EXTENSIONS: readonly string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mts",
  ".cts",
];

/**
 * Every TypeScript source git knows about under `dir`, sorted — or whichever
 * extensions the caller named through `extensions`.
 *
 * Nothing ignored, nothing vendored, nothing inside an agent worktree — those are
 * simply not in `repoFiles()`.
 */
export function sourceFiles(options: SourceFilesOptions = {}): string[] {
  const {
    dir = REPO_ROOT,
    recursive = true,
    as = "repo",
    extensions = DEFAULT_SOURCE_EXTENSIONS,
  } = options;
  const prefix = repoRelativeDir(dir);
  const scoped = prefix === "" ? "" : `${prefix}/`;
  const found: string[] = [];
  for (const file of repoFiles()) {
    if (!extensions.some((extension) => file.endsWith(extension))) continue;
    if (!file.startsWith(scoped)) continue;
    const withinDir = file.slice(scoped.length);
    if (!recursive && withinDir.includes("/")) continue;
    if (as === "absolute") found.push(join(REPO_ROOT, file));
    else if (as === "dir") found.push(withinDir);
    else found.push(file);
  }
  return found;
}

/**
 * The directories `pnpm-workspace.yaml` globs, PARSED FROM THE YAML TEXT — `packages`
 * and `apps` today, in the order the manifest lists them.
 *
 * WHY THIS IS PARSED AND NOT HARDCODED. `workspacePackageDirs()` used to test paths
 * against a literal `/^(?:apps|packages)\//`, which is the same mistake in miniature
 * as the `SKIPPED_DIRS` denylist this whole file exists to retire: a second copy of a
 * fact the repo already states, kept in sync by memory alone. It rots the same way
 * and it fails the same way — SILENTLY, by shrinking the census rather than erroring,
 * and a guard handed a short package list passes while guarding less than it claims.
 * `apps/web/src/projection/contract.test.ts` already refused the hardcoded version
 * for exactly this reason and kept its own yaml-derived group list, which left two
 * censuses in one repo disagreeing about where groups come from. The manifest wins.
 *
 * ONLY THE `<dir>/*` GLOB SHAPE IS UNDERSTOOD, which is the only shape this repo
 * uses. Anything else THROWS rather than being skipped: an unrecognised glob means
 * this walker's idea of the workspace is no longer the yaml's, and a census quietly
 * missing a whole group is the failure this function was rewritten to prevent. A
 * missing or unreadable manifest throws for the same reason — there is no useful
 * partial answer, only a confident wrong one.
 *
 * Exported as a pure text-to-groups function so a caller with the yaml already in
 * hand can reuse it.
 *
 * ⛔ `apps/web/src/projection/contract.test.ts` CARRIES ITS OWN IDENTICAL COPY, AND
 * THAT DUPLICATION IS DELIBERATE — ruled on, not drift. Do not collapse it and do
 * not leave a TODO proposing the merge. That file exists to assert that this walker
 * derives its workspace groups FROM `pnpm-workspace.yaml` rather than hardcoding
 * them, and it can only assert that from an INDEPENDENT reading of the manifest.
 * Import this function there and the test compares the walker against itself: it
 * would pass unconditionally, including on the exact regression it was written to
 * catch. An oracle that shares its implementation with the thing it checks is not
 * an oracle.
 */
export function workspaceGroupsIn(yaml: string): string[] {
  const groups: string[] = [];
  let insidePackages = false;
  for (const raw of yaml.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (line.trim() === "") continue;
    if (/^\S/.test(line)) {
      insidePackages = line.trim() === "packages:";
      continue;
    }
    if (!insidePackages) continue;
    const glob = /^\s*-\s*["']?(?<glob>[^"'\s]+)["']?\s*$/.exec(line)?.groups?.glob;
    const dir = glob ? /^(?<dir>[^*]+)\/\*$/.exec(glob)?.groups?.dir : undefined;
    if (dir === undefined) {
      throw new Error(
        `pnpm-workspace.yaml declares a workspace glob this walker does not ` +
          `understand (${line.trim()}) — only "<dir>/*" is handled, and a group ` +
          `the walker cannot see would be missing from every workspace census.`,
      );
    }
    groups.push(dir);
  }
  return groups;
}

let cachedWorkspaceGroups: readonly string[] | undefined;

/**
 * This checkout's workspace groups, read from `pnpm-workspace.yaml` at the repo root.
 *
 * Memoized alongside `repoFiles()` and for the same reason: the manifest cannot
 * change under a running test process, and the census callers hoist their walk
 * precisely to avoid repeating this kind of IO per assertion. A read failure — no
 * manifest, no permission — is re-thrown with the path named rather than swallowed
 * into an empty group list.
 */
export function workspaceGroups(): readonly string[] {
  if (cachedWorkspaceGroups !== undefined) return cachedWorkspaceGroups;
  const manifest = join(REPO_ROOT, "pnpm-workspace.yaml");
  let yaml: string;
  try {
    yaml = readFileSync(manifest, "utf-8");
  } catch (cause) {
    throw new Error(
      `repo-sources: cannot read ${manifest}, so the workspace groups are unknown ` +
        `and every workspace census would be silently empty.`,
      { cause },
    );
  }
  cachedWorkspaceGroups = workspaceGroupsIn(yaml);
  return cachedWorkspaceGroups;
}

/**
 * The workspace-package census: repo-root-relative directories that hold a
 * `package.json` exactly one level below one of `pnpm-workspace.yaml`'s groups —
 * the same set pnpm itself resolves. Sorted, because `repoFiles()` is.
 */
export function workspacePackageDirs(): string[] {
  const groups = workspaceGroups();
  return repoFiles()
    .filter((file) => {
      const group = groups.find((candidate) => file.startsWith(`${candidate}/`));
      if (group === undefined) return false;
      // Exactly one directory level below the group, as `<group>/*` means.
      const within = file.slice(group.length + 1).split("/");
      return within.length === 2 && within[1] === "package.json";
    })
    .map((file) => file.slice(0, file.lastIndexOf("/")));
}

/** `dir` as a repo-root-relative POSIX prefix (`""` for the root itself). */
function repoRelativeDir(dir: string): string {
  const absolute = isAbsolute(dir) ? dir : resolve(REPO_ROOT, dir);
  const rel = relative(REPO_ROOT, absolute);
  if (rel === "") return "";
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`repo-sources: ${dir} is outside the repo root ${REPO_ROOT}`);
  }
  return rel.split(sep).join("/");
}
