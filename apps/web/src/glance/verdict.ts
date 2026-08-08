/**
 * THE VERDICT (PRD #146 D15, slice #150) — the pure module that turns the projection's
 * anchor history into the one line D1 asks for: *does anything need me before I next
 * sit at the desk?*
 *
 * PURE, AND THAT IS LOAD-BEARING RATHER THAN STYLISTIC. No IO: no database, no
 * filesystem, no network, no `Date.now()` — the wall clock arrives as an argument.
 * That is what makes the 28-anchor replay in `verdict-replay.test.ts` possible at
 * all, and it is achievable only because slice #148 put every push-side conclusion on
 * the wire. What it takes from `../projection/contract.ts` is the wire contract's
 * types plus ONE runtime value, `SUPPRESSION_KEYS` — safe only because that module is
 * now pg-free (the driver moved to `../projection/snapshot-reader.ts`) and
 * `projection/contract.test.ts` holds it that way from the module graph. A value
 * import of anything that reaches `pg` would drag the driver into the browser bundle
 * and fail `client-bundle.integration.test.ts`.
 *
 * THE RULE THAT DECIDES WHAT MAY LIVE HERE: *does this computation need data D8 keeps
 * off the wire?* If yes the PUSH computes it and ships the conclusion (that is
 * `push/glance.ts` and the `feedGap` block); if no the READER computes it from the
 * wire plus the wall clock. `freshness` is the second kind — it is `summary.asOf`
 * against the clock, DERIVED AT RENDER TIME, never pushed and never read from the
 * payload. Everything else this module needs is already on the wire by construction.
 * If a future trigger wants a number that is not there, that is a spec seam to
 * re-open, not something to work around here.
 *
 * NOT A PACKAGE, and not yet. It sits beside the projection contract as a surface
 * concern — out of the engine, which must stay unaware that a cloud exists — and
 * becomes a package when a second consumer exists, not before.
 */
import type {
  DashboardFocus,
  DashboardSummary,
} from "@numisma/engine";
import {
  SUPPRESSION_KEYS,
  type GlanceBlock,
  type SnapshotAnchor,
} from "../projection/contract.ts";
import { addDays, asOfSortKey, calendarDateOf, daysBetween } from "../projection/as-of.ts";

/* ────────────────────────────── the four triggers ─────────────────────────────── */

/**
 * `freshness` — how old the newest anchor may be before the surface stops claiming to
 * describe today. Derived from `latest.asOf` against the wall clock; NEVER pushed.
 *
 * Two days rather than one because the anchor is a calendar date and the clock is a
 * moment: at one day, a snapshot taken yesterday evening reads stale this morning
 * every single day. UNTESTED AGAINST A REAL OUTAGE — every gap in the log predates
 * the launchd job, so with the job running this fires only when the job dies, which
 * is precisely when it is needed and precisely when nobody has seen it work.
 */
export const STALE_ANCHOR_DAYS = 2;

/**
 * `feedGap` — how many unexpectedly-absent marks it takes to speak. One. The
 * expectation-vs-arrival conclusion is computed push-side (D14) and arrives as
 * `glance.feedGap`; this module only reads the shortfall it names.
 */
export const FEED_GAP_MIN_MISSING_MARKS = 1;

/**
 * `reserveFloor` — the floor itself is NOT a constant here, and that absence is the
 * decision (V2/R4). It is stamped per anchor by the push from the preferences sidecar
 * and arrives as `glance.reserveTargetPct`; when it is absent the trigger DECLINES.
 * There is no fallback and deliberately no access to one — `defaultProfitPolicyEntry`
 * (10) is a seed for a new sidecar, never a read-gap filler, and rendering a floor the
 * operator never set is exactly the failure the invariant forbids.
 *
 * What is constant is the SHAPE of the rule (R4): strictly below the floor, on the
 * anchor's own Reserve percentage.
 */
export const RESERVE_FLOOR_WIRE_KEY = "glance.reserveTargetPct" as const;

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
 * 1.5% picks the tails of the measured month honestly: it takes three of the 28
 * anchored days and leaves 25. The measured day-over-day range that justifies the
 * choice is deliberately not quoted here — this repository is public, and the range
 * is the fund's best and worst days. It is recorded in the private notes vault.
 */
