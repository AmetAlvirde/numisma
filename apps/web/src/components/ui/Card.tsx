import type { ReactElement, ReactNode } from "react";

/**
 * THE CARD — Seam C of spec #403, the layer's centrepiece primitive, and the ONE site the
 * Tailwind migration translates the `card` class family at instead of twelve.
 *
 * ── IT IS A `<section>`, AND ONLY A `<section>` ──────────────────────────────────────
 * Twelve elements in this layer carry the `card` class and four of them are not cards:
 * the fill path's two `<p className="card fp-warn…">` warnings, its `role="alert"` banner
 * `<div>`, and login's `<form className="card auth-card">`. They keep their own elements
 * and do not use this. A shared class is not a shared component, and a polymorphic `as`
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
 * stylesheet. Callers pass their extra classes through as words, and no new class name is
 * introduced anywhere: `styles.css` is byte-identical across this whole increment.
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
  // Composed rather than interpolated, so a card with no extra classes emits `card` and
  // not `card ` — the class string is what the migration reads, and a stray trailing
  // space is the kind of thing that survives review and then confuses a codemod.
  return (
    <section className={className ? `card ${className}` : "card"}>
      {children}
    </section>
  );
}

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
