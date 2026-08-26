/**
 * THE ONE SYMBOL THE PUSH TREE TAKES FROM `glance/`, AND WHY IT LIVES ALONE.
 *
 * This module has no imports, and that is its whole job. `push/fixture-synthesis.ts`
 * needs the navMove threshold and nothing else out of `glance/`; while it read the
 * constant from `verdict.ts`, it inherited that file's `@numisma/components` import,
 * and through the package's curated index the push tree evaluated React, `@base-ui/react`
 * and `@tanstack/charts` before it wrote a projection row. The chain ran
 * `push/backfill.ts` → `backfill-core.ts` → `fixture-synthesis.ts` → `glance/verdict.ts`
 * → `@numisma/components`, and `backfill` is step 6 of the unattended daily job — the
 * one script nobody watches run. Nothing threw, because nothing in the package touches
 * `window`, `document` or a CSS import at module scope. It was startup cost and blast
 * radius: a `@tanstack/charts` upgrade that failed to evaluate would have failed the
 * backfill, and ADR-018 records that library as pre-alpha and breaking by the vendor's
 * own admission.
 *
 * `verdict.ts` RE-EXPORTS IT, so every existing reader is unmoved: the three uses in
 * `verdict.ts` itself, `verdict.test.ts`, and `fixture-synthesis.ts`'s own re-export
 * onward to the push tests. The threshold is one number with no dependencies, so
 * splitting it out costs nothing and severs the edge completely. `push/push-graph.test.ts`
 * is what holds it severed.
 *
 * The threshold itself is spec #439 review finding 5; the rule it encodes is below.
 */

/**
 * `navMove` — 1.5% against the NAMED reference, UNSCALED.
 *
 * THE HONEST CAVEAT, written down here rather than discovered later: this is a
 * per-STEP test, not a per-day one. When the nearest anchor is a multi-day step the
 * rule is LESS SENSITIVE per day — a 1.4% drift over three days is silent where the
 * same drift in one day would also be silent, but a genuinely eventful three-day
 * stretch can hide under one threshold. Acceptable now that launchd anchors daily and
 * the step is one day; the sparse stretch (06-26 → 06-30, and 07-03's three-day step
 * back to 06-30) is historical only.
 *
 * 1.5% picks the tails of the measured month honestly: it took three of the 28
 * anchored days it was chosen against and left 25. The measured day-over-day range that justifies the
 * choice is deliberately not quoted here — this repository is public, and the range
 * is the fund's best and worst days. It is recorded in the private notes vault.
 */
export const NAV_MOVE_THRESHOLD_PCT = 1.5;
