// @vitest-environment jsdom
/**
 * `Absent`'s CONTRACT, WHICH NO SOURCE SCAN CAN REACH.
 *
 * The primitive's whole job is a distinction that only exists in the rendered
 * accessibility tree: the em dash is DECORATION and the reason is INFORMATION. A screen
 * reader that announces "dash" instead of "no current mark" has lost the entire point of
 * per-number suppression, and a grep over the source cannot tell the two spans apart.
 *
 * The default reason is the other half. Five components used to spell this markup
 * themselves, and two of them rendered `suppressed` when their reason enum resolved to
 * nothing. That arm survived the extraction as the prop's default, so it is pinned here
 * rather than left to the call sites that no longer spell it.
 *
 * Everything below is authored. No ledger output has been near this file.
 *
 * THE PRIMITIVE MOVED AND THE TEST DID NOT (spec #432 §4.1). `Absent` now ships from
 * `@numisma/components`, and this file imports it from that specifier rather than from a
 * path, so what it pins is the SHIPPED surface — the thing five call sites and the
 * workbench fixture get — instead of a local file that happens to be re-exported.
 */
import { describe, expect, it } from "vitest";

import { classTokens as tokens, render, screen } from "../../render.testkit.tsx";
import { Absent } from "@numisma/components";

describe("Absent", () => {
  it("hides the em dash from assistive technology and exposes the reason", () => {
    const { container } = render(<Absent why="no current mark" />);

    const dash = container.querySelector('[aria-hidden="true"]');
    expect(dash?.textContent).toBe("—");

    const why = screen.getByText("no current mark");
    expect(why.getAttribute("aria-hidden")).toBe(null);
    expect(why.closest('[aria-hidden="true"]')).toBe(null);
  });

  it("reads `suppressed` when no reason is given", () => {
    render(<Absent />);
    expect(screen.getByText("suppressed")).not.toBe(null);
  });

  it("carries `.absent`'s four declarations as utilities, and no longer writes the name", () => {
    // THE COLOUR IS THE ONE DECLARATION THAT CHANGED SPELLING. A package file may read
    // no house name, so both reads are `--nms-muted-foreground`, which `styles.css`
    // aliases onto the app's `--muted`. Same painted grey, reached through the
    // namespace — and NOT `--nms-muted`, which is the recessed surface.
    const { container } = render(<Absent why="no floor set" />);

    // FOUND BY THE EM DASH. The class name is gone (spec #420 slice 8) and the glyph is
    // what identifies this primitive anyway — it is the half of the contract the two
    // assertions above are about.
    const root = container.querySelector('span[aria-hidden="true"]')?.parentElement;
    expect(root?.tagName).toBe("SPAN");
    for (const utility of [
      "inline-flex",
      "items-baseline",
      "gap-1.5",
      "text-[var(--nms-muted-foreground)]",
    ]) {
      expect(tokens(root!)).toContain(utility);
    }
    // `absent` IS GONE (spec #420 slice 8). It survived its own rule for six slices as a
    // bare hook because three contextual rules selected through it; the last of those,
    // `.fp-detail .absent`, was deleted with the selected-rung card, so the name has
    // nothing behind it. Asserted from the other side now — the absence is the decision.
    expect(tokens(root!)).not.toContain("absent");
  });

  it("puts `.absent-why` and `.muted` on the reason, sized for the metrics context", () => {
    render(<Absent why="no floor set" />);
    const why = screen.getByText("no floor set");

    for (const utility of [
      "text-[0.72rem]",
      "font-medium",
      "text-[var(--nms-muted-foreground)]",
      // `.muted` set `margin: 4px 0 0` — three zeroed edges and one that is not.
      // Preflight is off, so only `mt-1` would leave the UA free on the other three.
      "m-0",
      "mt-1",
      // The `.metrics .muted` context, keyed off the element rather than the class,
      // because slice 3 deletes the class and keeps the `<dd>`.
      "[dd_&]:text-[0.75rem]",
      "[dd_&]:mt-0",
    ]) {
      expect(tokens(why)).toContain(utility);
    }
    for (const deleted of ["muted", "absent-why"]) {
      expect(tokens(why)).not.toContain(deleted);
    }
  });
});