export const NAV_MOVE_THRESHOLD_PCT = 1.5;

/**
 * PRECEDENCE — `freshness > feedGap > reserveFloor > navMove`, ranked by *does this
 * invalidate what is below it*. Stale data invalidates every conclusion drawn from
 * it; a missing mark invalidates the numbers that descend from NAV; an under-reserved
 * fund is a standing condition that outranks a single day's move.
 *
 * CHOSEN, NOT MEASURED — and the code says so because a reader will otherwise assume
 * it was fitted to data. It cannot be measured: `feedGap` took 5 of the 6 *yes* days
 * in the fund's entire recorded history and `navMove` the 6th, so NO SAME-DAY
 * COLLISION HAS EVER BEEN OBSERVED. The only exercise this ordering gets is against
 * the synthesized collisions in `verdict.test.ts`.
 *
 * The verdict renders ONE line — `fired[0]` — and D6's "a freshness failure replaces
 * the verdict" is not a special case in the code: it is what being first in this
 * array means. The REST of `fired` is computed, returned, and currently rendered
 * NOWHERE: no component reads it. That is the honest state, not a gap to paper over
 * — D9's ceiling governs what may go below the tap, and a second firing trigger has
 * to earn its place there rather than arrive because the array happened to exist.
 */
export const TRIGGER_PRECEDENCE = [
  "freshness",
  "feedGap",
  "reserveFloor",
  "navMove",
] as const;

export type TriggerName = (typeof TRIGGER_PRECEDENCE)[number];

/**
 * THE EXHAUSTIVENESS LATCH for {@link TRIGGER_PRECEDENCE}, which is its whole job.
 *
 * NOTHING READS THIS AT RUNTIME, and the framing is deliberate: an earlier comment
 * called it "one readable inventory", which described an inventory no reader had — no
 * surface renders it and no code imports it. What it actually does is fail the BUILD
 * when a fifth trigger joins `TRIGGER_PRECEDENCE` without declaring its threshold
 * here, and that is worth keeping on its own. Deleting it as an unused export would
 * silently remove that latch, which is the failure mode it exists to prevent.
 */
export const TRIGGERS = {
  freshness: { name: "freshness", staleAfterDays: STALE_ANCHOR_DAYS },
  feedGap: { name: "feedGap", minMissingMarks: FEED_GAP_MIN_MISSING_MARKS },
  reserveFloor: { name: "reserveFloor", floorFrom: RESERVE_FLOOR_WIRE_KEY },
  navMove: { name: "navMove", thresholdPct: NAV_MOVE_THRESHOLD_PCT },
  // `Record<TriggerName, object>` rather than a shape: this latch is about
  // EXHAUSTIVENESS — a fifth trigger added to `TRIGGER_PRECEDENCE` without an entry
  // here stops compiling — not about the four thresholds sharing a shape, which they
  // deliberately do not (the Reserve floor is a wire key, not a number).
} as const satisfies Record<TriggerName, object>;

/* ─────────────────────────────────── the shape ────────────────────────────────── */

/** One trigger that fired, with the sentence it would render as the verdict. */
export interface FiredTrigger {
  name: TriggerName;
  sentence: string;
}

/**
 * Why a standing number is absent. An empty slot ALREADY means *suppressed* (V1/D7),
 * so it must never also mean "nothing to say" — every absence names its cause, and
 * the four causes are genuinely distinct:
 *
 *  - `unexpected-absence` — a mark the venue owed did not arrive (push-side, V1);
 *  - `no-policy` — no Reserve floor was in force as-of this anchor (R5);
 *  - `no-earlier-anchor` — D4's genesis case: there is no earlier anchor to compare
 *    against, so Change is absent by the same mechanism as any other missing input,
 *    with NO special-case copy;
 *  - `reference-withheld` — composition rule 1: the reference anchor's own numbers
 *    are suppressed, so the surface refuses to compare against a number it will not
 *    show.
 */
export type SuppressionReason =
  | "unexpected-absence"
  | "no-policy"
  | "no-earlier-anchor"
  | "reference-withheld";

