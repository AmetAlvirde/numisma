// @vitest-environment jsdom
/**
 * THE FILL PATH'S CARD SHELL, PINNED ACROSS THE PRIMITIVE SWAP (spec #403, S6).
 *
 * S6 rewrites this file's five `<section className="card…">` openers into `Card` and
 * their headings into `Card.Title`. That conversion has exactly two ways to go wrong
 * silently, and both are invisible in a screenshot:
 *
 *   1. THE HEADING LEVEL. `CardTitle` defaults to `2`, and the fill path's header is one
 *      of only two cards in the layer whose heading is its page's `<h1>`. Forgetting
 *      `level={1}` renders identically for a sighted reader and turns the page into a
 *      document with no title for everything that navigates by headings.
 *   2. THE CLASS SET. `Card` composes `card` with what the caller passes, so a caller
 *      that passes `card fp-header` emits `card card fp-header` and a caller that drops
 *      a word emits a card the stylesheet does not recognise. `styles.css` is required
 *      to be byte-identical across this whole increment, which makes the class strings
 *      the contract rather than an implementation detail.
 *
 * This is a CHARACTERIZATION test: it was written green against the pre-swap markup, and
 * its job is to still be green afterwards. That is the whole oracle for a
 * behavior-preserving conversion — a red-first test here would have to assert markup
 * nobody wants changed.
 *
 * The fixture is authored. `started-ladder.fixtures.ts` is hand-written and its own tests
 * say so; no ledger output has been near this file.
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "../render.testkit.tsx";
import { FillPathCards } from "./FillPath.tsx";
import { composeFillPathPage } from "../ladder/fill-path-view.ts";
import { ladderFixture } from "../ladder/started-ladder.fixtures.ts";

/** The widest fixture: filled rungs, waiting rungs and a live spot, so every card draws. */
function partlyWalkedView() {
  const fixture = ladderFixture("partly-walked");
  if (fixture === undefined) throw new Error("fixture `partly-walked` is gone");
  const page = composeFillPathPage(fixture.anchor, fixture.planId, fixture.spot);
  if (page.status !== "ok") {
    throw new Error(`fixture composed to \`${page.status}\`, not a page`);
  }
  return page.view;
}

describe("the fill path's card shell", () => {
  it("titles the page with an `h1` and every section with an `h2`", () => {
    const view = partlyWalkedView();
    const { container } = render(<FillPathCards view={view} />);

    // The page heading, by level rather than by lookup: `getByRole` with `level` is the
    // query that fails when a card silently drops to the primitive's default of 2.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(view.title);
    expect(container.querySelectorAll("h1")).toHaveLength(1);

    const sectionHeadings = [...container.querySelectorAll("h2")].map(
      (heading) => heading.textContent,
    );
    // The panel opens on the NEXT rung, not on the first one, so the expectation is
    // derived from the view rather than counted off the fixture by hand.
    const opensOn = view.rungs.find((rung) => rung.isNext);
    expect(opensOn).toBeDefined();
    expect(sectionHeadings).toEqual([
      "Price Drop Path",
      `Rung ${opensOn?.ladderIndex} of ${view.rungs.length}next`,
      "Rungs",
    ]);
  });

  it("emits the same four card class strings, once each, on `section` elements", () => {
    const { container } = render(<FillPathCards view={partlyWalkedView()} />);

    const sections = [...container.querySelectorAll("section")].map(
      (section) => section.className,
    );
    expect(sections).toEqual([
      "card fp-header",
      "card fp-chart-card",
      "card fp-selected",
      "card fp-list",
    ]);
  });

  it("keeps the selected-rung panel's live region on the card element itself", () => {
    // `aria-live` is announced from the element that carries it, so it cannot move to a
    // child without changing what a screen reader reads when selection changes. This is
    // the one card whose element is more than `card` plus a class string.
    const { container } = render(<FillPathCards view={partlyWalkedView()} />);

    const panel = container.querySelector(".fp-selected");
    expect(panel?.tagName).toBe("SECTION");
    expect(panel?.getAttribute("aria-live")).toBe("polite");
  });
});
