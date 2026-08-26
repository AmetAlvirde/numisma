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
 * ── NO ROUTER, ANYWHERE IN THIS FILE (spec #439 §4.6, S4) ───────────────────────────
 * It used to mount one: four `@tanstack/react-router` imports built a throwaway route
 * tree for the single case where the anchor renders. All four are gone, and that is what
 * makes this file portable at all — the package cannot depend on a router, and
 * `route-move.test.ts`'s dependency pin asserts its manifest exactly.
 *
 * The tap-through leaves through `renderLink` now, so the anchor arm is a SLOT arm: the
 * test passes a plain `<a>` and asserts the classes the package handed it. `to` and
 * `params` moved to `routes/index.tsx` with the slot, and `route-move.test.ts` reads them
 * there — that test is still the oracle for the link, this file for markup.
 *
 * THE PLANS ARE AUTHORED. No ledger output, and no plans-sidecar content, has been near
 * this file — the card renders counts, never lines, and neither does its fixture. The
 * literals live in `dca-card.fixtures.ts` beside the component, where the workbench
 * fixture reads the same ones.
 */
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  classTokens as tokens,
  render,
  absentSlots,
  screen,
} from "../testkit/render.testkit";
import { CARD_SURFACE } from "./card";
import { DcaCard } from "./dca-card";
import type { DcaView } from "./dca-card";
import {
  bareView,
  cadenceView,
  ladderView,
  ladderWithPlanId,
  unreadableView,
} from "./dca-card.fixtures";

/**
 * Every arm of the state badge, and the colour the deleted rules gave each one.
 *
 * NAMESPACED WITH THE COMPONENT (spec #439 §3.2, S4). Four of this card's ten reads are
 * here, and rewriting `STATE_TONE` without rewriting these four leaves a red naming the
 * exact string — which is this wave's parity evidence. Not loosened to a substring.
 */
const STATE_COLOURS = [
  ["pending", "text-[var(--nms-muted-foreground)]"],
  ["active", "text-[var(--nms-pos)]"],
  ["ended", "text-[var(--nms-muted-foreground)]"],
  ["unreadable", "text-[var(--nms-caution)]"],
] as const;

/**
 * The slot the app passes, reduced to what a package test can mount: a plain anchor.
 *
 * THE `href` IS `#` AND IS NEVER ASSERTED. It is there because an anchor without one is
 * `generic` to the accessibility tree, not `link`, and the tap target being reachable by
 * role is half of what the alert line is for. Where the anchor actually GOES is
 * `routes/index.tsx`'s decision, and `route-move.test.ts` reads the `to` and the `params`
 * there — this file asserts only what the package handed over.
 *
 * `seen` IS THE HALF THAT MATTERS. The classes reach the DOM whether or not the slot got
 * the `planId`, so the anchor alone cannot prove the widening landed; capturing the
 * argument is what does.
 */
