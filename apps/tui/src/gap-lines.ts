/**
 * The lost-day lines the TUI prints on its pre-alternate-screen startup channel —
 * the surface that reaches you WITHOUT YOU GOING TO LOOK FOR IT.
 *
 * WHY THE TUI AND NOT THE DASHBOARD. The dashboard's freshness verdict is
 * derivation-correct and delivery-broken: on the day this was investigated it
 * would have fired at four stale days and nobody saw it, because it speaks only
 * when a human opens the dashboard. Its own comment predicted exactly that — "this
 * fires only when the job dies, which is precisely when it is needed and precisely
 * when nobody has seen it work." The TUI is the surface already opened daily.
 *
 * NO BRIDGE, AND NO HAND-WRITTEN INTERFACE. The prototype put this derivation in
 * `apps/web` and reached it from here through a COMPUTED specifier so `tsc` could
 * not follow the edge — an app importing an app, with a hand-maintained structural
 * interface standing in for a contract the compiler should have known. Both are
 * gone: the derivation lives in `@numisma/event-store`, which this app already
 * declares, so this is an ordinary import with a real type. That is also what makes
 * "no `pg` in the TUI's module graph" true BY CONSTRUCTION rather than by care —
 * asserted in `module-graph.test.ts`.
 *
 * ── IT NEVER THROWS, AND IT IS NEVER SILENT ABOUT BEING BROKEN ────────────────
 * A liveness report that can brick the dashboard is worse than none, so a failure
 * to derive is caught here and returned as a line. But it is NOT swallowed: a
 * detector that says nothing when it is broken is indistinguishable from a detector
 * saying "all clear", which is the precise failure this whole increment exists to
 * remove. A clean window prints nothing; a BROKEN check says so.
 */
import {
  formatGapReport,
  loadGapReport,
  type EventStorePaths,
  type GapWindow,
} from "@numisma/event-store";

/** The one wording for "the check itself did not run." Shared with `startup.ts`. */
export function formatGapCheckFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Numisma: lost days were NOT checked (${detail}).`;
}

/**
 * Derive the lost days and render them.
 *
 * EMPTY MEANS CLEAN — the caller stays quiet, which is the whole point of putting
 * this on a channel the operator sees every single day. The window's floor defaults
 * to the launchd era and its ceiling is pinned to yesterday by the derivation, so
 * this can never accuse the day still in progress.
 */
export async function loadGapLines(
  paths: EventStorePaths,
  window: GapWindow,
): Promise<string[]> {
  try {
    return formatGapReport(await loadGapReport(paths, window));
  } catch (error) {
    return [formatGapCheckFailure(error)];
  }
}
