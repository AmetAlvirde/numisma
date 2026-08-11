/**
 * NO `pg` IN THE TUI'S MODULE GRAPH — and no app importing an app.
 *
 * WHY THIS IS A GRAPH TEST AND NOT AN ENVIRONMENT TEST. The AAR's claim that the
 * gap detector was independent of the projection was true of the ENVIRONMENT and
 * false of the MODULE GRAPH: the prototype's TUI bridge reached into
 * `apps/web/src/push/gap-report-core.ts`, and that file's neighbourhood imports
 * the `pg` driver. Asserting `process.env.DATABASE_URL` is unset would have passed
 * the whole time. So this follows the imports instead — from every non-test file
 * in `apps/tui/src`, transitively through the workspace packages, and reports what
 * the TUI can actually reach.
 *
 * The prototype hid that edge behind a COMPUTED specifier (`new URL(...).href`) so
 * `tsc` could not follow it; a regex walker cannot be dodged the same way, because
 * a computed specifier that this walker cannot resolve shows up as an unresolved
 * import and fails the last assertion rather than passing silently.
 */
import { readFileSync, readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = apps/tui/src → the repo root is three levels up.
const REPO_ROOT = resolve(HERE, "../../..");

/** Every workspace package: name → its directory and `exports` map. */
function workspacePackages(): Map<string, { dir: string; exports: unknown }> {
  const found = new Map<string, { dir: string; exports: unknown }>();
  for (const group of ["packages", "apps"]) {
    for (const entry of readdirSync(join(REPO_ROOT, group), { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const dir = join(REPO_ROOT, group, entry.name);
      const manifestPath = join(dir, "package.json");
      if (!existsSync(manifestPath)) {
        continue;
      }
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        name?: string;
        exports?: unknown;
      };
      if (manifest.name !== undefined) {
        found.set(manifest.name, { dir, exports: manifest.exports });
      }
    }
  }
  return found;
}

const PACKAGES = workspacePackages();

/** A source file for `specifier`, or undefined when it is not ours to follow. */
function resolveSpecifier(specifier: string, fromFile: string): string | undefined {
  if (specifier.startsWith(".")) {
    const base = resolve(dirname(fromFile), specifier);
    // The TUI is NodeNext (`./x.js`); apps/web is Bundler (`./x.ts`). Try both.
    for (const candidate of [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, join(base, "index.ts")]) {
      if (existsSync(candidate) && !candidate.endsWith("/")) {
        return candidate;
      }
    }
    return undefined;
  }
  const packageName = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : (specifier.split("/")[0] as string);
  const pkg = PACKAGES.get(packageName);
  if (pkg === undefined) {
    return undefined; // a real external (node_modules) — recorded, not followed
  }
  const subpath = specifier === packageName ? "." : `.${specifier.slice(packageName.length)}`;
  const exports = pkg.exports as Record<string, string> | undefined;
  const target = exports?.[subpath];
  if (target === undefined) {
    // A workspace package reached through an entry point it does not export —
    // e.g. one app deep-importing another's source. Surfaced, never silently ok.
    return join(pkg.dir, `UNRESOLVED:${subpath}`);
  }
  return resolve(pkg.dir, target);
}

/**
 * The same source with every comment removed — the walker's real input.
 *
 * WHY THE INPUT AND NOT THE MATCHER. The matcher below reads `from "…"` ANYWHERE in
 * the text, so an ordinary English sentence in a doc comment — `a load failure is a
 * different fact from "this position has no plan."` — was walked as an import of a
 * package by that name and failed the graph as an unresolvable external (#273). The
 * other candidate fix, anchoring the matcher to statement position, buys the same
 * quiet by narrowing what counts as an import — and an import this walker stops
 * seeing is exactly the edge the prototype hid. A comment cannot contain an import,
 * so the comments go and the matcher stays as greedy as it was.
 *
 * STRING LITERALS ARE KEPT VERBATIM, since the specifier itself is one — and that is
 * why `//` inside a string cannot start a comment here. Newlines survive so a removed
 * comment cannot splice two statements together. A `'`/`"` string also ends at the
 * newline: unterminated ones do not exist in source that compiles, and the bound
 * keeps a stray quote inside a regex literal (`/["']/`) from swallowing the file.
 */
function stripComments(source: string): string {
  let out = "";
  let index = 0;
  while (index < source.length) {
    const char = source[index] as string;
    const next = source[index + 1];
    if (char === "/" && next === "/") {
      while (index < source.length && source[index] !== "\n") {
        index += 1;
      }
      continue;
    }
    if (char === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") {
          out += "\n";
        }
        index += 1;
      }
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      out += char;
      index += 1;
      while (index < source.length) {
        const inner = source[index] as string;
        if (inner === "\\") {
          out += source.slice(index, index + 2);
          index += 2;
          continue;
        }
        out += inner;
        index += 1;
        if (inner === char || (inner === "\n" && char !== "`")) {
          break;
        }
      }
      continue;
    }
    out += char;
    index += 1;
  }
  return out;
}

