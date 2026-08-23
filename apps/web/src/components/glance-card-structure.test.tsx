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

  it("writes none of slice 2's deleted class names", () => {
    const { container } = render(<GlanceCard verdict={standingVerdict()} />);
    const rendered = renderedClassNames(container.firstElementChild!);

    for (const deleted of DELETED_IN_SLICE_2) {
      expect([...rendered]).not.toContain(deleted);
    }
    // `absent` is the one hook that stays, for three later slices' contextual rules.
    expect([...rendered]).toContain("absent");
  });
});
