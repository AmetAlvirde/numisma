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
 * invisible in a diff and this is what sees it.
 *
 * THE VERDICT IS AUTHORED, not composed through `verdict.ts`. This file asserts markup,
 * and `verdict.test.ts` is the oracle for what the fields should contain; a fixture that
 * ran the real derivation would test the derivation twice and pin the markup once. No
 * ledger output has been near this file.
 */
import { describe, expect, it } from "vitest";

import { classCensus, render, screen } from "../render.testkit.tsx";
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

  it("emits the same class strings it emitted before the conversion", () => {
    const { container } = render(<GlanceCard verdict={standingVerdict()} />);
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("SECTION");
    expect(classCensus(root!)).toEqual([
      "absent",
      "card glance",
      "metrics",
      "muted",
      "muted absent-why",
      "verdict verdict-no",
    ]);
  });
});
