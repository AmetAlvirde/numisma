// @vitest-environment jsdom
/**
 * `GlanceCard` ON THE SHARED `Card` — the no-heading half of the primitive's proof.
 *
 * The glance opens with a verdict SENTENCE, not a heading, and that is a decision rather
 * than an omission: the card's whole job is delivering the answer before the eye reaches
 * the numbers, and a heading above the sentence would put a label in front of the one
 * line the surface exists to say. `Card` makes headings easy to add, so this is now the
 * kind of thing a well-meaning diff adds. It renders no heading, asserted.
 *
 * The class census is the other half. Spec #403 moved this card's root element onto a
 * primitive that builds the class string for it, while forbidding any new class name; a
 * dropped, reordered or invented token is invisible in a diff and this is what saw it.
 * Spec #420 slice 5 converts the card and the census becomes its SUCCESSOR (Seam E): the
 * load-bearing utilities are asserted per class with `toContain`, and the four deleted
 * class names are asserted absent from the whole render. Full-string equality is gone on
 * purpose — a converted element's class attribute is a dozen ordered utilities, and
 * pinning the string would make this test depend on Prettier's class sort order.
 *
 * THE ROOT'S TWO CONTAINER CLASSES ARE THE ONE ASSERTION HERE THAT IS NOT ROUTINE.
 * `.glance` declared `container-name: glance metrics-card`, and `metrics-card` is what
 * slice 3's `@[380px]/metrics-card:` variants on the list below answer to. Tailwind's
 * named container utility emits the `container` shorthand and can therefore carry only
 * ONE name, so the pair is written as the bare container type plus an arbitrary
 * `container-name`. This file asserts that both classes are on the element. It cannot
 * assert that both names RESOLVE — jsdom lays nothing out and answers no container query
 * — so the value half is Chrome's, by binary-searching the reflow width.
 *
 * THE VERDICT IS AUTHORED, not composed through `verdict.ts`. This file asserts markup,
 * and `verdict.test.ts` is the oracle for what the fields should contain; a fixture that
 * ran the real derivation would test the derivation twice and pin the markup once. No
 * ledger output has been near this file.
 */
import { describe, expect, it } from "vitest";

import {
  classTokens as tokens,
  render,
  absentSlots,
  screen,
} from "../render.testkit.tsx";
import { CARD_SURFACE } from "@numisma/components";
import { GlanceCard } from "./GlanceCard.tsx";
import type { Verdict } from "../glance/verdict.ts";

/** The widest arm: one rendered slot, one suppressed slot with a named reference. */
function standingVerdict(): Verdict {
  return {
    asOf: "2026-01-05",
    staleDays: 0,
    needsYou: false,
    sentence: "Nothing needs you.",
    fired: [],
    slots: {
      fundValue: { rendered: true, usdValue: 1234.5 },
      change: {
        rendered: false,
        referenceLabel: "Mon 5 Jan",
        suppressedBy: "reference-withheld",
      },
      reserve: { rendered: true, percentOfFund: 12.25, floorPct: 10 },
    },
  };
}

