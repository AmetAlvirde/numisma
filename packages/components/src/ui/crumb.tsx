import type { ReactElement, ReactNode } from "react";

/**
 * THE WAY BACK UP — Seam D's fourth part (spec #403), and the last generic to cross into
 * the package (spec #432 §4.4, slice #437).
 *
 * The crumb was defined once inside the ladder route, called three times there, and
 * spelled out a fourth time as raw JSX on `/big-picture`. The `/` crumb points the other
 * way, down to the big picture, which is why the private version could never absorb it.
 *
 * ── THE LINK LEAVES THROUGH A SLOT, AND THE ROUTER STAYS OUTSIDE ─────────────────────
 * The old signature took `to: string` and built a TanStack `<Link>` itself. It cannot any
 * more. `@numisma/workbench` depends on this package, React, and nothing else — the
 * absence of a router and of SSR is stated in its vite config as the whole point of the
 * second consumer — so TanStack Router is not available here, and this package's manifest
 * does not name it.
 *
 * SO THE PACKAGE OWNS THE ANCHOR'S CLASSES AND HANDS THEM OUT. It does not own the
 * anchor. `apps/web` returns a fully typed `<Link>` from the slot; the workbench fixture
 * returns `<a href="#">`.
 *
 * A LINK-ADAPTER CONTEXT WAS THE ALTERNATIVE AND IT LOSES. TanStack checks `to` against
 * the generated route tree; an adapter that normalised every destination to `to: string`
 * would throw that check away silently, and the first typo in a route path would ship.
 * The slot keeps each call site building its own `<Link>` with its own literal
 * destination, so the route-tree check still runs where the destination is written.
 * `params` and `search` get no slots of their own for the same reason: everything about
 * navigation stays at the call site, and what crosses the boundary is a class name and
 * children.
 *
 * The ARROW IS THE CALLER'S. `← Glance` and `Big picture →` point opposite ways, and a
 * component that decided the glyph from the destination would be guessing at the page's
 * geography from a string.
 *
 * ── THE STYLING IS HERE (spec #420 slice 2) ──────────────────────────────────────────
 * `.crumb`, `.crumb a` and `.crumb a:hover` are deleted from `styles.css` and these
 * utilities are where they landed, which is the payoff for spec #403 having pulled the
 * five call sites onto one component first: the hover state converts once instead of
 * five times.
 *
 * THE TWO COLOURS ARE THE ONLY THING THAT DID NOT SURVIVE THE MOVE VERBATIM (spec #432
 * §4.1). A package file may read no house name, so the resting colour spells
 * `--nms-muted-foreground` and the hover `--nms-foreground`, and `apps/web` aliases each
 * onto the house name the deleted rule used. In app mode that is `#9aa1ad` resting and
 * `#e7e9ee` hovered, which is what `apps/web` painted before the move and after it.
 *
 * `--nms-muted-foreground` IS NOT `--nms-muted`. The recessed SURFACE is `--nms-muted`;
 * this is secondary TEXT. `tokens.ts` carries the argument, and it is the mistake this
 * migration was cut to catch.
 *
 * `m-0` IS NOT DECORATION. Preflight is off, so the UA's own `p` margin is live and
 * `.crumb`'s `margin: 0` was holding it off on all four edges. Dropping it would push
 * every crumb 16px down the page with nothing in the diff to say why.
 *
 * ── THIS FILE IMPORTS REACT AND NOTHING ELSE ─────────────────────────────────────────
 * The same discipline `absent.tsx` and `card.tsx` keep, and the reason `apps/web`'s
 * ladder-route closure guard admits `@numisma/components` into a browser bundle at all.
 * A router import here would be the one that broke it.
 */
export function Crumb({
  renderLink,
  children,
}: {
  renderLink: (props: {
    className: string;
    children: ReactNode;
  }) => ReactElement;
  children: ReactNode;
}): ReactElement {
  return (
    <p className="m-0 text-[0.9rem]">
      {renderLink({ className: CRUMB_LINK, children })}
    </p>
  );
}

/**
 * The anchor's class attribute, spelled once and handed to the slot.
 *
 * Not exported: what a consumer needs is the component, and a second name for the string
 * would let a call site paint a crumb-coloured link that is not a crumb.
 */
const CRUMB_LINK =
  "text-[var(--nms-muted-foreground)] no-underline hover:text-[var(--nms-foreground)]";
