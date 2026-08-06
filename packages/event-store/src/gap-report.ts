/**
 * THE GAP REPORT — a pure, synchronous derivation over the durable log that
 * answers one question: **which calendar days in the launchd era did the price
 * feed not run on?**
 *
 * IT REPORTS. IT NEVER FILLS. Folding an unanchored day writes a row on which all
 * thirteen instruments were expected and none arrived: `feedGap` fires, every
 * header key suppresses, and NAV is permanently blank on a historical row no later
 * run can repair — a calendar-dense backfill manufactures its own graveyard
 * (`apps/web/src/push/backfill-core.ts`). This module returns dates and counts,
 * and writes nothing to the log or the projection.
 *
 * ── THE RULE, STATED RATHER THAN INHERITED ────────────────────────────────────
 * **A `PriceMarked` event whose `asOf == D` is a mark landing on D.** That is the
 * whole rule, and it is written here rather than borrowed because nobody has
 * enumerated whether another event type should also count. It is a choice; the
 * next reader deserves to see that it was made. (`InvalidationMarked` is the one
 * verb whose NAME invites inclusion — it is latest-wins per position exactly as
 * `PriceMarked` is per instrument — but it records an operator's decision, not a
 * feed observation, so counting it would let a day look alive because someone
 * moved a stop. It is deliberately not a mark.)
 *
 * **IT IS NOT `feedGap.arrived`.** That metric is *nearby* and answers a different
 * question, and mistaking one for the other is the defect this module was rewritten
 * to remove. `arrived` counts instruments FRESH AGAINST THEIR LAST EXPECTED MARK
 * DATE, and for a weekday venue that expectation walks back over the weekend — so
 * on a Saturday the nine equities count as arrived off FRIDAY's marks. A weekend on
 * which the fetch produced nothing folds to 9, never 0. Measured against the real
 * log, every weekend from mid-July on folds 13/13 while producing 4 marks. **A
 * detector written on `arrived > 0` cannot fire on a weekend at all** — see
 * `arrivedUnderOldRule` in the test suite, which keeps that disagreement executable.
 *
 * Two verdicts, and only two:
 *
 *   `no-anchor`  no event of any kind carries this `asOf`.
 *   `no-marks`   an anchor exists, but zero `PriceMarked` events carry it. The day
 *                has SOME event — a fill, a deposit — so it is "fresh" to any
 *                `max(as_of)` test, while not one instrument was marked.
 *
 * **`marksOn(D) < 13` IS NOT REPORTED, AT ANY SEVERITY.** A Saturday's 4 is
 * complete, not degraded, and one failed Twelve Data symbol is one blank cell that
 * the existing `feedGap` trigger already speaks to. *Day lost* is permanent; *one
 * instrument missing* is not.
 *
 * INTERIOR GAPS ARE THE POINT. A trailing `max(as_of)` check is exactly what let
 * 07-18…07-26 hide until a human noticed nine days later. Walking the whole window
 * catches a single lost Thursday sitting behind a healthy Friday.
 *
 * ── WHERE IT LIVES ────────────────────────────────────────────────────────────
 * `@numisma/event-store`, and that is determined rather than chosen. Every input
 * sits on an existing edge — the log loader and store-path resolver from this
 * package, `PortfolioEvent` and `tradingDayAsOf` from `@numisma/engine`, which this
 * package already depends on. No new package edge in either direction, and both
 * consumers (`apps/web`, `apps/tui`) already declare it. `@numisma/engine` is not
 * an alternative: ADR-001 keeps file IO out of it by name, and this is derived from
 * the log. The prototype's `apps/tui → apps/web` reach through a computed specifier
 * — untypechecked by construction — is what this placement retires.
 *
 * The prototype's injected `{anchors, arrivedOn}` source pair is RETIRED. Over two
 * independent async folds it was a real seam with two adapters; over one
 * synchronous pass it is indirection with a single adapter — and it is what let
 * nine tests inject synthetic counts and never exercise the number the rule was
 * applied to.
 */
