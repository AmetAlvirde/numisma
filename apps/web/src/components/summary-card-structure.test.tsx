// @vitest-environment jsdom
/**
 * `SummaryCard` ON THE SHARED `Card` — the with-a-heading half of the primitive's proof,
 * and, since spec #420 slice 3, the census successor for the summary section.
 *
 * THE FUND NAME IS THE PAGE'S `<h1>`. `/big-picture` has exactly one, this card carries
 * it, and the call site is the only thing that knows that — which is the entire reason
 * `CardTitle` takes a `level` and defaults it to 2. The primitive is now the single thing
 * in the layer that can silently demote it, and a page whose only heading is an `<h2>`
 * looks identical to a sighted reader while reading as a document with no title to
 * everything that navigates by headings.
 *
 * ── WHY THE CENSUS BECAME PER-CLASS ─────────────────────────────────────────────────
 * The full-string census this file used to run was right while the card was UNCONVERTED:
 * its root class string was built by a primitive, and `"card summary"` turning into
 * `"card"` is exactly the invisible-in-a-diff failure it existed to catch. It is wrong
 * now. Every element below carries a dozen ordered utilities, and pinning the whole
 * attribute would make this file assert Prettier's class sort order — a formatter upgrade
 * would then read as a summary-card regression. Per spec #420 Seam E the census splits in
 * two: the load-bearing utilities are asserted PER CLASS with `toContain`, and none of the
 * slice's deleted class names appears anywhere in either render.
 *
 * THE VALUES ARE THE DELETED RULES', declaration for declaration, and that is the whole
 * point of the list: `.metrics dd` was `margin: 0; font-size: 1.15rem; font-weight: 600;
 * font-variant-numeric: tabular-nums; text-align: right`, and its `@container` arm reset
 * the top margin and the alignment. Preflight is off, so the UA's `<dd>` margin is live
 * and `m-0` is as load-bearing as anything beside it.
 *
 * THE SUMMARY IS AUTHORED. No ledger output has been near this file.
 */
import { describe, expect, it } from "vitest";

import {
  classTokens as tokens,
  DELETED_IN_SLICE_2,
  DELETED_IN_SLICE_3,
  render,
  renderedClassNames,
  screen,
} from "../render.testkit.tsx";
import { CARD_SURFACE } from "./ui/Card.tsx";
import { SummaryCard } from "./SummaryCard.tsx";
import type { DashboardSummary } from "@numisma/engine";

function cleanSummary(): DashboardSummary {
  return {
    fundName: "Test Fund",
    asOf: "2026-01-05",
    fundValueUsd: 1000,
    usdMxn: 18.5,
    totalUnrealizedPnlUsd: 100,
    dataSafety: {
      nonLiveExcluded: 0,
      invalidExcluded: 0,
      shortDeferredExcluded: 0,
      hasWarnings: false,
    },
  };
}

/** Every utility in `expected` is on `element`, one assertion per class. */
function expectUtilities(element: Element, expected: string[]): void {
  for (const utility of expected) {
    expect(tokens(element)).toContain(utility);
  }
}