/** A standing number that renders, or an absence that names its cause. */
export interface FundValueSlot {
  rendered: boolean;
  usdValue?: number;
  suppressedBy?: SuppressionReason;
}

/**
 * The Change slot. Its reference is ALWAYS named when one was resolved — including
 * when the number itself is suppressed, because "never claim a date you don't have;
 * always name the one you landed on" (V3) is about the date, not about the number.
 */
export interface ChangeSlot {
  rendered: boolean;
  percent?: number;
  referenceAsOf?: string;
  referenceLabel?: string;
  suppressedBy?: SuppressionReason;
}

export interface ReserveSlot {
  rendered: boolean;
  percentOfFund?: number;
  floorPct?: number;
  suppressedBy?: SuppressionReason;
}

export interface Verdict {
  /** The anchor this verdict describes. */
  asOf: string;
  /** Whole days from that anchor to the wall clock — the freshness derivation. */
  staleDays: number;
  /** D1's answer. `false` is the default and the common case: 22 of 28 anchors. */
  needsYou: boolean;
  /** The ONE line. `fired[0]`'s sentence, or the standing *no*. */
  sentence: string;
  /**
   * Everything that fired, in precedence order. No component renders it —
   * `/big-picture` does not list it — but it is NOT dead: the replay suites read
   * it to pin trigger precedence (audit finding 39).
   */
  fired: FiredTrigger[];
  /** D3's closed set of exactly three standing numbers. All three always render. */
  slots: {
    fundValue: FundValueSlot;
    change: ChangeSlot;
    reserve: ReserveSlot;
  };
}

/** The verdict sentence on a day nothing fired. */
export const NOTHING_NEEDS_YOU = "Nothing needs you";

/* ──────────────────────────── nearest-anchor resolution ───────────────────────── */

/**
 * V3 — the nearest anchor at or before `targetAsOf`, or `undefined` when the target
 * predates every anchor.
 *
 * The projection is a SAMPLED view of the log whose sampling rate is "whenever the
 * push ran", so "yesterday" is frequently not an anchor: from 07-03 the nearest
 * anchor to 07-02 is 06-30, a three-day step. Resolving to the nearest anchor at or
 * before the target is what keeps the NUMBER honest; rendering the date landed on
 * (never the date requested) is what keeps the LABEL honest. The caller must show
 * `referenceAsOf`, not the target it asked for.
 *
 * Ordered through {@link asOfSortKey} rather than by string comparison: `as_of` is a
 * TEXT column and a lexical sort mis-picks any non-zero-padded date.
 */
export function resolveNearestAnchor(
  anchors: readonly SnapshotAnchor[],
  targetAsOf: string,
): SnapshotAnchor | undefined {
  const targetKey = asOfSortKey(targetAsOf);
  let best: SnapshotAnchor | undefined;
  let bestKey = -Infinity;
  for (const anchor of anchors) {
    const key = asOfSortKey(anchor.asOf);
    if (key <= targetKey && key > bestKey) {
      best = anchor;
      bestKey = key;
    }
  }
  return best;
}

/**
 * THE reference anchor for `latest` — the nearest anchor at or before the day BEFORE
 * it. On a daily-anchored history that is simply yesterday; across the log's sparse
 * first fortnight it steps back further, and the caller names wherever it landed.
 *
 * Factored out of {@link computeVerdict} (slice #151) because `/big-picture`'s
 * per-row deltas resolve the SAME reference: the Change slot and the rows below it
 * disagreeing about which day they compare against would be a surface that contradicts
 * itself, and one function is a cheaper guarantee than two tests.
 */
export function resolveReferenceAnchor(
  anchors: readonly SnapshotAnchor[],
  latest: SnapshotAnchor,
): SnapshotAnchor | undefined {
  return resolveNearestAnchor(
    anchors.filter((anchor) => asOfSortKey(anchor.asOf) < asOfSortKey(latest.asOf)),
    addDays(latest.asOf, -1),
  );
}

/* ────────────────────────────────── the verdict ───────────────────────────────── */

/**
 * Compute the verdict for `latest` against the anchor history and the wall clock.
 *
 * `anchors` is the whole history (ascending, as `getSnapshotHistory` returns it), not
 * just a reference: `reserveFloor` is a STATE rule that has to count how long the
 * condition has held, which one anchor cannot answer.
 *
 * `now` is injected rather than read, which is what makes every case below
 * reproducible — including the ones real history does not contain.
 */
