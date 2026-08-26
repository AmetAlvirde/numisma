// @vitest-environment jsdom
/**
 * WHAT THE FILL PATH SAYS ABOUT ONE RUNG, AND HOW MANY TIMES IT SAYS IT (spec #451 §4.4,
 * S6).
 *
 * THE RULE THIS FILE HOLDS: `stateCopy` owns the venue state and everything that
 * decorates it; the pills carry only facts from a different axis. A pill that repeats
 * `stateCopy` is the same sentence twice, and the surface had two of them left — the rung
 * row's partial-fill pill and the selected-rung panel's, both printing the percentage the
 * state words already carry.
 *
 * THE DELETION IS SAFE BY CONSTRUCTION, WHICH IS WHY THE ASSERTIONS COUNT RATHER THAN
 * INSPECT. `filledPercent` is set only when `venueAxis === "partly-filled"` and
 * `venueResting` is `venueAxis === "resting"`: one field, two values, mutually exclusive.
 * So on every rung that could have fired a partial pill, the state words are already on
 * screen carrying the identical string. Counting occurrences of the rendered percentage
 * asserts exactly that, and it stays true for a rung state nobody has authored yet.
 *
 * THE `price passed, unconfirmed` PILL IS THE CONTROL. It is a fact from the SPOT axis —
 * price fell past a resting order and the venue has said nothing — and `stateCopy` cannot
 * carry it, so the rule that killed the two partial pills is also what keeps this one. A
 * deletion that took it along turns the second case red.
 *
 * THE VIEWS ARE AUTHORED LITERALS from `fill-path.fixtures.ts`, patched in place where a
 * case needs a rung arrangement no fixture ships. No fixture is added and no fixture's
 * data changes; the patches are local to the case that reads them, the same move
 * `fill-path-cards-structure.test.tsx` makes with `withSelectedRung`. No ledger output
 * has been near this file.
 */
import { describe, expect, it } from "vitest";

import { fireEvent, render } from "../testkit/render.testkit";
import { FillPathCards } from "./fill-path";
import type { FillPathView } from "./fill-path";
import { outOfOrderView, partlyWalkedView } from "./fill-path.fixtures";

/** Every occurrence of one string in the whole rendered page, cards and panel alike. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * THE COUNT IS PER CARD, and the distinction is the whole finding. The selected-rung
 * panel DESCRIBES the row the operator is inspecting, so it restates that row's index,
 * price, size and state by design — a detail view that stopped agreeing with the list
 * under it would be the defect. What §4.4 killed is a card printing one fact twice
 * WITHIN ITSELF, which both cards were doing: the panel's state pill above its partial
 * pill, and the row's status line above its partial pill.
 */
function cardTexts(view: FillPathView): { panel: string; list: string } {
  const { container } = render(<FillPathCards view={view} />);
  const panel = container.querySelector("section[aria-live]");
  const list = container.querySelector("li > button")?.closest("section");
  return { panel: panel?.textContent ?? "", list: list?.textContent ?? "" };
}

/** The one rung the fixtures give a measured fraction to, and the words it renders. */
const PARTIAL_COPY = "partly filled · 40%";

describe("a rung's fill percentage is printed once per card", () => {
  it("prints it once on each card when the partly filled rung is also next", () => {
    // `partly-walked`'s rung 4 is next AND partly filled, and the cards open on the next
    // rung — so the panel and the row are both showing it in the state this asserts.
    const view = partlyWalkedView();
    expect(view.rungs.filter((rung) => rung.filledPercent !== undefined)).toHaveLength(1);
    const { panel, list } = cardTexts(view);

    // On the row it is the SUB-LINE, under `next`; in the panel it is the state pill,
    // under the heading's badge. One statement each, where there were two each.
    expect(occurrences(list, PARTIAL_COPY)).toBe(1);
    expect(occurrences(panel, PARTIAL_COPY)).toBe(1);
  });

  it("prints it once when the partly filled rung is not the next one", () => {
    // THE CASE NO FIXTURE SHOWS, and the one a comment in `fill-path.tsx` used to deny.
    // `RowState` reads `status = isNext ? "next" : stateIsDefault ? undefined : stateCopy`,
    // so a partly filled rung that is not next takes `stateCopy` into the STATUS line
    // instead of the sub-line and the pill fired under it just the same. Being next only
    // ever made it three lines instead of two.
    const base = partlyWalkedView();
    const view: FillPathView = {
      ...base,
      rungs: base.rungs.map((rung) =>
        rung.filledPercent === undefined ? rung : { ...rung, isNext: false },
      ),
    };
    expect(view.rungs.some((rung) => rung.isNext)).toBe(false);

    expect(occurrences(cardTexts(view).list, PARTIAL_COPY)).toBe(1);
  });

  it("still prints the state words themselves, on the row and in the panel", () => {
    // The deletion takes the duplicate and never the original: a percentage printed ZERO
    // times is the failure on the other side of this claim, and it would leave the
    // operator reading a partly filled rung as an ordinary one.
    const { panel, list } = cardTexts(partlyWalkedView());

    expect(list).toContain(PARTIAL_COPY);
    expect(panel).toContain(PARTIAL_COPY);
  });
});