const STRIPPED = new Map<string, string>();

/** A file's code with its comments gone — read once, stripped once. */
function codeOf(file: string): string {
  const cached = STRIPPED.get(file);
  if (cached !== undefined) {
    return cached;
  }
  const code = stripComments(readFileSync(file, "utf8"));
  STRIPPED.set(file, code);
  return code;
}

interface Graph {
  files: Set<string>;
  externals: Set<string>;
  workspacePackagesReached: Set<string>;
  unresolved: string[];
}

/** Walk every import — static and dynamic — reachable from `entries`. */
function walkGraph(entries: readonly string[]): Graph {
  const graph: Graph = {
    files: new Set(),
    externals: new Set(),
    workspacePackagesReached: new Set(),
    unresolved: [],
  };
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (graph.files.has(file)) {
      continue;
    }
    graph.files.add(file);
    const source = codeOf(file);
    const specifiers = [
      ...[...source.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1] as string),
      ...[...source.matchAll(/import\s*\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1] as string),
    ];
    for (const specifier of specifiers) {
      if (specifier.startsWith("node:")) {
        continue;
      }
      if (!specifier.startsWith(".")) {
        const packageName = specifier.startsWith("@")
          ? specifier.split("/").slice(0, 2).join("/")
          : (specifier.split("/")[0] as string);
        if (PACKAGES.has(packageName)) {
          graph.workspacePackagesReached.add(packageName);
        } else {
          graph.externals.add(packageName);
          continue;
        }
      }
      const resolved = resolveSpecifier(specifier, file);
      if (resolved === undefined || resolved.includes("UNRESOLVED:")) {
        graph.unresolved.push(`${relative(REPO_ROOT, file)} → ${specifier}`);
        continue;
      }
      queue.push(resolved);
    }
  }
  return graph;
}

/** Every non-test source file the TUI ships. */
function tuiSources(): string[] {
  return readdirSync(HERE)
    .filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map((name) => join(HERE, name));
}

const GRAPH = walkGraph(tuiSources());

