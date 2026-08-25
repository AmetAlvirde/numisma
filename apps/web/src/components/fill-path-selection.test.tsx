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
 * AND THE TWO HALVES OF SPEC #403 §1'S QUESTION, which the contract above does not reach.
 * The spec states the motivating question as "does selecting a rung still move the panel
 * AND THE CHART together". The panel half is the three cases above. The chart half is
 * `aria-hidden` by construction, so no accessibility assertion can see it — it is asserted
 * here by reading the mark the adapter draws for the selected rung, which is the only
 * observable the picture has. Without it, handing the chart a constant key leaves this
 * whole file green, which was measured.
 *
 * THE INSPECT SLIDER IS THE OTHER DIRECTION. `select(key)` is covered by the click and by
 * the Tab walk; `selectIndex(index)` is spelled in exactly one place — the provider — and
 * is what the slider drives, so it is asserted here too. The slider is reached by a real
 * Tab walk, because it is a keyboard surface and its reachability is part of the same
 * contract the rows carry.
 *
 * IT IS DRIVEN WITH `fireEvent`, AND THAT IS THE ONE PLACE IN THIS FILE THAT IS NOT
 * `user-event`. Measured on jsdom 30: a range input implements no arrow-key stepping, so
 * `user.keyboard("{ArrowDown}")` on a focused slider leaves `value` untouched and an
 * assertion built on it would pass against a component with no slider behavior at all.
 * `fireEvent.change` dispatches the same `change` a browser dispatches when the thumb
 * moves, which is exactly the event the component listens for. The keyboard claim that CAN
 * be made honestly here — that the control is in the tab order — is made with a real Tab
 * walk, separately.
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

import { fireEvent, render, userEvent, within } from "@numisma/components/testkit/render.testkit.tsx";
import {
  FillPath,
  FillPathCards,
  FillPathProvider,
  useFillPathSelection,
} from "./FillPath.tsx";
import { composeFillPathPage } from "../ladder/fill-path-view.ts";
import { ladderFixture } from "../ladder/started-ladder.fixtures.ts";
import { CARD_SURFACE } from "@numisma/components";

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
  // FOUND BY THE LIVE-REGION ATTRIBUTE, not by a class name: spec #420 slice 8 deleted
  // `fp-selected`, and `aria-live` is what makes this card the panel anyway. The check
  // below still earns its place — the query allows any value and the contract is
  // `polite`, so a card that lost its politeness is found and then rejected.
  const panel = container.querySelector("section[aria-live]");
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
  // The rung list is the only list of buttons the fill path draws, and `fp-row` — the
  // class this used to key off — left with spec #420 slice 8. Structure rather than a
  // name: every rung is a button, and that IS the accessibility contract this file is
  // about, so the query is now made of the same fact as the assertions.
  return [...container.querySelectorAll<HTMLButtonElement>("li > button")];
}

/**
 * WHICH RUNG THE CHART IS MARKING, read off the drawn picture rather than off the prop
 * that was handed to it — a test that re-read `selectedKey` would be asserting the
 * expression it is supposed to be checking.
 *
 * The selection mark is the only `circle` on the chart filled with `--text`: every rung
 * ring is hollow (`--card`) and the halo beneath the disc is the page background
 * (`--bg`). `PriceDropPathChart` says why those three fills are what they are. The
 * adapter carries the datum's own `key` at the end of the element's `data-ts-key`, which
 * is what lets this name a RUNG rather than a coordinate — a pixel assertion would be
 * meaningless anyway, since jsdom lays every element out at zero.
 *
 * It throws rather than returning undefined on a miss: no disc at all, or two, is a
 * broken picture and not a rung this can report on.
 */
function chartSelectionKey(container: Element): string {
  const discs = [
    ...container.querySelectorAll('.fp-chart circle[fill="var(--text)"]'),
  ];
  if (discs.length !== 1) {
    throw new Error(`the chart drew ${discs.length} selection discs, not exactly one`);
  }
  const key = discs[0]?.getAttribute("data-ts-key")?.split(":").at(-1);
  if (key === undefined || key === "") {
    throw new Error("the chart's selection disc carries no datum key");
  }
  return key;
}

