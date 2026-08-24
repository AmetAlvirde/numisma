import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE DCA SECTION IS GONE FROM `styles.css` — AND WITH IT THE FILE'S ONLY INTERACTIVE
 * STATE RULE (spec #420 slice 6, gate line 2).
 *
 * TWO CLAIMS, ONE FILE. The first is the ordinary one: the nine selectors this slice
 * owns are gone, and `dca-card-structure.test.tsx` asserts from the other end that the
 * elements carry the declarations as utilities.
 *
 * The second is the one this slice has to get right and text can only half-see. The
 * deleted pair `a:hover, a:focus-visible` declared TEXT-DECORATION and nothing else; the
 * keyboard OUTLINE on that link was never in this file at all — it is the user agent's,
 * live because preflight is off. So the risk here is not a rule that fails to move, it is
 * a utility that suppresses something this file never declared: any `outline` reset
 * reaching that link removes a focus ring no test in this repo would miss. What the text
 * channel can hold is that no rule in this file paints or removes an outline on it, which
 * is asserted below. Whether the ring survives is a keyboard question and Chrome's alone
 * (spec #420 Seam F).
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
 * The selectors slice 6 owns (spec #420 §4.3), spelled exactly as the file spelled them.
 *
 * `a:hover` rode in a two-selector list with `a:focus-visible` and is listed beside it:
 * §4.3 names only the second, and a rule left standing with its hover arm alone would
 * still be an unlayered declaration on this link beating the variant that replaced it.
 *
 * Matched at column zero, which is where every top-level rule in that file starts, so a
 * mention inside a comment or a nested arm cannot pass for the rule. The escaping is by
 * hand for the reason `base-layer.test.ts` does it by hand: a generated `\b` in the
 * middle of a class name is a word boundary, not a literal.
 */
/**
 * EVERY TOP-LEVEL RULE IN THE FILE, as `[selector, body]`.
 *
 * Walked with a depth counter rather than matched at column zero: a nested rule's own
 * closing brace sits at column zero too, and a regex would read the text after it as a
 * selector. An at-rule's body comes back whole, which is what both callers want — a
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

const OWNED_SELECTORS = [
  "\\.dca-plan",
  "\\.dca-head",
  "\\.dca-state",
  "\\.dca-state-active",
  "\\.dca-state-unreadable",
  "\\.dca-alert",
  "\\.dca-alert a",
  "\\.dca-alert a:hover",
  "\\.dca-alert a:focus-visible",
  "\\.dca-alert-warn",
];

describe("the DCA section's deletion", () => {
  it("has taken every selector slice 6 owns out of styles.css", () => {
    for (const selector of OWNED_SELECTORS) {
      expect(STYLES_CSS).not.toMatch(new RegExp(`^${selector}\\s*[,{]`, "m"));
    }
  });

  it("leaves the file with no rule of its own on this card at all", () => {
    // Wider than the list above and deliberately so: the card's root still carries a
    // bare `dca` hook that never had a rule, and the state word's class was assembled
    // from a template whose two other arms (`pending`, `ended`) never had one either. A
    // rule reappearing under any of those names is the same mistake as one of the nine
    // surviving, and only a prefix sweep sees it.
    expect(UNCOMMENTED).not.toMatch(/^\.dca/m);
  });

  it("leaves every outline declaration in the file on a ladder row and nowhere else", () => {
    // The deleted `:focus-visible` rule UNDERLINED; it never touched `outline`. The
    // keyboard ring on that link is the user agent's, live because preflight is off, and
    // this file's job is to keep its hands off it. One rule here declares an outline —
    // `.fp-row:focus-visible`, slice 8's, which rings a selected rung on purpose — and
    // that is the whole of it. A second one arriving under a broader selector would beat
    // every cascade layer in the app and could take the ring off this link with no rule
    // missing and nothing red. Asserted as a scope, not as an absence, because the
    // ladder's own ring is legitimate and must not be read as a regression.
    for (const [selector, body] of topLevelRules(UNCOMMENTED)) {
      if (!/outline\s*[:-]/.test(body)) continue;
      expect(selector).toMatch(/^\.fp-/);
    }
  });

  it("keeps the file free of any selector that is not a class, an at-rule or :root", () => {
    // Slice 4's guard, carried forward — over the same walker the outline scope uses, so
    // the two cannot disagree about where a rule starts.
    const openers = topLevelRules(UNCOMMENTED).map(([selector]) => selector);
    expect(openers.length).toBeGreaterThan(0);
    for (const opener of openers) {
      expect(opener).toMatch(/^[.@:]/);
    }
  });
});
