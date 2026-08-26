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
 * BOTH ARMS ARE CENSUSED, from different elements. Six cases mount `anchoredView()`
 * and one mounts `anchorlessView()`, because `muted` is the percentage suffix on the
 * anchored arm and the "no earlier anchor" header on the genesis one. That is not a
 * redundant assertion — the genesis path renders a header cell the anchored arm never
 * produces, and it is the only render of this component's third `--nms-muted-foreground`
 * read, so a class name rewritten there would be invisible to the anchored arm alone.
 * The genesis case censuses that cell directly; it used to ride along inside the
 * whole-tree `expectNoStyledClassSurvives` scaffolding, which spec #439 S0 retired.
 *
 * THE ROWS ARE AUTHORED, and since spec #439 S2 they live in `section-table.fixtures.ts`
 * beside the component rather than in this file. Same literals, three readers: this test,
 * the workbench's cosmos fixture, and whatever renders the table next.
 * `apps/web/src/glance/row-view.test.ts` stays the oracle for every derived value; this
 * file pins markup and nothing else. No ledger output has been near it.
 */
import { describe, expect, it } from "vitest";

import {
  classTokens as tokens,
  render,
  absentSlots,
  screen,
} from "../testkit/render.testkit";
import { CARD_SURFACE } from "./card";
import { SectionTable } from "./section-table";
import { anchoredView, anchorlessView, section } from "./section-table.fixtures";

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
    for (const utility of ["text-[var(--nms-muted-foreground)]", "m-0", "mt-1"]) {
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
    // THESE TWO ARRIVED ALREADY NAMESPACED and the other four did not, which is the whole
    // reason the slice brief enumerates the component's reads over the FILE'S OWN TEXT
    // rather than over what a reviewer sees on screen: `POSITIVE` and `NEGATIVE` crossed
    // with `SummaryCard` in spec #439 S1 and were rewritten there, so the strings below
    // appear nowhere in `section-table.tsx`. The four that are its own were rewritten in
    // S2, in lockstep with the component. A test left asserting an old string goes red on
    // the exact class, which is this wave's parity evidence — never loosened to a
    // substring to get past it.
    expect(tokens(up)).toContain("text-[var(--nms-pos)]");
    expect(tokens(down)).toContain("text-[var(--nms-neg)]");
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
      "border-[var(--nms-border)]",
      "text-[var(--nms-muted-foreground)]",
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
    for (const utility of ["px-[10px]", "py-2", "border-b", "border-[var(--nms-border)]"]) {
      expect(tokens(labelCell)).toContain(utility);
      expect(tokens(usdCell)).toContain(utility);
    }
    expect(tokens(labelCell)).toContain("text-left");
    expect(tokens(usdCell)).toContain("text-right");
  });

  it("censuses the genesis arm's own header cell, the one the anchored arm never renders", () => {
    // THE OTHER ARM, AND THE ONLY TEST RENDER IT HAS (spec #439 review finding 3).
    // `anchorlessView()` is `anchoredView()` with `reference` DESTRUCTURED OUT, which
    // is the sole condition under which the anchor column's header says "no earlier
    // anchor" instead of naming a date. That fallback span is this component's THIRD
    // `--nms-muted-foreground` read (`section-table.tsx:219`); the other two are the
    // header box and the percentage suffix, both on the anchored arm. §4.7's table
    // enumerates the component at `--muted x3`, and the wave's parity gate rests on a
    // moved test's expected class string failing loudly when a read is rewritten — so
    // the read with no test rendering it is the one hole in that argument.
    //
    // The case this replaces was the retired `expectNoStyledClassSurvives` scaffolding,
    // which mounted this arm incidentally. The census is what the docblock above
    // promises, so it is asserted directly rather than as a side effect of something
    // else.
    render(<SectionTable section={section()} view={anchorlessView()} />);

    const genesis = screen.getByRole("columnheader", { name: "vs no earlier anchor" });
    const fallback = genesis.querySelector("span")!;
    expect(fallback.textContent).toBe("no earlier anchor");
    expect(tokens(fallback)).toContain("text-[var(--nms-muted-foreground)]");
    for (const utility of ["m-0", "mt-1"]) {
      expect(tokens(fallback)).toContain(utility);
    }

    // The cell around it is still an ordinary numeric header, so a fallback that
    // escaped its `<th>` — or a `<th>` that lost the shared box on this arm alone —
    // reds here rather than only in the anchored census above.
    for (const utility of [
      "px-[10px]",
      "py-2",
      "border-b",
      "border-[var(--nms-border)]",
      "text-right",
    ]) {
      expect(tokens(genesis)).toContain(utility);
    }
  });

  it("keeps `row-suppressed` on the suppressed `<tr>`, and its four stated causes", () => {
    // `row-suppressed` NEVER HAD A RULE ON EITHER REF, and it is asserted anyway. `main`
    // pinned it present in both censuses; the successors dropped it, so deleting it from
    // the `<tr>` goes unnoticed and anything later keyed on it — a row tint, a scan
    // guard, a test — misses silently. Drift, not breakage, and cheaper to stop here
    // than to rediscover.
    //
    // THE FOUR CAUSES RIDE ALONG for the reason the three cards' witnesses do:
    // `not.toContain("absent")` above is satisfied just as well by the row being gone.
    // They are asserted by their own words because the four are DIFFERENT — the row's
    // cause reaches two cells, and each delta column names its own — and a `Row` that
    // collapsed them into one would still print an em dash in every cell.
    const { container } = render(
      <SectionTable section={section()} view={anchoredView()} />,
    );
    const suppressed = container.querySelector("tr.row-suppressed");

    expect(suppressed).toBeTruthy();
    expect(suppressed?.querySelector("td")?.textContent).toBe("Beta");
    expect(absentSlots(suppressed!).map((slot) => slot.textContent)).toEqual([
      "—no current mark",
      "—no current mark",
      "—no earlier anchor",
      "—no cost basis",
    ]);

    // One suppressed row out of the two the fixture declares. The rendered row carries
    // no such class and no em dash, which is what makes the assertions above a
    // suppression witness rather than a description of every `<tr>` this table draws.
    expect(container.querySelectorAll("tr.row-suppressed")).toHaveLength(1);
  });
});
