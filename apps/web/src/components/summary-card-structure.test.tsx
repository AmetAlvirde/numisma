// @vitest-environment jsdom
/**
 * `SummaryCard` ON THE SHARED `Card` — the with-a-heading half of the primitive's proof.
 *
 * THE FUND NAME IS THE PAGE'S `<h1>`. `/big-picture` has exactly one, this card carries
 * it, and the call site is the only thing that knows that — which is the entire reason
 * `CardTitle` takes a `level` and defaults it to 2. The primitive is now the single thing
 * in the layer that can silently demote it, and a page whose only heading is an `<h2>`
 * looks identical to a sighted reader while reading as a document with no title to
 * everything that navigates by headings.
 *
 * The class census pins the other risk of the conversion: this card's root class string
 * is now built by a primitive, and spec #403 forbids a new class name and requires
 * `styles.css` to be byte-identical. Both suppression arms are censused, because the warn
 * badge and the em dashes only exist on one of them.
 *
 * THE SUMMARY IS AUTHORED. No ledger output has been near this file.
 */
import { describe, expect, it } from "vitest";

import { classCensus, render, screen } from "../render.testkit.tsx";
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

describe("SummaryCard on the shared Card", () => {
  it("renders the fund name as the page's h1", () => {
    render(
      <SummaryCard summary={cleanSummary()} usdMxn={18.5} fundValueRendered />,
    );

    const headings = screen.getAllByRole("heading");
    expect(headings.map((node) => node.tagName)).toEqual(["H1"]);
    expect(headings[0]?.textContent).toBe("Test Fund");
  });

  it("emits the same class strings it emitted before the conversion", () => {
    const { container } = render(
      <SummaryCard summary={cleanSummary()} usdMxn={18.5} fundValueRendered />,
    );
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("SECTION");
    expect(classCensus(root!)).toEqual([
      "badge badge-ok",
      "card summary",
      "metrics",
      "muted",
      "pos",
      "summary-head",
    ]);
  });

  it("emits the same class strings on the suppressed arm too", () => {
    const { container } = render(
      <SummaryCard
        summary={cleanSummary()}
        usdMxn={18.5}
        fundValueRendered={false}
      />,
    );

    expect(classCensus(container.firstElementChild!)).toEqual([
      "absent",
      "badge badge-warn",
      "card summary",
      "metrics",
      "muted",
      "muted absent-why",
      "summary-head",
    ]);
  });
});
