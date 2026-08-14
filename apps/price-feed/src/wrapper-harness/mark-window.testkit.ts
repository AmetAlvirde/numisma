/**
 * S8 · THE MARK WINDOW — the clock module of the wrapper harness (PRD #314 §8, D2).
 *
 * It owns two things a case cannot be trusted to own for itself: WHICH SIDE OF THE MARK
 * WINDOW A RUN FALLS ON, and the authored heartbeat a run finds already on disk.
 *
 * ── WHY THIS IS A MODULE AND NOT A CONSTANT ───────────────────────────────────────────
 * `markWindow` — and with it `lastMarkWindowFinishedAt`, which case 6 exists to assert —
 * is computed by the wrapper from a configured zone against a configured hour. Before
 * #315 that pair was a literal, so the only way to be in-window was for the suite to
 * happen to run between 18:00 and 23:59 CDMX. **Run it in the morning and case 6 passes
 * while asserting nothing** — the same green-while-testing-nothing failure the
 * group-leader trap produces, arriving through the clock instead of the process group and
 * equally invisible. The zone is an INPUT now, and this module is where that input is
 * chosen and where the oracle that judges it is written, so the two cannot drift apart.
 *
 * ── THE `Etc/GMT±n` TRICK, AND WHY THE OBVIOUS THING IS WRONG ─────────────────────────
 * The obvious thing is to pick a zone where it is currently evening. That works for most
 * of the day and BREAKS ONCE A DAY, when a suite run straddles the boundary it chose —
 * and the way it breaks is that a case starts asserting the wrong side, which is the
 * vacuity this whole slice exists to eliminate.
 *
 * The wrapper compares the current hour IN THE CONFIGURED ZONE against the configured
 * hour, so "in" is free: hour 0 is at or below every hour there is. "out" needs a
 * configured hour ABOVE the current one, and the only hour guaranteed to be above it is
 * one measured against a zone we picked. So {@link markConfigFor} finds the fixed-offset
 * zone where it is currently the 00 hour and asks for hour 0 (in) or hour 23 (out). That
 * leaves ~23 hours of margin in both directions, so no run of this suite — however long —
 * can straddle the boundary. Fixed-offset zones also have no DST discontinuity to
 * reason about.
 *
 * `Etc/GMT+5` means UTC-5: POSIX inverts the sign. Irrelevant here, because `Intl` below
 * and the wrapper's `TZ=… date` read the same tzdata and therefore agree by construction
 * whatever the label means. `packages/event-store/src/heartbeat.test.ts` uses the same
 * technique against the same wrapper; this is that technique, not a second one.
 *
 * ── EVERY SEEDED HEARTBEAT HERE IS AUTHORED ───────────────────────────────────────────
 * Byte for byte, written for this purpose. Nothing is captured from a real run, in
 * content or in shape — the line is authorship, not resemblance, and the instants below
 * are deliberately far from any date this repo has ever run on so a leaked real value
 * could never hide among them.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { MARK_HOUR, TRADING_DAY_TIME_ZONE } from "@numisma/engine";

/** The zone and hour a run's mark window is computed from. */
export interface MarkConfig {
  readonly timeZone: string;
  readonly hour: number;
}

/**
 * THE CONTRACT'S OWN PAIR, imported rather than restated. The wrapper's `${VAR:-default}`
 * halves are pinned against these constants by `apps/price-feed/src/schedule-window.test.ts`,
 * so a case configured with this is configured with exactly what an unconfigured run
 * would have used — which is what keeps every case written before the zone became an
 * input behaving precisely as it did.
 */
export const CONTRACT_MARK_CONFIG: MarkConfig = {
  timeZone: TRADING_DAY_TIME_ZONE,
  hour: MARK_HOUR,
};

/** The hour of day, right now, in `timeZone` — the same question the wrapper's `date` asks. */
function hourNowIn(timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(
      new Date(),
    ),
  );
}

/**
 * A configuration that puts a run on the chosen side of the mark window, with NO fake
 * `date`, no clock manipulation and no edit to the script.
 *
 * The range is the one every installed tzdata carries — `Etc/GMT-14` through `Etc/GMT+12`
 * — so AT LEAST ONE of them is at hour 00 at any instant and the search cannot come up
 * empty. Not exactly one: that is 27 offsets spread over a 24-hour cycle, so three pairs
 * share a local hour (`Etc/GMT-14`/`Etc/GMT+10`, `-13`/`+11`, `-12`/`+12`) and for part of
 * the day TWO zones sit at hour 00 together. Returning the first match is correct either
 * way — the two are equally valid answers to the same question — but "exactly one" was
 * never true and should not be relied on by a later edit. It throwing would mean the zone
 * database itself had moved, which must be loud.
 */
export function markConfigFor(window: "in" | "out"): MarkConfig {
  for (let offset = -14; offset <= 12; offset += 1) {
    const timeZone = `Etc/GMT${offset >= 0 ? "+" : "-"}${Math.abs(offset)}`;
    if (hourNowIn(timeZone) === 0) {
      return { timeZone, hour: window === "in" ? 0 : 23 };
    }
  }
  throw new Error(
    "wrapper harness: no fixed-offset zone is currently at hour 00, which is impossible — " +
      "the tz database this suite drives the mark window through has moved underneath it.",
  );
}