export function computeVerdict(
  latest: SnapshotAnchor,
  anchors: readonly SnapshotAnchor[],
  now: Date,
): Verdict {
  const summary = latest.report.dashboard.summary;
  const glance = latest.report.glance;
  const suppressed = new Set(glance.suppressed);

  // FRESHNESS — the render-time derivation. `latest.asOf` against the clock, in whole
  // UTC days. Nothing on the wire says how old the data is, and nothing should: a
  // pushed "staleness" would be stale itself the moment the push finished.
  const staleDays = daysBetween(summary.asOf, calendarDateOf(now));

  // The reference — the same one `/big-picture`'s per-row deltas resolve.
  const reference = resolveReferenceAnchor(anchors, latest);

  const slots = {
    fundValue: fundValueSlot(summary, suppressed),
    change: changeSlot(summary, suppressed, reference),
    reserve: reserveSlot(summary, glance, suppressed),
  };

  const fired: FiredTrigger[] = [];

  if (staleDays >= STALE_ANCHOR_DAYS) {
    fired.push({
      name: "freshness",
      sentence: `Data is ${staleDays} days old — last anchored ${referenceLabel(summary.asOf)}`,
    });
  }

  const missing = glance.feedGap.missing.length;
  if (missing >= FEED_GAP_MIN_MISSING_MARKS) {
    fired.push({
      name: "feedGap",
      sentence:
        `${missing} of ${glance.feedGap.expected} instruments ` +
        `${missing === 1 ? "has" : "have"} no current mark`,
    });
  }

  // RESERVE FLOOR — a STATE rule (R3), not an edge rule. It fires EVERY day the fund
  // is below its floor and names the duration past day one. An edge rule goes quiet
  // on day two while the condition still holds, which prints *no* over an
  // under-reserved fund: the one failure a triage surface cannot have, a `no` that
  // isn't. Alarm fatigue is accepted knowingly — a breach is rare, actionable and
  // self-clearing, and if it turns out not to be rare, the floor is set wrong.
  //
  // IT SHIPS UNTESTED AGAINST REAL DATA. Reserve sits at 19.5–20.7% against a 10%
  // floor on all 28 anchors — there is no breach anywhere in 34 days of log — so
  // every assertion behind this branch is against a SYNTHESIZED anchor. Say so rather
  // than leaning on a prototype for validation it cannot give.
  //
  // Composition rule 1 does NOT govern this trigger, and must not be described as
  // doing so: rule 1 is COMPARATIVE and is about the REFERENCE anchor, while a level
  // test has no reference anchor to withhold. What governs it is R8, which until
  // slice #151 was an unnamed "simpler rule" in this comment:
  //
  //   R8 — A TRIGGER MAY NOT ASSERT A BREACH OFF A NUMBER THE SURFACE REFUSES TO
  //   SHOW. It is about the CURRENT anchor's own number, and it is the
  //   `slots.reserve.rendered` gate below.
  //
  // R8 COMPLETES THE SPEC RATHER THAN DEPARTING FROM IT. #146 already says "suppress
  // the slot, decline the trigger" for the missing-policy cause (R5), and separately
  // says an unexpected mark absence suppresses Reserve % (because its denominator is
  // NAV). R8 is the JOIN of those two: whatever the cause, if the Reserve slot does
  // not render, the trigger does not fire. Without it, the second cause would print
  // "Reserve is 8.2%, below its 10% floor" beside an em dash where the 8.2% should be.
  if (slots.reserve.rendered && slots.reserve.floorPct !== undefined) {
    const pct = slots.reserve.percentOfFund!;
    if (pct < slots.reserve.floorPct) {
      const days = breachDurationDays(anchors, latest);
      fired.push({
        name: "reserveFloor",
        sentence:
          `Reserve is ${formatPct(pct)}%, below its ${formatPct(slots.reserve.floorPct)}% floor` +
          (days > 1 ? ` — ${ordinal(days)} day` : ""),
      });
    }
  }

  // NAV MOVE — the one comparative trigger, and therefore the one composition rule 1
  // governs. It fires only when the Change slot RENDERS: a withheld reference (06-28)
  // or a suppressed own NAV (07-03) means the surface will not show the number, and a
  // rule that refuses to compare against a number it will not show is the correct
  // reading of V1 composed with D4. Nobody designed that; it fell out of the two.
  if (
    slots.change.rendered &&
    Math.abs(slots.change.percent!) >= NAV_MOVE_THRESHOLD_PCT
  ) {
    fired.push({
      name: "navMove",
      // The verdict names the CONDITION; the slot carries the NUMBER. Printing the
      // move here too would say the same thing twice, which is what the prototype did.
      sentence: `Fund moved more than ${NAV_MOVE_THRESHOLD_PCT}% since ${slots.change.referenceLabel}`,
    });
  }

  fired.sort(
    (a, b) => TRIGGER_PRECEDENCE.indexOf(a.name) - TRIGGER_PRECEDENCE.indexOf(b.name),
  );

  return {
    asOf: summary.asOf,
    staleDays,
    needsYou: fired.length > 0,
    sentence: fired[0]?.sentence ?? NOTHING_NEEDS_YOU,
    fired,
    slots,
  };
}

