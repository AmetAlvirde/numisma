/**
 * The operator notice's pure half — the composition, with no disk anywhere.
 *
 * Every report here is HAND-BUILT from the `GapReport` type rather than derived
 * from a log: the derivation has its own tests, and a composer test that ran the
 * derivation would share an implementation with the thing it is guarding. Dates,
 * counts and registry venue names only — no price, no position, no balance.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_NOTICE_LOST_DAYS,
  MAX_NOTICE_VENUE_DARK_DAYS,
  formatNoticeCheckFailure,
  formatOperatorNotice,
  type NoticeGapFindings,
} from "./operator-notice.js";
import type { GapReport, LostDay, VenueDarkDay } from "./gap-report.js";

/** The report ceiling every fixture here shares — the instant the recency bound anchors at. */
const UNTIL = "2026-08-16";

function report(lost: readonly LostDay[], venueDark: readonly VenueDarkDay[]): GapReport {
  return {
    since: "2026-08-01",
    until: UNTIL,
    calendarDays: 16,
    anchorsChecked: 14,
    lost: [...lost],
    venueDark: [...venueDark],
    unattributedMarks: 0,
  };
}

function findings(lost: readonly LostDay[], venueDark: readonly VenueDarkDay[]): NoticeGapFindings {
  return { kind: "report", report: report(lost, venueDark) };
}

const CLEAN = findings([], []);

/**
 * `count` consecutive authored lost dates, OLDEST FIRST — the order `computeGapReport`
 * emits, which is the order the cap slices against.
 *
 * Authored from a fixed base rather than from today, so the fixtures do not drift; the
 * dates are the whole payload (no price, no position, no balance).
 */
function lostRun(count: number): LostDay[] {
  const base = Date.UTC(2026, 5, 1); // 2026-06-01
  return Array.from({ length: count }, (_unused, index) => ({
    date: new Date(base + index * 86_400_000).toISOString().slice(0, 10) as string,
    reason: "no-anchor" as const,
  }));
}

const RECOVERY = (date: string) =>
  `Numisma: ${date} — recover with: pnpm prices:fetch --as-of=${date}`;

/**
 * The venue-dark line, with BOTH numbers driven off the bound: the count the line
 * reports and the window it names. Restating "7" here would let the sentence and the
 * constant drift apart, which is the whole reason the constant is exported.
 */
const VENUE_DARK = (count: number) =>
  `Numisma: ${count} venue-day(s) dark in the last ${MAX_NOTICE_VENUE_DARK_DAYS} days — ` +
  `not lost days: the feed ran and the days are anchored, and the venue was silent or ` +
  `the market was closed for a holiday. Enumerate them with pnpm gap-report.`;

/**
 * `offset` days before the report's ceiling — 0 is `until` itself. Driven off the
 * ceiling rather than authored, so a case can say "the oldest day the bound admits"
 * instead of a literal a reader has to do arithmetic on.
 */
function daysBeforeUntil(offset: number): string {
  return new Date(Date.parse(`${UNTIL}T00:00:00Z`) - offset * 86_400_000)
    .toISOString()
    .slice(0, 10) as string;
}

/** The oldest venue-dark day the bound still admits, and the newest it does not. */
const OLDEST_ADMITTED = daysBeforeUntil(MAX_NOTICE_VENUE_DARK_DAYS - 1);
const NEWEST_REFUSED = daysBeforeUntil(MAX_NOTICE_VENUE_DARK_DAYS);

const dark = (date: string): VenueDarkDay => ({ date, source: "twelvedata", expected: 6 });

/**
 * The realistic near-term outage this cap was sized against: 08-14/08-15 unrecovered
 * plus a three-day away weekend. Driven off the cap so the relationship — NOT the
 * literal 5 — is what the suite asserts.
 */
const REALISTIC_LOST_DAYS = 5;

