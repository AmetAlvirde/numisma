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
 * THAT BYTE-IDENTITY HAS SINCE SPENT ITS ONE EXCEPTION. Spec #412 Slice 5 added a
 * `:root` block of `--nms-*` overrides to `styles.css` and changed nothing else: no rule
 * rewritten, no declaration moved, no class name touched. The census below is unaffected
 * by construction, which is the point of confining the edit to custom properties.
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

import {
  classTokens as tokens,
  DELETED_IN_SLICE_2,
  render,
  renderedClassNames,
  screen,
} from "../render.testkit.tsx";
import { CARD_SURFACE } from "./ui/Card.tsx";
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

  it("carries the card surface beside its own class", () => {
    const { container } = render(<DcaCard view={ladderView()} />);
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("SECTION");
    expect(root?.className).toBe(`${CARD_SURFACE} dca`);
  });

  it("converts every `muted` paragraph, all four margin edges included", () => {
    const { container } = render(<DcaCard view={unreadableView()} />);

    // The unreadable arm is the narrowest: one paragraph, and the whole of what this
    // card had to convert. `.muted` was `color: var(--muted); margin: 4px 0 0`, and
    // preflight is off, so `mt-1` alone would leave the UA's `p` margin on three edges.
    const paragraph = container.querySelector("p")!;
    for (const utility of ["text-[var(--muted)]", "m-0", "mt-1"]) {
      expect(tokens(paragraph)).toContain(utility);
    }
  });

  it("writes none of slice 2's deleted class names, on any of its three arms", () => {
    for (const view of [ladderView(), cadenceView(), unreadableView()]) {
      const { container } = render(<DcaCard view={view} />);
      for (const deleted of DELETED_IN_SLICE_2) {
        expect([...renderedClassNames(container.firstElementChild!)]).not.toContain(
          deleted,
        );
      }
    }
  });
});
