/**
 * The WIRE-CONTRACT half of the projection module (see `contract.ts`). Split from
 * the reader's suite (`snapshot-reader.test.ts`) along the same seam as the source:
 * nothing in here needs a Pool, real or stubbed.
 *
 * The first suite below is the seam's own guard — it asserts, from the module
 * graph rather than from a comment, that `contract.ts` stays pg-free.
 *
 * WHICH GUARD IS AUTHORITATIVE. Two tests defend the ADR-007 invariant that no pg
 * driver, connection string or auth secret reaches the browser, and they are not
 * peers:
 *
 *   - `apps/web/src/client-bundle.integration.test.ts` scans the BUILT client
 *     assets. It reads what actually shipped, so it is the AUTHORITATIVE boundary.
 *   - the module-graph walk below is a FAST LOCAL PRE-CHECK, not the real boundary.
 *     It reads source, so it runs on a plain `pnpm test` with no build — which is
 *     exactly why it exists, and exactly why it is not what the invariant rests on.
 *     It reasons about static imports only; a dynamic `import()`, a re-export
 *     through an installed package, or anything a bundler injects is outside it.
 *
 * So: a failure here is a real defect, but a PASS here is not the invariant being
 * proven. If the two ever disagree, the built-asset scan wins.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { CompositionReport } from "@numisma/engine";
import { describe, expect, it } from "vitest";
import { fundIdOf } from "./contract.ts";

// The fixture the push shell + reader share. Its fundName is the canonical
// slug-derivation case ("Sanitized Exploratory Fund" -> "sanitized-exploratory-fund").
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  HERE,
  "../../fixtures/composition-report.fixture.json",
);
const fixtureReport = JSON.parse(
  readFileSync(FIXTURE_PATH, "utf-8"),
) as CompositionReport;

/** Build a CompositionReport carrying only the fundName the slug derivation reads. */
function reportNamed(fundName: string): CompositionReport {
  return { dashboard: { summary: { fundName } } } as unknown as CompositionReport;
}

/**
 * Every module specifier `source` imports or re-exports AT RUNTIME — `import type`
 * and `export type` forms are skipped, because TypeScript erases them and they
 * therefore cannot pull a driver into anyone's bundle.
 *
 * A regex, not the TS compiler API: the repo's import style is plain top-of-file
 * ES statements, and the alternative (spin up a Program) buys nothing here while
 * costing a dependency on compiler internals. A dynamic `import()` would slip past
 * this — none exists in `projection/`, and a value `import` is the failure mode the
 * seam actually has.
 */
function runtimeImportsOf(source: string): string[] {
  const specifiers: string[] = [];
  const statement =
    /^\s*(?:import|export)\b(?<body>[\s\S]*?)\bfrom\s*["'](?<spec>[^"']+)["']/gm;
  for (const match of source.matchAll(statement)) {
    const body = match.groups?.body ?? "";
    const spec = match.groups?.spec;
    if (!spec) continue;
    // `import type X from` / `import { type A }`-only forms are erased at build.
    if (/^\s*type\b/.test(body)) continue;
    specifiers.push(spec);
  }
  // Bare side-effect imports (`import "pg";`) carry no `from` clause.
  for (const match of source.matchAll(/^\s*import\s*["'](?<spec>[^"']+)["']/gm)) {
    const spec = match.groups?.spec;
    if (spec) specifiers.push(spec);
  }
  return specifiers;
}

/**
 * The workspace's own packages, by published name — read from the layout rather
 * than assumed. `pnpm-workspace.yaml` globs `packages/*` and `apps/*`; each
 * directory's `package.json` supplies both its name and its `exports` map, which
 * is what a specifier actually resolves THROUGH (`@numisma/engine/calendar` is
 * an export-map key, not a path convention — nothing guarantees the two agree).
 */
const REPO_ROOT_DIR = resolve(HERE, "../../../..");

const workspacePackages = new Map<
  string,
  { dir: string; exports: Record<string, string> }
>(
  ["packages", "apps"].flatMap((group) => {
    const groupDir = resolve(REPO_ROOT_DIR, group);
    if (!existsSync(groupDir)) return [];
    return readdirSync(groupDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => {
        const dir = join(groupDir, entry.name);
        const manifestPath = join(dir, "package.json");
        if (!existsSync(manifestPath)) return [];
        const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
          name?: string;
          exports?: Record<string, unknown>;
        };
        if (!manifest.name) return [];
        // Only string export targets; this repo uses no conditional objects, and
        // guessing at one would be worse than leaving the edge unresolved.
        const exports: Record<string, string> = {};
        for (const [key, target] of Object.entries(manifest.exports ?? {})) {
          if (typeof target === "string") exports[key] = target;
        }
        return [[manifest.name, { dir, exports }] as const];
      });
  }),
);

