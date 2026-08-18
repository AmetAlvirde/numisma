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
  formatNoticeCheckFailure,
  formatOperatorNotice,
  type NoticeGapFindings,
} from "./operator-notice.js";
import type { GapReport, LostDay, VenueDarkDay } from "./gap-report.js";

function report(lost: readonly LostDay[], venueDark: readonly VenueDarkDay[]): GapReport {
  return {
    since: "2026-08-01",
    until: "2026-08-16",
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
    const lines = formatOperatorNotice([], findings(lost, []));

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
    const lines = formatOperatorNotice([], findings(lost, []));

    expect(lines).toHaveLength(MAX_NOTICE_LOST_DAYS * 2);
    expect(lines.join("\n")).not.toContain("withheld");
    for (const { date } of lost) {
      expect(lines).toContain(RECOVERY(date));
    }
  });

  it("withholds and COUNTS the moment one day more than the cap arrives", () => {
    const lost = lostRun(MAX_NOTICE_LOST_DAYS + 1);
    const lines = formatOperatorNotice([], findings(lost, []));

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
    const joined = formatOperatorNotice([], findings(lost, [])).join("\n");

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
      [],
      findings(lostRun(MAX_NOTICE_LOST_DAYS + 2), [
        { date: "2026-08-11", source: "binance", expected: 4 },
      ]),
    );
    expect(lines).toHaveLength(MAX_NOTICE_LOST_DAYS * 2 + 2);
    expect(lines.at(-2)).toBe(
      "Numisma: 2 earlier lost day(s) withheld — enumerate them with pnpm gap-report.",
    );
    expect(lines.at(-1)).toBe(
      "Numisma: 1 venue-day(s) dark — not lost days: the feed ran and the days are " +
        "anchored. Enumerate them with pnpm gap-report.",
    );
  });
});

describe("formatOperatorNotice", () => {
  it("says nothing at all when the job is healthy and the window is clean", () => {
    expect(formatOperatorNotice([], CLEAN)).toEqual([]);
  });

  it("puts the heartbeat's cause before the data's effect", () => {
    const lines = formatOperatorNotice(
      ["Numisma: the price feed has not completed since 2026-08-13."],
      findings([{ date: "2026-08-14", reason: "no-anchor" }], []),
    );
    expect(lines[0]).toBe("Numisma: the price feed has not completed since 2026-08-13.");
    expect(lines.slice(1).some((line) => line.includes("2026-08-14"))).toBe(true);
  });

  it("still speaks for a failed job on a clean window", () => {
    expect(formatOperatorNotice(["Numisma: the last run exited 127."], CLEAN)).toEqual([
      "Numisma: the last run exited 127.",
    ]);
  });

  it("ENUMERATES each lost day and names its own recovery command", () => {
    const lines = formatOperatorNotice(
      [],
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
    const dark: VenueDarkDay[] = [
      { date: "2026-07-03", source: "twelvedata", expected: 6 },
      { date: "2026-08-11", source: "twelvedata", expected: 6 },
      { date: "2026-08-11", source: "binance", expected: 4 },
    ];
    const lines = formatOperatorNotice([], findings([], dark));
    expect(lines).toEqual([
      "Numisma: 3 venue-day(s) dark — not lost days: the feed ran and the days are " +
        "anchored. Enumerate them with pnpm gap-report.",
    ]);
    // The permanent, accumulating rows must not reach the notice at all: no date and
    // no venue name from the venue-dark side may appear anywhere in it.
    const joined = lines.join("\n");
    for (const entry of dark) {
      expect(joined).not.toContain(entry.date);
      expect(joined).not.toContain(entry.source);
    }
  });

  it("carries both kinds, lost first, when the window has both", () => {
    expect(
      formatOperatorNotice(
        [],
        findings(
          [{ date: "2026-08-15", reason: "no-marks" }],
          [{ date: "2026-08-11", source: "binance", expected: 4 }],
        ),
      ),
    ).toEqual([
      "Numisma: 2026-08-15 — NO MARKS. The day is anchored but no price mark landed on it; the day is lost.",
      "Numisma: 2026-08-15 — recover with: pnpm prices:fetch --as-of=2026-08-15",
      "Numisma: 1 venue-day(s) dark — not lost days: the feed ran and the days are " +
        "anchored. Enumerate them with pnpm gap-report.",
    ]);
  });

  it("pairs each recovery command with ITS OWN lost date, not the first one", () => {
    const dates = ["2026-08-02", "2026-08-14", "2026-08-15"];
    const lines = formatOperatorNotice(
      [],
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
    const lines = formatOperatorNotice([], {
      kind: "failed",
      error: new Error("log line 12 quarantined"),
    });
    expect(lines).toEqual(["Numisma: lost days were NOT checked (log line 12 quarantined)."]);
  });

  it("keeps the heartbeat lines even when the gap check itself broke", () => {
    expect(
      formatOperatorNotice(["Numisma: the last run exited 127."], {
        kind: "failed",
        error: "no such file",
      }),
    ).toEqual([
      "Numisma: the last run exited 127.",
      "Numisma: lost days were NOT checked (no such file).",
    ]);
  });
});

describe("formatNoticeCheckFailure", () => {
  it("renders a non-Error throw without losing it", () => {
    expect(formatNoticeCheckFailure("disk gone")).toBe(
      "Numisma: lost days were NOT checked (disk gone).",
    );
  });
});
