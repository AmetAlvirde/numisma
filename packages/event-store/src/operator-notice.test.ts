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