/** The inspect slider, or a loud failure — an absent one is a lost keyboard surface. */
function inspectSlider(container: Element): HTMLInputElement {
  const slider = container.querySelector<HTMLInputElement>(
    '.fp-inspect input[type="range"]',
  );
  if (slider === null) throw new Error("the inspect slider is not rendered");
  return slider;
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

  it("moves the chart's mark with the panel — spec #403 §1's question, both halves", async () => {
    const user = userEvent.setup();
    const view = partlyWalkedView();
    const { container } = render(<FillPathCards view={view} />);
    const rows = rungRows(container);

    const opensOn = view.rungs.find((rung) => rung.isNext);
    expect(opensOn).toBeDefined();
    // The chart opens on the SAME rung the panel opens on. A chart handed a constant —
    // `view.rungs[0]?.key`, the mutation this case was written against — passes the panel
    // assertions above and fails here, because the ladder opens on the next rung.
    expect(chartSelectionKey(container)).toBe(opensOn?.key);

    const target = view.rungs.findIndex((rung) => rung.key !== opensOn?.key);
    expect(target).toBeGreaterThanOrEqual(0);
    await user.click(rows[target]!);

    // TOGETHER is the claim, so both are read after the same click.
    expect(chartSelectionKey(container)).toBe(view.rungs[target]?.key);
    expect(panelHeading(container)).toContain(
      `Rung ${view.rungs[target]?.ladderIndex} of ${view.rungs.length}`,
    );
  });

  it("keeps the inspect slider on the selection, and selects the rung it is dragged to", async () => {
    const user = userEvent.setup();
    const view = partlyWalkedView();
    const { container } = render(<FillPathCards view={view} />);
    const slider = inspectSlider(container);

    // The range spans the ladder: an index the slider can reach but the list cannot is a
    // rung the operator can select twice and a rung they cannot select at all.
    expect(slider.min).toBe("0");
    expect(slider.max).toBe(String(view.rungs.length - 1));

    // IT REFLECTS THE SELECTION, and the fixture opens on a rung that is not index 0, so
    // `value={0}` is red here rather than accidentally right.
    const opensAt = view.rungs.findIndex((rung) => rung.isNext);
    expect(opensAt).toBeGreaterThan(0);
    expect(slider.value).toBe(String(opensAt));

    // A REAL TAB WALK, because the slider is a keyboard surface and this is the half of
    // that claim jsdom can honour. See the header for why the drag below is not one.
    for (let step = 0; step < 30 && document.activeElement !== slider; step += 1) {
      await user.tab();
    }
    expect(document.activeElement).toBe(slider);

    // THE OTHER HALF OF THE TRANSLATION, driven end to end: an index goes in, and a rung
    // comes out everywhere the selection is visible. An off-by-one in the provider's
    // `selectIndex` — the mutation this case was written against — lands the panel, the
    // row and the chart one rung down.
    const dragTo = view.rungs.length - 1;
    fireEvent.change(slider, { target: { value: String(dragTo) } });

    expect(slider.value).toBe(String(dragTo));
    expect(panelHeading(container)).toContain(
      `Rung ${view.rungs[dragTo]?.ladderIndex} of ${view.rungs.length}`,
    );
    expect(currentRows(rungRows(container))).toEqual([dragTo]);
    expect(chartSelectionKey(container)).toBe(view.rungs[dragTo]?.key);

    // And back up, so the assertion is about the index it was handed rather than about
    // the slider having been moved at all.
    fireEvent.change(slider, { target: { value: "0" } });
    expect(panelHeading(container)).toContain(
      `Rung ${view.rungs[0]?.ladderIndex} of ${view.rungs.length}`,
    );
    expect(chartSelectionKey(container)).toBe(view.rungs[0]?.key);
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

    // The header card's own class is now its container utility (spec #420 slice 7).
    expect([...container.querySelectorAll("section")].map((s) => s.className)).toEqual([
      `${CARD_SURFACE} @container/fp-header`,
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
      `${CARD_SURFACE} fp-chart-card`,
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

/**
 * SEAM E'S PUBLISHED HOOK, EXERCISED AS THE PUBLISHED SURFACE.
 *
 * `useFillPathSelection` is the narrow shape spec #403 Seam E names by name, and the four
 * parts do not read it — they read the internal `useFillPath`, because every one of them
 * also needs `view` and two of them need `selectIndex`, neither of which the published
 * shape carries or should. See the comment above the hook for why that stays true rather
 * than being resolved by widening it.
 *
 * The consequence is that the hook's only consumer is here, so this is where its contract
 * is held: the exact three fields, in the terms a part outside this file would read them,
 * against the same provider the parts sit under. A published surface asserted by nobody
 * can return the wrong three fields and ship.
 */
describe("useFillPathSelection, the shape a part outside this file reads", () => {
  /** A consumer written the way the workbench would write one: hook in, DOM out. */
  function SelectionProbe({ selects }: { selects?: string }) {
    const selection = useFillPathSelection();
    return (
      <div>
        <p data-testid="probe-keys">{Object.keys(selection).sort().join(",")}</p>
        <p data-testid="probe-key">{selection.selected?.key ?? "none"}</p>
        <p data-testid="probe-index">{String(selection.selectedIndex)}</p>
        <button
          type="button"
          data-testid="probe-select"
          onClick={() => selection.select(selects ?? "")}
        >
          select
        </button>
      </div>
    );
  }

  function probeText(container: Element, id: string): string {
    return container.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";
  }

  it("returns exactly `selected`, `selectedIndex` and `select`", () => {
    const view = partlyWalkedView();
    const { container } = render(
      <FillPathProvider view={view}>
        <SelectionProbe />
      </FillPathProvider>,
    );

    // The whole shape, not a subset: an extra field is a widened seam, and a missing one
    // is a consumer that breaks on a surface nothing else was reading.
    expect(probeText(container, "probe-keys")).toBe(
      "select,selected,selectedIndex",
    );

    const opensOn = view.rungs.find((rung) => rung.isNext);
    expect(probeText(container, "probe-key")).toBe(opensOn?.key);
    // The index and the rung are the same fact twice, which is the pairing the seam
    // exists to keep honest.
    expect(probeText(container, "probe-index")).toBe(
      String(view.rungs.findIndex((rung) => rung.key === opensOn?.key)),
    );
  });

  it("selects by key, and the parts beside it see the same selection", async () => {
    const user = userEvent.setup();
    const view = partlyWalkedView();
    const last = view.rungs.length - 1;
    const target = view.rungs[last]?.key ?? "";
    expect(target).not.toBe("");

    const { container } = render(
      <FillPathProvider view={view}>
        <SelectionProbe selects={target} />
        <FillPath.SelectedRung />
      </FillPathProvider>,
    );

    await user.click(container.querySelector('[data-testid="probe-select"]')!);

    expect(probeText(container, "probe-key")).toBe(target);
    expect(probeText(container, "probe-index")).toBe(String(last));
    // ONE selection, not the hook's own copy of one: the panel mounted beside the probe
    // moved because they read the same provider.
    expect(panelHeading(container)).toContain(
      `Rung ${view.rungs[last]?.ladderIndex} of ${view.rungs.length}`,
    );
  });
});
