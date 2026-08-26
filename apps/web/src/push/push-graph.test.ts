import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * NO BROWSER PACKAGE ON THE UNATTENDED DAILY PATH (spec #439 review finding 5).
 *
 * WHY A GRAPH TEST AND NOT A GREP. The edge this exists for was invisible one hop out.
 * No file under `push/` imported `@numisma/components`; `fixture-synthesis.ts` imported
 * `NAV_MOVE_THRESHOLD_PCT` from `glance/verdict.ts`, and `verdict.ts` is what imported
 * the package. A grep over `push/` was green the whole time. So this follows the
 * relative imports out from the three script entrypoints and asserts against what they
 * can ACTUALLY reach, which is the same instrument `apps/tui/src/module-graph.test.ts`
 * points at the TUI and the same reason it exists.
 *
 * WHY IT MATTERS HERE RATHER THAN ANYWHERE. `backfill` is step 6 of the unattended
 * daily job. `@numisma/components`'s curated index re-exports `PriceDropPathChart`,
 * which imports `@tanstack/charts` at module scope, so the edge made a nightly script
 * that writes projection rows evaluate React, `@base-ui/react` and a charting library
 * before doing anything — and ADR-018 records that library as pre-alpha and breaking by
 * the vendor's own admission. Nothing threw, since nothing in the package touches
 * `window`, `document` or a CSS import at module scope, and the suite was green
 * throughout. That is exactly the kind of coupling nothing red ever reminds anyone
 * about, which is why it is written down as an assertion rather than as prose.
 *
 * THE RULE IS AN ALLOW-LIST OF BARE SPECIFIERS, not a deny-list of today's offender.
 * What makes a dependency wrong here is browser reach and startup cost, which is not a
 * property of any name this file could enumerate in advance — so the check is that the
 * set has not moved. A legitimate addition reds, and the fix is to read the new package
 * and write it down here.
 *
 * WHAT THE WALK DOES NOT DO. It follows RELATIVE specifiers only, so it stops at the
 * workspace boundary: a bare specifier is recorded and not traversed. That is the whole
 * claim being made — which packages the push tree loads — and it is why the assertion is
 * on the bare specifiers rather than on a file list.
 *
 * THE MATCHER IS ANCHORED TO STATEMENT POSITION, WHICH IS THE OPPOSITE OF THE TUI'S
 * CHOICE, and the difference is the threat model. The TUI's walker keeps a greedy
 * `from "…"` matcher and strips comments in a hundred lines of scanner, because the
 * edge it hunts was DELIBERATELY HIDDEN behind a computed specifier and narrowing the
 * matcher is how you lose it. Nothing is hiding from this guard: the coupling it exists
 * for was an ordinary top-of-file import that nobody thought about. Unanchored, this
 * walk read two English sentences out of the push docblocks as packages — `from "no
 * orders in the push"` and `from "the file could not be read"` — which is #273 again.
 * Anchoring costs the ability to see an import written somewhere no import is written
 * today, and buys not needing a JavaScript tokenizer in a guard. The `import(` matcher
 * stays unanchored, since a dynamic import is an expression and sits mid-line.
 *
 * TYPE-ONLY IMPORTS ARE SKIPPED because they erase and load nothing, which is the same
 * reasoning `routes/route-move.test.ts` runs on. Every relative specifier the walk
 * follows must resolve to a file that exists — a mistyped path would otherwise drop a
 * subtree and make this guard quieter without making it wrong-looking.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..");

/** The three `tsx` entrypoints `package.json` runs, `backfill` among them. */
const ENTRYPOINTS = ["push/push.ts", "push/gap-report.ts", "push/backfill.ts"];

interface Graph {
  files: Set<string>;
  bare: Set<string>;
  unresolved: string[];
}

/** Every file and every bare specifier reachable from `entries` by relative import. */
function walk(entries: readonly string[]): Graph {
  const graph: Graph = { files: new Set(), bare: new Set(), unresolved: [] };
  const pending = [...entries];
  while (pending.length > 0) {
    const rel = pending.pop() as string;
    if (graph.files.has(rel)) continue;
    graph.files.add(rel);
    const source = readFileSync(join(SRC, rel), "utf-8");
    const specifiers = [
      ...[...source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s*["']([^"']+)["']/gm)],
      ...[...source.matchAll(/^\s*import\s*["']([^"']+)["']/gm)],
      ...[...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)],
    ].map((match) => match[1] as string);
    for (const specifier of specifiers) {
      if (specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) {
        graph.bare.add(specifier);
        continue;
      }
      const next = relative(SRC, resolve(dirname(join(SRC, rel)), specifier));
      if (!existsSync(join(SRC, next))) {
        graph.unresolved.push(`${rel} → ${specifier}`);
        continue;
      }
      pending.push(next);
    }
  }
  return graph;
}

const GRAPH = walk(ENTRYPOINTS);

describe("the push scripts' module graph", () => {
  it("walks past the entrypoints at all", () => {
    // Guards the guard: a walker that stopped following imports would assert an empty
    // specifier set against the allow-list and report the strongest possible green for
    // having looked at three files.
    expect(GRAPH.files.size).toBeGreaterThan(ENTRYPOINTS.length);
    // And it dropped nothing on the way: an unresolvable relative specifier is a
    // subtree this guard never looked at.
    expect(GRAPH.unresolved).toEqual([]);
  });

  it("reaches no browser component package, at any depth", () => {
    // The assertion that would have failed on this wave's own diff, before
    // `NAV_MOVE_THRESHOLD_PCT` moved out of `glance/verdict.ts`.
    expect([...GRAPH.bare].filter((name) => name.startsWith("@numisma/components"))).toEqual([]);
    expect([...GRAPH.bare].filter((name) => /^(react|react-dom|@base-ui|@tanstack\/charts)/.test(name))).toEqual([]);
  });

  it("loads exactly the packages written down here", () => {
    expect([...GRAPH.bare].sort()).toEqual([
      "@numisma/engine",
      "@numisma/engine/calendar",
      "@numisma/event-store",
      "@numisma/preferences",
      "pg",
    ]);
  });
});
