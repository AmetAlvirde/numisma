import type { ReactNode } from "react";
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
 * This is a `<p className="crumb">` because that is what all four call sites render
 * today. No new class name is introduced and `styles.css` is byte-identical.
 */
export function Crumb({ to, children }: { to: string; children: ReactNode }) {
  return (
    <p className="crumb">
      <Link to={to}>{children}</Link>
    </p>
  );
}
