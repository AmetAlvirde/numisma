// @vitest-environment jsdom
/**
 * `DcaCard` ON THE SHARED `Card` — the last of the five conversions.
 *
 * `DCA` is a section heading at level 2 on `/`, beneath the glance. Asserted rather
 * than assumed: `CardTitle` defaults to 2, and a default is exactly the kind of thing
 * that moves under a later card without anyone noticing here.
 *
 * The class census carries the rest. This card emits the layer's densest class set —
 * the plan head, the per-state badge, the alert and its warn span, the rung table —
 * and spec #403 forbids a new class name while requiring `styles.css` to be
 * byte-identical. Three arms, because the states emit disjoint sets.
 *
 * NO ROUTER HERE, DELIBERATELY. The tap-through renders only where the wire supplies a
 * `planId`, so a plan without one exercises the whole card outside a router context.
 * The link's `to` and `params` are pinned by `route-move.test.ts`'s regexes, which this
 * increment does not edit — that test is the oracle for the link, this file for markup.
 *
 * THE PLANS ARE AUTHORED. No ledger output, and no plans-sidecar content, has been near
 * this file — the card renders counts, never lines, and neither does its fixture.
 */
import { describe, expect, it } from "vitest";

import { classCensus, render, screen } from "../render.testkit.tsx";
import { DcaCard } from "./DcaCard.tsx";
import type { DcaView } from "../glance/dca-view.ts";

/** An in-force ladder with rungs, an alert, and something needing recording. */
function ladderView(): DcaView {
  return {
    unreadable: false,
    unattributable: 0,
    positions: [
      {
        positionId: "test-ladder",
        state: "active",
        kind: "dcaLadder",
        rungs: [{ priceUsd: 900 }, { priceUsd: 800 }],
        alert: { rungs: 2, filled: 1, needsRecording: 1 },
      },
    ],
  };
}

/** A cadence plan: honestly rungless, no alert, so the absence copy is what renders. */
function cadenceView(): DcaView {
  return {
    unreadable: false,
    unattributable: 0,
    positions: [
      { positionId: "test-cadence", state: "pending", kind: "dcaTime", rungs: [] },
    ],
  };
}

/** The unreadable file — which is never "no plans declared", and says so. */
function unreadableView(): DcaView {
  return { unreadable: true, unattributable: 2, positions: [] };
}

describe("DcaCard on the shared Card", () => {
  it("renders its own heading as an h2", () => {
    render(<DcaCard view={ladderView()} />);

    const headings = screen.getAllByRole("heading");
    expect(headings.map((node) => node.tagName)).toEqual(["H2"]);
    expect(headings[0]?.textContent).toBe("DCA");
  });

  it("emits the same class strings it emitted before the conversion", () => {
    const { container } = render(<DcaCard view={ladderView()} />);
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("SECTION");
    expect(classCensus(root!)).toEqual([
      "card dca",
      "dca-alert",
      "dca-alert-warn",
      "dca-head",
      "dca-plan",
      "dca-state dca-state-active",
      "muted",
      "num",
      "table-scroll",
    ]);
  });

  it("emits the same class strings on the rungless arm too", () => {
    const { container } = render(<DcaCard view={cadenceView()} />);

    expect(classCensus(container.firstElementChild!)).toEqual([
      "absent",
      "card dca",
      "dca-head",
      "dca-plan",
      "dca-state dca-state-pending",
      "muted",
      "muted absent-why",
    ]);
  });

  it("emits the same class strings when the plans file is unreadable", () => {
    const { container } = render(<DcaCard view={unreadableView()} />);

    expect(classCensus(container.firstElementChild!)).toEqual([
      "card dca",
      "muted",
    ]);
  });
});
