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
 * ── NO CSS IS AUTHORED ───────────────────────────────────────────────────────────────
 * `absent` and `muted absent-why` already exist in `styles.css`, which spec #403 requires
 * to be byte-identical when the increment lands. The class family is translated once, at
 * this file, when the Tailwind migration comes.
 */
export function Absent({ why }: { why?: string | undefined }): ReactElement {
  return (
    <span className="absent">
      <span aria-hidden="true">—</span>
      <span className="muted absent-why">{why ?? "suppressed"}</span>
    </span>
  );
}
