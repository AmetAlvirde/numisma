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
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
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

const REPO_ROOT_DIR = resolve(HERE, "../../../..");
const CONTRACT = resolve(HERE, "contract.ts");
const READER = resolve(HERE, "snapshot-reader.ts");

/**
 * The directories `pnpm-workspace.yaml` globs, READ FROM THE YAML rather than
 * hardcoded — a hardcoded `["packages", "apps"]` and the yaml can drift with no
 * signal, and a workspace group the walker does not know about is a group whose
 * packages it would treat as third-party (see `resolveWorkspaceModule`).
 *
 * Only the `<dir>/*` glob shape is understood, which is the only shape this repo
 * uses. Anything else THROWS: an unrecognised glob means the walker's idea of
 * the workspace is no longer the yaml's, and that must be loud.
 */
function workspaceGroupsIn(yaml: string): string[] {
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
    const glob = /^\s*-\s*["']?(?<glob>[^"'\s]+)["']?\s*$/
      .exec(line)
      ?.groups?.glob;
    const dir = glob ? /^(?<dir>[^*]+)\/\*$/.exec(glob)?.groups?.dir : undefined;
    if (!dir) {
      throw new Error(
        `pnpm-workspace.yaml declares a workspace glob this walker does not ` +
          `understand (${line.trim()}) — only "<dir>/*" is handled, and a group ` +
          `the walker cannot see would have its packages treated as third-party.`,
      );
    }
    groups.push(dir);
  }
  return groups;
}

const WORKSPACE_GROUPS = workspaceGroupsIn(
  readFileSync(resolve(REPO_ROOT_DIR, "pnpm-workspace.yaml"), "utf-8"),
);

/**
 * The workspace's own packages, by published name — read from the layout rather
 * than assumed. Each directory's `package.json` supplies both its name and its
 * `exports` map, which is what a specifier actually resolves THROUGH
 * (`@numisma/engine/calendar` is an export-map key, not a path convention —
 * nothing guarantees the two agree). Export targets are kept RAW; reducing them
 * to a file is `exportedTargetFor`'s job.
 */
const workspacePackages = new Map<
  string,
  { dir: string; exports: Record<string, unknown> }
>(
  WORKSPACE_GROUPS.flatMap((group) => {
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
        return [
          [manifest.name, { dir, exports: manifest.exports ?? {} }] as const,
        ];
      });
  }),
);

/**
 * The scopes this workspace publishes under, derived from the packages actually
 * found. A specifier in one of these scopes is a workspace edge by construction,
 * so failing to resolve it is a defect rather than a third-party leaf.
 */
const WORKSPACE_SCOPES = new Set(
  [...workspacePackages.keys()]
    .filter((name) => name.startsWith("@"))
    .map((name) => name.split("/")[0]),
);

/**
 * Reduce one package's `exports` map + a subpath to the relative target a runtime
 * import takes. Three shapes, three outcomes:
 *
 *   - a STRING target is the target.
 *   - a CONDITIONAL object is resolved through `import` / `default` / `node`, in
 *     that order — the conditions a bundler or node takes for the ES imports this
 *     walker follows. A `types`-only object reduces to nothing and throws.
 *   - a WILDCARD key (`"./*": "./src/*.ts"`) matches around the star and
 *     substitutes the matched segment into the target.
 *
 * The two failure messages are deliberately distinct: an ABSENT key and a target
 * shape the walker cannot REDUCE are different defects, and reporting the second
 * as the first sends the reader hunting for a key that is right there.
 */
function exportedTargetFor(
  pkgName: string,
  exports: Record<string, unknown>,
  subpath: string,
): string {
  const key = subpath === "" ? "." : `.${subpath}`;

  const reduce = (matchedKey: string, target: unknown): string => {
    if (typeof target === "string") return target;
    if (target && typeof target === "object" && !Array.isArray(target)) {
      for (const condition of ["import", "default", "node"]) {
        const branch = (target as Record<string, unknown>)[condition];
        if (typeof branch === "string") return branch;
      }
    }
    throw new Error(
      `${pkgName}'s exports entry "${matchedKey}" IS in the map, but its target ` +
        `shape is one this walker cannot reduce to a single file ` +
        `(${JSON.stringify(target)}) — no import/default/node string condition.`,
    );
  };

  if (Object.hasOwn(exports, key)) return reduce(key, exports[key]);

  for (const [pattern, target] of Object.entries(exports)) {
    if (!pattern.includes("*")) continue;
    const [prefix = "", suffix = ""] = pattern.split("*");
    if (!key.startsWith(prefix) || !key.endsWith(suffix)) continue;
    if (key.length < prefix.length + suffix.length) continue;
    const star = key.slice(prefix.length, key.length - suffix.length);
    return reduce(pattern, target).replace("*", star);
  }

  throw new Error(
    `"${key}" is not in ${pkgName}'s exports map (no exact and no wildcard key ` +
      `matches) — the walker cannot follow it.`,
  );
}

