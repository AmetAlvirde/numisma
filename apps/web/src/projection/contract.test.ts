/**
 * The WIRE-CONTRACT half of the projection module (see `contract.ts`). Split from
 * the reader's suite (`snapshot-reader.test.ts`) along the same seam as the source:
 * nothing in here needs a Pool, real or stubbed.
 *
 * The first suite below is the seam's own guard — it asserts, from the module
 * graph rather than from a comment, that `contract.ts` stays pg-free.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
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
 * Walks the RELATIVE import graph from `entry`, returning every bare (package)
 * specifier reachable through runtime imports. Relative edges are followed to any
 * depth; bare specifiers are LEAVES — the walker stops at the package boundary and
 * does not resolve into `node_modules` or into workspace packages. So a package the
 * app pulls in (say `@numisma/engine/calendar`, which `contract.ts` reaches via
 * `as-of.ts`) is recorded by name only, and whatever IT imports is out of view.
 *
 * That is the walker's stated edge: this guards `pg` through the APP's relative
 * graph — a value import of the driver written anywhere in `apps/web`'s own files
 * downstream of `contract.ts`. A driver pulled in transitively by a workspace
 * package is a different failure and belongs to that package's own guard.
 */
function reachablePackages(entry: string): Set<string> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeImportsOf(readFileSync(file, "utf-8"))) {
      if (spec.startsWith(".")) {
        queue.push(resolve(dirname(file), spec));
      } else {
        packages.add(spec);
      }
    }
  }
  return packages;
}

/**
 * THE SEAM'S OWN GUARD (audit finding 8). `contract.ts` is the module every
 * browser-reachable surface imports from; the moment a value import of `pg` is
 * reachable from it, any runtime value taken from the contract — a schema version,
 * a shared key list — drags the driver toward the client bundle.
 *
 * `client-bundle.integration.test.ts` already asserts the CONSEQUENCE, but only
 * against a built tree (it skips without one) and only for the surfaces that happen
 * to be imported today. This asserts the CAUSE, on every `pnpm test`, from the app's
 * own relative module graph — which is what makes the pg-free half safe to put
 * shared runtime constants in. Scope, per `reachablePackages` above: relative edges
 * to any depth, package specifiers as leaves.
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