describe("the TUI's module graph", () => {
  it("reaches no database driver — `pg` is not in it, at any depth", () => {
    // The assertion that would have failed on the prototype's bridge.
    expect([...GRAPH.externals].filter((name) => /^pg($|-)/.test(name))).toEqual([]);
    for (const file of GRAPH.files) {
      // Stripped, like the walk: a comment PROMISING there is no `pg` import must
      // not read as one (#273).
      expect(codeOf(file)).not.toMatch(/from\s*["']pg["']/);
    }
  });

  it("reaches exactly one external package, and it is the renderer", () => {
    // Exact, like the gap-report CLI's specifier assertion: a NEW external
    // dependency in the TUI's reach has to be looked at, not absorbed.
    expect([...GRAPH.externals].sort()).toEqual(["@opentui/core"]);
  });

  it("NO APP IMPORTS AN APP — only the three workspace packages are reached", () => {
    expect([...GRAPH.workspacePackagesReached].sort()).toEqual([
      "@numisma/engine",
      "@numisma/event-store",
      "@numisma/preferences",
    ]);
    const otherApps = [...GRAPH.files]
      .map((file) => relative(REPO_ROOT, file))
      .filter((file) => file.startsWith("apps/") && !file.startsWith("apps/tui/"));
    expect(otherApps).toEqual([]);
  });

  it("resolves every import it follows — a computed specifier cannot hide an edge", () => {
    // The prototype's bridge used `new URL(...).href` precisely so `tsc` could not
    // follow the edge. Anything this walker cannot resolve is reported here rather
    // than quietly skipped, so hiding an edge fails the test instead of passing it.
    expect(GRAPH.unresolved).toEqual([]);
  });

  it("ONLY `pnpm dev` asks for the liveness lines — silence elsewhere is structural", () => {
    // The behavioural half is in `startup.test.ts` (omitting `gapLines` emits
    // nothing). This is the other half: no OTHER entry point supplies it, so
    // `report`, `spine` and the smoke harness cannot start speaking by accident.
    const speaking = tuiSources()
      .filter((file) => /\blivenessLines\s*:/.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file));
    expect(speaking).toEqual(["apps/tui/src/app.ts"]);

    // And the entry points that must stay quiet do not even reach the loader.
    for (const quiet of ["report.ts", "spine.ts", "spine-reset.ts", "smoke-startup-openTui.ts"]) {
      expect(readFileSync(join(HERE, quiet), "utf8")).not.toMatch(/loadGapLines|loadLivenessLines/);
    }
  });

  it("actually walked the graph — the guard is not passing on an empty set", () => {
    // Without this, every assertion above would pass on a walker that returned
    // nothing. It must have reached the app entry point and the derivation.
    const reached = [...GRAPH.files].map((file) => relative(REPO_ROOT, file));
    expect(reached).toContain("apps/tui/src/app.ts");
    expect(reached).toContain("apps/tui/src/gap-lines.ts");
    expect(reached).toContain("apps/tui/src/liveness-lines.ts");
    expect(reached).toContain("packages/event-store/src/heartbeat.ts");
    expect(reached).toContain("packages/event-store/src/gap-report-io.ts");
    expect(GRAPH.files.size).toBeGreaterThan(20);
  });
});

const fixtureDirs: string[] = [];

afterEach(() => {
  for (const dir of fixtureDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  fixtureDirs.length = 0;
});

/** A throwaway module tree — `entry.ts` is the walk's entry point. */
function walkFixture(files: Record<string, string>): Graph {
  const dir = mkdtempSync(resolve(tmpdir(), "numisma-module-graph-"));
  fixtureDirs.push(dir);
  for (const [name, source] of Object.entries(files)) {
    writeFileSync(join(dir, name), source, "utf8");
  }
  return walkGraph([join(dir, "entry.ts")]);
}

/** Just the file names the walk reached, so a temp directory does not leak in. */
function reachedNames(graph: Graph): string[] {
  return [...graph.files].map((file) => basename(file)).sort();
}

describe("the walker's input — what counts as an import specifier", () => {
  it("reads no import out of a comment — English that says `from \"…\"` is English", () => {
    // #273: a doc comment reading `… a different fact from "this position has no
    // plan."` was walked as an import of a package by that name, and failed the
    // graph as an unresolvable external. Twice in one increment, in files whose
    // source was correct. Prose is prose in all three comment forms.
    const graph = walkFixture({
      "entry.ts": [
        "/**",
        ' * A load failure is a different fact from "this position has no plan."',
        " */",
        '// The TUI reads its rows from "the fold", never from "pg".',
        '/* And a block comment, quoting a sentence from "somewhere else". */',
        'import { thing } from "./thing.js";',
        "export const used = thing;",
      ].join("\n"),
      "thing.ts": "export const thing = 1;\n",
    });
    expect([...graph.externals]).toEqual([]);
    expect(graph.unresolved).toEqual([]);
    // And the real import beside the prose was still followed.
    expect(reachedNames(graph)).toEqual(["entry.ts", "thing.ts"]);
  });

  it("does not read `pg` out of a comment either — the same prose, the same file", () => {
    // The other half of the `pg` assertion is a raw per-file match, so it carried
    // the same false positive: a comment PROMISING there is no `pg` import read as
    // one. It reads the same stripped source the walk does.
    const graph = walkFixture({
      "entry.ts": ['// Nothing in the TUI imports from "pg".', "export const ok = true;"].join("\n"),
    });
    const [entry] = [...graph.files];
    expect(codeOf(entry as string)).not.toMatch(/from\s*["']pg["']/);
  });

  it("still fails on an import it cannot resolve — the guard is not merely quieter", () => {
    // The fix must not buy silence with blindness. A missing relative file and a
    // real external are both still seen, exactly as before.
    const graph = walkFixture({
      "entry.ts": ['import { gone } from "./missing.js";', 'import pg from "pg";', "export const x = [gone, pg];"].join(
        "\n",
      ),
    });
    expect(graph.unresolved).toEqual([expect.stringContaining("→ ./missing.js")]);
    expect([...graph.externals]).toEqual(["pg"]);
  });

  it("follows imports that no statement-position matcher would find", () => {
    // The other candidate fix — anchor the matcher to `^\s*import … from` — would
    // pass the prose tests above while quietly dropping these three edges, and a
    // dropped edge is how the prototype hid `pg` in the first place. So they are
    // locked here: the walk's INPUT was narrowed, never its reach.
    const graph = walkFixture({
      "entry.ts": [
        "import {",
        "  a,",
        "  b,",
        '} from "./multi-line.js";',
        'export { c } from "./re-exported.js";',
        "export async function lazy() {",
        '  return await import("./dynamic.js");',
        "}",
        "export const pair = [a, b];",
      ].join("\n"),
      "multi-line.ts": "export const a = 1;\nexport const b = 2;\n",
      "re-exported.ts": "export const c = 3;\n",
      "dynamic.ts": "export const d = 4;\n",
    });
    expect(graph.unresolved).toEqual([]);
    expect(reachedNames(graph)).toEqual(["dynamic.ts", "entry.ts", "multi-line.ts", "re-exported.ts"]);
  });

  it("a `//` inside a string literal does not start a comment", () => {
    // The cheap version of this fix — delete from `//` to end of line — eats the
    // rest of any line holding a URL, and an import on that line goes with it.
    const graph = walkFixture({
      "entry.ts": [
        'export const docs = "https://example.com/a//b";',
        '/* A URL in a block comment: https://example.com/x */ import { thing } from "./thing.js";',
        "export const used = thing;",
      ].join("\n"),
      "thing.ts": "export const thing = 1;\n",
    });
    expect(graph.unresolved).toEqual([]);
    expect(reachedNames(graph)).toEqual(["entry.ts", "thing.ts"]);
  });
});
