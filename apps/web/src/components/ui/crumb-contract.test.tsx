// @vitest-environment jsdom
/**
 * THE CRUMB'S MARKUP AND ITS DESTINATION — Seam D's fourth part, and the only primitive
 * in this increment that changed a SIGNATURE rather than only moving markup.
 *
 * S5's acceptance is that `big-picture.tsx`'s inline crumb is gone AND its rendered
 * markup is unchanged. The first clause is visible in a diff. The second is what this
 * file holds, on the two axes a call site can get wrong:
 *
 *   1. THE ELEMENT AND ITS CLASS. All four call sites rendered `<p class="crumb"><a>`.
 *      A `<div>` here would change the element and the class census on four pages at
 *      once, and look identical in every screenshot.
 *   2. THE DESTINATION. The route-local version hard-coded `to="/"`; this one takes it as
 *      a required prop, precisely because the `/big-picture` crumb points the other way.
 *      A component that ignored `to` would render four crumbs that all look right and
 *      send the operator to one place.
 *
 * IT MOUNTS UNDER A MEMORY ROUTER, because `Link` reads router context and throws without
 * one. A memory history is the honest substitute: the link is a real `Link` resolving a
 * real `to` against a real router, so `href` is what the router computed rather than what
 * a stub echoed back. The route tree here is authored for the test and is deliberately
 * not the app's — this is a primitive's contract, not a routing assertion.
 *
 * Every value below is authored. No product data and no route file is involved.
 */
import { describe, expect, it } from "vitest";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";

import {
  classTokens as tokens,
  render,
  renderedClassNames,
  screen,
} from "../../render.testkit.tsx";
import { Crumb } from "./Crumb.tsx";

/**
 * Mount one crumb at the top of a throwaway router and hand back its container.
 *
 * AWAITED, because a TanStack router resolves its first match asynchronously: the
 * container is empty on the synchronous return and every assertion below would read
 * `undefined` off an unmounted tree. One crumb per case, so the awaited link is
 * unambiguously this case's.
 */
async function renderCrumb(to: string, label: string) {
  const rootRoute = createRootRoute({
    component: () => <Crumb to={to}>{label}</Crumb>,
  });
  const router = createRouter({
    routeTree: rootRoute,
    // THE HISTORY SITS SOMEWHERE ELSE, deliberately. `Link` adds its own `active` class
    // when the current location matches `to`, and a crumb links AWAY from the page that
    // renders it — all four call sites point at a route the reader is not on. Starting
    // the history on the crumb's own destination would census a class no call site emits.
    history: createMemoryHistory({ initialEntries: ["/elsewhere"] }),
  });
  // The router's own type is registered against the app's route tree; this authored tree
  // is not that tree, which is the one place a test-local router has to say so.
  const result = render(<RouterProvider router={router as never} />);
  await screen.findByRole("link");
  return result;
}

describe("Crumb", () => {
  it("renders the paragraph wrapping an anchor that all four call sites rendered", async () => {
    const { container } = await renderCrumb("/", "← Glance");
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("P");
    // The anchor is the crumb's only child element: the arrow rides inside the link, the
    // way every call site wrote it, not beside it.
    expect(root?.children).toHaveLength(1);
    expect(root?.firstElementChild?.tagName).toBe("A");
    expect(root?.textContent).toBe("← Glance");
  });

  it("carries `.crumb`, `.crumb a` and the hover state as utilities", async () => {
    const { container } = await renderCrumb("/", "← Glance");
    const root = container.firstElementChild!;
    const link = container.querySelector("a")!;

    // `m-0` is the whole of `.crumb`'s `margin: 0` and preflight is off, so dropping it
    // would let the UA's own paragraph margin push every crumb down the page.
    expect(tokens(root)).toContain("m-0");
    expect(tokens(root)).toContain("text-[0.9rem]");

    expect(tokens(link)).toContain("text-[var(--muted)]");
    expect(tokens(link)).toContain("no-underline");
    // The hover state converts ONCE here because spec #403 pulled four call sites onto
    // this primitive first. It is a class rather than a rule now, so it is assertable.
    expect(tokens(link)).toContain("hover:text-[var(--text)]");

    expect([...renderedClassNames(root)]).not.toContain("crumb");
  });

  // Two call sites, two directions, one case each. The ladder's crumb goes UP to the
  // glance; the big picture's goes DOWN from it, which is why the destination could
  // never be implicit — a primitive that ignored `to` passes one of these and fails the
  // other.
  it("points at the destination it was handed, going up", async () => {
    const { container } = await renderCrumb("/", "← Glance");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/");
  });

  it("points at the destination it was handed, going down", async () => {
    const { container } = await renderCrumb("/big-picture", "Big picture →");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("/big-picture");
    // The glyph is the caller's (see the primitive's header): nothing here derives it
    // from the destination, so a crumb pointing down still reads as pointing down.
    expect(container.querySelector("a")?.textContent).toBe("Big picture →");
  });
});
