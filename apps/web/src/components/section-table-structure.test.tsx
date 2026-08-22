// @vitest-environment jsdom
/**
 * `SectionTable` ON THE SHARED `Card` — the section-heading half of the conversion.
 *
 * The heading here is the SECTION'S OWN TITLE, at level 2, beneath the page's `<h1>`
 * on `/big-picture`. `CardTitle` defaults to 2, so the conversion looks correct even
 * if the default ever moves; the level is asserted rather than assumed, because a
 * demoted section heading is invisible to a sighted reader and reorders the whole
 * document outline for anything that navigates by headings.
 *
 * The class census is the other half. Spec #403 moves this table's root onto a
 * primitive that builds the class string for it, forbids any new class name, and
 * requires `styles.css` to be byte-identical. Both arms are censused, and they emit
 * the SAME set from different elements: `muted` is the percentage suffix on the
 * anchored arm and the "no earlier anchor" header on the genesis one. That is not a
 * redundant assertion — the genesis path renders a different header cell and a
 * different value cell, and a new class name introduced on either would be invisible
 * to the anchored arm alone.
 *
 * THE ROWS ARE AUTHORED. `row-view.test.ts` stays the oracle for every derived value;
 * this file pins markup and nothing else. No ledger output has been near it.
 */
import { describe, expect, it } from "vitest";

import { classCensus, render, screen } from "../render.testkit.tsx";
import { SectionTable } from "./SectionTable.tsx";
import type { DashboardSection } from "@numisma/engine";
import type { BigPictureView } from "../glance/row-view.ts";

function section(): DashboardSection {
  return {
    id: "portfolios",
    title: "Portfolios",
    rows: [
      {
        id: "row-a",
        kind: "portfolio",
        label: "Alpha",
        usdValue: 600,
        percentOfFund: 60,
      },
      {
        id: "row-b",
        kind: "portfolio",
        label: "Beta",
        usdValue: 400,
        percentOfFund: 40,
      },
    ],
  };
}

/** Both deltas render on `row-a`; `row-b` is suppressed with a named cause. */
function anchoredView(): BigPictureView {
  return {
    reference: { asOf: "2026-01-01", label: "Thu 1 Jan" },
    costBasisLabel: "cost basis",
    percentOfFundRendered: true,
    fundValueRendered: true,
    rows: new Map([
      [
        "row-a",
        {
          rendered: true,
          vsAnchor: { rendered: true, usdValue: 25, percent: 4.35 },
          vsCostBasis: { rendered: true, usdValue: -10, percent: -1.64 },
        },
      ],
      [
        "row-b",
        {
          rendered: false,
          suppressedBy: "unexpected-absence" as const,
          vsAnchor: { rendered: false, suppressedBy: "no-earlier-anchor" as const },
          vsCostBasis: { rendered: false, suppressedBy: "no-cost-basis" as const },
        },
      ],
    ]),
  };
}

/** The genesis arm: no anchor to name, and NAV withheld, so the % column is absent too. */
function anchorlessView(): BigPictureView {
  const view = anchoredView();
  const { reference: _reference, ...rest } = view;
  return { ...rest, percentOfFundRendered: false };
}

describe("SectionTable on the shared Card", () => {
  it("renders the section title as an h2", () => {
    render(<SectionTable section={section()} view={anchoredView()} />);

    const headings = screen.getAllByRole("heading");
    expect(headings.map((node) => node.tagName)).toEqual(["H2"]);
    expect(headings[0]?.textContent).toBe("Portfolios");
  });

  it("emits the same class strings it emitted before the conversion", () => {
    const { container } = render(
      <SectionTable section={section()} view={anchoredView()} />,
    );
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("SECTION");
    expect(classCensus(root!)).toEqual([
      "absent",
      "card",
      "muted",
      "muted absent-why",
      "neg",
      "num",
      "pos",
      "row-suppressed",
      "table-scroll",
    ]);
  });

  it("emits the same class strings on the genesis arm, with no anchor to name", () => {
    const { container } = render(
      <SectionTable section={section()} view={anchorlessView()} />,
    );

    expect(classCensus(container.firstElementChild!)).toEqual([
      "absent",
      "card",
      "muted",
      "muted absent-why",
      "neg",
      "num",
      "pos",
      "row-suppressed",
      "table-scroll",
    ]);
  });
});
