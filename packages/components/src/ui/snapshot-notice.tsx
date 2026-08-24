import type { ReactElement } from "react";

import { CARD_SURFACE } from "./card";

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
 * ── IT IMPORTS REACT AND ITS OWN NEIGHBOUR, AND NOTHING ELSE ─────────────────────────
 * `CARD_SURFACE` now arrives from `./card`, a relative read inside the package, because a
 * package file cannot reach back into `apps/web` for a string it composes — which is why
 * spec #432 blocked this move on the surface's. The discipline is the one the file kept
 * in the app; what enforces it now is `packages/components`'s four runtime dependencies,
 * the short list that lets `apps/web`'s ladder-route closure guard admit
 * `@numisma/components` into a browser bundle at all. The props stay scalars declared
 * inline for the same reason: a `SnapshotResult` type import here would drag the
 * projection contract into a primitive that only needs three numbers.
 *
 * ── THE REFUSAL READS `--nms-neg`, NOT `--nms-destructive` (spec #432 §4.1) ──────────
 * `apps/web` resolves both onto `--neg`, so in app mode the two are one red and the read
 * could have gone either way for free. It reads the sign token because a stale snapshot
 * is a fact about DATA, not the affordance of a control that destroys something, and
 * welding the two would move every destructive button the day the money-red softens. The
 * workbench's themed mode paints them a cyan and a red so the split is visible.
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
 * ── `text-white` PAIRS THE BACKGROUND, AND IS NOT DECORATION ─────────────────────────
 * The chip painted its own background and inherited its foreground, which reads as
 * economical and is a latent bug: an element that sets a background owns the text on it.
 * It only ever looked right because the one consumer was a dark app whose ambient
 * foreground happened to be light. The workbench rendered it against two palettes that
 * are not, and both painted near-black on black — `--nms-foreground` is `#1b1a17` in
 * themed mode and `oklch(0.145 0 0)` in grayscale. The pairing is literal for the same
 * reason `bg-black` is: no house token stays light in every mode, so a `var()` read here
 * would re-acquire the dependence on ambient palette that broke it.
 *
 * The chip therefore does NOT theme, by construction. Grayscale mode reviews hierarchy,
 * spacing and state, and a command chip is a constant in all three — the same argument
 * `--nms-neg` makes above about sign.
 *
 * Exported because the ladder fixture route spells the same chip inside its own notices.
 */
export const NOTICE_CODE = "rounded-[6px] bg-black text-white px-1.5 py-0.5";

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
    <div className={`${CARD_SURFACE} m-0 text-[var(--nms-neg)]`}>
      {/* Redundant by inheritance and written anyway: the deleted rule painted this
          heading directly, and a converted element that relies on its parent's colour
          reads as an omission the next time someone recolours the box. */}
      <h1 className="text-[var(--nms-neg)]">
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
