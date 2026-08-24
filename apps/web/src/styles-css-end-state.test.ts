import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `styles.css` IS THE TOKEN HOME AND HOLDS NO RULE (spec #420 slice 9, §8.1) — the last
 * of the nine deletion guards, and the only one that can state the end condition rather
 * than one section of it.
 *
 * THREE CLAIMS, ONE FILE.
 *
 * The first is the ordinary slice guard: every selector §4.3 gives slice 9 is gone, and
 * `fill-path-cards-structure.test.tsx` asserts from the other end that the chart's
 * elements carry those declarations as utilities.
 *
 * The second is the prefix sweep the other eight guards run, over the names this slice
 * took. It is the one that keeps mattering after the migration ends: a rule reappearing
 * here would be UNLAYERED CSS beating the utility that replaced it, silently, with
 * nothing else in the suite red.
 *
 * The third is the terminal shape, and it subsumes the other eight. Two rules in the
 * file, both `:root`, nothing else — so there is no section left for a tenth guard to
 * own and no way for any surface's rules to come back without this going red. The eight
 * section guards stay because they name WHICH names may not return; this one says only
 * that none may.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT ASSERT, because §8.1's other two clauses are held
 * where they were already held and a second copy would drift: the twelve `--nms-*` names
 * matching `NMS_TOKEN_NAMES` in both directions is `nms-tokens.test.ts`, and no colour
 * literal outside the two blocks is `summary-section-deleted.test.ts`, which has held it
 * since the badges took the file's last two.
 *
 * SCANNED, NEVER PARSED. Every value below is authored from the deleted rules. Nothing
 * here reads product data.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const STYLES_CSS = readFileSync(join(SRC, "styles.css"), "utf8");

/** CSS comments, gone — they quote selectors and mean none of them. */
const uncommented = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

const UNCOMMENTED = uncommented(STYLES_CSS);

/**
 * EVERY TOP-LEVEL RULE IN THE FILE, as `[selector, body]` — slice 6's walker, carried
 * forward unchanged so no two guards in this suite can disagree about where a rule
 * starts.
 */
function topLevelRules(css: string): [string, string][] {
  const rules: [string, string][] = [];
  let depth = 0;
  let since = 0;
  let selector = "";
  for (let index = 0; index < css.length; index += 1) {
    const character = css[index];
    if (character === "{") {
      if (depth === 0) {
        selector = css.slice(since, index).trim();
        since = index + 1;
      }
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        rules.push([selector, css.slice(since, index)]);
        since = index + 1;
      }
    }
  }
  expect(depth).toBe(0);
  return rules;
}

/**
 * The selectors slice 9 owns (spec #420 §4.3), spelled exactly as the file spelled them.
 *
 * `\\.fp-chart-card h2` IS HERE AND IS THE THIRD ARM OF A GROUPED RULE. The other two
 * went in slice 8, listed member by member for the same reason: a rule left standing with
 * one arm of its list removed is still a rule on every element it still reaches. This arm
 * is what retires the rule, so the rule is what disappears when the arm does.
 *
 * THE COMPOUND SWATCH SELECTORS ARE LISTED AS WRITTEN (`.fp-legend-swatch.is-filled`).
 * The escaping is by hand for the reason `base-layer.test.ts` does it by hand: a
 * generated `\b` in the middle of a class name is a word boundary, not a literal.
 */
const OWNED_SELECTORS = [
  "\\.fp-chart-card h2",
  "\\.fp-chart-head",
  "\\.fp-chart-head h2",
  "\\.fp-chart-head \\.fp-chart-range",
  "\\.fp-chart-range",
  "\\.fp-chart",
  "\\.fp-legend",
  "\\.fp-legend li",
  "\\.fp-legend-swatch",
  "\\.fp-legend-swatch\\.is-filled",
  "\\.fp-legend-swatch\\.is-waiting",
  "\\.fp-legend-swatch\\.is-now",
  "\\.fp-caption",
  "\\.fp-inspect",
  "\\.fp-inspect input",
];

/**
 * The name prefixes this slice took, for the sweep the list above cannot do.
 *
 * `\\.fp-chart` COVERS `\\.fp-chart-head`, `\\.fp-chart-range` AND `\\.fp-chart-card`,
 * which is the point of having no trailing character class: the `-` is not a delimiter,
 * as slice 7 found out when a nested `.fp-tile-label` arm passed a sweep that required
 * one. A leading delimiter is still required, so a hypothetical `.x-fp-chart` is not read
 * as `.fp-chart`.
 *
 * TWO OF THESE NAMES ARE STILL IN THE MARKUP AND THAT DOES NOT WEAKEN THE SWEEP. `fp-chart`
 * and `fp-inspect` survive as the hooks `fill-path-chart-a11y.test.tsx` and
 * `fill-path-selection.test.tsx` query by; what may not survive is a RULE under them, and
 * a hook with no rule is exactly what a converted surface looks like.
 */
const OWNED_PREFIXES = ["\\.fp-chart", "\\.fp-legend", "\\.fp-caption", "\\.fp-inspect"];

describe("the chart section's deletion", () => {
  it("has taken every selector slice 9 owns out of styles.css", () => {
    for (const selector of OWNED_SELECTORS) {
      expect(STYLES_CSS).not.toMatch(new RegExp(`^${selector}\\s*[,{]`, "m"));
    }
  });

  it("leaves no rule anywhere in the file under any name this slice took", () => {
    const nameInBody = new RegExp(`(^|[\\s,>+~])(${OWNED_PREFIXES.join("|")})`);
    for (const [selector, body] of topLevelRules(UNCOMMENTED)) {
      for (const prefix of OWNED_PREFIXES) {
        expect(selector).not.toMatch(new RegExp(`(^|[\\s,>+~])${prefix}`));
      }
      if (selector.startsWith("@")) expect(body).not.toMatch(nameInBody);
    }
  });
});

describe("the file is the token home and nothing else", () => {
  it("holds exactly two rules, and both are `:root`", () => {
    const openers = topLevelRules(UNCOMMENTED).map(([selector]) => selector);
    expect(openers).toEqual([":root", ":root"]);
  });

  it("declares nothing but custom properties and the colour-scheme hint", () => {
    // The other direction of the same claim: two `:root` openers would still admit a
    // `background: red` smuggled into one of them, which is a rule on `<html>` by another
    // spelling. Every declaration in this file must be a `--x: y` line.
    //
    // `color-scheme` IS THE ONE EXCEPTION AND IT IS NOT PAINT. It tells the UA which form
    // controls and scrollbars to render — the range input this slice converted is one of
    // them — and there is no custom property that could carry it. Named rather than
    // pattern-matched, so a second non-custom declaration cannot ride in beside it.
    for (const [, body] of topLevelRules(UNCOMMENTED)) {
      for (const declaration of body.split(";")) {
        const property = declaration.trim().split(":")[0]?.trim();
        if (property === undefined || property === "" || property === "color-scheme") {
          continue;
        }
        expect(property, `\`${property}\` is not a custom property`).toMatch(/^--/);
      }
    }
  });

  it("still defines the palette the whole app reads", () => {
    // Guards the guard. A walker that stopped finding rules would report the strongest
    // possible green for both assertions above, so this pins the other direction: the
    // blocks are there and they are full.
    expect(UNCOMMENTED).toMatch(/--muted:\s*#[0-9a-fA-F]{3,8}/);
    expect(UNCOMMENTED).toMatch(/--nms-primary:\s*var\(--accent\)/);
  });
});