/* ─────────────────────────────────── the slots ────────────────────────────────── */

/**
 * D3/D7 — ALL THREE SLOTS ALWAYS RENDER as slots; what varies is whether the NUMBER
 * is there. An empty slot means *suppressed*, which is diagnostic in itself, and a
 * slot that vanished would destroy that.
 *
 * The suppression keys are read from {@link SUPPRESSION_KEYS} — their one declared
 * home on the wire contract — never re-spelled here; that docstring says why.
 */
function fundValueSlot(
  summary: DashboardSummary,
  suppressed: ReadonlySet<string>,
): FundValueSlot {
  if (suppressed.has(SUPPRESSION_KEYS.fundValue)) {
    return { rendered: false, suppressedBy: "unexpected-absence" };
  }
  return { rendered: true, usdValue: summary.fundValueUsd };
}

/**
 * The Change slot — three causes of absence, checked in the order they invalidate.
 *
 * 1. This anchor's own NAV is suppressed, so no change computed from it is safe.
 * 2. D4's genesis case: no earlier anchor exists. No special-case copy — the slot is
 *    absent by the same mechanism as any other missing input.
 * 3. Composition rule 1: the reference anchor's own NAV is withheld.
 */
function changeSlot(
  summary: DashboardSummary,
  suppressed: ReadonlySet<string>,
  reference: SnapshotAnchor | undefined,
): ChangeSlot {
  const named =
    reference === undefined
      ? {}
      : {
          referenceAsOf: reference.asOf,
          referenceLabel: referenceLabel(reference.asOf),
        };

  if (suppressed.has(SUPPRESSION_KEYS.change)) {
    return { rendered: false, suppressedBy: "unexpected-absence", ...named };
  }
  if (reference === undefined) {
    return { rendered: false, suppressedBy: "no-earlier-anchor" };
  }
  if (reference.report.glance.suppressed.includes(SUPPRESSION_KEYS.fundValue)) {
    return { rendered: false, suppressedBy: "reference-withheld", ...named };
  }

  const from = reference.report.totals.fundValueUsd;
  return {
    rendered: true,
    percent: (summary.fundValueUsd / from - 1) * 100,
    ...named,
  };
}

/**
 * The Reserve slot. Two causes, and they are genuinely different failures: an absent
 * mark makes the RATIO wrong (its denominator is NAV — D7's original illustration got
 * this backwards and the spec corrects it), while an absent policy leaves the ratio
 * perfectly correct and removes only the floor it would be judged against.
 *
 * The push already emits `summary.reserve` for both causes; the floor's absence is
 * re-read here because it is what tells the two apart, and because a reader that
 * trusted the key list alone could not name the cause.
 */
