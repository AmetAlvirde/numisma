// @vitest-environment jsdom
/**
 * SEAM E — SELECTION, COORDINATED THROUGH CONTEXT (spec #403 S7, grill D3).
 *
 * The fill path is the one tier-2 compound in this layer: four sibling cards that
 * coordinate a single selection. Before this slice the state sat in `FillPathCards` and
 * was threaded back down in TWO prop shapes — an index pair for the chart, a key pair for
 * the rung list — with the index-to-key translation written into the parent's JSX. This
 * file is the oracle for the conversion that deleted that.
 *
 * WHAT IT ASSERTS IS THE ACCESSIBILITY CONTRACT, NOT THE WIRING. The wiring is an
 * implementation detail and a test that pins it would have to be rewritten by the next
 * refactor. What must survive verbatim is what a screen-reader or keyboard operator
 * experiences, which ADR-019 fixed when it declined a labelled, navigable chart:
 *
 *   1. Selecting a rung updates the `aria-live="polite"` panel and moves `aria-current`.
 *   2. A Tab walk down the rung list moves the selection WITH FOCUS, because the rows
 *      select on focus. That is the substitute route ADR-019 chose instead of the chart,
 *      so it is asserted with `user-event`'s real Tab rather than described in prose —
 *      `fireEvent.focus` would dispatch the event without moving `document.activeElement`
 *      and would pass against a component that had lost the keyboard path entirely.
 *   3. The chart subtree stays `aria-hidden` and unreachable THROUGHOUT the interaction,
 *      not merely on first paint. `fill-path-chart-a11y.test.tsx` pins the mounted state;
 *      what this adds is that selection does not open a hole in it.
 *
 * AND EACH PART MOUNTS ALONE. D4's export shape exists so a test can render one card
 * without its four siblings — needed here, needed again by the workbench. A part that only
 * works inside `FillPathCards` has not been decoupled, it has been renamed, so every part
 * is mounted by itself against the provider and nothing else.
 *
 * The fixture is authored: `started-ladder.fixtures.ts` is hand-written and its own tests
 * say so. No ledger output has been near this file.
 */
import { describe, expect, it } from "vitest";

import { render, userEvent, within } from "../render.testkit.tsx";
import {
  FillPath,
  FillPathCards,
  FillPathProvider,
} from "./FillPath.tsx";
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

/**
 * The tabbable selector, spelled the same way `fill-path-chart-a11y.test.tsx` spells it:
 * `[tabindex="-1"]` is excluded because a negative tabindex is programmatically focusable
 * and NOT reachable by keyboard, and it is the neutralization ADR-019 records as
 * load-bearing on the chart's own surface.
 */
const TABBABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** The live panel's heading — the sentence that has to follow the selection. */
function panelHeading(container: Element): string {
  const panel = container.querySelector(".fp-selected");
  if (panel === null) throw new Error("the selected-rung panel is not rendered");
  if (panel.getAttribute("aria-live") !== "polite") {
    throw new Error("the selected-rung panel stopped being a polite live region");
  }
  const heading = within(panel as HTMLElement).getByRole("heading");
  return heading.textContent ?? "";
}

/** Which rows claim `aria-current`. Exactly one, always — an ambiguous list is a defect. */
function currentRows(rows: readonly Element[]): number[] {
  return rows.flatMap((row, index) =>
    row.getAttribute("aria-current") === "true" ? [index] : [],
  );
}

function rungRows(container: Element): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>("button.fp-row")];
}

