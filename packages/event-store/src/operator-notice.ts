/**
 * THE OPERATOR NOTICE — the liveness banner's PUSH twin.
 *
 * Every derivation this composes is already correct and already shipped. What
 * failed on 2026-08-14/15 was not detection but ARRIVAL: the TUI named both lost
 * days correctly, live, the whole time, and nobody opened the TUI for three days
 * while sitting at the machine. Every surface in this repo is PULL-ONLY. This
 * module composes the same two signals into a file the shell profile cats on every
 * new terminal, so the first moment the operator is back is unmissable. It adds no
 * derivation of any kind.
 *
 * ── WHY IT LIVES HERE AND NOT IN THE TUI ──────────────────────────────────────
 * It sits beside the primitives it composes — `loadHeartbeatLines`,
 * `loadGapReport`, `formatLostDays` are all already exported from this package.
 * The alternative, reaching into `apps/tui`'s `loadLivenessLines`, is AN APP
 * IMPORTING AN APP: `gap-lines.ts` records that a prototype did exactly that
 * through a computed specifier `tsc` could not follow, and that both the bridge and
 * its hand-written interface were deleted for it.
 *
 * ── IT IS NOT THE BANNER, AND MUST NOT BE UNIFIED WITH IT ─────────────────────
 * The notice and the TUI banner do NOT share a rendering, deliberately. The banner
 * ENUMERATES venue-dark days under `MAX_GAP_LINES`/`RESERVED_LOST_LINES`; the notice
 * COUNTS them (see below). Folding one into the other would change TUI behaviour to
 * serve a different channel's noise budget. What the two share is the PRIMITIVES,
 * which already live in this package — so the composer moved next to the vocabulary
 * rather than the vocabulary moving next to a renderer.
 *
 * DO NOT READ THAT AS "BOUNDING IS THE BANNER'S PROBLEM." Both channels need a
 * ceiling; they just spend it on opposite sides. The banner bounds the venue-dark
 * ENUMERATION it chose to print; this notice counts those instead, and spends its
 * ceiling on the LOST side via {@link MAX_NOTICE_LOST_DAYS}. The earlier absence of
 * that constant was not a decision — it is where the bound went missing, and the
 * constant's own comment records how.
 *
 * ── ENUMERATE `lost`, COUNT `venueDark` ───────────────────────────────────────
 * The split is the decision this channel lives or dies on, and the data already
 * carries it (`venueDark` is its own key, never folded into `lost`):
 *
 *   - A LOST DAY IS REMEDIABLE AND SELF-EXTINGUISHING. Name the date, name the
 *     command, the operator runs it and the row is GONE. That standing debt on
 *     every new shell is precisely the pressure that would have stopped 08-15 being
 *     lost the night after 08-14 was already understood.
 *   - A VENUE-DARK DAY IS PERMANENT AND ACCUMULATES. About ten a year are US market
 *     holidays and no command will ever clear one. Enumerated on a channel that
 *     prints on every new terminal, that is cry-wolf channel death arriving on a
 *     schedule, inside the fix. So it gets ONE LINE CARRYING A NUMBER, in
 *     `formatGapSummary`'s existing wording, and the notice names the command that
 *     enumerates them on demand.
 *
 * ── ORDER IS THE CAUSE, THEN THE EFFECT ───────────────────────────────────────
 * Heartbeat lines (the job) first, data findings second — the same order, and for
 * the same reason, as `liveness-lines.ts`: a failed run is WHY the days went
 * missing, and reading the consequence before the reason is the wrong way round on
 * a channel scanned in two seconds.
 *
 * ── EMPTY MEANS HEALTHY ───────────────────────────────────────────────────────
 * A clean window returns NO LINES, and the shell writes an EMPTY FILE — not an "all
 * good" line. The notice therefore self-clears with NO DISMISSAL STATE, which means
 * there is no dismissal state to get wrong.
 *
 * ── IT NEVER THROWS, AND IT IS NEVER SILENT ABOUT BEING BROKEN ────────────────
 * A notice writer that bricks the wrapper's step 5 is worse than no notice at all,
 * so the derivation's failure arrives here as {@link NoticeGapFindings}' `failed`
 * arm. But it is NOT swallowed: a detector that says nothing when it is broken is
 * indistinguishable from one saying "all clear", which is the exact failure this
 * whole increment exists to remove. `gap-lines.ts`'s reasoning, verbatim.
 */