function reserveSlot(
  summary: DashboardSummary,
  glance: GlanceBlock,
  suppressed: ReadonlySet<string>,
): ReserveSlot {
  const reserve: DashboardFocus | undefined = summary.reserve;
  if (reserve === undefined || suppressed.has(SUPPRESSION_KEYS.fundValue)) {
    return { rendered: false, suppressedBy: "unexpected-absence" };
  }
  if (glance.reserveTargetPct === undefined) {
    return { rendered: false, suppressedBy: "no-policy" };
  }
  // Defensive against STORED snapshots: today's push never emits `reserve` without
  // also emitting `fundValue`, but a reserve-only key list is constructible data the
  // reader may be handed, so this branch stays. Kept honest by `suppression-seam.test.ts`.
  if (suppressed.has(SUPPRESSION_KEYS.reserve)) {
    return { rendered: false, suppressedBy: "unexpected-absence" };
  }
  return {
    rendered: true,
    percentOfFund: reserve.percentOfFund,
    floorPct: glance.reserveTargetPct,
  };
}

/* ────────────────────────────────── the helpers ───────────────────────────────── */

/**
 * How many consecutive anchors, ending at `latest`, are below their OWN floor.
 *
 * Each anchor is judged against the floor stamped on it, never against today's:
 * `pickPolicyAsOf` time-travels, so a floor that changed mid-breach replays honestly.
 *
 * COUNTED IN ANCHORS, NOT CALENDAR DAYS, and the two are the same thing only while
 * launchd anchors daily. Across the log's sparse first fortnight this under-counts —
 * a breach spanning 06-26 → 06-30 reads as "2nd day". Naming the ANCHOR count is the
 * honest number available: the surface cannot claim a day it never observed.
 *
 * A SUPPRESSED RESERVE ENDS THE RUN, which is the second and sharper instance of that
 * same rule. The first is a day that produced no anchor at all; this is a day whose
 * anchor exists but whose Reserve number the surface refused to show. Suppression is a
 * KEY LIST, not a redaction — `toProjectionReport` copies `report.dashboard` wholesale,
 * so a suppressed anchor still carries a real `percentOfFund` on the wire — so a
 * counter that did not check would extend the breach through a number R8 forbids the
 * surface from asserting off.
 *
 * BOTH DIRECTIONS OF ERROR WERE WEIGHED. Counting the suppressed day overstates the
 * breach. Breaking risks the opposite: if that day's wire value happened to sit at or
 * above the floor, the run would have broken there anyway — but where it was genuinely
 * below, a real multi-day breach now reads as day one, the "a `no` that isn't" class R3
 * exists to prevent. Breaking is still the honest floor, because the understatement is
 * bounded and visible (the trigger still FIRES today, only the duration shrinks) while
 * the overstatement asserts a fact off a number nobody was shown. The count therefore
 * means consecutive OBSERVED breach days.
 */
function breachDurationDays(
  anchors: readonly SnapshotAnchor[],
  latest: SnapshotAnchor,
): number {
  const latestKey = asOfSortKey(latest.asOf);
  const history = anchors
    .filter((anchor) => asOfSortKey(anchor.asOf) <= latestKey)
    .sort((a, b) => asOfSortKey(b.asOf) - asOfSortKey(a.asOf));

  let days = 0;
  for (const anchor of history) {
    const floor = anchor.report.glance.reserveTargetPct;
    const pct = anchor.report.dashboard.summary.reserve?.percentOfFund;
    const withheld = anchor.report.glance.suppressed.includes(SUPPRESSION_KEYS.reserve);
    if (floor === undefined || pct === undefined || withheld || pct >= floor) break;
    days += 1;
  }
  return days;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * `2026-07-13` → `Mon 13 Jul`. Read in UTC, for the same reason the push side does:
 * a local-time read of a bare calendar date lands on the previous day west of
 * Greenwich, which would print the wrong weekday for the reference the number was
 * actually computed against.
 */
export function referenceLabel(asOf: string): string {
  const date = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`referenceLabel: ${JSON.stringify(asOf)} is not a calendar date`);
  }
  return `${WEEKDAYS[date.getUTCDay()]} ${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/** One decimal, trailing zeros trimmed: `8.20` → `8.2`, `10` → `10`. */
function formatPct(value: number): string {
  return String(Number(value.toFixed(1)));
}

/** `1` → `1st`, `2` → `2nd`, `11` → `11th`. */
function ordinal(value: number): string {
  const rem100 = value % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${value}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[value % 10] ?? "th";
  return `${value}${suffix}`;
}