/**
 * Resolve a bare specifier to a file inside this workspace, or `null` if it is a
 * true third-party package (or a node: builtin) — which is what keeps the walk
 * out of `node_modules`.
 *
 * A name in one of the WORKSPACE'S OWN SCOPES that is not in the map THROWS. It
 * cannot be a third-party leaf, and returning `null` for it was the one path
 * where a workspace edge could vanish without a sound — the exact blind spot the
 * guard exists to close.
 */
function resolveWorkspaceModule(spec: string): string | null {
  // Scoped names carry the scope in their first segment: `@numisma/engine/calendar`
  // is package `@numisma/engine` + subpath `./calendar`.
  const segments = spec.split("/");
  const name = spec.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : (segments[0] ?? spec);
  const pkg = workspacePackages.get(name);
  if (!pkg) {
    if (WORKSPACE_SCOPES.has(segments[0] ?? "")) {
      throw new Error(
        `${spec} names the workspace scope "${segments[0]}" but no package ` +
          `'${name}' was found under ${WORKSPACE_GROUPS.join("/, ")}/ — the ` +
          `walker would otherwise treat a workspace edge as a third-party leaf.`,
      );
    }
    return null;
  }
  return resolve(pkg.dir, exportedTargetFor(name, pkg.exports, spec.slice(name.length)));
}

/**
 * The on-disk file a followed edge names. Three import styles reach here and all
 * three must resolve, because a false throw reds the pg-free guard on a defect
 * that does not exist — and a guard people learn to distrust defends nothing:
 *
 *   - NodeNext (`./calendar.js` for `calendar.ts`), used inside the workspace
 *     packages. The `.ts`/`.tsx` rewrite is tried BEFORE the literal `.js`, so a
 *     stray compiled emit beside its source never wins over the source.
 *   - EXTENSIONLESS (`./as-of`), legal under `apps/web`'s
 *     `"moduleResolution": "Bundler"` — the sibling `.ts`/`.tsx` is tried.
 *   - QUERY/HASH-suffixed (`../styles.css?url`, live at `routes/__root.tsx`),
 *     which names the file to its left.
 *
 * An edge that still resolves to no file THROWS rather than being skipped — a
 * walk that quietly drops edges is the failure mode this whole guard exists to
 * prevent.
 */
function moduleFileFor(candidate: string): string {
  const path = candidate.replace(/[?#].*$/, "");
  const attempts = path.endsWith(".js")
    ? [path.replace(/\.js$/, ".ts"), path.replace(/\.js$/, ".tsx"), path]
    : [path, `${path}.ts`, `${path}.tsx`];
  attempts.push(join(path, "index.ts"), join(path, "index.tsx"));
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
  it("follows a @numisma/* edge into the workspace package's own source", () => {
    // contract.ts -> ./as-of.ts -> `export { addDays, daysBetween } from
    // "@numisma/engine/calendar"` (a RUNTIME re-export, not `export type`). The
    // walk must cross that specifier and land on the file the export map names.
    const { files } = reachableGraph(CONTRACT);
    const calendar = resolve(REPO_ROOT_DIR, "packages/engine/src/calendar.ts");
    // Set membership, not a substring of a joined blob: `calendar.tsx` or a
    // `calendar.ts.bak` would satisfy the latter without the edge being followed.
    expect(files).toContain(calendar);
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
      resolve(REPO_ROOT_DIR, "packages/engine/src/calendar.ts"),
    );
    expect(resolveWorkspaceModule("@numisma/engine")).toBe(
      resolve(REPO_ROOT_DIR, "packages/engine/src/index.ts"),
    );
    for (const thirdParty of ["pg", "react", "better-auth", "node:fs"]) {
      expect(resolveWorkspaceModule(thirdParty), thirdParty).toBeNull();
    }
  });
});

/**
 * THE WALKER'S FAILURE MODES. Every one of these is a case where the walk must
 * either resolve correctly or FAIL LOUDLY — never quietly record a leaf and move
 * on. Fixtures here are authored inline; nothing is read from real data.
 */
