import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * THE SUMMARY SECTION IS GONE FROM `styles.css`, AND WITH IT THE FILE'S LAST COLOUR
 * LITERAL (spec #420 slice 3, gate lines 2 and the slice's own file-wide claim).
 *
 * TWO DIFFERENT CLAIMS, ONE FILE, and they are here together because they became true
 * in the same commit. The first is this slice's: the sixteen selectors it owns are gone,
 * and the elements that referenced them carry the declarations as utilities — which is
 * what `summary-card-structure.test.tsx` and the two carrier tests assert, from the
 * other end. The second is the whole migration's: `.badge-ok` and `.badge-warn` each
 * painted `color: #fff` from a literal, `.notice code`'s `#000` went in slice 2 and
 * `.auth-card button`'s `#3b6cf0` in slice 1, so deleting these two is the moment the
 * file-wide statement stops being an aspiration.
 *
 * WHY THE `:root` BLOCKS ARE CUT OUT RATHER THAN EXEMPTED BY LINE. They are where colour
 * is DEFINED — the palette and the twelve `--nms-*` aliases — and they are the file's
 * terminal state. Everything else is a rule, and a rule that spells a colour has
 * defined one somewhere it cannot be re-themed from. The distinction is the whole
 * convention, so it is the axis the test cuts on.
 *
 * SCANNED, NEVER PARSED. This asserts what the FILE says; whether the utilities that
 * replaced it win the cascade is Chrome's question and not answerable from text. The two
 * channels are deliberately separate (spec #420 Seam F).
 *
 * Every value below is authored from the deleted rules. Nothing here reads product data.
 */

const SRC = dirname(fileURLToPath(import.meta.url));
const STYLES_CSS = readFileSync(join(SRC, "styles.css"), "utf8");

/**
 * The selectors slice 3 owns (spec #420 §4.3), spelled exactly as the file spelled them.
 *
 * Matched at column zero, which is where every top-level rule in that file starts, so a
 * mention inside a comment or a nested `@container` arm cannot pass for the rule. The
 * escaping is by hand for the same reason `base-layer.test.ts` does it by hand: a
 * generated `\b` in the middle of a class name is a word boundary, not a literal.
 */
const OWNED_SELECTORS = [
  "\\.summary",
  "\\.summary-head",
  "\\.summary-head > div",
  "\\.summary-head \\.badge",
  "\\.badge",
  "\\.badge-ok",
  "\\.badge-warn",
  "\\.metrics",
  "\\.metrics > div",
  "\\.metrics dt",
  "\\.metrics dd",
  "\\.metrics dd \\.absent",
  "\\.metrics \\.muted",
  "\\.pos",
  "\\.neg",
];

/** CSS comments, gone — they quote selectors and colours and mean neither. */
const uncommented = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, "");

/**
 * The file with both `:root` blocks cut out.
 *
 * Brace counting rather than `[^}]*` for the reason `base-layer.test.ts` counts: the
 * lazy form stops at the first inner close, and a block that grew a nested rule would
 * leave its tail in the remainder and read as a rule spelling a colour.
 */
function outsideRootBlocks(css: string): string {
  let remainder = "";
  let index = 0;
  let blocks = 0;
  while (index < css.length) {
    const open = css.indexOf(":root", index);
    if (open === -1) break;
    const brace = css.indexOf("{", open);
    remainder += css.slice(index, open);
    let depth = 1;
    let scan = brace + 1;
    while (scan < css.length && depth > 0) {
      if (css[scan] === "{") depth += 1;
      if (css[scan] === "}") depth -= 1;
      scan += 1;
    }
    expect(depth).toBe(0);
    index = scan;
    blocks += 1;
  }
  // The terminal state is exactly two, and a third would be a new place to define a
  // colour that this test would then walk straight past.
  expect(blocks).toBe(2);
  return remainder + css.slice(index);
}

/**
 * A colour written out rather than read from a token: hex in any of its four lengths,
 * the four functional notations, and the two keywords the file could plausibly reach
 * for.
 *
 * `color-mix()` IS NOT ON THE LIST AND MUST NOT BE, though it is a colour function and
 * the file still holds four of them. Every one of them mixes `var(--pos)` or `var(--now)`
 * into `var(--bg)` or `var(--line)`, which is a token READ — the tint is derived from
 * the palette and re-themes with it. What this test is about is a colour DEFINED outside
 * the block that defines colour, and `rgb(59, 108, 240)` would be one where
 * `color-mix(in srgb, var(--pos) 12%, var(--bg))` is not.
 */
const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\s*\(|\b(?:white|black)\b/g;

describe("the summary section's deletion", () => {
  it("has taken every selector slice 3 owns out of styles.css", () => {
    for (const selector of OWNED_SELECTORS) {
      expect(STYLES_CSS).not.toMatch(new RegExp(`^${selector}\\s*[,{]`, "m"));
    }
  });

  it("has taken the shared 380px breakpoint's at-rule with them", () => {
    // The container NAME survives — the summary card and the glance card both still
    // query it, now through `@[380px]/metrics-card:` variants — but nothing in this
    // file may still declare the breakpoint, or the two would answer at once.
    expect(uncommented(STYLES_CSS)).not.toMatch(/@container\s+metrics-card/);
  });

  it("no longer needs the glance card to hold the shared name — slice 5 took it", () => {
    // This assertion used to read the other way round. `.summary` left the shared
    // `container-type` selector list in slice 3 and `.glance` stayed, because it was the
    // only thing still supplying `metrics-card` to the variants slice 3 had just written;
    // pinning it here is what stopped slice 3 from deleting it by tidiness. Slice 5 has
    // now moved that declaration onto the element as TWO classes that keep BOTH names, so
    // the pin is inverted rather than dropped: the rule is gone, and
    // `glance-section-deleted.test.ts` owns the deletion from here.
    expect(uncommented(STYLES_CSS)).not.toMatch(/^\.glance[\s,{]/m);
  });

  it("spells no colour literal outside the two :root blocks", () => {
    const hits = outsideRootBlocks(uncommented(STYLES_CSS)).match(COLOR_LITERAL);
    expect(hits ?? []).toEqual([]);
  });

  it("still defines the palette it reads from, inside those blocks", () => {
    // Guards the guard: a scanner that stopped finding the blocks would cut nothing,
    // find every definition, and report the strongest possible red — or cut the whole
    // file and report the strongest possible green. This pins the other direction.
    expect(uncommented(STYLES_CSS)).toMatch(/--pos:\s*#[0-9a-fA-F]{3,8}/);
    expect(uncommented(STYLES_CSS)).toMatch(/--neg:\s*#[0-9a-fA-F]{3,8}/);
  });
});
