/**
 * THE GAP REPORT — a pure, synchronous derivation over the durable log that
 * answers TWO questions about the launchd era:
 *
 *   1. **Which calendar days did the price feed not run on?** → `lost`
 *   2. **On which days did a whole VENUE owe marks and produce none?** → `venueDark`
 *
 * IT ANSWERED ONLY THE FIRST UNTIL #266, and the single-question framing that used
 * to open this header was load-bearing documentation — so it is replaced rather
 * than amended. The second question exists because the first cannot see the worst
 * case it neighbours: a venue that goes dark WHILE STILL SERVING STALE BARS makes
 * every instrument self-skip as INFO, the run exits 0, the heartbeat reads healthy,
 * and the day is anchored and marked — by the OTHER venue. Question 1 calls that
 * day clean, correctly. It is not clean.
 *
 * THE TWO ANSWERS ARE NOT THE SAME KIND OF THING, and conflating them is the one
 * mistake this module must not make. A lost day is PERMANENT — the feed did not
 * run, the marks can never be recovered, NAV is blank on that row forever. A
 * venue-dark day is not lost: the feed ran, the day is anchored, NAV computes off
 * the venue that did report. That is why `venueDark` is a SECOND ARRAY rather than
 * a third `LostDayReason` (#266 D5): three surfaces render `lost.length` as
 * "N lost day(s)", and a third verdict would silently inflate all three.
 *
 * QUESTION 2 IS STRICTLY ADDITIVE. It can only fire on a day that already has an
 * anchor AND at least one mark — i.e. a day question 1 has already cleared — so
 * `no-anchor` and `no-marks` keep their exact meanings, and no day carries both
 * verdicts. It is also WARN-ONLY (#266 D8): nothing is suppressed and the exit code
 * does not move, which D7 below makes mandatory rather than merely preferable.
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
 * instrument missing* is not. **`venueDark` does not overturn this**: its unit is a
 * whole venue at ZERO, never a count shortfall — eight of nine equities is still
 * one blank cell and stays unreported (#266 D3).
 *
 * ── QUESTION 2, STATED ─────────────────────────────────────────────────────────
 * **A venue is DARK on D when it owed a mark on D and zero `PriceMarked` events on
 * D attribute to it.** "Owed" is `owesMarkOn` from `@numisma/engine`'s venue
 * calendar — the same definition the push glance builder expects marks against, so
 * the two surfaces cannot disagree about whether a venue marks on weekends.
 *
 * ATTRIBUTION IS `instrumentsForSource`, NEVER `resolveInstrument`. The latter
 * throws loud on an unknown id BY DESIGN, which is right for the fetch orchestrator
 * and catastrophic here: this is a RETROSPECTIVE derivation over the whole log, so
 * one since-retired instrument in a historical row would crash every report from
 * that day forward. Marks that attribute to no registered instrument are counted
 * into `unattributedMarks` and are otherwise inert — **they may never suppress a
 * verdict**, because a mark nobody can place is not evidence that a venue reported.
 *
 * NO MARKET-HOLIDAY CALENDAR (#266 D7). `owesMarkOn` walks back over weekends and
 * nothing else, so every weekday US market holiday — roughly 9-10 a year — fires.
 * That is accepted, on this module's own logic: a false *no* is the one failure a
 * triage surface cannot have, and a holiday is a false *yes*. It is paid for in the
 * MESSAGE rather than in a calendar: the line names the venue and the WEEKDAY, so a
 * holiday reads as a holiday on sight. (A calendar also buys less than it looks
 * like — a stale one produces false positives, safe; an over-broad one produces
 * false negatives, dangerous.)
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
import {
  PRICE_SOURCES,
  addDays,
  instrumentsForSource,
  owesMarkOn,
  tradingDayAsOf,
  weekdayName,
  type PortfolioEvent,
  type PriceSource,
} from "@numisma/engine";

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

/**
 * One venue, one day, zero marks — question 2's finding.
 *
 * IT CARRIES THE DATE, and that is deliberate. `GapReport` is a LOCAL artifact:
 * stdout, `gap-report.json` beside the git-ignored log, and the TUI. ADR-007's
 * payload allow-list governs the hosted projection payload, which is a different
 * surface reached through a different module; nothing here imports it and nothing
 * here may. The local surfaces should name the day, and the weekday the message
 * needs is derived from the date rather than stored beside it.
 */
export interface VenueDarkDay {
  /** The day the venue owed marks on. */
  date: string;
  /** The venue that produced none. */
  source: PriceSource;
  /** How many registered instruments that venue owed on this day. */
  expected: number;
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
  /**
   * Ascending by date, then by venue. Empty means every venue that owed a mark on
   * a non-lost day produced at least one. **These are NOT lost days** — see the
   * header. Nothing may fold this into `lost.length`.
   */
  venueDark: VenueDarkDay[];
  /**
   * `PriceMarked` events in the window whose `instrumentId` has no registry row —
   * a since-retired or never-registered instrument. Reported so the number is
   * visible, and deliberately inert: it fills no venue's expectation.
   */
  unattributedMarks: number;
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
  // date → source → marks attributed to that source on that date.
  const venueMarksOn = new Map<string, Map<PriceSource, number>>();
  let unattributedMarks = 0;
  for (const event of events) {
    const { asOf } = event;
    if (asOf < since || asOf > until) {
      continue;
    }
    anchored.add(asOf);
    if (event.type !== "PriceMarked") {
      continue;
    }
    marksOn.set(asOf, (marksOn.get(asOf) ?? 0) + 1);
    // Attribution never throws: an id with no registry row is bucketed, not fatal.
    const source = SOURCE_BY_INSTRUMENT_ID.get(event.instrumentId);
    if (source === undefined) {
      unattributedMarks += 1;
      continue;
    }
    let bySource = venueMarksOn.get(asOf);
    if (bySource === undefined) {
      bySource = new Map();
      venueMarksOn.set(asOf, bySource);
    }
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
  }

