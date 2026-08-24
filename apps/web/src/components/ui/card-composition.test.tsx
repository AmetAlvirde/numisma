// @vitest-environment jsdom
/**
 * `Card`'s CONTRACT — the tier-1 compound, and the two guarantees it buys.
 *
 * ── IT IS A `<section>`, AND ONLY A `<section>` ──────────────────────────────────────
 * Twelve elements in this layer carry the `card` class; three of them are not cards —
 * the fill path's two `<p className="card fp-warn…">` warnings and its `role="alert"`
 * banner `<div>` — and neither is the login `<form className="card auth-card">`. A shared
 * class is not a shared component, and a polymorphic `as` prop to absorb four one-off
 * elements would buy a knob and lose exactly the guarantee asserted here.
 *
 * ── THE PARTS ARE THE SAME FUNCTION BY EITHER NAME ───────────────────────────────────
 * Spec #403's D4 export shape: parts attached as plain properties AND named-exported.
 * The namespace is the call-site vocabulary; the named exports are what per-part tests
 * and the later workbench fixtures import directly. Asserting identity is what stops the
 * two spellings drifting into two components with one comment between them.
 *
 * Heading level is asserted rather than eyeballed because it is an accessibility fact and
 * this primitive is now the single thing that can get it wrong for every card.
 *
 * Everything below is authored. No ledger output has been near this file.
 */
import { describe, expect, it } from "vitest";

import { classTokens as tokens, render, screen } from "../../render.testkit.tsx";
import { Card, CARD_SURFACE, CardTitle } from "./Card.tsx";

describe("Card", () => {
  it("attaches its parts under both names, as one function each", () => {
    expect(Card.Title).toBe(CardTitle);
  });

  it("renders a section carrying the surface and whatever the caller passes through", () => {
    const { container } = render(<Card className="glance">body</Card>);

    const root = container.firstElementChild;
    expect(root?.tagName).toBe("SECTION");
    expect(root?.className).toBe(`${CARD_SURFACE} glance`);
    expect(root?.textContent).toBe("body");
  });

  it("renders the bare surface when the caller passes no extra classes", () => {
    // No trailing space, no `undefined` in the class attribute.
    const { container } = render(<Card>body</Card>);
    expect(container.firstElementChild?.className).toBe(CARD_SURFACE);
  });

  it("spells `.card`'s four declarations, and no longer writes the class name", () => {
    // The one place in the app that pins the surface's utilities individually. Every
    // other adopter asserts `CARD_SURFACE` by reference, which is the point of exporting
    // it — this test is what stops the constant from being redefined into something else.
    const { container } = render(<Card>body</Card>);
    const root = container.firstElementChild!;

    for (const utility of [
      "bg-[var(--card)]",
      "border",
      "border-[var(--line)]",
      // 12px and 16px, an exact match for Tailwind's `--radius-xl` and `--spacing`
      // scale. `rounded-md` would have compiled and painted the package's 8px control
      // radius, which `tailwind.css` remaps.
      "rounded-xl",
      "p-4",
    ]) {
      expect(tokens(root)).toContain(utility);
    }
    expect(tokens(root)).not.toContain("card");
  });

  it("titles at level 2 by default and at level 1 only when asked", () => {
    render(
      <Card>
        <CardTitle>a section heading</CardTitle>
        <Card.Title level={1}>the page heading</Card.Title>
      </Card>,
    );

    expect(screen.getByText("a section heading").tagName).toBe("H2");
    expect(screen.getByText("the page heading").tagName).toBe("H1");
  });
});