/**
 * Resolve a bare specifier to a file inside this workspace, or `null` if it is a
 * true third-party package (or a node: builtin) — which is what keeps the walk
 * out of `node_modules`.
 */
function resolveWorkspaceModule(spec: string): string | null {
  // Scoped names carry the scope in their first segment: `@numisma/engine/calendar`
  // is package `@numisma/engine` + subpath `./calendar`.
  const segments = spec.split("/");
  const name = spec.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? spec);
  const pkg = workspacePackages.get(name);
  if (!pkg) return null;

  const subpath = spec.slice(name.length);
  const target = pkg.exports[subpath === "" ? "." : `.${subpath}`];
  if (!target) {
    throw new Error(
      `${spec} is a workspace package but "${subpath === "" ? "." : `.${subpath}`}" ` +
        `is not in ${name}'s exports map — the walker cannot follow it.`,
    );
  }
  return resolve(pkg.dir, target);
}

/**
 * The on-disk file a followed edge names. Relative specifiers inside the
 * workspace packages are written NodeNext-style (`./calendar.js` for
 * `calendar.ts`), while `apps/web` writes `.ts` directly; both are handled here.
 * An unresolvable edge THROWS rather than being skipped — a walk that quietly
 * drops edges is the failure mode this whole guard exists to prevent.
 */
function moduleFileFor(candidate: string): string {
  const attempts = [
    candidate,
    candidate.replace(/\.js$/, ".ts"),
    candidate.replace(/\.js$/, ".tsx"),
    join(candidate, "index.ts"),
  ];
  const hit = attempts.find((path) => existsSync(path));
  if (!hit) {
    throw new Error(
      `module-graph walker could not resolve ${candidate} (tried ${attempts.join(", ")})`,
    );
  }
  return hit;
}

/**
 * Walks the import graph from `entry`, returning both the FILES opened and every
 * bare (package) specifier reached through runtime imports.
 *
 * Two kinds of edge, two behaviors:
 *
 *   - RELATIVE edges are followed to any depth, as they always were.
 *   - BARE specifiers are all RECORDED by name, and the ones naming a package of
 *     THIS WORKSPACE are additionally FOLLOWED — resolved through that package's
 *     `exports` map and walked like any other file. So `@numisma/engine/calendar`,
 *     which `contract.ts` reaches via `as-of.ts`, no longer ends the walk: a driver
 *     a workspace package pulls in transitively is now in view (#295).
 *
 * True third-party specifiers (`pg`, `react`, `node:fs`) remain LEAVES. The walker
 * never opens `node_modules` — resolving installed packages would mean implementing
 * node resolution, and the built-asset scan (the AUTHORITATIVE guard; see this
 * file's header) already covers what those packages contribute to a real bundle.
 *
 * An edge that resolves to no file THROWS rather than being skipped: a walk that
 * silently drops edges is precisely the blind spot this guard exists to close.
 */
function reachableGraph(entry: string): {
  files: Set<string>;
  packages: Set<string>;
} {
  const files = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of runtimeImportsOf(readFileSync(file, "utf-8"))) {
      if (spec.startsWith(".")) {
        queue.push(moduleFileFor(resolve(dirname(file), spec)));
        continue;
      }
      // Every package edge is NAMED, workspace or not — that set is what the
      // pg-free assertion reads. Workspace ones are additionally FOLLOWED.
      packages.add(spec);
      const workspaceFile = resolveWorkspaceModule(spec);
      if (workspaceFile) queue.push(moduleFileFor(workspaceFile));
    }
  }
  return { files, packages };
}

function reachablePackages(entry: string): Set<string> {
  return reachableGraph(entry).packages;
}

/**
 * THE SEAM'S OWN GUARD (audit finding 8). `contract.ts` is the module every
 * browser-reachable surface imports from; the moment a value import of `pg` is
 * reachable from it, any runtime value taken from the contract — a schema version,
 * a shared key list — drags the driver toward the client bundle.
 *
 * `client-bundle.integration.test.ts` asserts the CONSEQUENCE and is the
 * authoritative boundary (see this file's header), but only against a built tree —
 * it skips without one. This asserts the CAUSE, on every `pnpm test`, from the
 * module graph — which is what makes the pg-free half safe to put shared runtime
 * constants in. Scope, per `reachableGraph` above: relative edges to any depth,
 * workspace packages followed through their export maps, true third-party
 * specifiers recorded as leaves.
 */