  const lost: LostDay[] = [];
  const venueDark: VenueDarkDay[] = [];
  let calendarDays = 0;
  let anchorsChecked = 0;
  // Ascending by construction — the walk IS the sort. `venueDark` inherits that
  // ordering, and within a day the venue order is `PRICE_SOURCES`'.
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
      // A lost day is not additionally a venue-dark day: one day, one verdict.
      continue;
    }
    const bySource = venueMarksOn.get(date);
    for (const source of PRICE_SOURCES) {
      if (!owesMarkOn(source, date) || (bySource?.get(source) ?? 0) > 0) {
        continue;
      }
      venueDark.push({ date, source, expected: EXPECTED_BY_SOURCE[source] ?? 0 });
    }
  }

  return { since, until, calendarDays, anchorsChecked, lost, venueDark, unattributedMarks };
}

/**
 * `instrumentId` → the venue that serves it, built ONCE from `instrumentsForSource`
 * — the registry read that cannot throw. A module-level constant because the
 * registry is code-owned reference data: it cannot change between two calls of a
 * pure function, and rebuilding it per report would re-walk thirteen rows per day.
 */
const SOURCE_BY_INSTRUMENT_ID: ReadonlyMap<string, PriceSource> = new Map(
  PRICE_SOURCES.flatMap((source) =>
    instrumentsForSource(source).map(
      (entry) => [entry.instrumentId, source] as [string, PriceSource],
    ),
  ),
);

/** How many instruments each venue owes on a day it owes anything. */
const EXPECTED_BY_SOURCE: Readonly<Partial<Record<PriceSource, number>>> =
  Object.fromEntries(
    PRICE_SOURCES.map((source) => [source, instrumentsForSource(source).length]),
  );

/**
 * One line per lost day, then one per venue-dark venue-day. EMPTY when the window
 * is clean — the caller stays quiet, and that is what bounds the noise BY
 * CONSTRUCTION on every channel this feeds.
 *
 * LOST DAYS COME FIRST, wording untouched, so the surfaces that already read this
 * output see their existing lines in their existing order with new lines appended.
 * The venue-dark line says "the day is not lost" in as many words: it is printed
 * next to lines that end "the day is lost", and a reader must not have to infer the
 * difference.
 */
export function formatGapReport(report: GapReport): string[] {
  return [...formatLostDays(report), ...formatVenueDarkDays(report)];
}

/**
 * The lost-day lines alone, ascending.
 *
 * SPLIT OUT BECAUSE A BOUNDED CHANNEL CANNOT SLICE THE CONCATENATION. The TUI prints
 * at most seven lines; taking the tail of `formatGapReport`'s output withholds lost
 * days first and, once the venue-dark lines alone fill the bound, withholds every
 * lost day forever — a permanent, unfixable finding starved out by a transient,
 * recurring one. The channel therefore reserves capacity per kind, and reserving
 * requires the kinds to arrive separately. The rendering itself is unchanged, and
 * {@link formatGapReport} still returns exactly what it always did.
 */
export function formatLostDays(report: GapReport): string[] {
  return report.lost.map(({ date, reason }) =>
    reason === "no-anchor"
      ? `Numisma: ${date} — NO DATA. No event of any kind carries this date; the day is lost.`
      : `Numisma: ${date} — NO MARKS. The day is anchored but no price mark landed on it; the day is lost.`,
  );
}

/**
 * The venue-dark lines alone, ascending by date then by venue. See
 * {@link formatLostDays} for why the two kinds are separable.
 */
export function formatVenueDarkDays(report: GapReport): string[] {
  // The WEEKDAY is not decoration — it is how the reader recognises the ~9-10
  // market holidays a year this fires on (D7), which are the only false
  // positives it has by design.
  return report.venueDark.map(
    ({ date, source, expected }) =>
      `Numisma: ${date} (${weekdayName(date)}) — VENUE DARK. ${source} owed ` +
      `${expected} mark(s) and produced none. The day is not lost; the venue was ` +
      `silent, or the market was closed for a holiday.`,
  );
}

/**
 * The always-printed one-liner: what was checked, and the verdict.
 *
 * THE LOST-DAY SENTENCE IS UNCHANGED, down to the byte, and the venue-dark count
 * is a SEPARATE sentence that says what it is not. Three surfaces render "N lost
 * day(s)"; folding venue-dark venue-days into that number would inflate all three.
 */
export function formatGapSummary(report: GapReport): string {
  const scope =
    `${report.since}…${report.until} ` +
    `(${report.calendarDays} day(s), ${report.anchorsChecked} anchor(s) checked)`;
  const lost =
    report.lost.length === 0
      ? `Numisma: no lost days in ${scope}.`
      : `Numisma: ${report.lost.length} lost day(s) in ${scope}.`;
  return report.venueDark.length === 0
    ? lost
    : `${lost} ${report.venueDark.length} venue-day(s) dark — not lost days: ` +
      `the feed ran and the days are anchored.`;
}