describe("the notice's lost-day cap", () => {
  it("sits comfortably above the realistic outage shape", () => {
    expect(REALISTIC_LOST_DAYS).toBeLessThan(MAX_NOTICE_LOST_DAYS);
  });

  it("names EVERY lost day at the realistic outage shape, each with its own command", () => {
    const lost = lostRun(REALISTIC_LOST_DAYS);
    const lines = formatOperatorNotice(findings(lost, []));

    // The cap must never hide the debt it exists to surface: nothing withheld, and
    // every single day still individually remediable from the notice alone.
    expect(lines).toHaveLength(REALISTIC_LOST_DAYS * 2);
    expect(lines.join("\n")).not.toContain("withheld");
    for (const [index, { date }] of lost.entries()) {
      expect(lines[index * 2]).toContain(date);
      expect(lines[index * 2 + 1]).toBe(RECOVERY(date));
    }
  });

  it("enumerates EXACTLY the cap with no tail line", () => {
    const lost = lostRun(MAX_NOTICE_LOST_DAYS);
    const lines = formatOperatorNotice(findings(lost, []));

    expect(lines).toHaveLength(MAX_NOTICE_LOST_DAYS * 2);
    expect(lines.join("\n")).not.toContain("withheld");
    for (const { date } of lost) {
      expect(lines).toContain(RECOVERY(date));
    }
  });

  it("withholds and COUNTS the moment one day more than the cap arrives", () => {
    const lost = lostRun(MAX_NOTICE_LOST_DAYS + 1);
    const lines = formatOperatorNotice(findings(lost, []));

    expect(lines).toHaveLength(MAX_NOTICE_LOST_DAYS * 2 + 1);
    expect(lines.at(-1)).toBe(
      "Numisma: 1 earlier lost day(s) withheld — enumerate them with pnpm gap-report.",
    );
  });

  it("keeps the MOST RECENT lost days and withholds the earlier ones", () => {
    const withheld = 4;
    const lost = lostRun(MAX_NOTICE_LOST_DAYS + withheld);
    const shown = lost.slice(withheld);
    const hidden = lost.slice(0, withheld);
    const joined = formatOperatorNotice(findings(lost, [])).join("\n");

    for (const { date } of shown) {
      expect(joined).toContain(RECOVERY(date));
    }
    // The withheld head must not leak: not as a finding, not as a command, not at all.
    for (const { date } of hidden) {
      expect(joined).not.toContain(date);
    }
    expect(joined).toContain(
      `Numisma: ${withheld} earlier lost day(s) withheld — enumerate them with pnpm gap-report.`,
    );
  });

  it("puts the withheld tail after the shown days and before the venue-dark count", () => {
    const lines = formatOperatorNotice(
      findings(lostRun(MAX_NOTICE_LOST_DAYS + 2), [
        { date: "2026-08-11", source: "binance", expected: 4 },
      ]),
    );
    expect(lines).toHaveLength(MAX_NOTICE_LOST_DAYS * 2 + 2);
    expect(lines.at(-2)).toBe(
      "Numisma: 2 earlier lost day(s) withheld — enumerate them with pnpm gap-report.",
    );
    expect(lines.at(-1)).toBe(VENUE_DARK(1));
  });
});

/**
 * THE CASE #381 NAMES — the one that would have caught this shape at authoring time.
 *
 * The notice must be able to reach EMPTY on the real store, and before the bound it
 * could not: 2026-07-03 is observed US Independence Day, `owesMarkOn` is holiday-blind
 * by #266 D7, so that day is a permanent venue-dark finding no command will ever
 * clear. Every number here is driven off {@link MAX_NOTICE_VENUE_DARK_DAYS} — the
 * boundary is pinned from BOTH sides, so neither widening nor narrowing the bound can
 * pass silently, and only removing it turns these red.
 */
describe("the notice's venue-dark recency bound", () => {
  it("says NOTHING AT ALL about a venue-dark day older than the window", () => {
    expect(formatOperatorNotice(findings([], [dark(NEWEST_REFUSED)]))).toEqual([]);
  });

  it("still counts the OLDEST day the window admits", () => {
    expect(formatOperatorNotice(findings([], [dark(OLDEST_ADMITTED)]))).toEqual([
      VENUE_DARK(1),
    ]);
  });

  it("counts only the days inside the window when both sides are present", () => {
    const inside = Array.from({ length: MAX_NOTICE_VENUE_DARK_DAYS }, (_unused, offset) =>
      dark(daysBeforeUntil(offset)),
    );
    const outside = [dark(NEWEST_REFUSED), dark(daysBeforeUntil(MAX_NOTICE_VENUE_DARK_DAYS + 30))];
    expect(formatOperatorNotice(findings([], [...outside, ...inside]))).toEqual([
      VENUE_DARK(MAX_NOTICE_VENUE_DARK_DAYS),
    ]);
  });

  it("leaves the LOST half untouched — a lost day is permanent and never ages out", () => {
    // The bound is presentation-only AND venue-dark-only. Narrowing the derivation
    // window to achieve it would age 2026-08-14/15 out of the notice, which is the one
    // outcome this channel exists to prevent.
    const stale = { date: NEWEST_REFUSED, reason: "no-anchor" as const };
    expect(formatOperatorNotice(findings([stale], [dark(NEWEST_REFUSED)]))).toEqual([
      `Numisma: ${NEWEST_REFUSED} — NO DATA. No event of any kind carries this date; the day is lost.`,
      RECOVERY(NEWEST_REFUSED),
    ]);
  });

  it("filters nothing when the report itself is narrower than the bound", () => {
    const narrow: NoticeGapFindings = {
      kind: "report",
      report: { ...report([], [dark(UNTIL)]), since: UNTIL, calendarDays: 1 },
    };
    expect(formatOperatorNotice(narrow)).toEqual([VENUE_DARK(1)]);
  });
});

