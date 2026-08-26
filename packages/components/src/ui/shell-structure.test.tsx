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

import { classTokens as tokens, render } from "../testkit/render.testkit";
import { Shell } from "./shell";

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
});
