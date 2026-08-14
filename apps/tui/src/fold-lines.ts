/**
 * The fold's DROPPED-EVENT lines on the TUI's pre-alternate-screen startup channel —
 * the surface that reaches you WITHOUT YOU GOING TO LOOK FOR IT (PRD #323 slice E,
 * seam E; ADR-020, `context/adr/ADR-020-the-discard-channel-report-never-refuse.md`).
 *
 * WHY HERE AND NOT IN THE RENDERER. `mountApp` owns the terminal from the moment the
 * alternate screen opens, so anything written to stderr after that is painted over. The
 * startup channel is the one place in `pnpm dev` where prose reaches the operator at
 * all, and it is the same channel the ingest report and the lost days already use.
 *
 * IT IS THE ENUMERATION, NOT THE COUNT — the opposite choice from the unattended push,
 * and deliberately. A human is at the keyboard here and every dropped event's locator
 * (`eventId` + index), verb and reason is what makes the finding actionable; the id is
 * greppable in `events.jsonl`. The push gets `unattendedFoldVerdict`'s single counted
 * line instead, because that one prints from launchd every evening forever.
 *
 * ── ITS CAPACITY IS RESERVED, AND SO IS THE GAP CHANNEL'S ─────────────────────────
 * This channel is now CO-TENANTED: `loadGapLines` files lost days and venue-dark days
 * beside these. Each kind is bounded over ITS OWN lines and never over the
 * concatenation — {@link MAX_FOLD_DISCARD_LINES} here, `MAX_GAP_LINES` there — which is
 * PR #322's lesson and ADR-020's reserved-capacity rule in the only form that survives
 * a co-tenant: a bound taken over the concatenation withholds whichever kind sorts
 * last, and once one kind alone fills it, the other is starved forever. A fold discard
 * is PERMANENT (append-only history: it can never be repaired), so a transient,
 * recurring venue-dark line must never be able to crowd it out — nor it them.
 *
 * ── IT NEVER THROWS, AND IT IS NEVER SILENT ABOUT BEING BROKEN ────────────────────
 * Same contract as `gap-lines.ts` beside it, for the same reason: a diagnostic that can
 * brick the dashboard is worse than none, but a detector that says nothing when it is
 * broken is indistinguishable from one saying "all clear" — which is the precise
 * failure this whole increment exists to remove. A clean fold prints nothing; a BROKEN
 * check says so.
 *
 * ── IT COSTS ONE RE-READ OF A SMALL LOCAL FILE ────────────────────────────────────
 * Said out loud rather than hidden: `prepareStartup` returns the fold as a lazy thunk
 * on purpose (the genesis guard must stay lazy so `pnpm dev` renders a load-failure
 * panel where `report` exits non-zero), so this folds the log a second time rather than
 * forcing that thunk early and changing a failure mode. The same trade is already made
 * and documented at `loadVenueDarkAsOf` in the push. If it ever matters, the fix is to
 * share one fold through the startup path — not to stop reporting.
 */
import {
  formatFoldDiscards,
  loadFoldedReview,
  type EventStorePaths,
} from "@numisma/event-store";

/** The one wording for "the fold's discard check itself did not run." */
export function formatFoldCheckFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Numisma: dropped events were NOT checked (${detail}).`;
}

/**
 * Fold to `asOf` (or current state) and render what the fold dropped.
 *
 * EMPTY MEANS CLEAN — the caller stays quiet, which is what keeps a channel read every
 * single day worth reading. The bound only ever removes lines and never adds one, so
 * that silence is untouched by it.
 */
export async function loadFoldLines(
  paths: EventStorePaths,
  asOf?: string,
): Promise<string[]> {
  try {
    return formatFoldDiscards(await loadFoldedReview(paths, asOf));
  } catch (error) {
    return [formatFoldCheckFailure(error)];
  }
}