import { addDays, tradingDayAsOf, type PortfolioEvent } from "@numisma/engine";

/**
 * THE FLOOR. 2026-07-03 is the day the daily launchd scheduler landed
 * (`ops/price-feed`, #108/#109) and the first date from which the log is
 * calendar-dense. Before it, a missing day is an artifact of there being no job;
 * from it onward a missing day IS the failure this report exists to name. Dated
 * and hardcoded on purpose: moving the floor must be a visible edit.
 *
 * REJECTED — a genesis / first-anchor floor (walk everything the log holds). The
 * log's first week is hand-run: its anchors are `06-26, 06-28, 06-30, 07-03 …`, so
 * 06-27 / 06-29 / 07-01 / 07-02 would be reported as lost on every run, forever,
 * with no possible remedy — a missed day is permanently unmarkable after CDMX
 * midnight. A detector that opens with four unfixable findings trains you to skim
 * it, which is precisely the failure #185 was filed about.
 *
 * REJECTED — deriving the floor as "the day after the last gap". It is
 * SELF-ERASING: every new gap advances the floor past itself and the report goes
 * quiet exactly when it should shout. **A detector must not be a function of its
 * own findings.**
 */
export const LAUNCHD_ERA_START = "2026-07-03";

/**
 * The timezone the trading day — and therefore "yesterday" — is anchored to. A
 * BARE STRING, not a `MarkClock`: with the ceiling pinned to yesterday at every
 * hour (below), the mark-TIME check drops out of this derivation entirely, so the
 * only thing left to duplicate is the zone. It matches `apps/price-feed`'s
 * `DEFAULT_CONFIG.timeZone`; this package does not depend on that app and will not
 * grow an edge to read one constant.
 */
export const REPORT_TIME_ZONE = "America/Mexico_City";

/** Why a day is lost. Both are "day lost"; they differ in what the log holds. */
export type LostDayReason =
  /** No event of any kind carries this `asOf`. */
  | "no-anchor"
  /** An anchor exists, but zero `PriceMarked` events carry this `asOf`. */
  | "no-marks";

export interface LostDay {
  date: string;
  reason: LostDayReason;
}

export interface GapReport {
  /** Inclusive window floor actually used. */
  since: string;
  /** Inclusive window ceiling actually used — never today. */
  until: string;
  /** Calendar days in `[since, until]`. Zero when the window is inverted. */
  calendarDays: number;
  /** Anchored days that fell inside the window. */
  anchorsChecked: number;
  /** Ascending. Empty means every day in the window carried a mark. */
  lost: LostDay[];
}

/**
 * The window to inspect. `now` is REQUIRED and `since`/`until` are optional
 * overrides — which is what keeps {@link computeGapReport} a pure function of its
 * arguments: it reads no clock of its own, so the only surface that can produce a
 * different answer on a different day is the caller.
 */
export interface GapWindow {
  /** Inclusive floor. Defaults to {@link LAUNCHD_ERA_START}. */
  since?: string | undefined;
  /** Inclusive ceiling. Clamped to {@link dueThrough} — never today. */
  until?: string | undefined;
  /** The instant "yesterday" is measured from. */
  now: Date;
}

/**
 * THE CEILING: **yesterday in CDMX, at every hour of the day.** The report never
 * names today.
 *
 * The prototype flipped the ceiling to TODAY once the clock passed the 18:00 CDMX
 * mark time and then printed, verbatim, *"today — NO DATA … the day is lost."*
 * That is false until CDMX midnight, and it is false during exactly the six-hour
 * window the design exists to exploit — one run on record completed at 20:56. A
 * liveness detector that cries about a day still in progress is the same
 * skim-inducing false positive the genesis floor was rejected for.
 */
export function dueThrough(now: Date, timeZone: string = REPORT_TIME_ZONE): string {
  return addDays(tradingDayAsOf(now, timeZone), -1);
}

