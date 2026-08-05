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
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
    const source = readFileSync(file, "utf8");
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
      expect(readFileSync(file, "utf8")).not.toMatch(/from\s*["']pg["']/);
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

  it("ONLY `pnpm dev` asks for the gap lines — silence elsewhere is structural", () => {
    // The behavioural half is in `startup.test.ts` (omitting `gapLines` emits
    // nothing). This is the other half: no OTHER entry point supplies it, so
    // `report`, `spine` and the smoke harness cannot start speaking by accident.
    const speaking = tuiSources()
      .filter((file) => /\bgapLines\s*:/.test(readFileSync(file, "utf8")))
      .map((file) => relative(REPO_ROOT, file));
    expect(speaking).toEqual(["apps/tui/src/app.ts"]);

    // And the entry points that must stay quiet do not even reach the loader.
    for (const quiet of ["report.ts", "spine.ts", "spine-reset.ts", "smoke-startup-openTui.ts"]) {
      expect(readFileSync(join(HERE, quiet), "utf8")).not.toMatch(/loadGapLines/);
    }
  });

  it("actually walked the graph — the guard is not passing on an empty set", () => {
    // Without this, every assertion above would pass on a walker that returned
    // nothing. It must have reached the app entry point and the derivation.
    const reached = [...GRAPH.files].map((file) => relative(REPO_ROOT, file));
    expect(reached).toContain("apps/tui/src/app.ts");
    expect(reached).toContain("apps/tui/src/gap-lines.ts");
    expect(reached).toContain("packages/event-store/src/gap-report-io.ts");
    expect(GRAPH.files.size).toBeGreaterThan(20);
  });
});
