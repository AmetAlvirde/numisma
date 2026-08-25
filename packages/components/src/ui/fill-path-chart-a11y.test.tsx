// @vitest-environment jsdom
/**
 * T7 — THE CHART'S ACCESSIBILITY INVARIANT, ASSERTED RATHER THAN PROMISED.
 *
 * ADR-019 decided that `PriceDropPathChart` is presentation only: the chart subtree is
 * `aria-hidden`, nothing inside it is reachable by keyboard, and the picture's one
 * irreplaceable fact — the shape of the capital curve — reaches the accessibility tree
 * through a GENERATED `.sr-only` caption beside it. Until ADR-022 bought this harness,
 * that invariant was held by a paragraph of prose, and `docs/coverage-rationale.md` §6
 * carried it as the audit's T7: blocked, guarded by an ADR, not by a test.
 *
 * THE SILENT FAILURE THIS FILE EXISTS TO CATCH is deleting the `.sr-only` caption element
 * as empty markup. It is invisible to every sighted reader, including every sighted
 * reviewer of every future diff, so removing it breaks nothing anyone can see while
 * severing the chart's only route into the accessibility tree.
 *
 * IT MOVED INTO THE PACKAGE AT SPEC #439 S9, with the component it mounts. Its view is
 * now an authored literal from `fill-path.fixtures.ts` rather than a value composed
 * through `apps/web`, which a package test cannot reach — see the third case's own
 * docblock for what that costs and where the cost was paid.
 *
 * THE CHART IS MOUNTED FOR REAL. No mock stands in for `@tanstack/charts`: a stand-in
 * cannot answer "is anything inside this subtree focusable", and that question is the one
 * that catches a future library upgrade mounting a focusable surface. The harness stubs
 * the browser measurement APIs jsdom lacks (`render.testkit.tsx`); it does not stub the
 * component under test.
 *
 * WHAT THE FOCUS ASSERTION IS AND IS NOT PINNING, measured rather than assumed. Under
 * `@tanstack/charts` 0.11.0 the adapter renders `tabindex="-1"` on its `<svg>` surface
 * whatever `tabIndex`, `focus` and `keyboard` are set to — flipping each of the three and
 * re-running left this file green. So it does NOT pin those four neutralization props;
 * ADR-019's prose still holds them and `PriceDropPathChart`'s header still explains them.
 * What it pins is the RENDERED OUTCOME: this subtree, as it actually mounts today,
 * contains nothing a Tab reaches. That is the claim a version bump can break silently,
 * and adding one `<button>` anywhere under `.fp-chart` turns this red — which is how the
 * assertion was checked for teeth rather than assumed to have them.
 */
import { describe, expect, it } from "vitest";

import { render } from "../testkit/render.testkit";
import { FillPathCards } from "./fill-path";
import { partlyWalkedView } from "./fill-path.fixtures";

/**
 * The tabbable selector, spelled once. `[tabindex="-1"]` is excluded on purpose: a
 * negative tabindex is programmatically focusable and NOT reachable by keyboard, and it
 * is exactly the neutralization ADR-019 records as load-bearing on the chart surface.
 * Matching it would turn the fix into the failure.
 */
const TABBABLE =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

describe("the fill-path chart's accessibility contract (ADR-019)", () => {
  it("hides the chart subtree from the accessibility tree", () => {
    const { container } = render(<FillPathCards view={partlyWalkedView()} />);

    const chart = container.querySelector(".fp-chart");
    expect(chart).not.toBeNull();
    expect(chart?.getAttribute("aria-hidden")).toBe("true");
  });

  it("mounts nothing keyboard-reachable inside that subtree", () => {
    const { container } = render(<FillPathCards view={partlyWalkedView()} />);

    const chart = container.querySelector(".fp-chart");
    expect(chart).not.toBeNull();
    expect([...(chart?.querySelectorAll(TABBABLE) ?? [])]).toEqual([]);

    // THE EMPTY QUERY ABOVE MUST NOT BE EMPTY BECAUSE NOTHING MOUNTED. jsdom measures
    // every element at zero, so a chart that silently declined to draw would satisfy the
    // assertion vacuously and satisfy it forever. The adapter's own surface carries a
    // negative tabindex, so its presence is the cheapest proof that a real chart is in
    // this subtree and that the empty result is a fact about it.
    expect(chart?.querySelector('[tabindex="-1"]')).not.toBeNull();
  });

  /**
   * ── WHAT THIS CASE PROVES CHANGED AT SPEC #439 S9, AND THE CHANGE IS REAL ─────────
   *
   * It used to recompute the caption by calling `convexityCaption` from
   * `apps/web/src/ladder/` over the view's own rungs and compare the two. That proved
   * the caption is GENERATED from the data the chart is drawn from — a literal here
   * would have been the hand-maintained chart description ADR-019 exists to forbid,
   * smuggled in as a test expectation, drifting from the picture while staying green.
   *
   * This file now lives in the package and cannot call that function. It asserts against
   * `view.caption`, and the view is an authored fixture, so `view.caption` IS a literal.
   * What survives here is the COMPONENT-LEVEL claim, which is the one this file is the
   * right place for: the chart renders the field it was handed rather than inventing
   * prose of its own.
   *
   * THE PROPERTY THE OLD DOCBLOCK WAS PROTECTING MOVED, IT WAS NOT DROPPED. That the
   * caption is generated from the rungs is pinned by
   * `apps/web/src/ladder/fill-path-fixture-equivalence.test.ts`, which deep-compares
   * every authored fixture against `composeFillPathPage` — caption included, on all four
   * ladder states. Without this paragraph the next reader sees exactly the regression the
   * old docblock forbade.
   */
  it("renders the caption it was handed as the chart's screen-reader substitute", () => {
    const view = partlyWalkedView();
    const { container } = render(<FillPathCards view={view} />);

    // OFF THE VIEW, NEVER OFF A STRING WRITTEN HERE. Reading `view.caption` is what makes
    // this a claim about the component: a sentence typed into this file would pass
    // against a card that ignored the field and printed its own.
    expect(view.caption).toBeTypeOf("string");

    const substitute = container.querySelector(".sr-only");
    expect(substitute).not.toBeNull();
    expect(substitute?.textContent).toBe(view.caption);
  });
});
