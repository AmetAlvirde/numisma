import type { ReactElement, ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * THE WAY BACK UP — the fourth part of spec #403's Seam D.
 *
 * The crumb was defined once inside the ladder route, called three times there, and
 * spelled out a fourth time as raw JSX on `/big-picture`. The `/` crumb points the other
 * way, down to the big picture, which is why the private version could never absorb it.
 *
 * ── BOTH PROPS ARE REQUIRED, AND THE DESTINATION IS ONE OF THEM ──────────────────────
 * The route-local version took neither: it hard-coded `to="/"` and `← Glance`, which is
 * correct for exactly the surfaces that sit one tap below the glance and silently wrong
 * for the first caller that does not. A crumb whose destination is implicit is a bug
 * waiting for its third caller. All four call sites pass what they already rendered, so
 * nothing on any page moves.
 *
 * The ARROW IS THE CALLER'S. `← Glance` and `Big picture →` point opposite ways, and a
 * component that decided the glyph from the destination would be guessing at the
 * page's geography from a string.
 *
 * ── THE STYLING IS HERE NOW (spec #420 slice 2) ──────────────────────────────────────
 * `.crumb`, `.crumb a` and `.crumb a:hover` are deleted from `styles.css` and this is
 * where they landed, which is the payoff for spec #403 having pulled the four call sites
 * onto one component first: the hover state converts once instead of four times.
 *
 * `m-0` IS NOT DECORATION. Preflight is off, so the UA's own `p` margin is live and
 * `.crumb`'s `margin: 0` was holding it off on all four edges. Dropping it would push
 * every crumb 16px down the page with nothing in the diff to say why.
 */
export function Crumb({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}): ReactElement {
  return (
    <p className="m-0 text-[0.9rem]">
      <Link
        className="text-[var(--muted)] no-underline hover:text-[var(--text)]"
        to={to}
      >
        {children}
      </Link>
    </p>
  );
}
