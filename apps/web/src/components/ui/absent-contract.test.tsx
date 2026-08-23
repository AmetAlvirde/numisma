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
 */
import { describe, expect, it } from "vitest";

import { render, screen } from "../../render.testkit.tsx";
import { Absent } from "./Absent.tsx";

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

  it("emits the class strings the stylesheet already carries", () => {
    const { container } = render(<Absent why="no floor set" />);

    const root = container.querySelector(".absent");
    expect(root?.tagName).toBe("SPAN");
    expect(screen.getByText("no floor set").className).toBe("muted absent-why");
  });
});
