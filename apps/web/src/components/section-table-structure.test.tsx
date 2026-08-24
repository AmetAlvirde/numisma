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
 * requires `styles.css` to be byte-identical — a rule spec #412 Slice 5 has since broken
 * exactly once, adding a `:root` block of `--nms-*` overrides and no selector at all.
 * Both arms are censused, and they emit
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

import {
  classTokens as tokens,
  DELETED_IN_SLICE_2,
  DELETED_IN_SLICE_3,
  DELETED_IN_SLICE_4,
  render,
  renderedClassNames,
  screen,
} from "../render.testkit.tsx";
import { CARD_SURFACE } from "./ui/Card.tsx";
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

  it("carries the bare card surface, with no class of its own beside it", () => {
    const { container } = render(
      <SectionTable section={section()} view={anchoredView()} />,
    );
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("SECTION");
    expect(root?.className).toBe(CARD_SURFACE);
  });

  it("converts the delta suffix, all four margin edges included", () => {
    render(<SectionTable section={section()} view={anchoredView()} />);

    // A `<span>`, so the vertical margins do not paint — and they are written anyway,
    // because `.muted` set all four and the next element to carry this string may be a
    // block. Preflight is off; a missing edge is a UA margin, not a zero.
    const suffix = screen
      .getAllByText(/%$/)
      .find((element) => element.tagName === "SPAN")!;
    for (const utility of ["text-[var(--muted)]", "m-0", "mt-1"]) {
      expect(tokens(suffix)).toContain(utility);
    }
  });

  it("paints its two deltas with the sign colours, as slice 3's carrier", () => {
    render(<SectionTable section={section()} view={anchoredView()} />);

    // `.pos`/`.neg` are a shared rule and the summary card is the first surface in the
    // spec's order that carries them, so slice 3 deletes the rule and converts every
    // carrier — including this one, in a component that slice otherwise does not own
    // (spec #420 Seam B). `row-a` renders one of each, which is why the fixture gives
    // it a positive anchor delta and a negative cost-basis one.
    const up = screen.getByText(/▲/);
    const down = screen.getByText(/▼/);
    expect(tokens(up)).toContain("text-[var(--pos)]");
    expect(tokens(down)).toContain("text-[var(--neg)]");
  });

  it("keeps the escape hatch on the scroller and the table", () => {
    const { container } = render(
      <SectionTable section={section()} view={anchoredView()} />,
    );
    const table = container.querySelector("table")!;
    const scroller = table.parentElement!;

    // The scroller is the query container AND the thing that pans; both facts have to be
    // on the same element or the breakpoint below measures the wrong box.
    for (const utility of [
      "@container/table-scroll",
      "overflow-x-auto",
      "[-webkit-overflow-scrolling:touch]",
    ]) {
      expect(tokens(scroller)).toContain(utility);
    }

    // Sized to content with a floor, and fitted only above a 380px SCROLLER. jsdom lays
    // nothing out and resolves no container query, so this asserts that the two arms are
    // written and on which element — Chrome is what proves the pan actually happens.
    for (const utility of [
      "w-max",
      "min-w-full",
      "@[380px]/table-scroll:w-full",
      "border-collapse",
      "tabular-nums",
    ]) {
      expect(tokens(table)).toContain(utility);
    }
  });

  it("puts the cell box on every cell and the alignment per column", () => {
    render(<SectionTable section={section()} view={anchoredView()} />);

    const label = screen.getByRole("columnheader", { name: "Label" });
    const figure = screen.getByRole("columnheader", { name: "USD value" });

    // The header's own treatment, over the shared box. Preflight is off, so the padding,
    // the hairline and the alignment are all written rather than inherited from a UA
    // that centres a `th` and draws no border at all.
    for (const utility of [
      "px-[10px]",
      "py-2",
      "border-b",
      "border-[var(--line)]",
      "text-[var(--muted)]",
      "text-[0.78rem]",
      "uppercase",
      "tracking-[0.04em]",
    ]) {
      expect(tokens(label)).toContain(utility);
      expect(tokens(figure)).toContain(utility);
    }

    // The one thing that differs by column, and the reason the figure cell does not also
    // carry the left arm: two unvariant `text-align` utilities are resolved by emitted
    // order, so only the winning one is written.
    expect(tokens(label)).toContain("text-left");
    expect(tokens(label)).not.toContain("text-right");
    expect(tokens(figure)).toContain("text-right");
    expect(tokens(figure)).not.toContain("text-left");

    const cells = screen.getAllByRole("cell");
    const labelCell = cells.find((cell) => cell.textContent === "Alpha")!;
    const usdCell = labelCell.nextElementSibling!;
    for (const utility of ["px-[10px]", "py-2", "border-b", "border-[var(--line)]"]) {
      expect(tokens(labelCell)).toContain(utility);
      expect(tokens(usdCell)).toContain(utility);
    }
    expect(tokens(labelCell)).toContain("text-left");
    expect(tokens(usdCell)).toContain("text-right");
  });

  it("writes none of the deleted class names, on either arm", () => {
    const anchored = render(
      <SectionTable section={section()} view={anchoredView()} />,
    );
    const genesis = render(
      <SectionTable section={section()} view={anchorlessView()} />,
    );

    for (const { container } of [anchored, genesis]) {
      const rendered = renderedClassNames(container.firstElementChild!);
      for (const deleted of [
        ...DELETED_IN_SLICE_2,
        ...DELETED_IN_SLICE_3,
        ...DELETED_IN_SLICE_4,
      ]) {
        expect([...rendered]).not.toContain(deleted);
      }
      // The hook is gone as of slice 8, which deleted the last rule selecting through
      // it; the primitive's own contract test holds that end.
      expect([...rendered]).not.toContain("absent");
    }
  });
});