import {
  formatLostDays,
  type GapReport,
} from "./gap-report.js";

/**
 * The gap side of the notice: the report, or the reason there isn't one.
 *
 * A DISCRIMINATED UNION RATHER THAN A THROW is what keeps this half PURE and keeps
 * the never-throws contract testable with no disk: the IO shell does the one `try`
 * and hands the outcome in, and every rendering decision — including the broken
 * one — is exercised by a synchronous test.
 */
export type NoticeGapFindings =
  | { readonly kind: "report"; readonly report: GapReport }
  | { readonly kind: "failed"; readonly error: unknown };

/**
 * The one wording for "the check itself did not run."
 *
 * DELIBERATELY THE SAME TEXT as `apps/tui/src/gap-lines.ts`'s `formatGapCheckFailure`
 * and deliberately NOT shared with it: this package must not import that app, and
 * re-homing the TUI's copy would edit a surface this increment is out of scope for.
 * The duplication is one string, recorded here so the next person to touch either
 * knows the other exists.
 */
export function formatNoticeCheckFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `Numisma: lost days were NOT checked (${detail}).`;
}

/**
 * THE MOST LOST DAYS THIS CHANNEL WILL ENUMERATE before it withholds the rest.
 *
 * Everything above enumerates correctly and unusably. The CLI passes no window, so
 * production gets the derivation's default (~90 days): smoke-run against a store with
 * no log at all, this composer wrote NINETY LINES on first contact. A notice that long
 * on a channel that prints on every new terminal trains its reader to skip it on day
 * one — which reproduces #357 INSIDE the fix for #357. The bound is the one property
 * that did not survive rerouting off the TUI's `loadLivenessLines` (D3 chose it partly
 * because it "already bounds its own line count"; the later correction forbade a
 * package importing an app). Restoring it FINISHES that design rather than amending it.
 *
 * WHY TEN, against the real outage shape and not an aesthetic one:
 *   - The realistic near-term is about FIVE lost days, and they are days the operator
 *     is actively working through: 2026-08-14 and 2026-08-15 are unrecovered now, and
 *     Fri 2026-08-21 through Sun 08-23 are away days (dark by expectation, not by
 *     failure). A cap that withheld those would hide exactly the debt this notice
 *     exists to surface. Ten covers that with 2x headroom.
 *   - Past roughly ten, the enumerate-and-remediate idiom stops paying: pasting ten
 *     separate commands is not the workflow any more, a loop is. The cap lands where
 *     the idiom it serves runs out.
 *   - The common case is far below it — the real store measures FIVE lines total (two
 *     lost days plus one venue-dark count). The cap costs nothing when things are
 *     normal and engages only where the channel would otherwise destroy itself.
 *
 * THE ACCEPTED TRADE, RECORDED RATHER THAN SILENT: a withheld day is no longer
 * individually named with its own recovery command, so D5's self-extinguishing
 * property — name the date, run the command, the row disappears — APPLIES ONLY TO WHAT
 * IS SHOWN. The withheld tail is what keeps the rest visible, and it points at
 * `pnpm gap-report`, which enumerates all of them on demand.
 *
 * DELIBERATELY THIS CHANNEL'S OWN NUMBER. `apps/tui`'s `MAX_GAP_LINES` /
 * `RESERVED_LOST_LINES` are tuned to a startup banner's screen real estate, and this
 * package must not import that app in any case. Exported because the test must DRIVE
 * the bound rather than restate it — the same reason those two are exported there.
 */
export const MAX_NOTICE_LOST_DAYS = 10;

