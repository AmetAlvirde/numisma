import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE BARE-ELEMENT RULES' NEW HOME (spec #420 Seam C, slice 2).
 *
 * `*`, `body`, `h1` and `h2` are the four rules in the migration with no class to
 * hang a utility on. Preflight would have owned them and preflight is off
 * permanently, so they move into `@layer base` in `tailwind.css` — the only place
 * an element selector can live under Tailwind's cascade order — and `styles.css`
 * loses them.
 *
 * WHAT THIS TEST IS FOR, and it is not style policing. The move changes WHO WINS.
 * In `styles.css` these rules were unlayered and beat every utility on a shared
 * property; inside `@layer base` they lose to `layer(utilities)`, which is the
 * direction the migration wants and also the direction in which a stray extra
 * selector in the block is invisible. So the block's membership is asserted
 * exactly, not loosely: four selectors, no more, and each with the declarations
 * the deleted rule carried.
 *
 * THE ONE DECLARATION THAT DOES NOT COME ACROSS is `body { min-width: 320px }`.
 * Seam D put `min-w-[320px]` on `<body>` in `__root.tsx` in slice 0 precisely so
 * that deleting the `body` rule would make the sentinel the real floor rather
 * than a duplicate of one. Re-declaring it here would re-cover the scan guard
 * with a rule the guard cannot see, so it is asserted ABSENT.
 *
 * Every value below is authored from the deleted rules. Nothing here reads
 * product data.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const TAILWIND_CSS = readFileSync(join(SRC, "tailwind.css"), "utf8");
const STYLES_CSS = readFileSync(join(SRC, "styles.css"), "utf8");

/** The layer order line, spelled once. It is first, or the layers order by appearance. */
const ORDER_LINE = "@layer theme, base, components, utilities;";

/**
 * The block's body, from `@layer base {` to the matching close.
 *
 * Brace counting rather than a regex: the block holds nested rule bodies, and
 * `[^}]*` would stop at the first inner close and report a block that is missing
 * three of its four selectors as if it were complete.
 */
function baseLayerBody(css: string): string {
  const opens = [...css.matchAll(/@layer\s+base\s*\{/g)];
  expect(opens).toHaveLength(1);
  const start = opens[0]!.index! + opens[0]![0].length;
  let depth = 1;
  let index = start;
  while (index < css.length && depth > 0) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    index += 1;
  }
  expect(depth).toBe(0);
  return css.slice(start, index - 1);
}

/** Selector -> its declarations, split and trimmed, for one level of nesting. */
function rules(body: string): Map<string, string[]> {
  const parsed = new Map<string, string[]>();
  for (const match of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = match[1]!
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim()
      .split("\n")
      .at(-1)!
      .trim();
    parsed.set(
      selector,
      match[2]!
        .split(";")
        .map((declaration) => declaration.trim())
        .filter(Boolean),
    );
  }
  return parsed;
}

describe("the base layer in tailwind.css", () => {
  it("keeps the layer order line first, ahead of every import", () => {
    expect(TAILWIND_CSS).toContain(ORDER_LINE);
    // Column-zero anchored: the file's header prose names `@import` several
    // times, and a bare `indexOf` finds the sentence rather than the statement.
    const firstImport = TAILWIND_CSS.search(/^@import/m);
    expect(firstImport).toBeGreaterThan(-1);
    expect(TAILWIND_CSS.indexOf(ORDER_LINE)).toBeLessThan(firstImport);
  });

  it("holds exactly the four bare-element selectors and nothing else", () => {
    expect([...rules(baseLayerBody(TAILWIND_CSS)).keys()].sort()).toEqual([
      "*",
      "body",
      "h1",
      "h2",
    ]);
  });

  it("carries the declarations the deleted rules carried", () => {
    const parsed = rules(baseLayerBody(TAILWIND_CSS));

    expect(parsed.get("*")).toEqual(["box-sizing: border-box"]);
    expect(parsed.get("body")).toEqual([
      "margin: 0",
      "background: var(--bg)",
      "color: var(--text)",
      "font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    ]);
    expect(parsed.get("h1")).toEqual(["font-size: 1.3rem", "margin: 0"]);
    expect(parsed.get("h2")).toEqual(["font-size: 1.05rem", "margin: 0 0 12px"]);
  });

  it("leaves the 320px floor to the scan sentinel, not to the rehomed rule", () => {
    expect(rules(baseLayerBody(TAILWIND_CSS)).get("body")).not.toContain(
      "min-width: 320px",
    );
  });

  it("has taken the four rules out of styles.css", () => {
    // Anchored at column zero, which is where every top-level rule in that file
    // starts, and escaped by hand: a naive `\\${selector}` turns `body` into the
    // word boundary `\b` followed by `ody` and passes on a file that still has
    // the rule.
    for (const selector of ["\\*", "body", "h1", "h2"]) {
      expect(STYLES_CSS).not.toMatch(new RegExp(`^${selector}\\s*\\{`, "m"));
    }
  });
});