describe("the module-graph walker's failure modes", () => {
  it("throws rather than leafing a workspace-scope specifier it cannot resolve", () => {
    // The blind spot: an `@numisma/*` name absent from the map used to return
    // null and be recorded as a third-party leaf, so a pg-importing package in
    // a workspace group the walker did not know about would pass the guard.
    expect(() =>
      resolveWorkspaceModule("@numisma/authored-absent-package"),
    ).toThrow(/workspace scope/);
    expect(() =>
      resolveWorkspaceModule("@numisma/authored-absent-package/sub"),
    ).toThrow(/workspace scope/);
  });

  it("fails the whole walk on an unresolvable workspace edge instead of leafing it", () => {
    // The unit throw above is only worth anything if the WALK propagates it.
    // Authored entry file, obviously synthetic: it names a workspace-scope
    // package that does not exist, which is the shape a `services/*` group the
    // walker cannot see would produce.
    const scratch = mkdtempSync(join(tmpdir(), "numisma-walker-"));
    try {
      const entry = join(scratch, "authored-entry.ts");
      writeFileSync(
        entry,
        'export { ledger } from "@numisma/authored-absent-package";\n',
      );
      expect(() => reachableGraph(entry)).toThrow(/workspace scope/);
      // And a true third-party name in the same position stays a silent leaf.
      writeFileSync(entry, 'import { Pool } from "pg";\nexport { Pool };\n');
      expect(reachableGraph(entry).packages).toContain("pg");
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("derives its workspace groups from pnpm-workspace.yaml rather than a hardcoded list", () => {
    // Independent read: if the walker ever goes back to hardcoding
    // ["packages", "apps"], adding a group to the yaml reds this test instead
    // of silently shrinking the walk.
    const yaml = readFileSync(
      resolve(REPO_ROOT_DIR, "pnpm-workspace.yaml"),
      "utf-8",
    );
    const block = yaml.slice(yaml.indexOf("\npackages:") + 1);
    const declared = block
      .split("\n")
      .slice(1)
      .filter((line) => /^\s+-\s/.test(line))
      .map((line) => line.replace(/^\s+-\s*/, "").trim());
    expect(declared.length).toBeGreaterThan(0);
    expect([...WORKSPACE_GROUPS].sort()).toEqual(
      declared.map((glob) => glob.replace(/\/\*$/, "")).sort(),
    );
  });

  it("resolves an extensionless relative import, which moduleResolution Bundler allows", () => {
    // apps/web/tsconfig.json sets "moduleResolution": "Bundler"; `./contract`
    // is legal there and must not red the pg-free guard as a phantom defect.
    expect(moduleFileFor(resolve(HERE, "contract"))).toBe(
      resolve(HERE, "contract.ts"),
    );
  });

  it("prefers the .ts source over a stray compiled .js sitting beside it", () => {
    const scratch = mkdtempSync(join(tmpdir(), "numisma-walker-"));
    try {
      // Authored, obviously synthetic: two files, same basename.
      writeFileSync(join(scratch, "authored.ts"), "export const authored = 1;\n");
      writeFileSync(join(scratch, "authored.js"), "export const authored = 1;\n");
      expect(moduleFileFor(join(scratch, "authored.js"))).toBe(
        join(scratch, "authored.ts"),
      );
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it("resolves a bundler query suffix to the file it names", () => {
    // Live today at apps/web/src/routes/__root.tsx: `../styles.css?url`.
    const styles = resolve(HERE, "../styles.css");
    expect(moduleFileFor(`${styles}?url`)).toBe(styles);
  });

  it("resolves a conditional export object to the file a runtime import takes", () => {
    expect(
      exportedTargetFor("@numisma/authored", { ".": "./src/index.ts" }, ""),
    ).toBe("./src/index.ts");
    expect(
      exportedTargetFor(
        "@numisma/authored",
        { ".": { types: "./src/index.ts", default: "./src/index.ts" } },
        "",
      ),
    ).toBe("./src/index.ts");
    expect(
      exportedTargetFor(
        "@numisma/authored",
        { ".": { types: "./src/index.ts", import: "./src/esm.ts" } },
        "",
      ),
    ).toBe("./src/esm.ts");
  });

  it("resolves a wildcard export key by substituting the matched segment", () => {
    expect(
      exportedTargetFor(
        "@numisma/authored",
        { "./*": "./src/*.ts" },
        "/calendar",
      ),
    ).toBe("./src/calendar.ts");
  });

  it("names the real cause when an export target has a shape it cannot reduce", () => {
    // An ABSENT key and an UNREDUCIBLE target are different defects; the walker
    // used to report both as "not in the exports map".
    expect(() =>
      exportedTargetFor("@numisma/authored", { ".": "./src/index.ts" }, "/nope"),
    ).toThrow(/not in @numisma\/authored's exports map/);
    expect(() =>
      exportedTargetFor(
        "@numisma/authored",
        { ".": { types: "./src/index.d.ts" } },
        "",
      ),
    ).toThrow(/target shape/);
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