describe("the qualifier pill from the spot axis survives the deletion", () => {
  /** Every rung row, in ladder order, as the list renders them. */
  function rungRows(view: FillPathView): HTMLButtonElement[] {
    const { container } = render(<FillPathCards view={view} />);
    return [...container.querySelectorAll<HTMLButtonElement>("li > button")];
  }

  it("fires `price passed, unconfirmed` for exactly the rungs it names", () => {
    const view = outOfOrderView();
    const expected = view.rungs
      .map((rung, index) => (rung.pricePassedUnconfirmed ? index : -1))
      .filter((index) => index >= 0);
    expect(expected.length).toBeGreaterThan(0);

    const fired = rungRows(view)
      .map((row, index) =>
        row.textContent?.includes("price passed, unconfirmed") ? index : -1,
      )
      .filter((index) => index >= 0);

    expect(fired).toEqual(expected);
  });
});

describe("the inspect range announces the rung it selects, in words", () => {
  function inspectRange(view: FillPathView) {
    const { container } = render(<FillPathCards view={view} />);
    const range = container.querySelector<HTMLInputElement>('input[type="range"]');
    if (range === null) throw new Error("the inspect range is not rendered");
    return range;
  }

  it("reads the row's copy rather than the bare index", () => {
    // ASSERTED THROUGH THE RENDERED CONTROL, never through the function that formats the
    // string: a helper asserted on its own is green while nothing puts its result on the
    // element, which is the whole failure this attribute exists to prevent.
    const view = partlyWalkedView();
    const range = inspectRange(view);
    const opensAt = view.rungs.findIndex((rung) => rung.isNext);

    expect(range.value).toBe(String(opensAt));
    expect(range.getAttribute("aria-valuetext")).toBe(
      "Rung 4 of 8, 400.00 USD at 38,000, next, partly filled · 40%",
    );
  });

  it("moves with the selection, and drops the clauses that no longer apply", () => {
    const view = partlyWalkedView();
    const range = inspectRange(view);

    // An ordinary waiting rung: the state column is EMPTY on the row, and the
    // announcement is silent about the state for the same reason. Empty means waiting.
    fireEvent.change(range, { target: { value: "4" } });
    expect(range.getAttribute("aria-valuetext")).toBe("Rung 5 of 8, 500.00 USD at 34,000");

    // A rung that was declared and never placed says so, because `stateCopy` says so.
    fireEvent.change(range, { target: { value: "6" } });
    expect(range.getAttribute("aria-valuetext")).toBe(
      "Rung 7 of 8, 850.00 USD at 26,000, declared — not placed",
    );
  });

  it("names the spot-axis qualifier too, since the row prints it", () => {
    const view = outOfOrderView();
    const range = inspectRange(view);
    const target = view.rungs.findIndex((rung) => rung.pricePassedUnconfirmed);
    expect(target).toBeGreaterThanOrEqual(0);

    fireEvent.change(range, { target: { value: String(target) } });
    expect(range.getAttribute("aria-valuetext")).toContain("price passed, unconfirmed");
  });

  it("says the size is missing rather than leaving the sentence short", () => {
    const base = partlyWalkedView();
    const view: FillPathView = {
      ...base,
      // OMITTED, never set to `undefined`: `exactOptionalPropertyTypes` is on, and a v4
      // snapshot that carries no size does not carry the key at all.
      rungs: base.rungs.map((rung, index) => {
        if (index !== 0) return rung;
        const { sizeUsd: _sizeUsd, ...sizeless } = rung;
        return sizeless;
      }),
    };
    const range = inspectRange(view);

    fireEvent.change(range, { target: { value: "0" } });
    expect(range.getAttribute("aria-valuetext")).toBe(
      "Rung 1 of 8, 50,000, size not carried, filled",
    );
  });
});

describe("the `next` badge is not what this slice deleted", () => {
  it("keeps the badge on the panel heading, and only while the rung is next", () => {
    // §4.4's distinction: the partial pill was redundant in every state, in one card; the
    // badge is coincident in ONE state, across two cards, and informative in every other.
    // Its ABSENCE is the signal a keyboard user hears when they walk off the next rung,
    // and the panel is `aria-live` so they hear it go.
    const view = partlyWalkedView();
    const { container } = render(<FillPathCards view={view} />);
    const panel = container.querySelector("section[aria-live]");
    const range = container.querySelector<HTMLInputElement>('input[type="range"]')!;

    expect(panel?.querySelector("h2")?.textContent).toContain("next");

    fireEvent.change(range, { target: { value: "4" } });
    expect(panel?.querySelector("h2")?.textContent).not.toContain("next");
  });
});
