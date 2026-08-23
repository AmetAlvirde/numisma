import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE TABLE SURFACE IS GONE FROM `styles.css`, AND SO IS THE LAST BARE-ELEMENT RULE
 * OUTSIDE `@layer base` (spec #420 slice 4, gate line 2).
 *
 * TWO CLAIMS, ONE FILE. The first is this slice's own: the seven selectors it owns are
 * gone, and the elements that referenced them carry the declarations as utilities —
 * which `section-table-structure.test.tsx` and `dca-card-structure.test.tsx` assert from
 * the other end. The second is Seam C's: `table`, `td` and `thead th` were the file's
 * remaining element selectors and they did NOT follow `*`, `body`, `h1` and `h2` into
 * `@layer base`, because they are table-surface rules with real elements to hang a
 * utility on. So `styles.css` now selects nothing but classes, and `tailwind.css`'s base
 * block is still the four `base-layer.test.ts` pins and no more.
 *
 * SCANNED, NEVER PARSED. This asserts what the FILE says. Whether the utilities that
 * replaced it win the cascade — and whether the table still pans at 320px, which is the
 * behaviour the deleted rules existed for — is Chrome's question and is not answerable
 * from text at all (spec #420 Seam F).
 *
 * Every value below is authored from the deleted rules. Nothing here reads product data.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const STYLES_CSS = readFileSync(join(SRC, "styles.css"), "utf8");

/** CSS comments, gone — they quote selectors and mean none of them. */
const uncommented = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

const UNCOMMENTED = uncommented(STYLES_CSS);

/**
 * The selectors slice 4 owns (spec #420 §4.3), spelled exactly as the file spelled them.
 *
 * `th` rode with `td` and `th.num` with `td.num` in a two-selector list, so the pairs
 * are listed as the file listed them: a rule that survived with only its `th` arm left
 * would still be an unlayered element rule beating every utility on this page.
 *
 * Matched at column zero, which is where every top-level rule in that file starts, so a
 * mention inside a comment or a nested arm cannot pass for the rule. The escaping is by
 * hand for the same reason `base-layer.test.ts` does it by hand: a generated `\b` in the
 * middle of a class name is a word boundary, not a literal.
 */
const OWNED_SELECTORS = [
  "\\.table-scroll",
  "table",
  "\\.table-scroll table",
  "th",
  "td",
  "th\\.num",
  "td\\.num",
  "thead th",
];

describe("the table section's deletion", () => {
  it("has taken every selector slice 4 owns out of styles.css", () => {
    for (const selector of OWNED_SELECTORS) {
      expect(STYLES_CSS).not.toMatch(new RegExp(`^${selector}\\s*[,{]`, "m"));
    }
  });

  it("has taken the scroller's 380px container query with it", () => {
    // The container NAME survives — both tables still reflow at a 380px SCROLLER width,
    // now through `@[380px]/table-scroll:` — but nothing in this file may still declare
    // the breakpoint, or the two would answer at once and the emitted order would pick.
    expect(UNCOMMENTED).not.toMatch(/@container\s+table-scroll/);
  });

  it("leaves no element selector at all behind, per Seam C", () => {
    // Every top-level selector left in the file starts with a `.`, an `@` or a `:`.
    // This is the mechanical form of "the bare-element rules are `@layer base`'s and the
    // table surface's rules are the elements' own"; anything else at column zero is a
    // rule that would beat Tailwind's whole cascade on a shared property.
    // Walked with a depth counter rather than matched at column zero: a nested rule's
    // own closing brace sits at column zero too, and a regex would read the text after
    // it as a selector. `summary-section-deleted.test.ts` counts braces for the same
    // reason.
    const openers: string[] = [];
    let depth = 0;
    let since = 0;
    for (let index = 0; index < UNCOMMENTED.length; index += 1) {
      const character = UNCOMMENTED[index];
      if (character === "{") {
        if (depth === 0) openers.push(UNCOMMENTED.slice(since, index).trim());
        depth += 1;
      } else if (character === "}") {
        depth -= 1;
        since = index + 1;
      }
    }
    expect(depth).toBe(0);
    expect(openers.length).toBeGreaterThan(0);
    for (const opener of openers) {
      expect(opener).toMatch(/^[.@:]/);
    }
  });
});
