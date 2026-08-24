import type { ReactElement } from "react";

import { CARD_SURFACE } from "@numisma/components";

/**
 * THE TWO SNAPSHOT GUARD NOTICES — Seam D of spec #403.
 *
 * Three routes carried this copy verbatim, three times each: the same heading, the same
 * paragraph, the same interpolated version numbers. Copy that lives in three files is
 * copy that gets corrected in one of them, and the correction is invisible — every route
 * still renders, and the operator sees whichever page they happened to open.
 *
 * ── THE CONTROL FLOW STAYS IN THE ROUTE ──────────────────────────────────────────────
 * These are the WORDS, not the guard. Each route keeps its own
 * `if (result.status === "empty" | "stale")` and its own `<Shell>`, because folding the
 * branch into a layout route is a routing change with real behavior risk, declined in the
 * spec and left to the workbench increment that will already be moving the router.
 * `route-move.test.ts` pins the shell import and the per-route branching, and this
 * extraction is deliberately shaped to keep every one of those assertions true.
 *
 * ── A `<div>` ON THE CARD SURFACE, NOT A `Card` ──────────────────────────────────────
 * Both notices keep the element they render today. `Card` is a `<section>` and only a
 * `<section>`; converting these would change the element and the landmark structure of
 * three pages, which is a visual and accessibility change. They import the surface's
 * class string instead, which is exactly the split spec #420 slice 2 drew: a painted
 * surface is shareable, a landmark is not.
 *
 * ── THE `notice` AND `error` CLASS NAMES ARE GONE (spec #420 slice 2) ────────────────
 * They were never styled on their own. `.notice code` painted the inline code chip and
 * `.notice.error h1` painted the refusal's heading; both are deleted here and both are
 * now utilities on the elements themselves, so the two names carry nothing and are not
 * written. Slice 1 kept `error` alive on purpose while `.notice.error h1` still selected
 * through it — that was the last rule, and this is the slice that moves it.
 *
 * ── NO GENERIC `Notice` ──────────────────────────────────────────────────────────────
 * A `<Notice variant severity>` would have exactly these two consumers. The ladder
 * route's own `not-found` and `no-price-axis` notices are not candidates: different copy,
 * one call site each, and the second carries `card` WITHOUT `notice`, so absorbing it
 * would change its class set. Two named components that say what they mean beat one
 * parameterized component that says nothing.
 *
 * ── THIS FILE IMPORTS REACT AND NOTHING ELSE ─────────────────────────────────────────
 * It enters the import closure `route-move.test.ts` walks from the ladder route, which
 * allows exactly two `@numisma/*` runtime imports. The props are scalars declared inline
 * for the same reason: a `SnapshotResult` type import here would drag the projection
 * contract into a primitive that only needs three numbers.
 */
/**
 * The inline code chip, which was `.notice code`.
 *
 * `rounded-[6px]` RATHER THAN `rounded-md`, and this is the trap the migration keeps
 * meeting: `tailwind.css`'s `@theme` remaps `--radius-md` onto the package's 8px control
 * radius, so `rounded-md` compiles, resolves, wins its cascade and paints 8px. Only the
 * arbitrary value is 6px. `bg-black` IS an exact match for the deleted `#000` and is a
 * Tailwind default rather than a mapped house token, so it is not that collision.
 *
 * Exported because the ladder fixture route spells the same chip inside its own notices.
 */
export const NOTICE_CODE = "rounded-[6px] bg-black px-1.5 py-0.5";

export function SnapshotEmptyNotice(): ReactElement {
  return (
    <div className={CARD_SURFACE}>
      <h1>No snapshot yet</h1>
      <p>
        The projection is empty. Run <code className={NOTICE_CODE}>pnpm push</code>{" "}
        to publish the latest composition report.
      </p>
    </div>
  );
}

/**
 * The refusal. The stored version and the supported window are all RENDERED, because
 * "refusing to render" without the numbers leaves the operator with nothing to act on —
 * the fix is re-running the push against a matching engine build, and which build that is
 * follows from the range.
 *
 * The refusal is the one notice painted in the negative colour, here and in the ladder
 * fixture route that stages it.
 */
export function SnapshotStaleNotice({
  storedVersion,
  min,
  max,
}: {
  storedVersion: number;
  min: number;
  max: number;
}): ReactElement {
  return (
    // THE HOOK IS GONE NOW. Slice 1 deleted `.error` and kept the class name alive
    // because `.notice.error h1` still selected through it; slice 2 has moved that rule
    // onto the heading, so the name carries nothing and is not written.
    <div className={`${CARD_SURFACE} m-0 text-[var(--neg)]`}>
      {/* Redundant by inheritance and written anyway: the deleted rule painted this
          heading directly, and a converted element that relies on its parent's colour
          reads as an omission the next time someone recolours the box. */}
      <h1 className="text-[var(--neg)]">
        Schema version mismatch — refusing to render
      </h1>
      <p>
        The stored snapshot is schema version <strong>{storedVersion}</strong>, which is
        outside the versions this app supports (
        <strong>
          {min}–{max}
        </strong>
        ). Re-run the push shell with a matching engine build before viewing.
      </p>
    </div>
  );
}
