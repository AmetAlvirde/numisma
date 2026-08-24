import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE LADDER IS GONE FROM `styles.css` (spec #420 slice 8, gate line 2) — the second of
 * the three sections that share `FillPath.tsx`, and the one that carried the surface's
 * only interactive element.
 *
 * FOUR CLAIMS, ONE FILE.
 *
 * The first is the ordinary one: every selector §4.3 gives slice 8 is gone, and
 * `fill-path-cards-structure.test.tsx` asserts from the other end that the elements carry
 * those declarations as utilities.
 *
 * The second is the prefix sweep slice 7 introduced, turned on this slice's names. It
 * looks INSIDE at-rule bodies, because both deleted `@container` blocks were nested arms
 * and a nested arm is where a half-finished deletion hides. Every name here left the
 * markup as well as the stylesheet, so a rule under any of them has no carrier and is
 * either dead or a regression — and a regression here is an unlayered declaration beating
 * the utility that replaced it, with nothing else in the suite red.
 *
 * The third is the containers. `container: fp-selected / inline-size` and
 * `container: fp-list / inline-size` were shorthands, and a shorthand re-declared
 * anywhere in this unlayered file would answer the deleted `@container` blocks'
 * replacements from two places at once. Neither name may appear in a container
 * declaration in this file in any form, which — the header's having gone in slice 7 —
 * leaves the file with no container declaration at all.
 *
 * The fourth is the one that has been waiting six slices. `absent` was kept as a bare
 * class-name hook because three CONTEXTUAL rules selected through it, the last of them
 * `.fp-detail .absent`. It left with the selected-rung card, so no rule in this file may
 * select that name any more — asserted over the whole file rather than as a selector in
 * the list above, because the claim is about a name with no rule rather than about one
 * rule being gone.
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
 *
 * Walked with a depth counter rather than matched at column zero: a nested rule's own
 * closing brace sits at column zero too, and a regex would read the text after it as a
 * selector. An at-rule's body comes back whole, which is what every caller wants — a
 * declaration smuggled inside a `@container` arm is still a declaration in this file.
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
 * The selectors slice 8 owns (spec #420 §4.3), spelled exactly as the file spelled them.
 *
 * THE GROUPED HEADING RULE IS LISTED BY ITS TWO ARMS, not by the rule: `.fp-chart-card
 * h2` is slice 9's and the rule is still there carrying it. A rule left standing with one
 * arm of its list removed is still a rule on an element this slice converted, which is
 * precisely how a three-selector deletion goes two-thirds done.
 *
 * THE ROW'S STATE RULES ARE COMPOUND (`.fp-row.is-filled`) and are listed as written. The
 * escaping is by hand for the reason `base-layer.test.ts` does it by hand: a generated
 * `\b` in the middle of a class name is a word boundary, not a literal.
 */
const OWNED_SELECTORS = [
  "\\.fp-torn",
  "\\.fp-torn p",
  "\\.fp-unchecked",
  "\\.fp-warn",
  "\\.fp-warn-certain",
  "\\.fp-warn-inferred",
  "\\.fp-list h2",
  "\\.fp-selected h2",
  "\\.fp-selected",
  "\\.fp-selected-price",
  "\\.fp-selected-size",
  "\\.fp-selected-at",
  "\\.fp-selected-price \\.fp-unit",
  "\\.fp-detail",
  "\\.fp-detail dt",
  "\\.fp-detail dd",
  "\\.fp-detail \\.absent",
  "\\.fp-pills",
  "\\.fp-pill",
  "\\.fp-pill-unplaced",
  "\\.fp-pill-inferred",
  "\\.fp-pill-next",
  "\\.fp-pill-caption",
  "\\.fp-list",
  "\\.fp-list ul",
  "\\.fp-row",
  "\\.fp-row\\.is-filled",
  "\\.fp-row\\.is-next",
  "\\.fp-row\\.is-unplaced",
  "\\.fp-row\\.is-unplaced \\.fp-row-price",
  "\\.fp-row\\.is-selected",
  "\\.fp-row:focus-visible",
  "\\.fp-row-index",
  "\\.fp-row-figures",
  "\\.fp-row-price",
  "\\.fp-row-size",
  "\\.fp-row-at",
  "\\.fp-row-state",
  "\\.fp-row-status",
  "\\.fp-row-status::first-letter",
  "\\.fp-row-substatus",
  "\\.fp-row\\.is-filled \\.fp-row-status",
  "\\.fp-row\\.is-next \\.fp-row-status",
  "\\.fp-row\\.is-unplaced \\.fp-row-status",
  "\\.fp-row-quals",
  "\\.fp-orphans",
  "\\.fp-recorded",
  "\\.fp-recorded strong",
];

/**
 * The name prefixes this slice took, for the sweep the list above cannot do.
 *
 * Written as prefixes because the failure being guarded against is a rule REAPPEARING,
 * and a rule that reappears rarely comes back under exactly the selector that left — a
 * `.fp-row-note`, a `:hover` arm, a `.fp-pill-partial`.
 *
 * `\\.fp-pill` COVERS `\\.fp-pills` and that is the point of having no trailing character
 * class: the `s` is not a delimiter any more than the `-` in `.fp-row-price` is. Slice
 * 7's sweep is written the same way, and requiring a delimiter is what let a nested
 * `.fp-tile-label` arm pass it once.
 */
const OWNED_PREFIXES = [
  "\\.fp-torn",
  "\\.fp-unchecked",
  "\\.fp-warn",
  "\\.fp-selected",
  "\\.fp-unit",
  "\\.fp-detail",
  "\\.fp-pill",
  "\\.fp-list",
  "\\.fp-row",
  "\\.fp-orphans",
  "\\.fp-recorded",
];

/**
 * THE SURVIVOR LIST IS GONE, AND ITS ASSERTION WITH IT (spec #420 slice 9). It held the
 * half of this slice's claim that says nothing outside slice 8's list moved, and the only
 * thing left to hold it up was the chart. Slice 9 took the chart, so the list empties and
 * `styles-css-end-state.test.ts` asserts the stronger thing directly: the file has no rule
 * at all. An empty list asserting nothing is worse than no list.
 */

describe("the fill path ladder section's deletion", () => {
  it("has taken every selector slice 8 owns out of styles.css", () => {
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

  it("leaves the file with no container declared at all", () => {
    // The header's went in slice 7 and these two are the last: `fp-selected` and
    // `fp-list` are utilities on their cards now, and every `@[380px]/` variant in
    // `FillPath.tsx` answers to those and to nothing in this file.
    expect(UNCOMMENTED).not.toMatch(/container-type\s*:/);
    expect(UNCOMMENTED).not.toMatch(/container-name\s*:/);
    expect(UNCOMMENTED).not.toMatch(/\bcontainer\s*:/);
    expect(UNCOMMENTED).not.toMatch(/@container\b/);
  });

  it("selects `.absent` nowhere, six slices after deleting its rule", () => {
    // The claim the bare hook was kept alive for. Slice 2 deleted `.absent`'s own rule
    // and kept the NAME because three contextual rules still reached through it; this
    // slice deleted the last of them, so the name is not a join any more and the
    // primitive stopped writing it. Over the whole uncommented file rather than over the
    // selector list, because what is being asserted is that NO rule mentions it.
    expect(UNCOMMENTED).not.toMatch(/\.absent\b/);
  });

  it("keeps the file free of any selector that is not a class, an at-rule or :root", () => {
    // Slice 4's standing guard, carried forward over slice 6's walker.
    const openers = topLevelRules(UNCOMMENTED).map(([selector]) => selector);
    expect(openers.length).toBeGreaterThan(0);
    for (const opener of openers) {
      expect(opener).toMatch(/^[.@:]/);
    }
  });
});
