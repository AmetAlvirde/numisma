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
 * The class census is the other half. Spec #403 moves this card's root element onto a
 * primitive that builds the class string for it, while forbidding any new class name and
 * requiring `styles.css` to be byte-identical. A dropped, reordered or invented token is
 * invisible in a diff and this is what sees it. Spec #412 Slice 5 spends that file's one
 * sanctioned edit on a `:root` block of `--nms-*` overrides; it adds custom properties
 * and touches no selector, so this census is the same instrument it was.
 *
 * THE VERDICT IS AUTHORED, not composed through `verdict.ts`. This file asserts markup,
 * and `verdict.test.ts` is the oracle for what the fields should contain; a fixture that
 * ran the real derivation would test the derivation twice and pin the markup once. No
 * ledger output has been near this file.
 */
import { describe, expect, it } from "vitest";

import {
  classTokens as tokens,
  DELETED_IN_SLICE_2,
  DELETED_IN_SLICE_3,
  render,
  renderedClassNames,
  screen,
} from "../render.testkit.tsx";
import { CARD_SURFACE } from "./ui/Card.tsx";
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
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("SECTION");
    expect(root?.className).toBe(`${CARD_SURFACE} glance`);

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

  it("writes none of the deleted class names", () => {
    const { container } = render(<GlanceCard verdict={standingVerdict()} />);
    const rendered = renderedClassNames(container.firstElementChild!);

    for (const deleted of [...DELETED_IN_SLICE_2, ...DELETED_IN_SLICE_3]) {
      expect([...rendered]).not.toContain(deleted);
    }
    // `absent` is the one hook that stays, for three later slices' contextual rules.
    expect([...rendered]).toContain("absent");
  });
});