/**
 * The heartbeat lines, then the data findings, for one instant. EMPTY when there is
 * nothing to say.
 *
 * `heartbeatLines` arrives already rendered (`loadHeartbeatLines`) rather than being
 * derived here, for the same reason the report does: this half owns COMPOSITION and
 * nothing else.
 */
export function formatOperatorNotice(
  heartbeatLines: readonly string[],
  findings: NoticeGapFindings,
): string[] {
  if (findings.kind === "failed") {
    return [...heartbeatLines, formatNoticeCheckFailure(findings.error)];
  }
  return [
    ...heartbeatLines,
    ...formatLostDayFindings(findings.report),
    ...formatVenueDarkCount(findings.report),
  ];
}

/**
 * Each lost day's existing line, each followed by ITS OWN recovery command.
 *
 * The finding line is `formatLostDays`' output UNTOUCHED — three surfaces render
 * that wording and this must not become a fourth variant of it. What the notice adds
 * is the second line, and the reason is D5's whole argument: this is the one channel
 * that arrives without being asked, so it must carry the move that makes the row
 * disappear. The date is repeated INSIDE the command line rather than left implicit
 * in the pairing, so a line that reaches the operator alone — grepped, quoted into a
 * standup, wrapped by a narrow terminal — still says which day it recovers.
 *
 * The zip is index-aligned because `formatLostDays` maps `report.lost` one-to-one in
 * order; a test drives that pairing over three dates rather than restating it.
 *
 * Bounded to {@link MAX_NOTICE_LOST_DAYS} — see that constant for the number and the
 * trade. The bound is PRESENTATION-ONLY and applied here at the leaf: `computeGapReport`
 * still walks the whole window and still knows every lost day. It only ever REMOVES
 * pairs, never adds a line, so the empty-means-healthy contract above is untouched.
 *
 * THE MOST RECENT days are the ones kept and the EARLIER ones are withheld: a lost day
 * is permanent, so the window's tail is where the still-actionable damage is. Same
 * slice direction, and the same reason, as the TUI's `gap-lines.ts`.
 */
function formatLostDayFindings(report: GapReport): string[] {
  const lines = formatLostDays(report);
  const withheld = Math.max(0, report.lost.length - MAX_NOTICE_LOST_DAYS);
  const shown = report.lost.flatMap(({ date }, index) =>
    index < withheld
      ? []
      : [lines[index] as string, `Numisma: ${date} — recover with: pnpm prices:fetch --as-of=${date}`],
  );
  return withheld === 0 ? shown : [...shown, formatWithheldLostDays(withheld)];
}

/**
 * The tail line: how many earlier lost days the cap kept back, and where to see them.
 *
 * Emitted ONLY when days were actually withheld — a "0 earlier lost day(s)" line on a
 * short outage would be the same cry-wolf noise the venue-dark split exists to refuse.
 * It is written in `formatVenueDarkCount`'s voice, with its `(s)` house form and its
 * `pnpm gap-report` pointer, for the same reason: one finding, one vocabulary. A count
 * the operator cannot expand is a dead end, and that command already expands it.
 */
function formatWithheldLostDays(withheld: number): string {
  return `Numisma: ${withheld} earlier lost day(s) withheld — enumerate them with pnpm gap-report.`;
}

/**
 * ONE LINE CARRYING A NUMBER — never `formatVenueDarkDays`, which is the enumeration
 * this channel exists to refuse.
 *
 * The sentence is `formatGapSummary`'s venue-dark clause, in its voice and with its
 * `(s)` house form, so the two surfaces do not develop two vocabularies for one
 * finding. It names `pnpm gap-report` because a count the operator cannot expand is
 * a dead end, and expanding it on demand is exactly what that command already does.
 * Omitted entirely at zero: a channel that prints "0 venue-day(s) dark" on a clean
 * day has broken the empty-means-healthy contract.
 */
function formatVenueDarkCount(report: GapReport): string[] {
  if (report.venueDark.length === 0) {
    return [];
  }
  return [
    `Numisma: ${report.venueDark.length} venue-day(s) dark — not lost days: the feed ` +
      `ran and the days are anchored. Enumerate them with pnpm gap-report.`,
  ];
}