describe("the fill path's selection, coordinated through the provider", () => {
  it("opens on the rung price reaches next", () => {
    const view = partlyWalkedView();
    const { container } = render(<FillPathCards view={view} />);

    // Derived from the view, never counted off the fixture by hand: the default is a
    // decision `fill-path-view.ts` makes and this file must not restate.
    const opensOn = view.rungs.find((rung) => rung.isNext);
    expect(opensOn).toBeDefined();
    expect(panelHeading(container)).toContain(
      `Rung ${opensOn?.ladderIndex} of ${view.rungs.length}`,
    );
    expect(currentRows(rungRows(container))).toEqual([
      view.rungs.findIndex((rung) => rung.key === opensOn?.key),
    ]);
  });

  it("moves the live panel and `aria-current` when a rung is clicked", async () => {
    const user = userEvent.setup();
    const view = partlyWalkedView();
    const { container } = render(<FillPathCards view={view} />);
    const rows = rungRows(container);
    expect(rows).toHaveLength(view.rungs.length);

    const opensOn = view.rungs.findIndex((rung) => rung.isNext);
    const target = view.rungs.findIndex((rung, index) => index !== opensOn && !rung.isNext);
    expect(target).toBeGreaterThanOrEqual(0);

    await user.click(rows[target]!);

    expect(panelHeading(container)).toContain(
      `Rung ${view.rungs[target]?.ladderIndex} of ${view.rungs.length}`,
    );
    // MOVED, not added: the old row must have given the attribute up, which is the half a
    // "the new row is current" assertion alone would miss.
    expect(currentRows(rows)).toEqual([target]);
  });

  it("moves the selection with focus as a Tab walk goes down the list", async () => {
    const user = userEvent.setup();
    const view = partlyWalkedView();
    const { container } = render(<FillPathCards view={view} />);
    const rows = rungRows(container);
    expect(rows.length).toBeGreaterThan(1);

    // A REAL TAB WALK from the top of the document, so the rows are reached the way a
    // keyboard operator reaches them rather than by being handed focus. The bound is a
    // guard against an infinite loop, not an assertion about the tab order's length.
    for (let step = 0; step < 20 && document.activeElement !== rows[0]; step += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(rows[0]);
    expect(currentRows(rows)).toEqual([0]);
    expect(panelHeading(container)).toContain(
      `Rung ${view.rungs[0]?.ladderIndex} of ${view.rungs.length}`,
    );

    await user.tab();

    expect(document.activeElement).toBe(rows[1]);
    expect(currentRows(rows)).toEqual([1]);
    expect(panelHeading(container)).toContain(
      `Rung ${view.rungs[1]?.ladderIndex} of ${view.rungs.length}`,
    );
  });

  it("keeps the chart hidden and unreachable throughout the interaction", async () => {
    const user = userEvent.setup();
    const view = partlyWalkedView();
    const { container } = render(<FillPathCards view={view} />);

    const assertSealed = () => {
      const chart = container.querySelector(".fp-chart");
      expect(chart).not.toBeNull();
      expect(chart?.getAttribute("aria-hidden")).toBe("true");
      expect([...(chart?.querySelectorAll(TABBABLE) ?? [])]).toEqual([]);
      // Not vacuous: the adapter's own surface carries the negative tabindex, so its
      // presence proves a real chart is in the subtree and the empty query is a fact
      // about it rather than about a chart that declined to draw.
      expect(chart?.querySelector('[tabindex="-1"]')).not.toBeNull();
    };

    assertSealed();
    const rows = rungRows(container);
    await user.click(rows[rows.length - 1]!);
    assertSealed();
    await user.tab();
    assertSealed();
  });
});

describe("every fill-path part mounts on its own", () => {
  it("mounts the header alone, still carrying the page's `h1`", () => {
    const view = partlyWalkedView();
    const { container } = render(
      <FillPathProvider view={view}>
        <FillPath.Header />
      </FillPathProvider>,
    );

    expect([...container.querySelectorAll("section")].map((s) => s.className)).toEqual([
      "card fp-header",
    ]);
    expect(container.querySelector("h1")?.textContent).toBe(view.title);
  });

  it("mounts the chart alone, hidden, with its generated substitute beside it", () => {
    const { container } = render(
      <FillPathProvider view={partlyWalkedView()}>
        <FillPath.Chart />
      </FillPathProvider>,
    );

    expect([...container.querySelectorAll("section")].map((s) => s.className)).toEqual([
      "card fp-chart-card",
    ]);
    expect(container.querySelector(".fp-chart")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector(".sr-only")?.textContent ?? "").not.toBe("");
  });

  it("mounts the selected-rung panel alone, on the opening rung, still live", () => {
    const view = partlyWalkedView();
    const { container } = render(
      <FillPathProvider view={view}>
        <FillPath.SelectedRung />
      </FillPathProvider>,
    );

    const opensOn = view.rungs.find((rung) => rung.isNext);
    expect(panelHeading(container)).toContain(
      `Rung ${opensOn?.ladderIndex} of ${view.rungs.length}`,
    );
  });

  it("mounts the rung list alone, selecting on its own", async () => {
    const user = userEvent.setup();
    const view = partlyWalkedView();
    const { container } = render(
      <FillPathProvider view={view}>
        <FillPath.RungList />
      </FillPathProvider>,
    );

    const rows = rungRows(container);
    expect(rows).toHaveLength(view.rungs.length);
    // The part owns its half of the contract with no sibling present: a list that only
    // selects when the panel happens to be mounted beside it is still coupled.
    await user.click(rows[rows.length - 1]!);
    expect(currentRows(rows)).toEqual([rows.length - 1]);
  });
});
