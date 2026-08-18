/**
 * THE OPERATOR NOTICE — the liveness banner's PUSH twin.
 *
 * Every derivation this composes is already correct and already shipped. What
 * failed on 2026-08-14/15 was not detection but ARRIVAL: the TUI named both lost
 * days correctly, live, the whole time, and nobody opened the TUI for three days
 * while sitting at the machine. Every surface in this repo is PULL-ONLY. This
 * module composes the DATA findings into a file the shell profile cats on every new
 * terminal, so the first moment the operator is back is unmissable. It adds no
 * derivation of any kind.
 *
 * ── WHY IT LIVES HERE AND NOT IN THE TUI ──────────────────────────────────────
 * It sits beside the primitives it composes — `loadGapReport` and `formatLostDays`
 * are both already exported from this package. The alternative, reaching into
 * `apps/tui`'s `loadLivenessLines`, is AN APP IMPORTING AN APP: `gap-lines.ts`
 * records that a prototype did exactly that through a computed specifier `tsc`
 * could not follow, and that both the bridge and its hand-written interface were
 * deleted for it.
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
 * ── THE ADMISSION RULE: A MOVE THE OPERATOR CAN MAKE TODAY ────────────────────
 * **A line earns this notice only if there is a move the operator can make today
 * that deletes it.** That is the rule the whole channel is judged against, and it
 * is the rule the ENUMERATE/COUNT split below was already reaching for without
 * saying: that split bounded the VOLUME of what gets printed and left the
 * ADMISSION open, which is how a line that no move can ever delete ended up
 * printing on every new terminal forever. "Something is wrong" is not the bar. A
 * notice that offers zero moves has spent the operator's attention and returned
 * nothing, and it does that on the mornings when nothing is wrong — which is most
 * of them.
 *
 * A VENUE-DARK DAY IS ADMITTED ONLY WHEN RECENT, and that is this rule applied
 * rather than an exception to it. A real outage's day IS actionable: once the
 * provider is back, `pnpm prices:fetch --as-of=<date>` lands the marks and the day
 * then LEAVES `venueDark` entirely — `computeGapReport` re-derives the finding from
 * the marks on every run — so the line self-extinguishes exactly like a lost day.
 * A US market holiday's never will; no command will ever clear one, because there
 * was nothing to fetch. The derivation cannot tell those two apart (`owesMarkOn`
 * is holiday-blind by #266 D7, deliberately), so RECENCY IS THE ONLY PROXY IT HAS
 * — and it is a proxy with the property that actually matters here: **the line
 * leaves on its own even when the operator can do nothing.** See
 * {@link MAX_NOTICE_VENUE_DARK_DAYS}.
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
 *     `formatGapSummary`'s voice, and the notice names the command that enumerates
 *     them on demand — and that line is BOUNDED BY RECENCY under the admission rule
 *     above ({@link MAX_NOTICE_VENUE_DARK_DAYS}), which is what stops the count
 *     itself from becoming the permanent line the enumeration was refused for.
 *
 * ── IT DOES NOT SPEAK FOR THE JOB, AND THAT IS THE ADMISSION RULE AGAIN ───────
 * This composer once opened with the heartbeat lines — the job's status first, the
 * data findings second, cause before effect, the ordering `liveness-lines.ts` still
 * keeps and still needs. That ordering is gone from here because ITS FIRST TERM IS
 * GONE. The heartbeat half was composed at step 5b of the wrapper, and 5b is the
 * one moment it is guaranteed to be misread.
 *
 * THE MECHANISM, STATED CORRECTLY, because the obvious statement of it is wrong and
 * every remedy that chases freshness buys the wrong thing. The EXIT trap is
 * EXIT-ONLY, so at 5b the breadcrumb still holds run N−1's bytes EXACTLY AS STEP 0
 * SAW THEM AT THE TOP OF THIS SAME RUN. The two read the same file. 5b is not
 * STALER — it is identically sourced and DIFFERENTLY SCOPED. Step 0 says "the
 * PREVIOUS daily price job run FAILED" and adds a scope line; `formatHeartbeatWarning`
 * says "the daily price job FAILED on <date>", present tense, about the job. On a
 * recovery run the file is right and the sentence is wrong.
 *
 * Said the way it is worth remembering: **5b's job half was written by a run that
 * knows its own status and reads someone else's.**
 *
 * PRICED AGAINST THE ADMISSION RULE, on the recovery run that motivated this — N−1
 * died at `prices-fetch` three days ago and run N is landing three days of marks
 * right now — the three heartbeat triggers come apart:
 *
 *   - `exitCode !== 0`: true of N−1 and NOT ACTIONABLE, because the run writing the
 *     line just fixed it. The bash already carries this, correctly scoped, and it
 *     reaches the two paths 5b never sees at all (an unresolvable `pnpm`/`node`, and
 *     a run that died partway). Since the wrapper's EXIT trap began calling
 *     `write_operator_failure_notice`, the PRIMARY carrier is the trap, and it speaks
 *     about THIS run at the moment it dies rather than about N−1 on the next fire —
 *     which is why the FAILED sentence stopped being anti-correlated with the truth
 *     of the run composing it. Step 0 is now the BACKSTOP for the same fact (see
 *     below).
 *   - STALENESS: true of N−1 and NOT ACTIONABLE — run N recorded the day minutes
 *     earlier. Not lost but UPGRADED: every case it fires on, the lost-day half
 *     names better, with the day's own dated `pnpm prices:fetch --as-of=` line —
 *     dated, actionable, self-extinguishing, which the staleness line is not. The
 *     one case it caught that the gap half does not is "marks landed from a manual
 *     fetch but the job never ran", and under the admission rule that is not
 *     actionable: the data is there.
 *   - FUTURE-DATED: the only real loss, and it is small. That breadcrumb is
 *     overwritten by every run's own EXIT trap, so the anomaly is ALREADY visible
 *     only between N−1's death and N's finish. It survives on the TUI, live.
 *
 * Two of the three are ANTI-CORRELATED with the truth of the run composing them.
 *
 * THE ALTERNATIVE IS REFUSED BY THE BASH, NOT BY TASTE. "Write an in-progress
 * heartbeat before 5b" would make the file describe THIS run — and `write_heartbeat`'s
 * first act after capturing `$?` is a SIGKILL of the watchdog plus a `pgrep -P` reap
 * of its `sleep`, so an early write would leave 5b AND `backfill`, the longest step,
 * running with no timeout. It buys back only the future-dated trigger.
 *
 * SO THE CHANNELS SPLIT BY LANGUAGE: this notice is purely the DATA channel, and the
 * job channel is purely bash. That bash is now TWO WRITERS OF ONE FILE, and which one
 * speaks is the difference between reporting a death and remembering one:
 *
 *   - THE WRAPPER'S `EXIT` TRAP is the PRIMARY writer. It fires inside the failing run
 *     on a non-zero exit, so it knows its own run's status and its own run's scope
 *     because it is inside it, and a run that dies at step 3 reports itself the moment
 *     it dies instead of waiting for the next fire.
 *   - THE WRAPPER'S STEP 0 is the BACKSTOP. It reads the previous run's breadcrumb at
 *     the top of the next run, so it is deliberately scoped to run N−1 — inside run N,
 *     speaking about N−1. On every ordinary failure it re-asserts what the trap already
 *     wrote, one run apart. The residue it covers ALONE is the death with no trap at
 *     all — SIGKILL to the shell, an OOM kill, a power loss — plus the run that dies
 *     before the trap is installed. On those nothing else in this repo ever speaks.
 *
 * `run-daily-fetch.sh`'s own step 0 and step 5b blocks say the same thing; the three
 * must be kept in agreement. `formatHeartbeatWarning`,
 * `loadHeartbeatLines` and `heartbeat.ts` are UNTOUCHED and the TUI banner keeps all
 * three triggers: it is a LIVE PULL surface reading the same primitive at the moment
 * the operator looks, which is the one context in which "the job failed" is a
 * currently-true sentence. If `loadHeartbeatLines` ends up with only the banner as a
 * consumer, THAT IS CORRECT AND NOT A CLEANUP OPPORTUNITY.
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
import { addDays } from "@numisma/engine";
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
 * production gets the COMPOSER's floor — `loadOperatorNoticeLines` fills in
 * `defaultGapReportSince(now)`, which is the era start today and a rolling 400-day
 * floor from 2027-08-08, so `computeGapReport`'s own `LAUNCHD_ERA_START` default is
 * never reached from this path. Measured against that floor: smoke-run against a
 * store with no log at all, this composer wrote NINETY LINES on first contact. A notice that long
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
 * HOW RECENT A VENUE-DARK DAY MUST BE to earn a place on this channel at all.
 *
 * This is the ADMISSION RULE in the header made numeric, and it is the constant
 * that makes "empty means healthy" REACHABLE ON THE REAL STORE. Without it the
 * notice can never be empty again: the store's one venue-dark day is 2026-07-03,
 * observed US Independence Day, and `owesMarkOn` is holiday-blind by #266 D7, so
 * that day is a standing finding no command will ever clear. A channel that always
 * says something is a channel that is never read.
 *
 * WHY SEVEN, against the failure shape and not an aesthetic. The holiday case is
 * not one line — it is ONE EPISODE PER HOLIDAY, N DAYS LONG, about ten times a
 * year, forever. N therefore sets what fraction of the year this channel is
 * non-empty ON A PERFECTLY HEALTHY STORE: 30 days spends ~300 of them and leaves
 * the notice quiet ~18% of the year; 14 spends ~140; SEVEN spends ~70 and keeps
 * the channel EMPTY FOUR DAYS IN FIVE. Anything in the 14–30 range converts a
 * permanent line into a line present most of the year, which trains the identical
 * skim — it does not restore the contract, it slows its collapse.
 *
 * Seven is also the SHORTEST window that survives the absence pattern this
 * codebase already plans around: {@link MAX_NOTICE_LOST_DAYS}' own comment names
 * "Fri 2026-08-21 through Sun 08-23 are away days". Below seven, a Friday outage
 * over a long weekend depends on the operator opening a shell on exactly the right
 * Monday; above seven the episodes start merging around Thanksgiving and
 * Christmas. RECORDED FLIP TRIGGER: if ~70 noisy days a year still proves too
 * many, THREE is defensible — a real outage still reaches the TUI banner and
 * `pnpm gap-report` intact. 14 and 30 are not.
 *
 * THE BOUND IS PRESENTATION-ONLY AND APPLIED AT THE LEAF, exactly like
 * {@link MAX_NOTICE_LOST_DAYS}: `computeGapReport` still walks the whole window and
 * still knows every venue-dark day. NARROWING THE DERIVATION WINDOW TO ACHIEVE
 * THIS IS FORBIDDEN — it would narrow the `lost` half too, and lost days are
 * PERMANENT, so 2026-08-14/15 would age out of the notice: the one outcome this
 * channel exists to prevent.
 *
 * THE TUI BANNER DOES NOT TAKE THIS BOUND, and that is not an oversight. The
 * banner is a PULL surface, deliberately scanned when opened, and it already has
 * the ceiling its own docstring asked for (`MAX_GAP_LINES` / `RESERVED_LOST_LINES`).
 * The twin property this notice shares with it binds the WINDOW, not the RENDERING
 * — `operator-notice-cli.ts` says so — and a recency bound is a rendering decision,
 * the same kind of decision as the banner enumerating what this notice counts.
 *
 * Exported because the test must DRIVE the bound rather than restate it — the same
 * reason {@link MAX_NOTICE_LOST_DAYS} and the TUI's `MAX_GAP_LINES` are exported.
 */
