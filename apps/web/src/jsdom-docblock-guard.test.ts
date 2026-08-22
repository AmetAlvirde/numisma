/**
 * EVERY RENDER TEST HERE DECLARES ITS OWN ENVIRONMENT — the guard that makes ADR-022's
 * per-file jsdom ruling checkable.
 *
 * ── WHAT IS BEING GUARDED ────────────────────────────────────────────────────────────
 * jsdom attaches through a `// @vitest-environment jsdom` docblock at the top of each
 * `*.test.tsx`, and through nothing else: the root `vitest.config.ts` has no
 * `environment` key, no `projects` entry and no `setupFiles`. Spec #403 §3 and ADR-022
 * carry the reasoning; the short version is that a projects split would state the
 * gitignore-derived `exclude` and the 30 s test budget a second time, in the one file
 * whose header forbids exactly that, and would fail toward green when a render test
 * matches no project's `include`.
 *
 * ── WHY A SOURCE SCAN AND NOT A RUNTIME CHECK ────────────────────────────────────────
 * "Every `*.test.tsx` under `apps/web/src` declares jsdom" is a claim about files that do
 * not exist yet, which no assertion inside a running test can make: a file missing its
 * docblock is not collected into any environment where a check could look for it. It is
 * the same shape of claim, held by the same instrument, as `route-move.test.ts` and
 * `rung-state-seam.test.ts` — the repo already reads its own source to guard what
 * execution cannot reach.
 *
 * A missing docblock does fail red on its own, at the first `render()`, with `document is
 * not defined`. That is a real backstop and it is not enough: the message names the DOM
 * rather than the docblock, so it costs a debugging session the first time somebody meets
 * it, and it only fires once the new file is run. This test names the file and the fix.
 *
 * ── THE DOCBLOCK MUST BE FIRST ───────────────────────────────────────────────────────
 * Vitest reads the environment comment out of the file's leading docblock, so a comment
 * that has drifted below an import is INERT and looks identical to a correct one in a
 * diff. Position is therefore part of what is asserted, not a style preference.
 *
 * Every value below is authored. Nothing here reads product data.
 */
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { sourceFiles } from "../../../ops/testkit/repo-sources.testkit.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** The exact line, spelled once. `vitest` matches `@vitest-environment <name>`. */
const DOCBLOCK = "// @vitest-environment jsdom";

/**
 * Where the declaration is allowed to be: at the very top, or after other leading
 * comment lines and blank lines and nothing else. The first line that is neither a
 * comment nor blank ends the search, because everything after it is inert.
 */
function declaresJsdomBeforeAnyCode(source: string): boolean {
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (line === DOCBLOCK) return true;
    if (line === "") continue;
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) {
      continue;
    }
    return false;
  }
  return false;
}

const renderTests = sourceFiles({
  dir: HERE,
  as: "absolute",
  extensions: [".tsx"],
}).filter((file) => file.endsWith(".test.tsx"));

describe("the jsdom docblock guard", () => {
  it("finds the render tests it is meant to be guarding", () => {
    // A scan over an empty list passes forever. If this repo ever has no render test,
    // this guard has nothing to do and its removal is a deliberate edit, not a silence.
    expect(renderTests.length).toBeGreaterThan(0);
  });

  it("requires `// @vitest-environment jsdom` at the top of every *.test.tsx", () => {
    const missing = renderTests.filter(
      (file) => !declaresJsdomBeforeAnyCode(readFileSync(file, "utf8")),
    );
    expect(missing).toEqual([]);
  });

  it("rejects a declaration that has drifted below the imports", () => {
    // The mutation this guard was checked against, as a fixture rather than as a claim:
    // the same line, one import too late, is inert and must not count.
    const drifted = ['import { it } from "vitest";', DOCBLOCK, ""].join("\n");
    expect(declaresJsdomBeforeAnyCode(drifted)).toBe(false);

    const leading = ["/** A header. */", DOCBLOCK, 'import "x";'].join("\n");
    expect(declaresJsdomBeforeAnyCode(leading)).toBe(true);

    expect(declaresJsdomBeforeAnyCode('import "x";')).toBe(false);
  });
});
