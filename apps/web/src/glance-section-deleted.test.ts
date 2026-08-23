import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE GLANCE SECTION IS GONE FROM `styles.css` — AND WITH IT THE LAST DECLARATION OF THE
 * SHARED CONTAINER NAME (spec #420 slice 5, gate line 2).
 *
 * TWO CLAIMS, ONE FILE. The first is the ordinary one: the four selectors this slice owns
 * are gone, and `glance-card-structure.test.tsx` asserts from the other end that the
 * elements carry the declarations as utilities.
 *
 * The second is the one this slice exists to get right. `.glance` declared
 * `container-name: glance metrics-card`, TWO names, and the second was the only thing in
 * the repo still supplying `metrics-card` to this card. Slice 3 converted the metrics
 * list's breakpoint onto `@[380px]/metrics-card:` variants and deliberately left the
 * container where it was. So deleting this rule without carrying BOTH names onto the
 * element strands the glance card's metrics list at its narrow layout — at every width,
 * silently, with no rule missing and no test red. The assertions below hold the text half:
 * the rule is gone from the file, and no `@container` block in the file re-declares the
 * breakpoint the variants now answer. The value half is Chrome's, and only Chrome's: this
 * file cannot see which names a class resolves.
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
 * The selectors slice 5 owns (spec #420 §4.3), spelled exactly as the file spelled them.
 *
 * Matched at column zero, which is where every top-level rule in that file starts, so a
 * mention inside a comment or a nested arm cannot pass for the rule. The escaping is by
 * hand for the reason `base-layer.test.ts` does it by hand: a generated `\b` in the middle
 * of a class name is a word boundary, not a literal.
 */
const OWNED_SELECTORS = ["\\.glance", "\\.verdict", "\\.verdict-no", "\\.verdict-yes"];

describe("the glance section's deletion", () => {
  it("has taken every selector slice 5 owns out of styles.css", () => {
    for (const selector of OWNED_SELECTORS) {
      expect(STYLES_CSS).not.toMatch(new RegExp(`^${selector}\\s*[,{]`, "m"));
    }
  });

  it("leaves neither container name declared anywhere in the file", () => {
    // `.glance` was the file's last LONGHAND container declaration — slice 3 took
    // `.summary`, the only other one — so the two longhand properties should now be
    // absent outright. The fill path's three shorthand containers (`fp-header`,
    // `fp-selected`, `fp-list`) are slices 7 and 8's and are deliberately still here;
    // what may not survive is either of THIS card's names, in any form. A second
    // declaration of `metrics-card` in this unlayered file would beat the utility on the
    // element and answer the list's variants from two places at once.
    expect(UNCOMMENTED).not.toMatch(/container-type\s*:/);
    expect(UNCOMMENTED).not.toMatch(/container-name\s*:/);
    expect(UNCOMMENTED).not.toMatch(/container\s*:[^;}]*\bglance\b/);
    expect(UNCOMMENTED).not.toMatch(/container\s*:[^;}]*\bmetrics-card\b/);
  });

  it("keeps the file free of any selector that is not a class, an at-rule or :root", () => {
    // Slice 4's guard, carried forward. Walked with a depth counter rather than matched at
    // column zero: a nested rule's own closing brace sits at column zero too, and a regex
    // would read the text after it as a selector.
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
