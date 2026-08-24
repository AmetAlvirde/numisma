import type { ReactElement } from "react";

/**
 * AN EM DASH IS NOT A ZERO — Seam B of spec #403, and the layer's first shared primitive.
 *
 * Five components spelled this markup privately, in four different prop shapes, each with
 * a comment naming the other four. It is presentation and nothing else: a decorative
 * glyph the accessibility tree never hears, beside the CAUSE of the absence in words.
 * Both halves are load-bearing. "The number is missing" and "the number is missing
 * because the feed did not run" are different amounts of information, and the second one
 * is why suppression is per-number instead of whole-page.
 *
 * ── THE REASON IS RESOLVED AT THE CALL SITE, ON PURPOSE ──────────────────────────────
 * This primitive takes a STRING, never a reason enum. `GlanceCard`'s `SuppressionReason`
 * and `SectionTable`'s `RowAbsenceReason` are owned by different view modules and keyed
 * off different domain vocabularies; `SectionTable` already records that their two
 * overlapping causes are "the same causes seen from a different altitude". Pulling either
 * table in here would couple two view vocabularies through a UI file to save four lines,
 * and would give this file a domain import it has no business having.
 *
 * ── THIS FILE IMPORTS REACT AND NOTHING ELSE ─────────────────────────────────────────
 * `route-move.test.ts` walks the reachable module graph from the ladder route and allows
 * exactly two `@numisma/*` runtime imports. Everything a primitive imports enters that
 * closure, so primitives stay dependency-free — the `why` prop's type is declared inline
 * here for the same reason. It is spelled `string | undefined` rather than `string`
 * because `exactOptionalPropertyTypes` is on: the call sites resolve a reason that may be
 * absent and pass the result straight through, which is the whole point of the default.
 *
 * ── THE STYLING IS HERE NOW, AND ONE CLASS NAME SURVIVES ON PURPOSE ──────────────────
 * Spec #420 slice 2 deletes `.absent` (`display: inline-flex; align-items: baseline;
 * gap: 6px; color: var(--muted)`), `.absent-why` and `.muted`, and those declarations are
 * the utilities below.
 *
 * `absent` ITSELF STAYS AS A BARE HOOK, exactly as slice 1 kept `error` while a later
 * slice's rule still selected through it. THREE CONTEXTUAL RULES DID: `.metrics dd
 * .absent` (slice 3), `.fp-tile .absent` (slice 7) and `.fp-detail .absent` (slice 8),
 * two of them with `@container` arms. THE FIRST IS NOW THE `[dd_&]` PAIR BELOW; two
 * remain, so the hook stays until slice 8 takes the last of them. It carries nothing
 * itself; it is a join.
 *
 * ── `[dd_&]` IS THE METRICS CONTEXT, NAMED BY ITS ELEMENT ────────────────────────────
 * `.metrics .muted` (slice 3's) beat `.absent-why` on specificity and sized the reason
 * 0.75rem with no margin wherever a metrics `<dd>` holds one, against 0.72rem and the
 * `.muted` top margin everywhere else. Losing the `muted` class name loses that
 * selector's grip, so the two declarations are reproduced here.
 *
 * They key off `dd` rather than `.metrics` because the CLASS is going and the ELEMENT is
 * not: slice 3 rewrites `.metrics` as utilities on the `<dl>` and this variant keeps
 * meaning the same thing through it. Measured before it was written: the only `<dd>` in
 * the app that holds an `Absent` is a metrics one — `.fp-detail`'s single `<dd>` renders
 * a price and never this — so the proxy is exact today, not merely close.
 *
 * SLICE 3'S OWN RULE JOINS THEM, on the same `dd` proxy and for the same reason.
 * `.metrics dd .absent` wrapped the cause under the em dash at the right rail rather
 * than widening the row, and its `@container` arm returned it to the left edge once the
 * card reflowed. Both edges are here, and the container variant names the breakpoint the
 * card still declares — this element is inside a `metrics-card` container whenever the
 * `dd` proxy is true, which is the same measurement.
 *
 * ── `className` IS FOR THE CONTEXTS WITH NO ELEMENT TO KEY OFF ───────────────────────
 * `.metrics dd .absent` had one, which is why it is a variant above. The fill path's two
 * — `.fp-spot .absent` and `.fp-tile .absent`, both deleted in spec #420 slice 7 — do
 * not: a spot reading is a `<p>` and a tile is a `<div>`, and neither element name is
 * anywhere near specific enough to stand in for the class that is going away. So the call
 * site passes what its own rule declared, which also keeps those declarations in the file
 * that owns them rather than accumulating one variant per surface here. The two arrive
 * with DIFFERENT strings on purpose: the tile's rule had a container arm returning it to
 * the left edge and spot's did not, because spot's own reflow keeps it right-aligned.
 */
const ABSENT_SURFACE =
  "absent inline-flex items-baseline gap-1.5 text-[var(--muted)] [dd_&]:flex-wrap [dd_&]:justify-end [dd_&]:@[380px]/metrics-card:justify-start";

export function Absent({
  why,
  className,
}: {
  why?: string | undefined;
  className?: string | undefined;
}): ReactElement {
  return (
    <span className={className ? `${ABSENT_SURFACE} ${className}` : ABSENT_SURFACE}>
      <span aria-hidden="true">—</span>
      <span className="m-0 mt-1 text-[0.72rem] font-medium text-[var(--muted)] [dd_&]:mt-0 [dd_&]:text-[0.75rem]">
        {why ?? "suppressed"}
      </span>
    </span>
  );
}