describe("formatOperatorNotice", () => {
  it("says nothing at all when the job is healthy and the window is clean", () => {
    expect(formatOperatorNotice(CLEAN)).toEqual([]);
  });

  /**
   * #376's ruling, pinned at the SIGNATURE.
   *
   * This composer took `heartbeatLines` first, and at the wrapper's step 5b that half
   * was written by a run that knows its own status and reads someone else's. The
   * arity is the ruling made mechanical: a job half cannot come back without editing
   * this line, and `operator-notice-io.test.ts` pins the same absence against a real
   * FAILED breadcrumb on disk. The TUI banner keeps all three triggers — it reads the
   * same primitive live, which is the one context where "the job failed" is a
   * currently-true sentence.
   */
  it("TAKES THE FINDINGS AND NOTHING ELSE — the job is not this channel's to report", () => {
    expect(formatOperatorNotice).toHaveLength(1);
    expect(formatOperatorNotice(CLEAN)).toEqual([]);
  });

  it("ENUMERATES each lost day and names its own recovery command", () => {
    const lines = formatOperatorNotice(
      findings(
        [
          { date: "2026-08-14", reason: "no-anchor" },
          { date: "2026-08-15", reason: "no-marks" },
        ],
        [],
      ),
    );
    expect(lines).toEqual([
      "Numisma: 2026-08-14 — NO DATA. No event of any kind carries this date; the day is lost.",
      "Numisma: 2026-08-14 — recover with: pnpm prices:fetch --as-of=2026-08-14",
      "Numisma: 2026-08-15 — NO MARKS. The day is anchored but no price mark landed on it; the day is lost.",
      "Numisma: 2026-08-15 — recover with: pnpm prices:fetch --as-of=2026-08-15",
    ]);
  });

  it("COUNTS venue-dark days on one line and never enumerates them", () => {
    // All three inside the recency window, so this case is about the RENDERING and
    // nothing else — the bound has its own describe block above.
    const entries: VenueDarkDay[] = [
      { date: "2026-08-12", source: "twelvedata", expected: 6 },
      { date: "2026-08-11", source: "twelvedata", expected: 6 },
      { date: "2026-08-11", source: "binance", expected: 4 },
    ];
    const lines = formatOperatorNotice(findings([], entries));
    expect(lines).toEqual([VENUE_DARK(3)]);
    // The accumulating rows must not reach the notice at all: no date and no venue
    // name from the venue-dark side may appear anywhere in it.
    const joined = lines.join("\n");
    for (const entry of entries) {
      expect(joined).not.toContain(entry.date);
      expect(joined).not.toContain(entry.source);
    }
  });

  it("names the holiday the derivation cannot rule out, as #266 D7 requires", () => {
    // `venue-calendar.ts` accepts the holiday false positive ONLY on the condition
    // that every surface rendering this expectation says so in its own message. The
    // line must carry the clause, not merely the count.
    const [line] = formatOperatorNotice(findings([], [dark("2026-08-12")]));
    expect(line).toContain("the market was closed for a holiday");
    // And it must name its own scope: a count whose window is invisible reads as total.
    expect(line).toContain(`in the last ${MAX_NOTICE_VENUE_DARK_DAYS} days`);
    expect(line).toContain("pnpm gap-report");
  });

  it("carries both kinds, lost first, when the window has both", () => {
    expect(
      formatOperatorNotice(
        findings(
          [{ date: "2026-08-15", reason: "no-marks" }],
          [{ date: "2026-08-11", source: "binance", expected: 4 }],
        ),
      ),
    ).toEqual([
      "Numisma: 2026-08-15 — NO MARKS. The day is anchored but no price mark landed on it; the day is lost.",
      "Numisma: 2026-08-15 — recover with: pnpm prices:fetch --as-of=2026-08-15",
      VENUE_DARK(1),
    ]);
  });

  it("pairs each recovery command with ITS OWN lost date, not the first one", () => {
    const dates = ["2026-08-02", "2026-08-14", "2026-08-15"];
    const lines = formatOperatorNotice(
      findings(
        dates.map((date) => ({ date, reason: "no-anchor" }) as LostDay),
        [],
      ),
    );
    for (const [index, date] of dates.entries()) {
      expect(lines[index * 2]).toContain(date);
      expect(lines[index * 2 + 1]).toBe(
        `Numisma: ${date} — recover with: pnpm prices:fetch --as-of=${date}`,
      );
    }
  });

  it("reports a BROKEN check as a line rather than swallowing it", () => {
    const lines = formatOperatorNotice({
      kind: "failed",
      error: new Error("log line 12 quarantined"),
    });
    expect(lines).toEqual(["Numisma: lost days were NOT checked (log line 12 quarantined)."]);
  });

  it("says the check broke and NOTHING BESIDE IT on a non-Error throw", () => {
    expect(
      formatOperatorNotice({ kind: "failed", error: "no such file" }),
    ).toEqual(["Numisma: lost days were NOT checked (no such file)."]);
  });
});

describe("formatNoticeCheckFailure", () => {
  it("renders a non-Error throw without losing it", () => {
    expect(formatNoticeCheckFailure("disk gone")).toBe(
      "Numisma: lost days were NOT checked (disk gone).",
    );
  });
});
