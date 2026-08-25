// @vitest-environment jsdom
/**
 * THE CRUMB'S MARKUP AND ITS SLOT — Seam D's fourth part, and the one primitive in
 * `@numisma/components` whose signature changed on the way across the boundary
 * (spec #432 §4.4, slice #437).
 *
 * The acceptance is that no page moved AND that the destination still type-checks
 * where it is written, on the three axes a call site can get wrong:
 *
 *   1. THE ELEMENT AND ITS CLASS. All five call sites render `<p><a>`. A `<div>`
 *      here would change the element and the class census on three pages at once,
 *      and look identical in every screenshot.
 *   2. THE PACKAGE'S CLASSES. The package owns the anchor's class attribute and
 *      hands it to the slot; it does not own the anchor. A slot that dropped the
 *      `className` it was handed would render an unstyled crumb that still has the
 *      right words in it.
 *   3. THE DESTINATION, which is now entirely the caller's. `to` left the package
 *      with the router, so what this file pins is that the crumb renders whatever
 *      the slot returns — including the direction. Two call sites point opposite
 *      ways and a crumb that overrode either would send the operator to one place.
 *
 * THERE IS NO ROUTER HERE ANY MORE, and its absence is the point rather than a
 * simplification. The previous version mounted a memory router because `Link` read
 * router context and threw without one; the package cannot import a router at all,
 * so a crumb that still needed one would not render in `apps/workbench` either.
 * The slot is what makes both true, and `<a href>` below is the same stub the
 * workbench fixture supplies.
 *
 * Every value below is authored. No product data and no route file is involved.
 */
import { describe, expect, it } from "vitest";
import type { ReactNode } from "react";

import { Crumb } from "./crumb";

import {
  classTokens as tokens,
  render,
  renderedClassNames,
} from "../testkit/render.testkit";

/**
 * Mount one crumb whose slot builds a plain anchor at `href`, and hand back both
 * the render result and the props the package passed into the slot.
 *
 * SYNCHRONOUS NOW. The awaited `findByRole` the router version needed is gone with
 * the router: nothing here resolves a route match, so the container holds the
 * crumb on the synchronous return.
 */
function renderCrumb(href: string, label: string) {
  const seen: { className: string; children: ReactNode }[] = [];
  const result = render(
    <Crumb
      renderLink={(props) => {
        seen.push(props);
        return (
          <a className={props.className} data-from-slot="" href={href}>
            {props.children}
          </a>
        );
      }}
    >
      {label}
    </Crumb>,
  );
  return { ...result, seen };
}

describe("Crumb", () => {
  it("renders the paragraph wrapping an anchor that all five call sites rendered", () => {
    const { container } = renderCrumb("/", "← Glance");
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("P");
    // The anchor is the crumb's only child element: the arrow rides inside the link, the
    // way every call site wrote it, not beside it.
    expect(root?.children).toHaveLength(1);
    expect(root?.firstElementChild?.tagName).toBe("A");
    expect(root?.textContent).toBe("← Glance");
  });

  it("carries `.crumb`, `.crumb a` and the hover state as utilities", () => {
    const { container } = renderCrumb("/", "← Glance");
    const root = container.firstElementChild!;
    const link = container.querySelector("a")!;

    // `m-0` is the whole of `.crumb`'s `margin: 0` and preflight is off, so dropping it
    // would let the UA's own paragraph margin push every crumb down the page.
    expect(tokens(root)).toContain("m-0");
    expect(tokens(root)).toContain("text-[0.9rem]");

    // Both colours are namespaced now: a package file may read no house name, and
    // `apps/web` aliases each onto the house colour the deleted `.crumb a` rule read.
    expect(tokens(link)).toContain("text-[var(--nms-muted-foreground)]");
    expect(tokens(link)).toContain("no-underline");
    // The hover state converts ONCE here because spec #403 pulled five call sites onto
    // this primitive first. It is a class rather than a rule now, so it is assertable.
    expect(tokens(link)).toContain("hover:text-[var(--nms-foreground)]");

    expect([...renderedClassNames(root)]).not.toContain("crumb");
  });

  // THE NEW CASE, and the wave's only one (spec #432 §6). The two above would both
  // pass against a package that still built its own anchor, which is exactly what it
  // may no longer do: the workbench has no router and `@tanstack/react-router` is not
  // a dependency of `@numisma/components`.
  it("renders the caller's anchor, through the slot, with the package's classes", () => {
    const { container, seen } = renderCrumb("/", "← Glance");
    const link = container.querySelector("a")!;

    // The rendered anchor is the element the SLOT built. `data-from-slot` is not a
    // thing the package could have emitted, so an anchor without it is an anchor the
    // package made for itself.
    expect(link.hasAttribute("data-from-slot")).toBe(true);

    // Called once, with the class string the package owns and the children the caller
    // passed — the whole of the slot's contract, and nothing about navigation in it.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.className).toBe(
      "text-[var(--nms-muted-foreground)] no-underline hover:text-[var(--nms-foreground)]",
    );
    expect(seen[0]?.children).toBe("← Glance");
    // What the slot was handed is what the anchor wears: a call site that dropped the
    // class would render the words with none of the paint.
    expect(link.getAttribute("class")).toBe(seen[0]?.className);
  });

  // Two call sites, two directions, one case each. The ladder's crumb goes UP to the
  // glance; the big picture's goes DOWN from it, which is why the destination could
  // never live in the primitive — the slot hands out a class name and children, and
  // everything about where the link goes stays at the call site.
  it("points at the destination the slot built, going up", () => {
    const { container } = renderCrumb("/", "← Glance");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/");
  });

  it("points at the destination the slot built, going down", () => {
    const { container } = renderCrumb("/big-picture", "Big picture →");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/big-picture");
    // The glyph is the caller's (see the primitive's header): nothing here derives it
    // from the destination, so a crumb pointing down still reads as pointing down.
    expect(container.querySelector("a")?.textContent).toBe("Big picture →");
  });
});
