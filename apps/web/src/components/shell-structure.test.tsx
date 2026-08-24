// @vitest-environment jsdom
/**
 * THE PAGE COLUMN, AFTER `.dashboard` (spec #420 slice 2, gate line 3).
 *
 * `Shell` is the one element on three routes that no card structure test renders, and
 * `.dashboard` was six declarations wide — a capped centred column with its own padding
 * and gap. Deleting the rule with no assertion behind the replacement would leave the
 * shape of every page in the app resting on nothing but review.
 *
 * WHY THE MARGIN PAIR IS ASSERTED SEPARATELY. `margin: 0 auto` set FOUR edges, and
 * preflight is off, so `mx-auto` on its own is not the same declaration: the UA's own
 * `main` margins would stand on the other two. It is the quietest way to fail this
 * conversion while every other assertion here stays green, so it gets its own line.
 *
 * Everything below is authored. No ledger output has been near this file.
 */
import { describe, expect, it } from "vitest";

import {
  classTokens as tokens,
  DELETED_IN_SLICE_2,
  render,
  renderedClassNames,
  styleSheetClassSelectors,
} from "../render.testkit.tsx";
import { Shell } from "./Shell.tsx";

describe("Shell", () => {
  it("still renders one `main` around whatever it is handed", () => {
    const { container } = render(<Shell>page</Shell>);

    expect(container.firstElementChild?.tagName).toBe("MAIN");
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.textContent).toBe("page");
  });

  it("carries `.dashboard`'s six declarations as utilities", () => {
    const { container } = render(<Shell>page</Shell>);
    const main = container.firstElementChild!;

    for (const utility of [
      "max-w-[760px]",
      "p-4",
      "flex",
      "flex-col",
      "gap-4",
    ]) {
      expect(tokens(main)).toContain(utility);
    }
  });

  it("zeroes the block margins the auto-centring left to the UA", () => {
    const { container } = render(<Shell>page</Shell>);
    const main = container.firstElementChild!;

    expect(tokens(main)).toContain("mx-auto");
    expect(tokens(main)).toContain("my-0");
  });

  it("writes none of slice 2's deleted class names", () => {
    const { container } = render(<Shell>page</Shell>);
    const rendered = renderedClassNames(container.firstElementChild!);

    for (const deleted of DELETED_IN_SLICE_2) {
      expect([...rendered]).not.toContain(deleted);
    }
  });
});

/**
 * THE TERMINAL ASSERTION (spec #420 Seam E, slice 9), on all five census successors and
 * the shell's.
 *
 * THE SET OF CLASS NAMES THIS SURFACE RENDERS, INTERSECTED WITH THE SET OF CLASS
 * SELECTORS LEFT IN `styles.css`, IS EMPTY. That is the mechanical proof that no house
 * rule survives WITH A CARRIER — the failure mode the nine deletion guards cannot see,
 * because each of them knows only the names its own slice took.
 *
 * IT COULD ONLY LAND HERE. Every slice but the last renders a class the file still
 * styles, on purpose: that is what a nine-slice migration through a shared stylesheet
 * looks like from the inside. The assertion is false by design for eight slices and true
 * for good afterwards.
 *
 * IT IS NOT A RESTATEMENT OF "THE FILE HAS NO RULES". `styles-css-end-state.test.ts` says
 * that about the file; this says something the file cannot know — that nothing RENDERED
 * reaches whatever is in it. A rule added back under a name no guard lists goes red here
 * the moment a component writes its class.
 */
describe("no rule left in styles.css reaches this surface", () => {
  it("renders no class name the stylesheet still selects", () => {
    const { container } = render(<Shell>page</Shell>);
    const styled = styleSheetClassSelectors();
    const survivors = [...renderedClassNames(container)].filter((name) => styled.has(name));

    expect(survivors).toEqual([]);
  });
});
