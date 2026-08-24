// @vitest-environment jsdom
/**
 * `DcaCard` ON THE SHARED `Card` — the last of the five conversions.
 *
 * `DCA` is a section heading at level 2 on `/`, beneath the glance. Asserted rather
 * than assumed: `CardTitle` defaults to 2, and a default is exactly the kind of thing
 * that moves under a later card without anyone noticing here.
 *
 * This card emits the layer's densest class set — the plan head, the per-state badge, the
 * alert and its warn span, the rung table — which under spec #403 was held by a CENSUS of
 * the full class strings, because that spec forbade a new class name while requiring
 * `styles.css` to be byte-identical.
 *
 * BOTH OF THOSE CONSTRAINTS ARE SPENT AND THE INSTRUMENT HAS CHANGED WITH THEM. Spec #412
 * Slice 5 took the byte-identity's one exception (a `:root` block of `--nms-*` overrides,
 * no rule rewritten); spec #420 is now emptying the file surface by surface, and slices 4
 * and 6 took this card's. So the census is gone, replaced by Seam E's pair: the
 * load-bearing utilities are asserted PER CLASS with `toContain`, and no deleted class
 * name appears anywhere in the render. Full-string equality would have made every one of
 * these tests depend on Prettier's class sort order.
 *
 * FOUR ARMS, because the states emit disjoint sets, and the state badge gets a fifth pass
 * of its own: its colour used to be a base plus two overrides and is now a total map, so
 * the arm that was answered by the base is the one a conversion drops silently.
 *
 * A ROUTER FOR ONE CASE, AND ONLY ONE. The tap-through renders only where the wire
 * supplies a `planId`, so a plan without one exercises the whole card outside a router
 * context and four of the five cases take that path. The fifth mounts a throwaway router
 * because slice 6 converted the anchor itself. The link's `to` and `params` are pinned by
 * `route-move.test.ts`'s regexes, which this increment does not edit — that test is the
 * oracle for the link, this file for markup.
 *
 * THE PLANS ARE AUTHORED. No ledger output, and no plans-sidecar content, has been near
 * this file — the card renders counts, never lines, and neither does its fixture.
 */
import { describe, expect, it } from "vitest";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRouter,
} from "@tanstack/react-router";