describe("contract.ts stays pg-free", () => {
  const CONTRACT = resolve(HERE, "contract.ts");
  const READER = resolve(HERE, "snapshot-reader.ts");

  it("reaches no runtime pg import through the app's relative import graph", () => {
    const packages = reachablePackages(CONTRACT);
    const pgish = [...packages].filter((p) => p === "pg" || p.startsWith("pg/"));
    expect(pgish, `reachable packages: ${[...packages].join(", ")}`).toEqual([]);
  });

  it("does not import the reader directly, which is where pg legitimately lives", () => {
    // Proves the dependency runs one way only at the seam itself: this checks the
    // contract's OWN import list, not the whole graph. The reader imports the
    // contract; a contract that imported back would re-merge the two halves
    // silently (the pg-free assertion above covers the deeper relative paths).
    const contractSource = readFileSync(CONTRACT, "utf-8");
    expect(runtimeImportsOf(contractSource)).not.toContain("./snapshot-reader.ts");

    // And the assertion above has teeth only if the reader really does import pg —
    // otherwise a future move could empty both files and pass vacuously.
    expect(reachablePackages(READER)).toContain("pg");
  });
});

/**
 * THE WALKER'S OWN BOUNDARY. The guard above is only worth its assertion if the
 * walk actually goes where it claims, so these pin BOTH halves of the rule:
 * workspace edges are followed, true third-party edges are leaves. A walker that
 * resolved nothing fails the first; a walker that resolved everything (into
 * `node_modules`) fails the second.
 *
 * Deliberately asserting what the walk CONTAINS, not merely what it lacks: a
 * silently-empty walk that finds no `pg` because it found nothing at all is the
 * exact defect this pair exists to prevent.
 */
describe("the module-graph walker's boundary", () => {
  const CONTRACT = resolve(HERE, "contract.ts");
  const READER = resolve(HERE, "snapshot-reader.ts");
  const REPO_ROOT = resolve(HERE, "../../../..");

  it("follows a @numisma/* edge into the workspace package's own source", () => {
    // contract.ts -> ./as-of.ts -> `export { addDays, daysBetween } from
    // "@numisma/engine/calendar"` (a RUNTIME re-export, not `export type`). The
    // walk must cross that specifier and land on the file the export map names.
    const { files } = reachableGraph(CONTRACT);
    const calendar = resolve(REPO_ROOT, "packages/engine/src/calendar.ts");
    expect([...files].sort().join("\n")).toContain(calendar);
  });

  it("records a true third-party specifier as a leaf and does not walk node_modules", () => {
    const { files, packages } = reachableGraph(READER);
    // The specifier is still NAMED — that is what the pg-free assertion reads.
    expect(packages).toContain("pg");
    // But nothing behind it is opened: no file in the walk comes from an
    // installed package. (`pg` itself pulls pg-pool/pg-protocol/pg-types; a
    // resolve-everything walker would drag all of them in here.)
    expect([...files].filter((f) => f.includes("node_modules"))).toEqual([]);
  });

  it("resolves the workspace export map, and refuses everything outside the workspace", () => {
    // The subpath comes from packages/engine/package.json `exports`, not from a
    // guessed src/<name>.ts convention.
    expect(resolveWorkspaceModule("@numisma/engine/calendar")).toBe(
      resolve(REPO_ROOT, "packages/engine/src/calendar.ts"),
    );
    expect(resolveWorkspaceModule("@numisma/engine")).toBe(
      resolve(REPO_ROOT, "packages/engine/src/index.ts"),
    );
    for (const thirdParty of ["pg", "react", "better-auth", "node:fs"]) {
      expect(resolveWorkspaceModule(thirdParty), thirdParty).toBeNull();
    }
  });
});

describe("fundIdOf slug derivation", () => {
  it("derives the canonical fixture slug", () => {
    expect(fundIdOf(fixtureReport)).toBe("sanitized-exploratory-fund");
    // Guard against the fixture drifting out from under the canonical case.
    expect(fundIdOf(reportNamed("Sanitized Exploratory Fund"))).toBe(
      "sanitized-exploratory-fund",
    );
  });

  it("lowercases mixed casing", () => {
    expect(fundIdOf(reportNamed("MixedCASE Fund"))).toBe("mixedcase-fund");
  });

  it("collapses runs of punctuation and whitespace to a single separator", () => {
    expect(fundIdOf(reportNamed("Foo   &&&   Bar!!!Baz"))).toBe("foo-bar-baz");
  });

  it("trims leading and trailing separators", () => {
    expect(fundIdOf(reportNamed("  --Alpha Fund--  "))).toBe("alpha-fund");
    expect(fundIdOf(reportNamed("!!!Omega!!!"))).toBe("omega");
  });

  it("preserves digits", () => {
    expect(fundIdOf(reportNamed("Fund 2026 v2"))).toBe("fund-2026-v2");
  });

  it("passes an already-slugged name through unchanged", () => {
    expect(fundIdOf(reportNamed("already-slug"))).toBe("already-slug");
  });
});