export const MAX_NOTICE_VENUE_DARK_DAYS = 7;

/**
 * The data findings for one instant. EMPTY when there is nothing to say.
 *
 * ONE ARGUMENT, AND THE MISSING ONE IS THE POINT. This took `heartbeatLines` first
 * until #376; the header records why the job half came off this channel and why
 * re-adding it is not a small convenience. The findings arrive already derived
 * rather than being computed here, for the reason this half exists at all: it owns
 * COMPOSITION and nothing else, so every rendering decision — including the broken
 * one — is exercised by a synchronous test with no disk.
 */
export function formatOperatorNotice(findings: NoticeGapFindings): string[] {
  if (findings.kind === "failed") {
    return [formatNoticeCheckFailure(findings.error)];
  }
  return [
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
 *
 * THE BARE COMMAND REALLY DOES ENUMERATE THESE, and that is a property of the floor
 * this notice takes rather than of this sentence: `loadOperatorNoticeLines` defaults
 * to `defaultGapReportSince`, so the window these days were withheld from and the
 * window `pnpm gap-report` opens are the same one. See `formatVenueDarkCount` below
 * for why naming a `--since` here instead would produce an instruction that command
 * REFUSES, and why this pointer was promising an enumeration it could not deliver
 * until the two floors were bound together.
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
 * finding. Omitted entirely at zero — a channel that prints "0 venue-day(s) dark" on
 * a clean day has broken the empty-means-healthy contract — and ZERO AFTER FILTERING
 * IS THE SAME ZERO, which is precisely what makes that contract reachable on the real
 * store rather than only in a fixture.
 *
 * ── IT CARRIES THE HOLIDAY CLAUSE, BECAUSE #266 D7 REQUIRES IT ────────────────
 * `packages/engine/src/price-feed/venue-calendar.ts` accepts that a US market holiday
 * reads as venue-dark ON THE CONDITION that *"every surface that renders this
 * expectation is required to say so in its own message, so a holiday reads as a
 * holiday."* `formatVenueDarkDays` honours it; this line did not, and the store's one
 * venue-dark day is 2026-07-03, observed Independence Day — the known false positive,
 * pinned into a push channel with the sentence that would explain it stripped out.
 * That was a defect independent of any window and the clause is not optional here.
 *
 * ── AND IT NAMES ITS OWN WINDOW ───────────────────────────────────────────────
 * The count is over {@link MAX_NOTICE_VENUE_DARK_DAYS} days, not over the report, so
 * the line SAYS SO: a count whose scope is invisible is a count the reader assumes is
 * total. The number in the text is derived from the constant rather than restated, so
 * retuning the bound moves the sentence with it. `pnpm gap-report` is the record; the
 * notice is not.
 *
 * ── THE `pnpm gap-report` POINTER IS SAFE TO KEEP ─────────────────────────────
 * It points at the BARE command, with no `--since`, and that only works because
 * `loadOperatorNoticeLines` now defaults its floor to `defaultGapReportSince` — the
 * same floor that command uses. Before that, the notice floored at
 * `LAUNCHD_ERA_START` while the command floored 400 days back, so from 2027-08-08 the
 * two describe different windows; and the obvious repair — printing
 * `pnpm gap-report --since=${report.since}` — produces an instruction the command
 * REFUSES, because era-floor → yesterday crosses `MAX_WINDOW_DAYS` on exactly that
 * date. Not "the default won't show it" but "no invocation can". Same for
 * `formatWithheldLostDays`' pointer above; both are correct by construction now, and
 * both stop being correct the moment either surface picks its own floor again.
 *
 * ── THE WINDOW IS ANCHORED AT `report.until`, NOT AT `now` ────────────────────
 * This half is PURE and reads no clock; `report.until` is already clamped to
 * yesterday by the derivation, which is the same instant a clock read here would
 * resolve to and is reproducible in a test besides. A report narrower than the bound
 * simply filters nothing — no clamp is needed, because the floor only ever moves
 * earlier than the report's own.
 *
 * THE ARITHMETIC, CHECKED AND RECORDED SO IT IS NOT RE-DERIVED: `floor = until − 6`
 * with `date >= floor` is `[until − 6, until]`, exactly seven calendar days inclusive,
 * pinned from both sides off the constant by `operator-notice.test.ts`'
 * `OLDEST_ADMITTED` / `NEWEST_REFUSED` pair. Two residual wrinkles, both
 * PRESENTATION-ONLY and both accepted:
 *
 *   - "in the last 7 days" is measured from `until`, which is YESTERDAY, so the window
 *     the operator reads as "the last 7 days" is `[today − 7, today − 1]`: a day dark
 *     exactly seven days before the morning they read it is still counted, and today
 *     never is (it cannot be — it is not due yet). Fixing the wording would cost either
 *     a clock read in this pure half or the clumsier "in the 7 days ending <until>".
 *   - A caller handing in a report NARROWER than the bound still gets "in the last 7
 *     days", naming a window the report did not open. Unreachable from the zero-argument
 *     CLI; the test pins the filter-nothing behaviour deliberately.
 */
function formatVenueDarkCount(report: GapReport): string[] {
  const floor = addDays(report.until, -(MAX_NOTICE_VENUE_DARK_DAYS - 1));
  const recent = report.venueDark.filter(({ date }) => date >= floor);
  if (recent.length === 0) {
    return [];
  }
  return [
    `Numisma: ${recent.length} venue-day(s) dark in the last ` +
      `${MAX_NOTICE_VENUE_DARK_DAYS} days — not lost days: the feed ran and the days ` +
      `are anchored, and the venue was silent or the market was closed for a holiday. ` +
      `Enumerate them with pnpm gap-report.`,
  ];
}