import {
  classTokens as tokens,
  DELETED_IN_SLICE_2,
  DELETED_IN_SLICE_4,
  DELETED_IN_SLICE_6,
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

/**
 * A row in one of the two states the wire ships bare: `{ positionId, state }` and no plan
 * body at all. Both exist so the state badge can be walked on every arm rather than on
 * the one the live ledger happens to be in — the two colours slice 6 deleted were
 * OVERRIDES of a base, and the conversion replaced that cascade with a total map, so the
 * arms that used to be answered by the base are exactly the ones a partial map would drop.
 */
function bareView(state: "ended" | "unreadable"): DcaView {
  return {
    unreadable: false,
    unattributable: 0,
    positions: [{ positionId: `test-${state}`, state, rungs: [] }],
  };
}

/** Every arm of the state badge, and the colour the deleted rules gave each one. */
const STATE_COLOURS = [
  ["pending", "text-[var(--muted)]"],
  ["active", "text-[var(--pos)]"],
  ["ended", "text-[var(--muted)]"],
  ["unreadable", "text-[var(--warn)]"],
] as const;

/** The four renders that between them emit every class this card can emit. */
function everyArm(): DcaView[] {
  return [ladderView(), cadenceView(), unreadableView(), bareView("ended")];
}

/** The same ladder, with the one field that turns the alert line into a tap target. */
function ladderWithPlanId(): DcaView {
  const view = ladderView();
  return {
    ...view,
    positions: [{ ...view.positions[0]!, planId: "test-plan" }],
  };
}

/**
 * Mount the card inside a throwaway router, for the one arm that needs one.
 *
 * The docblock above is right that a plan WITHOUT a `planId` exercises the whole card
 * outside a router, and that stays the default here — four of the five cases below take
 * it. But slice 6 converted the anchor itself, and an anchor that never mounts is an
 * anchor no assertion can reach. The route tree is authored for this test and is not the
 * app's; `route-move.test.ts` remains the oracle for where the link points.
 *
 * AWAITED, because a TanStack router resolves its first match asynchronously: the
 * container is empty on the synchronous return.
 */
async function renderWithRouter(view: DcaView) {
  const rootRoute = createRootRoute({ component: () => <DcaCard view={view} /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  // The router's own type is registered against the app's route tree; this authored tree
  // is not that tree, which is the one place a test-local router has to say so.
  const result = render(<RouterProvider router={router as never} />);
  await screen.findByRole("link");
  return result;
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

  it("carries the table surface on its rung ladder, as slice 4's carrier", () => {
    // The scroller, the table element rules and the cell box are a shared rule and
    // `SectionTable` is the first surface in the spec's order that carries them, so
    // slice 4 deletes the rules and converts every carrier — including this ladder, in a
    // component that slice otherwise does not own (spec #420 Seam B). The strings are
    // imported from there rather than respelled, so this asserts the elements they
    // landed on, which is the half an import cannot guarantee.
    const { container } = render(<DcaCard view={ladderView()} />);
    const table = container.querySelector("table")!;

    for (const utility of [
      "@container/table-scroll",
      "overflow-x-auto",
      "[-webkit-overflow-scrolling:touch]",
    ]) {
      expect(tokens(table.parentElement!)).toContain(utility);
    }
    // The two-column ladder is exactly why the floor exists: without it this table
    // huddles at the left of its card instead of spanning it.
    for (const utility of ["w-max", "min-w-full", "@[380px]/table-scroll:w-full"]) {
      expect(tokens(table)).toContain(utility);
    }

    const rung = screen.getByRole("columnheader", { name: "Rung" });
    const price = screen.getByRole("columnheader", { name: "Limit price" });
    for (const utility of ["px-[10px]", "py-2", "border-b", "border-[var(--line)]"]) {
      expect(tokens(rung)).toContain(utility);
      expect(tokens(price)).toContain(utility);
    }
    expect(tokens(rung)).toContain("text-left");
    expect(tokens(price)).toContain("text-right");

    // The figures pan and align as figures, on the same terms as the composition table.
    const cells = screen.getAllByRole("cell");
    expect(tokens(cells[0]!)).toContain("text-left");
    expect(tokens(cells[1]!)).toContain("text-right");
    expect(tokens(cells[1]!)).toContain("px-[10px]");
  });

  it("carries the plan block's one margin edge and the head's whole wrapping row", () => {
    // The head is a `<p>` and preflight is off, so `m-0` is as load-bearing as the edge
    // that is kept: without it the UA's 1em top margin sits between the head and the
    // plan block's own 14px, and the card grows a gap nobody wrote. The block is a
    // `<div>`, which the UA gives no margin, so one edge is the whole of its rule.
    const { container } = render(<DcaCard view={ladderView()} />);
    const head = screen.getByText("in force").parentElement!;
    expect(head.tagName).toBe("P");

    for (const utility of [
      "flex",
      "flex-wrap",
      "items-baseline",
      "gap-2",
      "m-0",
      "mb-[6px]",
    ]) {
      expect(tokens(head)).toContain(utility);
    }
    expect(tokens(head.parentElement!)).toContain("mt-[14px]");
  });

  it("paints the state word on every arm, not only the one the wire is in", () => {
    // THE ARM THAT USED TO BE ANSWERED BY THE BASE IS THE ONE AT RISK. The deleted rules
    // were a grey base plus two colour overrides; the conversion replaced that with a
    // total map, because two unvariant colour utilities on one element are resolved by
    // Tailwind's emitted order rather than by source order. A map missing `pending` or
    // `ended` emits no colour at all and the word inherits the card's body text — legible,
    // plausible, and the wrong answer to *is this plan in force?*. So all four are walked.
    const views: Record<string, DcaView> = {
      pending: cadenceView(),
      active: ladderView(),
      ended: bareView("ended"),
      unreadable: bareView("unreadable"),
    };
    const copy: Record<string, string> = {
      pending: "pending",
      active: "in force",
      ended: "ended",
      unreadable: "unreadable",
    };

    for (const [state, colour] of STATE_COLOURS) {
      // Unmounted per arm rather than left to the harness's `afterEach`: four cards in
      // one document would make every `getByText` below ambiguous from the second arm on.
      const { unmount } = render(<DcaCard view={views[state]!} />);
      const word = screen.getByText(copy[state]!);

      for (const utility of [
        "text-[0.72rem]",
        "font-semibold",
        "uppercase",
        "tracking-[0.04em]",
      ]) {
        expect(tokens(word)).toContain(utility);
      }
      expect(tokens(word)).toContain(colour);
      // Exactly one colour reaches the element. The assertion above would pass just as
      // happily on a string carrying the deleted base grey beside the state's colour,
      // which is the coin toss the total map exists to remove.
      expect(tokens(word).filter((token) => token.startsWith("text-[var("))).toEqual([
        colour,
      ]);
      unmount();
    }
  });

  it("carries the alert line's box and its warn span's own colour", () => {
    render(<DcaCard view={ladderView()} />);
    // This view supplies no `planId`, so the alert renders as prose and the whole card
    // mounts outside a router — the arm the docblock above describes. Reached through the
    // plan block rather than by text: the line and the span inside it share every word,
    // so a text query cannot say which of the two it found.
    const plan = screen.getByText("in force").parentElement!.parentElement!;
    const alert = plan.querySelectorAll("p")[1]!;
    expect(alert.textContent).toContain("needs recording");

    for (const utility of ["m-0", "mb-2", "text-[0.85rem]"]) {
      expect(tokens(alert)).toContain(utility);
    }
    expect(tokens(alert.querySelector("span")!)).toContain("text-[var(--neg)]");
  });

  it("gives the tap target its box, its colour and a decoration on both states", async () => {
    // THE KEYBOARD RING IS NOT ASSERTED HERE AND CANNOT BE. The deleted rule underlined
    // on `:focus-visible` and never touched `outline`; the ring is the user agent's, live
    // because preflight is off, and jsdom computes no cascade and paints no focus. What
    // this end holds is that the underline came across on BOTH states as variants — which
    // outrank the base by specificity rather than by emitted order — and that no utility
    // here suppresses an outline. Chrome, after a real Tab, holds the ring itself.
    const { container } = await renderWithRouter(ladderWithPlanId());
    const link = await screen.findByRole("link");

    for (const utility of [
      "inline-block",
      "px-0",
      "py-1",
      "text-[var(--text)]",
      "no-underline",
      "hover:underline",
      "focus-visible:underline",
    ]) {
      expect(tokens(link)).toContain(utility);
    }
    for (const token of tokens(link)) {
      expect(token).not.toMatch(/outline/);
    }
    // The line still wraps the link rather than being replaced by it.
    expect(link.parentElement?.tagName).toBe("P");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("writes none of the deleted class names, on any of its four arms", () => {
    for (const view of everyArm()) {
      const { container, unmount } = render(<DcaCard view={view} />);
      for (const deleted of [
        ...DELETED_IN_SLICE_2,
        ...DELETED_IN_SLICE_4,
        ...DELETED_IN_SLICE_6,
      ]) {
        expect([...renderedClassNames(container.firstElementChild!)]).not.toContain(
          deleted,
        );
      }
      unmount();
    }
  });

  it("writes none of them on the router arm either, where the link is", () => {
    // The four arms above all render outside a router and so never emit the anchor. The
    // alert's deleted rules hung off the `<p>`, not off the link, but the link is the one
    // element in this card no other case in this file mounts.
    return renderWithRouter(ladderWithPlanId()).then(({ container }) => {
      for (const deleted of [
        ...DELETED_IN_SLICE_2,
        ...DELETED_IN_SLICE_4,
        ...DELETED_IN_SLICE_6,
      ]) {
        expect([...renderedClassNames(container.firstElementChild!)]).not.toContain(
          deleted,
        );
      }
    });
  });
});
