import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE FILL PATH'S HEADER SECTION IS GONE FROM `styles.css` (spec #420 slice 7, gate
 * line 2) — the longest section in the file, and the first of three that share one
 * component.
 *
 * THREE CLAIMS, ONE FILE.
 *
 * The first is the ordinary one: every selector §4.3 gives slice 7 is gone, and
 * `fill-path-cards-structure.test.tsx` asserts from the other end that the elements
 * carry those declarations as utilities.
 *
 * The second was what made this slice's mixed state safe rather than merely tolerated —
 * the ladder and the chart still had rules here then, and what could not survive was a
 * rule reaching an element THIS slice converted. The mixed state is over (slice 9 emptied
 * the file) and the claim outlives it: a rule REAPPEARING under one of these names would
 * be an unlayered declaration beating the utility that replaced it, with nothing else in
 * the suite red. A prefix sweep is the instrument, because the section did not own a tidy
 * namespace — `.fp-tile-label` was rendered by the CHART card's inspect label too, and a
 * surviving rule under any of these names would be an unlayered declaration beating the
 * utility that replaced it, with nothing else in the suite red.
 *
 * The third is the container. `container: fp-header / inline-size` was a shorthand, and
 * a shorthand re-declared anywhere in this unlayered file would answer both deleted
 * `@container fp-header` blocks' replacements from two places at once. The name may not
 * appear in a container declaration in this file in any form.
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
 * forward unchanged.
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
 * The selectors slice 7 owns (spec #420 §4.3), spelled exactly as the file spelled them.
 *
 * The grouped selector lists are listed member by member, because a rule left standing
 * with one arm of its list removed is still a rule on an element this slice converted —
 * which is precisely how a two-selector deletion goes half-done.
 *
 * Matched at column zero, which is where every top-level rule in that file starts, so a
 * mention inside a comment or a nested arm cannot pass for the rule. The escaping is by
 * hand for the reason `base-layer.test.ts` does it by hand: a generated `\b` in the
 * middle of a class name is a word boundary, not a literal.
 */
const OWNED_SELECTORS = [
  "\\.fp-header",
  "\\.fp-header h1",
  "\\.fp-header-head",
  "\\.fp-header-id",
  "\\.fp-badge",
  "\\.fp-badge-active",
  "\\.fp-badge-unreadable",
  "\\.fp-spot",
  "\\.fp-tile",
  "\\.fp-spot > \\.fp-tile-label",
  "\\.fp-tile > \\.fp-tile-label",
  "\\.fp-spot > \\.fp-tile-value",
  "\\.fp-spot > \\.fp-spot-value",
  "\\.fp-tile > \\.fp-tile-value",
  "\\.fp-spot-value",
  "\\.fp-spot-note",
  "\\.fp-spot \\.absent",
  "\\.fp-tile \\.absent",
  "\\.fp-tiles",
  "\\.fp-tile-label",
  "\\.fp-tile-value",
  "\\.fp-progress",
  "\\.fp-progress-track",
  "\\.fp-progress-fill",
  "\\.fp-progress p",
  "\\.fp-waiting",
  "\\.fp-waiting > \\.fp-tile-label",
  "\\.fp-waiting > \\.fp-tile-value",
  "\\.fp-waiting-sub",
  "\\.fp-expected",
  "\\.fp-expected \\.fp-tiles",
  "\\.fp-expected-value",
  "\\.fp-hero",
  "\\.fp-hero-value",
  "\\.fp-tiles-quiet \\.fp-tile-value",
];

/**
 * The name prefixes this slice took, for the sweep the list above cannot do.
 *
 * Written as prefixes because the failure being guarded against is a rule REAPPEARING,
 * and a rule that reappears rarely comes back under exactly the selector that left —
 * `.fp-tile-note`, `.fp-header-sub`, a `:hover` arm. Every name here is one this slice
 * removed from the markup as well as from the stylesheet, so any rule under any of them
 * has no carrier and is either dead or a regression.
 */
const OWNED_PREFIXES = [
  "\\.fp-header",
  "\\.fp-badge",
  "\\.fp-spot",
  "\\.fp-tile",
  "\\.fp-progress",
  "\\.fp-waiting",
  "\\.fp-expected",
  "\\.fp-hero",
];

/**
 * THE SURVIVOR LIST IS GONE, AND ITS ASSERTION WITH IT (spec #420 slice 9).
 *
 * It held the other half of this slice's claim while the file still had rules: the ladder
 * and the chart were still there, and a green suite with THEM missing would have meant
 * slice 7 took two later slices' work along with its own. The list shrank as slice 8
 * worked down the ladder and emptied when slice 9 took the chart, which is the end state
 * `styles-css-end-state.test.ts` now asserts directly — no rule in the file at all. An
 * empty list asserting nothing is worse than no list, so both are deleted rather than
 * kept as a vestige.
 */

describe("the fill path header section's deletion", () => {
  it("has taken every selector slice 7 owns out of styles.css", () => {
    for (const selector of OWNED_SELECTORS) {
      expect(STYLES_CSS).not.toMatch(new RegExp(`^${selector}\\s*[,{]`, "m"));
    }
  });

  it("leaves no rule anywhere in the file under any name this slice took", () => {
    // Wider than the list above and deliberately so, and it looks INSIDE at-rule bodies:
    // both deleted `@container fp-header` blocks were nested arms, and a nested arm is
    // where a half-finished deletion hides. `topLevelRules` hands back an at-rule's body
    // whole, so the sweep sees the arm and the top-level rule the same way.
    // NO TRAILING CHARACTER CLASS, and that is the whole point of calling these
    // prefixes. Requiring one measured green against a nested `.fp-tile-label` arm — the
    // `-` after `.fp-tile` is not a delimiter — which is exactly the reappearance this
    // sweep exists to see. A leading delimiter is still required, so `.fp-chart-header`
    // is not read as `.fp-header`.
    const nameInBody = new RegExp(`(^|[\\s,>+~])(${OWNED_PREFIXES.join("|")})`);
    for (const [selector, body] of topLevelRules(UNCOMMENTED)) {
      for (const prefix of OWNED_PREFIXES) {
        expect(selector).not.toMatch(new RegExp(`(^|[\\s,>+~])${prefix}`));
      }
      if (selector.startsWith("@")) expect(body).not.toMatch(nameInBody);
    }
  });

  it("leaves the `fp-header` container declared nowhere in the file", () => {
    // Slice 5 took the file's last longhand container declaration, so the two longhand
    // properties are still absent outright; what is new here is that ONE of the three
    // surviving shorthand containers has gone. `fp-selected` and `fp-list` are slice 8's
    // and are deliberately still here — asserting their absence would fail on a file
    // behaving exactly as intended.
    expect(UNCOMMENTED).not.toMatch(/container-type\s*:/);
    expect(UNCOMMENTED).not.toMatch(/container-name\s*:/);
    expect(UNCOMMENTED).not.toMatch(/container\s*:[^;}]*\bfp-header\b/);
    expect(UNCOMMENTED).not.toMatch(/@container\s+fp-header\b/);
  });

  it("keeps the file free of any selector that is not a class, an at-rule or :root", () => {
    // Slice 4's guard, carried forward over slice 6's walker, so no two guards in this
    // suite can disagree about where a rule starts.
    const openers = topLevelRules(UNCOMMENTED).map(([selector]) => selector);
    expect(openers.length).toBeGreaterThan(0);
    for (const opener of openers) {
      expect(opener).toMatch(/^[.@:]/);
    }
  });
});
