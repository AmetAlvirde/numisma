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
import { loadHeartbeatLines, type EventStorePaths, type GapWindow } from "@numisma/event-store";
import { loadGapLines } from "./gap-lines.js";

/**
 * The heartbeat lines followed by the lost-day lines, for one instant.
 *
 * `now` is passed ONCE and shared: the heartbeat's staleness threshold and the gap
 * report's ceiling are the same rule (`dueThrough`), so evaluating them against two
 * different clock reads is the one way they could contradict each other.
 */
export async function loadLivenessLines(
  paths: EventStorePaths,
  now: Date,
  window: Omit<GapWindow, "now"> = {},
): Promise<string[]> {
  const [heartbeat, gaps] = await Promise.all([
    loadHeartbeatLines(paths, now),
    loadGapLines(paths, { ...window, now }),
  ]);
  return [...heartbeat, ...gaps];
}