/** The two overrides the wrapper reads, as the environment carries them. */
export function markEnv(config: MarkConfig): { NUMISMA_MARK_TZ: string; NUMISMA_MARK_HOUR: string } {
  return { NUMISMA_MARK_TZ: config.timeZone, NUMISMA_MARK_HOUR: String(config.hour) };
}

/**
 * Whether this run was in the mark window, computed the way THE RUN'S OWN CONFIGURATION
 * computes it rather than from the machine's local clock, which would agree only by
 * coincidence of an OS setting.
 *
 * IT TAKES THE CASE'S CONFIG, NOT THE CONTRACT'S, and that is the whole correction #319
 * makes to the oracle. While the zone was a literal the two were the same thing; now that
 * a case chooses its side, an oracle still reading `America/Mexico_City` would judge the
 * in-window case against the wrong side — failing permanently, or worse, passing for the
 * wrong reason for six hours a day.
 *
 * Read off the heartbeat's own `startedAt`, so a run that straddles the configured hour is
 * still judged against the instant the wrapper judged itself at.
 */
export function expectedMarkWindow(startedAt: string, config: MarkConfig): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: config.timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(startedAt)),
  );
  return hour >= config.hour;
}

/**
 * AN AUTHORED PRIOR STAMP. Deliberately an instant this repo has never run at, so
 * "carried forward unchanged" and "re-stamped with this run's finish" can never be
 * confused for one another by coincidence.
 */
export const AUTHORED_PRIOR_STAMP = "2001-02-03T04:05:06Z";

/** Authored instants for the seeded files below. Same reasoning; never a captured value. */
const AUTHORED_SEED_STARTED_AT = "2001-02-03T04:00:00Z";
const AUTHORED_V1_FINISHED_AT = "2001-02-03T04:44:44Z";

function seed(dataDir: string, contents: string): void {
  writeFileSync(join(dataDir, "job-heartbeat.json"), contents, "utf8");
}

/**
 * A v2 breadcrumb from an earlier evening that DID land the day's marks.
 *
 * What a run finding it must do splits cleanly on the window: in-window and landed, it
 * overwrites this stamp with its own finish; anything else re-emits it unchanged. Both
 * halves are asserted, and seeding the SAME file for both is what makes them a pair —
 * without a prior stamp, "carried forward" and "invented nothing" are the same assertion.
 */
export function seedMarkedEveningHeartbeat(dataDir: string): void {
  seed(
    dataDir,
    `{
  "schemaVersion": 2,
  "startedAt": "${AUTHORED_SEED_STARTED_AT}",
  "finishedAt": "${AUTHORED_PRIOR_STAMP}",
  "exitCode": 0,
  "lastStep": "complete",
  "markWindow": true,
  "lastMarkWindowFinishedAt": "${AUTHORED_PRIOR_STAMP}"
}
`,
  );
}

/**
 * A SCHEMA-VERSION-1 breadcrumb — the shape written before the mark window existed.
 *
 * Every v1 run was read as evidence of a marked day, so its `finishedAt` IS the last
 * in-window finish and the wrapper migrates it forward. This is the only path on which
 * the wrapper derives a stamp from a field that is not one, and case 8 is the only place
 * it is exercised end to end.
 */
export function seedV1Heartbeat(dataDir: string): void {
  seed(
    dataDir,
    `{
  "schemaVersion": 1,
  "startedAt": "${AUTHORED_SEED_STARTED_AT}",
  "finishedAt": "${AUTHORED_V1_FINISHED_AT}",
  "exitCode": 0,
  "lastStep": "complete"
}
`,
  );
}

/** {@link seedV1Heartbeat}'s `finishedAt` — what a run reading it must carry, and nothing else. */
export const AUTHORED_V1_CARRY = AUTHORED_V1_FINISHED_AT;

/**
 * A v2 breadcrumb from an IN-WINDOW run that died before `spine` — in the window, marked
 * nothing, and correctly carrying no stamp at all.
 *
 * THIS IS THE DANGEROUS ONE, and it is the exact shape of the defect that opened this
 * line of work. The wrapper's v1 fallback used to be gated NEGATIVELY — it fired whenever
 * the file did not say `"markWindow": false` — so this perfectly ordinary v2 file was read
 * as v1 and its `finishedAt` was promoted into a marked-day stamp. That MANUFACTURES
 * EVIDENCE THAT THE DAY WAS COVERED out of a run that covered nothing, silencing the
 * staleness warning on precisely the morning it was needed: a false *no* on the coverage
 * question, the most dangerous defect class in this system. The watchdog makes this shape
 * routine — a timed-out run is in-window and unmarked by construction — so nothing about
 * it is hypothetical.
 */
export function seedInWindowDiedBeforeSpineHeartbeat(dataDir: string): void {
  seed(
    dataDir,
    `{
  "schemaVersion": 2,
  "startedAt": "${AUTHORED_SEED_STARTED_AT}",
  "finishedAt": "${AUTHORED_PRIOR_STAMP}",
  "exitCode": 127,
  "lastStep": "prices-fetch",
  "markWindow": true
}
`,
  );
}