describe("SummaryCard on the shared Card", () => {
  it("renders the fund name as the page's h1", () => {
    render(
      <SummaryCard summary={cleanSummary()} usdMxn={18.5} fundValueRendered />,
    );

    const headings = screen.getAllByRole("heading");
    expect(headings.map((node) => node.tagName)).toEqual(["H1"]);
    expect(headings[0]?.textContent).toBe("Test Fund");
  });

  it("carries the card surface and the converted `as of` line", () => {
    const { container } = render(
      <SummaryCard summary={cleanSummary()} usdMxn={18.5} fundValueRendered />,
    );
    const root = container.firstElementChild!;

    expect(root.tagName).toBe("SECTION");
    expectUtilities(root, CARD_SURFACE.split(" "));

    // This one sits in the card header rather than in a metrics `<dd>`, so it takes
    // `.muted` plain — colour and all four margin edges, preflight being off.
    const asOf = screen.getByText(/^as of/);
    expect(asOf.tagName).toBe("P");
    expectUtilities(asOf, ["text-[var(--muted)]", "m-0", "mt-1"]);
  });

  it("is the query container the shared 380px breakpoint names", () => {
    const { container } = render(
      <SummaryCard summary={cleanSummary()} usdMxn={18.5} fundValueRendered />,
    );

    // `.summary` declared `container-name: summary metrics-card`; only the second
    // name was ever queried, here and by the glance card, so only it survives the
    // conversion. Losing it would not fail a render test — it would silently strand
    // every `@[380px]/metrics-card:` variant below on a card that never reflows.
    expectUtilities(container.firstElementChild!, ["@container/metrics-card"]);
  });

  it("keeps the head's title block and badge on one row, wrapping at 320px", () => {
    render(
      <SummaryCard summary={cleanSummary()} usdMxn={18.5} fundValueRendered />,
    );

    const head = screen.getByText("Test Fund").closest("header")!;
    expectUtilities(head, [
      "flex",
      "flex-wrap",
      "justify-between",
      "items-start",
      "gap-3",
    ]);
    // `flex: 1 1 0` plus `min-width: 0` is what lets the title block shrink instead
    // of pushing the badge off the card.
    expectUtilities(head.firstElementChild!, ["flex-1", "min-w-0"]);
  });

  it("lays the metrics list out phone-first and reflows it at a 380px card", () => {
    render(
      <SummaryCard summary={cleanSummary()} usdMxn={18.5} fundValueRendered />,
    );

    const list = screen.getByText("Fund value").closest("dl")!;
    expectUtilities(list, [
      "grid",
      "grid-cols-1",
      "gap-2",
      "m-0",
      "mt-4",
      "@[380px]/metrics-card:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]",
      "@[380px]/metrics-card:gap-3",
    ]);

    const row = screen.getByText("Fund value").closest("div")!;
    expectUtilities(row, [
      "grid",
      "grid-cols-[auto_minmax(0,1fr)]",
      "items-baseline",
      "gap-x-[10px]",
      "@[380px]/metrics-card:block",
    ]);
  });

  it("sizes the term and the figure, both arms of the reflow", () => {
    render(
      <SummaryCard summary={cleanSummary()} usdMxn={18.5} fundValueRendered />,
    );

    expectUtilities(screen.getByText("Fund value"), [
      "text-[var(--muted)]",
      "text-[0.8rem]",
    ]);
    expectUtilities(screen.getByText("18.50").closest("dd")!, [
      "m-0",
      "text-[1.15rem]",
      "font-semibold",
      "tabular-nums",
      "text-right",
      "@[380px]/metrics-card:mt-[2px]",
      "@[380px]/metrics-card:text-left",
    ]);
  });

  it("paints the P&L figure with the sign colour it earned", () => {
    render(
      <SummaryCard summary={cleanSummary()} usdMxn={18.5} fundValueRendered />,
    );
    const pnl = screen.getByText(/^\$100/);
    expectUtilities(pnl, ["text-[var(--pos)]"]);

    render(
      <SummaryCard
        summary={{ ...cleanSummary(), totalUnrealizedPnlUsd: -100 }}
        usdMxn={18.5}
        fundValueRendered
      />,
    );
    expectUtilities(screen.getByText(/^-\$100/), ["text-[var(--neg)]"]);
  });

  it("carries both badge arms, and wraps only inside the head", () => {
    render(
      <SummaryCard summary={cleanSummary()} usdMxn={18.5} fundValueRendered />,
    );
    const ok = screen.getByText("Data OK");
    expectUtilities(ok, [
      "inline-block",
      "rounded-[999px]",
      "px-[10px]",
      "py-1",
      "text-[0.78rem]",
      "font-semibold",
      "whitespace-nowrap",
      "bg-[var(--ok)]",
      "text-white",
    ]);
    // `.badge`'s `nowrap` was overridden for EXACTLY ONE PLACEMENT and the override is
    // written as an element-scoped variant rather than a second plain utility, because
    // two unvariant `white-space` utilities on one element are resolved by Tailwind's
    // emitted order and not by the order they are written in. `[header_&]` outranks the
    // base on specificity, which is a fact about the selector rather than about the sort.
    expectUtilities(ok, ["[header_&]:whitespace-normal", "[header_&]:flex-initial"]);

    render(
      <SummaryCard
        summary={cleanSummary()}
        usdMxn={18.5}
        fundValueRendered={false}
      />,
    );
    // By title, not by text: the badge and the em dash beneath it spell the SAME cause
    // from the same constant, deliberately, so the words are not a unique handle.
    expectUtilities(screen.getByTitle("Withheld or excluded data"), [
      "bg-[var(--warn)]",
      "text-white",
      "whitespace-nowrap",
      "[header_&]:whitespace-normal",
    ]);
  });

  it("writes none of the deleted class names, on either arm", () => {
    const clean = render(
      <SummaryCard summary={cleanSummary()} usdMxn={18.5} fundValueRendered />,
    );
    const suppressed = render(
      <SummaryCard
        summary={cleanSummary()}
        usdMxn={18.5}
        fundValueRendered={false}
      />,
    );

    for (const { container } of [clean, suppressed]) {
      const rendered = [...renderedClassNames(container.firstElementChild!)];
      for (const deleted of [...DELETED_IN_SLICE_2, ...DELETED_IN_SLICE_3]) {
        expect(rendered).not.toContain(deleted);
      }
    }
    // The suppressed arm is the one that renders an `Absent`, and its hook stays —
    // two of the three contextual rules that select through it are still in the file.
    expect([
      ...renderedClassNames(suppressed.container.firstElementChild!),
    ]).toContain("absent");
  });
});
