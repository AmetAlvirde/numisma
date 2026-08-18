/**
 * The one liveness channel the TUI prints before the alternate screen takes over:
 * **did the job run**, then **which days are lost**.
 *
 * TWO SIGNALS, ONE SURFACE, AND NEITHER SUBSUMES THE OTHER. They fail in opposite
 * directions, which is exactly why both are here:
 *
 *   - The job dies before fetching → no marks land → the GAP REPORT sees it, and
 *     the heartbeat says why.
 *   - The job fetches cleanly and then dies at the commit or the post-check → the
 *     log looks perfect and the gap report is silent → only the HEARTBEAT knows.
 *   - The machine never hosted the job → no heartbeat at all → silence is correct,
 *     and the gap report remains the backstop if marks ever stop landing.
 *
 * ORDER IS THE CAUSE, THEN THE EFFECT. A failed run is why the days went missing;
 * reading the consequence first and the reason last is the wrong way round on a
 * channel scanned in two seconds.
 *
 * EMPTY MEANS HEALTHY. Both halves are silent when there is nothing to say, and
 * neither can throw — a liveness report that stops the dashboard mounting is worse
 * than no liveness report at all.
 */
import {
  defaultGapReportSince,
  loadHeartbeatLines,
  type EventStorePaths,
  type GapWindow,
} from "@numisma/event-store";
import { loadGapLines } from "./gap-lines.js";

/**
 * The heartbeat lines followed by the lost-day lines, for one instant.
 *
 * `now` is passed ONCE and shared: the heartbeat's staleness threshold and the gap
 * report's ceiling are the same rule (`dueThrough`), so evaluating them against two
 * different clock reads is the one way they could contradict each other.
 *
 * THE FLOOR NOBODY SUPPLIED IS `defaultGapReportSince` — the same floor
 * `pnpm gap-report` and the operator notice take. `app.ts` passes no window at all,
 * so before this the banner floored at the FIXED `LAUNCHD_ERA_START` while the
 * command floored 400 days back from yesterday, and the two started describing
 * different windows on 2027-08-08. Defaulting HERE rather than at `app.ts` is what
 * makes the shared floor structural: the notice's `loadOperatorNoticeLines` does the
 * identical thing at its own composer, so the twin binding survives a new caller
 * that never read this comment. Nothing observable changes until 2027-08-08, which
 * is the whole reason it had to be written before then.
 */
export async function loadLivenessLines(
  paths: EventStorePaths,
  now: Date,
  window: Omit<GapWindow, "now"> = {},
): Promise<string[]> {
  const [heartbeat, gaps] = await Promise.all([
    loadHeartbeatLines(paths, now),
    loadGapLines(paths, { ...window, since: window.since ?? defaultGapReportSince(now), now }),
  ]);
  return [...heartbeat, ...gaps];
}