describe("GlanceCard on the shared Card", () => {
  it("renders no heading — the verdict sentence opens the card", () => {
    render(<GlanceCard verdict={standingVerdict()} />);
    expect(screen.queryAllByRole("heading")).toEqual([]);
    expect(screen.getByText("Nothing needs you.")).not.toBe(null);
  });

  it("carries the card surface and the converted shared vocabulary", () => {
    const { container } = render(<GlanceCard verdict={standingVerdict()} />);
    const root = container.firstElementChild!;

    expect(root.tagName).toBe("SECTION");
    for (const utility of CARD_SURFACE.split(" ")) {
      expect(tokens(root)).toContain(utility);
    }

    // `.muted` was `color: var(--muted); margin: 4px 0 0`. Preflight is off, so the
    // three zeroed edges are as load-bearing as the one that is not.
    const asOf = screen.getByText(/^as of/);
    expect(asOf.tagName).toBe("P");
    for (const utility of ["text-[var(--muted)]", "m-0", "mt-1"]) {
      expect(tokens(asOf)).toContain(utility);
    }

    // The three trailing references sit in a metrics `<dd>`, where `.metrics .muted`
    // (slice 3's, and now dead) beat `.muted` on size, weight and margin. Those three
    // declarations are on the spans themselves, since the context is static here.
    const reference = screen.getByText(/floor/);
    for (const utility of [
      "text-[var(--muted)]",
      "text-[0.75rem]",
      "font-medium",
      "m-0",
    ]) {
      expect(tokens(reference)).toContain(utility);
    }
  });

  it("declares the query container with BOTH of the names the rule carried", () => {
    const { container } = render(<GlanceCard verdict={standingVerdict()} />);
    const root = container.firstElementChild!;

    // Two classes, not one, and the pair is the whole contract. The bare utility is the
    // containment; the arbitrary property is the name pair, underscore for space. Writing
    // the named utility instead would emit `container: glance / inline-size` and take
    // `metrics-card` away from the list below without failing anything here.
    expect(tokens(root)).toContain("@container");
    expect(tokens(root)).toContain("[container-name:glance_metrics-card]");
  });

  it("paints the verdict line, and paints the two arms opposite colours", () => {
    // `.verdict` was `margin: 0; font-size: 1.5rem; line-height: 1.25; font-weight: 650;
    // letter-spacing: -0.01em`. Preflight is off, so the `<p>`'s four UA margin edges are
    // live and `m-0` is a declaration rather than a formality.
    const standing = render(<GlanceCard verdict={standingVerdict()} />);
    const settled = standing.getByText("Nothing needs you.");
    expect(settled.tagName).toBe("P");
    for (const utility of [
      "m-0",
      "text-[1.5rem]",
      "leading-tight",
      "font-[650]",
      "tracking-[-0.01em]",
    ]) {
      expect(tokens(settled)).toContain(utility);
    }

    // INVERTED AGAINST THE CLASS NAMES THAT ARE GONE, and unchanged: `.verdict-no` — the
    // settled arm — was `var(--pos)`, and `.verdict-yes`, the arm that needs the operator,
    // was `var(--neg)`. The alarming answer gets the alarming colour.
    expect(tokens(settled)).toContain("text-[var(--pos)]");

    const alarming = standingVerdict();
    alarming.needsYou = true;
    alarming.sentence = "Reserve is under its floor.";
    render(<GlanceCard verdict={alarming} />);
    expect(tokens(screen.getByText("Reserve is under its floor."))).toContain(
      "text-[var(--neg)]",
    );
  });

  it("carries the shared metrics grid, as slice 3's carrier", () => {
    render(<GlanceCard verdict={standingVerdict()} />);

    // `.metrics` and its `@container metrics-card` arm are a shared rule; the summary
    // card is the first surface in the spec's order that carries them, so slice 3
    // deletes the rule and converts this list too (spec #420 Seam B). The breakpoint
    // keeps its NAME precisely so both cards still reflow at the same card width, and
    // the container itself is still declared by `.glance`, which is slice 5's to move.
    const list = screen.getByText("Fund value").closest("dl")!;
    for (const utility of [
      "grid",
      "grid-cols-1",
      "gap-2",
      "m-0",
      "mt-4",
      "@[380px]/metrics-card:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]",
      "@[380px]/metrics-card:gap-3",
    ]) {
      expect(tokens(list)).toContain(utility);
    }

    const row = screen.getByText("Fund value").closest("div")!;
    for (const utility of [
      "grid",
      "grid-cols-[auto_minmax(0,1fr)]",
      "items-baseline",
      "gap-x-[10px]",
      "@[380px]/metrics-card:block",
    ]) {
      expect(tokens(row)).toContain(utility);
    }

    for (const utility of ["text-[var(--muted)]", "text-[0.8rem]"]) {
      expect(tokens(screen.getByText("Fund value"))).toContain(utility);
    }
    for (const utility of [
      "m-0",
      "text-[1.15rem]",
      "font-semibold",
      "tabular-nums",
      "text-right",
      "@[380px]/metrics-card:mt-[2px]",
      "@[380px]/metrics-card:text-left",
    ]) {
      expect(tokens(screen.getByText(/1,234/).closest("dd")!)).toContain(utility);
    }
  });

  it("paints a rendered change with the sign colour it earned", () => {
    const rising = standingVerdict();
    rising.slots.change = {
      rendered: true,
      percent: 1.83,
      referenceLabel: "Mon 5 Jan",
    };
    render(<GlanceCard verdict={rising} />);
    expect(tokens(screen.getByText(/▲/))).toContain("text-[var(--pos)]");

    const falling = standingVerdict();
    falling.slots.change = {
      rendered: true,
      percent: -1.83,
      referenceLabel: "Mon 5 Jan",
    };
    render(<GlanceCard verdict={falling} />);
    expect(tokens(screen.getByText(/▼/))).toContain("text-[var(--neg)]");
  });

  it("still mounts the suppressed change's `Absent`, em dash and stated cause", () => {
    // THE WITNESS THE DELETED CENSUS USED TO BE. `main` pinned `"absent"` and
    // `"muted absent-why"` as PRESENT, which incidentally proved this card's suppression
    // path rendered at all; the successor asserts the inverse, and `not.toContain` is
    // satisfied just as well by the element being gone. `GlanceCard.tsx`'s `Change`
    // returning `null` would leave every other assertion in this file green while the
    // card shipped printing nothing where a cause belongs.
    //
    // FOUND BY THE EM DASH, which is the marker the primitive still writes now that the
    // class name is gone, and the one `absent-contract.test.tsx` pins.
    const { container } = render(<GlanceCard verdict={standingVerdict()} />);
    const slots = absentSlots(container);

    expect(slots).toHaveLength(1);
    // The fixture withholds the reference, so the cause is that vocabulary's words and
    // not the primitive's `suppressed` default.
    expect(slots[0]?.textContent).toBe("—reference withheld");
  });
});
