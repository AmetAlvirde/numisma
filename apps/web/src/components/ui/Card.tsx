import type { ReactElement, ReactNode } from "react";

/**
 * THE CARD — Seam C of spec #403, the layer's centrepiece primitive, and the ONE site the
 * Tailwind migration translates the `card` class family at instead of twelve.
 *
 * ── IT IS A `<section>`, AND ONLY A `<section>` ──────────────────────────────────────
 * A dozen elements in this layer carry the card surface and four of them are not cards:
 * the fill path's two `fp-warn` warning paragraphs, its `role="alert"` banner `<div>`,
 * and login's `<form>`. They keep their own elements and import `CARD_SURFACE` below
 * instead. A shared surface is not a shared component, and a polymorphic `as`
 * prop to absorb four one-off elements would buy a knob and lose the guarantee that a
 * `Card` is a landmark-bearing section. `card-composition.test.tsx` holds that.
 *
 * ── TIER-1 OPEN COMPOSITION, NO CONTEXT ──────────────────────────────────────────────
 * Grill decision D1. The parts share nothing at runtime, so a provider would buy an
 * indirection with no state behind it. D4 fixes the export shape: parts are attached as
 * plain properties AND named-exported. `Card.Title` is the call-site vocabulary; the
 * named `CardTitle` is what per-part tests and the later workbench fixtures import
 * directly. They are the same function, asserted. React 19 makes a `forwardRef` wrapper
 * unnecessary, so there is not one.
 *
 * ── NO `variant` ENUM ────────────────────────────────────────────────────────────────
 * The twelve variant class strings are exactly what the Tailwind migration deletes, so an
 * enum now is a second thing to migrate and a second vocabulary to keep in step with the
 * stylesheet. Callers pass their extra classes through as words.
 *
 * ── THIS FILE IMPORTS REACT AND NOTHING ELSE ─────────────────────────────────────────
 * Everything a primitive imports enters the import closure `route-move.test.ts` walks
 * from the ladder route, which allows exactly two `@numisma/*` runtime imports. Prop
 * types are declared inline for the same reason.
 */
export function Card({
  className,
  children,
}: {
  className?: string | undefined;
  children?: ReactNode;
}): ReactElement {
  // Composed rather than interpolated, so a card with no extra classes emits the surface
  // and not the surface plus a trailing space — the class string is what the structure
  // tests read, and a stray space is the kind of thing that survives review.
  return (
    <section
      className={className ? `${CARD_SURFACE} ${className}` : CARD_SURFACE}
    >
      {children}
    </section>
  );
}

/**
 * THE CARD SURFACE, SPELLED ONCE (spec #420 slice 2).
 *
 * `.card` was `background: var(--card); border: 1px solid var(--line);
 * border-radius: 12px; padding: 16px`, and it is deleted. These four utilities are that
 * rule, and they are exported because EIGHT ELEMENTS CARRY THE SURFACE AND FOUR OF THEM
 * ARE NOT CARDS: the fill path's two `fp-warn` paragraphs and its `role="alert"` banner,
 * login's `<form>`, and the ladder routes' notice `<div>`s. The docblock above declines
 * to absorb them into this component and that has not changed — what they share is a
 * painted surface, not a landmark — so what they import is the string, not the section.
 *
 * `rounded-xl` IS THE ONE DEFAULT-SCALE CLASS HERE and it is an exact match: Tailwind's
 * `--radius-xl` is 0.75rem. `rounded-md` would NOT have been — `tailwind.css`'s `@theme`
 * remaps `--radius-md` onto the package's 8px control radius — the same shape of trap as
 * the theme colour utilities, in the radius namespace, and the reason the house colours
 * below are read as arbitrary values.
 */
export const CARD_SURFACE =
  "rounded-xl border border-[var(--line)] bg-[var(--card)] p-4";

/**
 * The card's heading.
 *
 * `level` EXISTS BECAUSE TWO CARDS ARE THE PAGE. `SummaryCard`'s fund name and the fill
 * path's header are their pages' `<h1>`; every other card's heading is a section heading
 * beneath one. Only the call site knows which of those it is — nothing about a card can
 * derive it — so it is passed, and it defaults to 2, which is what the majority are.
 *
 * Heading level is an accessibility fact rather than a styling one: a page whose only
 * heading is an `<h2>` renders identically for a sighted reader and reads as a document
 * with no title to everything that navigates by headings. This primitive is now the one
 * thing in the layer that can get it wrong for every card at once, which is why the
 * adopters assert their level instead of leaving it to review.
 */
export function CardTitle({
  level = 2,
  children,
}: {
  level?: 1 | 2;
  children?: ReactNode;
}): ReactElement {
  return level === 1 ? <h1>{children}</h1> : <h2>{children}</h2>;
}

Card.Title = CardTitle;
