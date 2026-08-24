// @vitest-environment jsdom
/**
 * THE GUARD NOTICES' COPY, PINNED WHERE IT NOW LIVES ONCE.
 *
 * Three routes spelled these two notices out in full. The extraction's whole claim is
 * that all three pages still say exactly what they said, so the copy is asserted as a
 * whole normalized sentence rather than by keyword: a dropped clause, a lost space
 * around an interpolated `<strong>`, or a version range rendered with the wrong dash
 * would all survive a `toContain("schema version")`.
 *
 * THE VERSION NUMBERS ARE THE POINT OF THE SECOND ONE. "Refusing to render" without them
 * leaves the operator nothing to act on. They are interpolated, so they are the part an
 * extraction can silently drop, and they are asserted individually as well as in the
 * sentence.
 *
 * The class census covers the rest: `card notice` on both, plus `error` on the stale
 * variant and nowhere else. Spec #403 forbade a new class name and required
 * `styles.css` to be byte-identical; spec #420 is the migration that unmakes the second
 * half of that, so the stale variant's census is now the successor shape (Seam E) —
 * per class, `toContain` — and carries the two utilities that replaced `.error`.
 *
 * ── IT STAYS IN `apps/web` AND IMPORTS THE SHIPPED SURFACE (spec #432 §4.6) ──────────
 * The notices now live in `packages/components`; this file did not follow them, because
 * it renders through `../../render.testkit.tsx`, whose header states RTL is imported at
 * exactly one path in this repo, and the package has neither RTL nor jsdom. Importing
 * from `"@numisma/components"` rather than a relative path is the better half of that
 * accident: the copy is asserted against the surface consumers actually get, so an export
 * dropped from `index.ts` reds here rather than passing against a file still on disk.
 *
 * The version numbers here are authored, and deliberately not the real schema window —
 * the primitive renders whatever the route hands it, and pinning today's numbers would
 * make this test fail the day the engine's window moves for an unrelated reason.
 */
import { describe, expect, it } from "vitest";

import {
  classTokens as tokens,
  render,
  renderedClassNames,
  screen,
} from "../../render.testkit.tsx";
import {
  CARD_SURFACE,
  NOTICE_CODE,
  SnapshotEmptyNotice,
  SnapshotStaleNotice,
} from "@numisma/components";

/** JSX collapses its own newlines; the DOM keeps them. Compare on words. */
function text(node: Element): string {
  return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

describe("SnapshotEmptyNotice", () => {
  it("says the projection is empty and names the command that fills it", () => {
    const { container } = render(<SnapshotEmptyNotice />);

    const headings = screen.getAllByRole("heading");
    expect(headings.map((node) => node.tagName)).toEqual(["H1"]);
    expect(headings[0]?.textContent).toBe("No snapshot yet");

    expect(text(container.querySelector("p")!)).toBe(
      "The projection is empty. Run pnpm push to publish the latest composition report.",
    );
    // The command is marked up as one, not merely spelled in a sentence.
    expect(container.querySelector("code")?.textContent).toBe("pnpm push");
  });

  it("paints the card surface and the code chip, and writes neither class name", () => {
    const { container } = render(<SnapshotEmptyNotice />);
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("DIV");
    expect(root?.className).toBe(CARD_SURFACE);
    // `.notice code` painted the inline command chip. `rounded-[6px]` and not
    // `rounded-md`: the theme remaps `--radius-md` to the package's 8px control radius,
    // so the default-scale class compiles and paints the wrong corner.
    expect(container.querySelector("code")?.className).toBe(NOTICE_CODE);
    expect(NOTICE_CODE.split(" ")).toEqual([
      "rounded-[6px]",
      "bg-black",
      "text-white",
      "px-1.5",
      "py-0.5",
    ]);

    for (const deleted of ["card", "notice"]) {
      expect([...renderedClassNames(root!)]).not.toContain(deleted);
    }
  });
});

describe("SnapshotStaleNotice", () => {
  it("names the stored version, the supported window, and the way out", () => {
    const { container } = render(
      <SnapshotStaleNotice storedVersion={2} min={4} max={6} />,
    );

    const headings = screen.getAllByRole("heading");
    expect(headings.map((node) => node.tagName)).toEqual(["H1"]);
    expect(headings[0]?.textContent).toBe(
      "Schema version mismatch — refusing to render",
    );

    expect(text(container.querySelector("p")!)).toBe(
      "The stored snapshot is schema version 2, which is outside the versions this app " +
        "supports (4–6). Re-run the push shell with a matching engine build before viewing.",
    );
  });

  it("renders the three numbers as emphasized figures, not as prose", () => {
    const { container } = render(
      <SnapshotStaleNotice storedVersion={2} min={4} max={6} />,
    );

    expect([...container.querySelectorAll("strong")].map(text)).toEqual([
      "2",
      "4–6",
    ]);
  });

  it("paints the refusal in the negative colour, on the heading as well as the box", () => {
    const { container } = render(
      <SnapshotStaleNotice storedVersion={2} min={4} max={6} />,
    );
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("DIV");
    // Per class, `toContain`, never full-string equality (spec #420 Seam E).
    // `--nms-neg`, not `--neg`: the component now lives in `packages/components`, where
    // the namespace guard forbids a bare house read, and `styles.css` aliases the
    // package name onto `--neg` so the app paints the colour it painted before.
    for (const utility of [
      ...CARD_SURFACE.split(" "),
      "text-[var(--nms-neg)]",
      "m-0",
    ]) {
      expect(tokens(root!)).toContain(utility);
    }
    // `.notice.error h1` is deleted and this is where it went. The heading would inherit
    // the colour from the box anyway; it is written because the rule painted the heading
    // and an element that leans on its parent reads as an omission next time.
    expect(tokens(screen.getByRole("heading"))).toContain("text-[var(--nms-neg)]");

    // The last two hooks in this file go with the rules that needed them: slice 1 kept
    // `error` alive only because `.notice.error h1` still selected through it.
    for (const deleted of ["card", "notice", "error"]) {
      expect([...renderedClassNames(root!)]).not.toContain(deleted);
    }
  });
});
