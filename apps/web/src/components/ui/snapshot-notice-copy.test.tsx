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
 * The version numbers here are authored, and deliberately not the real schema window —
 * the primitive renders whatever the route hands it, and pinning today's numbers would
 * make this test fail the day the engine's window moves for an unrelated reason.
 */
import { describe, expect, it } from "vitest";

import { classCensus, render, screen } from "../../render.testkit.tsx";
import { SnapshotEmptyNotice, SnapshotStaleNotice } from "./SnapshotNotice.tsx";

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

  it("emits the class strings the three routes emitted before the extraction", () => {
    const { container } = render(<SnapshotEmptyNotice />);
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("DIV");
    expect(classCensus(root!)).toEqual(["card notice"]);
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

  it("carries `error` alongside the class set the empty notice shares, plus the utilities that replaced its rule", () => {
    const { container } = render(
      <SnapshotStaleNotice storedVersion={2} min={4} max={6} />,
    );
    const root = container.firstElementChild;

    expect(root?.tagName).toBe("DIV");
    // Per class, `toContain`, never full-string equality (spec #420 Seam E). The old
    // census pinned the whole attribute, which made slice 1's two added utilities read
    // as a regression rather than as the conversion they are.
    const names = (root?.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    for (const name of ["card", "notice", "error"]) {
      expect(names).toContain(name);
    }
    // `.error` is deleted; the name above survives ONLY because `.notice.error h1` still
    // selects through it (slice 2's rule). Its own two declarations are utilities now.
    for (const utility of ["text-[var(--neg)]", "m-0"]) {
      expect(names).toContain(utility);
    }
  });
});