function linkSlot(seen: { planId?: string }) {
  return ({ className, children, planId }: {
    className: string;
    children: ReactNode;
    planId: string;
  }) => {
    seen.planId = planId;
    return (
      <a className={className} href="#">
        {children}
      </a>
    );
  };
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
    // card had to convert. `.muted` set the recessed text colour and `margin: 4px 0 0`, and
    // preflight is off, so `mt-1` alone would leave the UA's `p` margin on three edges.
    const paragraph = container.querySelector("p")!;
    for (const utility of ["text-[var(--nms-muted-foreground)]", "m-0", "mt-1"]) {
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
    // NOT THIS CARD'S STRING TO WRITE, and not S4's to re-decide: the header cell comes
    // from `TABLE_HEAD_CELL`, which crossed with `SectionTable` in spec #439 S2 and was
    // rewritten there. This line was namespaced in that slice, while the card still sat
    // in `apps/web`, and it is left exactly as it stands — the card reads the six table
    // constants as siblings now and decides none of their colour.
    for (const utility of ["px-[10px]", "py-2", "border-b", "border-[var(--nms-border)]"]) {
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
    // This view supplies no `planId`, so the alert renders as prose — one of the two
    // absences that reach that arm, the other being an absent slot, which the case below
    // covers. Reached through the plan block rather than by text: the line and the span
    // inside it share every word, so a text query cannot say which of the two it found.
    const plan = screen.getByText("in force").parentElement!.parentElement!;
    const alert = plan.querySelectorAll("p")[1]!;
    expect(alert.textContent).toContain("needs recording");

    for (const utility of ["m-0", "mb-2", "text-[0.85rem]"]) {
      expect(tokens(alert)).toContain(utility);
    }
    expect(tokens(alert.querySelector("span")!)).toContain("text-[var(--nms-neg)]");
  });

  it("gives the tap target its box, its colour and a decoration on both states", () => {
    // THE KEYBOARD RING IS NOT ASSERTED HERE AND CANNOT BE. The deleted rule underlined
    // on `:focus-visible` and never touched `outline`; the ring is the user agent's, live
    // because preflight is off, and jsdom computes no cascade and paints no focus. What
    // this end holds is that the underline came across on BOTH states as variants — which
    // outrank the base by specificity rather than by emitted order — and that no utility
    // here suppresses an outline. Chrome, after a real Tab, holds the ring itself.
    const seen: { planId?: string } = {};
    const { container } = render(
      <DcaCard view={ladderWithPlanId()} renderLink={linkSlot(seen)} />,
    );
    const link = screen.getByRole("link");

    for (const utility of [
      "inline-block",
      "px-0",
      "py-1",
      "text-[var(--nms-foreground)]",
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

  it("renders the anchor THROUGH the slot, with no router in the tree", () => {
    // WHAT THE MOVE BOUGHT (spec #439 §4.6, S4). This card used to import `<Link>` and
    // this file used to build a throwaway router to mount it. Neither exists now: the
    // package hands the slot a class string and the view's `planId`, the caller returns
    // whatever anchor it likes, and nothing in this tree knows what a route is.
    //
    // THE `planId` IS THE WIDENING AND IT IS CHECKED BY CAPTURE, not by the DOM. The
    // classes arrive whether or not the slot was handed an id, so an anchor carrying
    // `ALERT_LINK` proves only half of it. `ladderWithPlanId()` is the one fixture that
    // supplies the field, and `test-plan` is the value the card holds the only copy of.
    const seen: { planId?: string } = {};
    render(<DcaCard view={ladderWithPlanId()} renderLink={linkSlot(seen)} />);

    expect(seen.planId).toBe("test-plan");
    const link = screen.getByRole("link");
    // The arrow is the PACKAGE's here, unlike `Crumb`'s: one destination, one direction,
    // and it sits inside the link with the alert text as one sentence. So it renders
    // where the link renders and nowhere else, which is what the case below pins.
    expect(link.textContent).toContain("→");
    expect(link.textContent).toContain("needs recording");
    // The id is a JOIN KEY, never a label. It reaches the slot and no rendered text.
    expect(link.textContent).not.toContain("test-plan");
  });

  it("renders the REAL unlinked arm when no slot is passed", () => {
    // OPTIONAL IS THE BETTER HALF, and this is the case that says why. `Crumb`'s fixture
    // has to supply a dead `<a href="#">` because a crumb with no link is not a state the
    // app produces. This card's IS one: `planId` is absent on every v4 row, and the alert
    // has always rendered as a plain paragraph there. So an absent slot degrades to a
    // state production emits, not to a stub — same counts, same box, no anchor, no arrow.
    const { container } = render(<DcaCard view={ladderWithPlanId()} />);

    expect(container.querySelectorAll("a")).toHaveLength(0);
    const plan = screen.getByText("in force").parentElement!.parentElement!;
    const alert = plan.querySelectorAll("p")[1]!;

    expect(alert.tagName).toBe("P");
    for (const utility of ["m-0", "mb-2", "text-[0.85rem]"]) {
      expect(tokens(alert)).toContain(utility);
    }
    expect(alert.textContent).toContain("2 rungs · 1 filled");
    expect(alert.textContent).toContain("needs recording");
    // The arrow lives inside the link, so it must not survive the link's absence.
    expect(alert.textContent).not.toContain("→");
  });

  it("still mounts each rungless arm's `Absent`, em dash and stated cause", () => {
    // THE WITNESS THE DELETED CENSUS USED TO BE. `main` pinned `"absent"` and
    // `"muted absent-why"` as PRESENT, which incidentally proved this card's three
    // rungless arms rendered at all; the branch asserted nothing about `Absent`
    // whatsoever, so `Rungs` returning `null` on any of them stayed green.
    //
    // ALL THREE ARMS, BY THEIR OWN WORDS. The causes are the whole point: "cadence plan"
    // and "plan ended" are declarations the operator made, and "plan unreadable" is a
    // file that could not be read. Asserting a count would let the three collapse into
    // one another silently, which is the difference between "no rungs, on purpose" and
    // "we could not tell you".
    //
    // FOUND BY THE EM DASH, the marker the primitive still writes now that the class is
    // gone, and the one `absent-contract.test.tsx` pins.
    const arms = [
      [cadenceView(), "—cadence plan — no rung ladder"],
      [bareView("ended"), "—plan ended"],
      [bareView("unreadable"), "—plan unreadable"],
    ] as const;

    for (const [view, cause] of arms) {
      const { container, unmount } = render(<DcaCard view={view} />);
      const slots = absentSlots(container);

      expect(slots).toHaveLength(1);
      expect(slots[0]?.textContent).toBe(cause);
      unmount();
    }

    // The ladder arm draws its rungs and no em dash, which is what makes the three above
    // suppression witnesses rather than a glyph this card always prints.
    expect(absentSlots(render(<DcaCard view={ladderView()} />).container)).toHaveLength(0);
  });
});