/**
 * THE FLOOR, BOUNDED: `LAUNCHD_ERA_START`, or `maxDays` back from the ceiling —
 * whichever is LATER. Inclusive of the ceiling itself, so the window it opens is
 * exactly `maxDays` calendar days wide at its widest.
 *
 * IT EXISTS BECAUSE THE ERA START IS A FIXED DAY AND THE CEILING IS NOT. A caller
 * that both defaults its floor to the era start AND refuses windows over some width
 * has written a date-bomb without noticing: the default window grows by one day
 * every day and eventually crosses the refusal. For the gap-report command that day
 * is 2027-08-08, and the cost is the 18:00 job going permanently red at its last
 * step, long after anyone remembers why.
 *
 * The WIDTH lives with the caller that has the reason for it (readability, a line
 * budget, a screen); the ERA START and the calendar arithmetic live here, with the
 * derivation they belong to. Neither has to know the other's constant.
 */
export function boundedEraFloor(now: Date, maxDays: number): string {
  const widest = addDays(dueThrough(now), -(maxDays - 1));
  return widest > LAUNCHD_ERA_START ? widest : LAUNCHD_ERA_START;
}

/**
 * Name the lost days in the window. Synchronous, pure, and ONE PASS over the
 * events: the anchor set and the per-date mark counts are built together, because
 * they are two readings of the same scan.
 *
 * An anchor is ANY event's `asOf` — matching how the backfill enumerates them.
 * (The backfill additionally filters to `asOf >= genesis`; here the window floor
 * is 2026-07-03, long after genesis, so that filter is already subsumed and no
 * genesis load is needed. That is what lets the core be pure.)
 */
export function computeGapReport(
  events: readonly PortfolioEvent[],
  window: GapWindow,
): GapReport {
  const since = window.since ?? LAUNCHD_ERA_START;
  const ceiling = dueThrough(window.now);
  // Clamped, not merely defaulted: "the report never names today" is then a
  // property of this function rather than of every caller's care.
  const until =
    window.until === undefined || window.until > ceiling ? ceiling : window.until;

  const anchored = new Set<string>();
  const marksOn = new Map<string, number>();
  for (const event of events) {
    const { asOf } = event;
    if (asOf < since || asOf > until) {
      continue;
    }
    anchored.add(asOf);
    if (event.type === "PriceMarked") {
      marksOn.set(asOf, (marksOn.get(asOf) ?? 0) + 1);
    }
  }

  const lost: LostDay[] = [];
  let calendarDays = 0;
  let anchorsChecked = 0;
  // Ascending by construction — the walk IS the sort.
  for (let date = since; date <= until; date = addDays(date, 1)) {
    calendarDays += 1;
    if (!anchored.has(date)) {
      lost.push({ date, reason: "no-anchor" });
      continue;
    }
    anchorsChecked += 1;
    // Zero marks, not "fewer than thirteen". See the header.
    if ((marksOn.get(date) ?? 0) === 0) {
      lost.push({ date, reason: "no-marks" });
    }
  }

  return { since, until, calendarDays, anchorsChecked, lost };
}

/** One line per lost day. EMPTY when the window is clean — the caller stays quiet. */
export function formatGapReport(report: GapReport): string[] {
  return report.lost.map(({ date, reason }) =>
    reason === "no-anchor"
      ? `Numisma: ${date} — NO DATA. No event of any kind carries this date; the day is lost.`
      : `Numisma: ${date} — NO MARKS. The day is anchored but no price mark landed on it; the day is lost.`,
  );
}

/** The always-printed one-liner: what was checked, and the verdict. */
export function formatGapSummary(report: GapReport): string {
  const scope =
    `${report.since}…${report.until} ` +
    `(${report.calendarDays} day(s), ${report.anchorsChecked} anchor(s) checked)`;
  return report.lost.length === 0
    ? `Numisma: no lost days in ${scope}.`
    : `Numisma: ${report.lost.length} lost day(s) in ${scope}.`;
}
