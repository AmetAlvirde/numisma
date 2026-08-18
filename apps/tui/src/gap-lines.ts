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
  formatLostDays,
  formatVenueDarkDays,
  loadGapReport,
  type EventStorePaths,
  type GapReport,
  type GapWindow,
} from "@numisma/event-store";

/**
 * The most report lines this channel will print before it summarizes the rest.
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
 * reason `MAX_WINDOW_DAYS` is exported from `@numisma/event-store` — a constant this
 * app now has a real relationship to, since `liveness-lines.ts` takes its window
 * floor from `defaultGapReportSince`, which is that width applied.
 */
export const MAX_GAP_LINES = 7;

/**
 * THE FLOOR THE LOST DAYS CANNOT BE PUSHED BELOW — the bound's other half, and the
 * reason the two kinds are budgeted rather than concatenated.
 *
 * A TAIL SLICE OVER `[...lost, ...venueDark]` STARVES THE LOST DAYS. It withholds
 * every lost day before it drops one venue-dark line, and once the venue-dark lines
 * alone reach {@link MAX_GAP_LINES} it can never print a lost day again. That is not
 * a severity trade-off — the two findings are not the same kind of thing: A LOST DAY
 * IS PERMANENT and can never be repaired, while a venue-dark day is transient, recurs,
 * and by D7 fires on ~9-10 market holidays a year. The starving line is the one whose
 * own text says *the day is not lost*.
 *
 * It is not a rare shape either: this app passes no `since`, so the floor is
 * `defaultGapReportSince` — the era start until 2027-08-08 and a rolling 400-day floor
 * after it — and the window grows by a day every day until then. On holidays alone the
 * venue-dark side crosses the cap within about a year, permanently, on the one surface
 * that is read daily and the only automatic one that names permanent data loss.
 *
 * So each kind gets a RESERVED FLOOR and neither can be crowded out. The floor is not
 * a quota: whatever the other kind does not need, this one may spend — a clean
 * venue-dark side still prints seven lost days. Lost days hold the larger share
 * because permanence outranks recurrence. Exported for the same reason as
 * {@link MAX_GAP_LINES}: the test must DRIVE the numbers, not restate them.
 */
export const RESERVED_LOST_LINES = 4;

/** The one wording for "the check itself did not run." Shared with `startup.ts`. */
export function formatGapCheckFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Numisma: lost days were NOT checked (${detail}).`;
}

/**
 * Derive the lost days and render them.
 *
 * EMPTY MEANS CLEAN — the caller stays quiet, which is the whole point of putting
 * this on a channel the operator sees every single day. The window's floor is filled
 * in by `loadLivenessLines` (`defaultGapReportSince`) when the caller supplies none,
 * and its ceiling is pinned to yesterday by the derivation, so
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
  let report: GapReport;
  try {
    report = await loadGapReport(paths, window);
  } catch (error) {
    return [formatGapCheckFailure(error)];
  }

  const lost = formatLostDays(report);
  const venueDark = formatVenueDarkDays(report);
  if (lost.length + venueDark.length <= MAX_GAP_LINES) {
    // Under the cap nothing is budgeted and nothing is withheld — including the clean
    // window, which returns the empty array and keeps this channel silent.
    return [...lost, ...venueDark];
  }

  // THE BUDGET. Each kind may take the whole cap minus whatever the OTHER kind's
  // reserve actually claims — so a floor when both are over-full, and the full cap
  // when the other side is quiet. See {@link RESERVED_LOST_LINES}.
  const shownLost = Math.min(
    lost.length,
    MAX_GAP_LINES - Math.min(venueDark.length, MAX_GAP_LINES - RESERVED_LOST_LINES),
  );
  const shownVenueDark = Math.min(venueDark.length, MAX_GAP_LINES - shownLost);

  // Each kind keeps its OWN most recent days — the still-actionable end within a kind
  // — so the head withheld from each is its oldest.
  return [
    ...lost.slice(lost.length - shownLost),
    ...venueDark.slice(venueDark.length - shownVenueDark),
    withheldLine(lost.length - shownLost, venueDark.length - shownVenueDark),
  ];
}

/**
 * The tail line: what was withheld, COUNTED PER KIND.
 *
 * One undifferentiated "N line(s)" cannot be read: since #266 a withheld line may be a
 * permanent lost day or a transient venue-dark day, and the operator's next move is
 * different for each. Naming both counts is what makes the bound honest rather than
 * merely quiet, and a kind that lost nothing is omitted rather than reported as zero.
 *
 * Deliberately NOT `formatGapSummary`: that one reports the TOTAL over the FULL window
 * and is contractually the always-printed one-liner — it speaks on a clean window,
 * which this channel must never do. This says only how much was withheld, and names
 * the command that shows the rest. `(s)` is the house form (`formatGapSummary`'s
 * `lost day(s)` / `anchor(s)`); there is no singular branch.
 */
function withheldLine(lost: number, venueDark: number): string {
  const parts = [
    ...(lost > 0 ? [`${lost} earlier lost day(s)`] : []),
    ...(venueDark > 0 ? [`${venueDark} earlier venue-dark line(s)`] : []),
  ];
  return `Numisma: …and ${parts.join(", ")} (pnpm gap-report).`;
}
