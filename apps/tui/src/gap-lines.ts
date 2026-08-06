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

/**
 * The most lost-day lines this channel will print before it summarizes the rest.
 *
 * A startup channel is not a report. After a long outage the derivation walks the
 * WHOLE window and finds every lost day — that is `computeGapReport`'s job and it
 * stays untouched — but printing sixty lines above the alternate screen scrolls the
 * TUI's own first frame off the terminal, and a channel that buries its own product
 * is a channel you learn to skip. So the BOUND IS PRESENTATION-ONLY, applied here
 * at the leaf: the derivation still knows everything, and the operator is told
 * exactly how much is being withheld and the one command that shows all of it.
 *
 * The MOST RECENT days, not the last 7 calendar days — a lost day is permanent, so
 * the window's tail is where the still-actionable damage is.
 *
 * Exported because the test must DRIVE the bound rather than restate it; the same
 * reason `MAX_WINDOW_DAYS` is exported from `gap-report-core.ts`.
 */
export const MAX_GAP_LINES = 7;

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
 *
 * Bounded to {@link MAX_GAP_LINES} — see that constant. A CLEAN WINDOW STILL
 * PRINTS NOTHING: the bound only ever removes lines, never adds one, so the
 * silence contract above is untouched by it.
 */
export async function loadGapLines(
  paths: EventStorePaths,
  window: GapWindow,
): Promise<string[]> {
  let all: string[];
  try {
    all = formatGapReport(await loadGapReport(paths, window));
  } catch (error) {
    return [formatGapCheckFailure(error)];
  }

  const withheld = all.length - MAX_GAP_LINES;
  if (withheld <= 0) {
    return all;
  }
  // `formatGapReport` renders `report.lost`, which the derivation's walk builds
  // ASCENDING — so the most recent lost days are the tail, and the withheld ones are
  // the head. The count goes last, under the days it summarizes.
  //
  // Deliberately NOT `formatGapSummary`: that one reports the TOTAL over the FULL
  // window and is contractually the always-printed one-liner — it speaks on a clean
  // window, which this channel must never do. This says only how much was withheld,
  // and names the command that shows the rest. `day(s)` is the house form
  // (`formatGapSummary`'s `lost day(s)` / `anchor(s)`); there is no singular branch.
  return [
    ...all.slice(withheld),
    `Numisma: …and ${withheld} earlier lost day(s) (pnpm gap-report).`,
  ];
}
