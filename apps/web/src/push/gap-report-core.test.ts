/**
 * The gap-report CLI's FIRST test file. The command had none.
 *
 * Most of what is asserted here is ordinary argument hygiene. One case is not:
 * `--since 2026-02-30`. Left to `Date` that input rolls silently to March 2 and
 * the report answers a question nobody asked, IN THE SAME SHAPE AS A CORRECT
 * ANSWER — a detector whose entire value is trust cannot have a failure mode that
 * looks like success. It is why this slice exists at this size, and it is tested
 * by name.
 *
 * The log fixtures are synthetic — invented instrument ids and round numbers,
 * written into a throwaway temp dir. No test here reads the real data store.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { daysBetween, type PortfolioEvent } from "@numisma/engine";
import {
  GAP_REPORT_SCHEMA_VERSION,
  LAUNCHD_ERA_START,
  dueThrough,
  gapReportPath,
  resolveEventStorePaths,
  type EventStorePaths,
} from "@numisma/event-store";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_WINDOW_DAYS,
  defaultGapReportSince,
  parseGapReportArgs,
  resolveGapReportPaths,
  runGapReport,
} from "./gap-report-core.ts";

const created: string[] = [];
const savedEnv = { ...process.env };

afterEach(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
  process.env = { ...savedEnv };
});

function mark(date: string, instrumentId: string): PortfolioEvent {
  return {
    id: `pm-${instrumentId}-${date}`,
    asOf: date,
    type: "PriceMarked",
    instrumentId,
    price: 100,
  };
}

function deposit(date: string): PortfolioEvent {
  return { id: `dep-${date}`, asOf: date, type: "Deposit", reserveId: "cash-core", amount: 500, tier: "c1" };
}

/**
 * A day on which BOTH venues reported — the registry's own ids. Since #266 the
 * report also asks whether a whole venue went dark, so "clean" means every venue
 * that owed a mark produced one; a single made-up mark leaves nine unquoted.
 * Elsewhere in this file `mark(date, "cx-a")` is used only to make the log
 * NON-EMPTY, and those cases assert exit codes and paths rather than lines.
 */
const CRYPTO = ["btc", "eth", "render", "gram"];
const EQUITIES = [
  "aapl",
  "googl",
  "tsla",
  "eww-mxn",
  "intc-mxn",
  "nke-mxn",
  "nu-mxn",
  "rivn-mxn",
  "sbux-mxn",
];

function healthyDay(date: string): PortfolioEvent[] {
  return [...CRYPTO, ...EQUITIES].map((instrumentId) => mark(date, instrumentId));
}

/** A throwaway store holding exactly these events. */
async function storeWith(events: readonly PortfolioEvent[]): Promise<EventStorePaths> {
  const dataDir = await mkdtemp(join(tmpdir(), "numisma-gap-cli-"));
  created.push(dataDir);
  const paths = resolveEventStorePaths(dataDir);
  await writeFile(paths.log, events.map((event) => `${JSON.stringify(event)}\n`).join(""), "utf8");
  return paths;
}

const NOW = new Date("2026-08-05T12:00:00Z"); // 06:00 CDMX on 2026-08-05
const YESTERDAY = "2026-08-04";
const TODAY_CDMX = "2026-08-05";

describe("parseGapReportArgs — refusing an input it cannot answer correctly", () => {
  it("rejects --since 2026-02-30 rather than rolling it forward to March 2", () => {
    // The whole reason for this slice. `2026-02-30` satisfies /\d{4}-\d{2}-\d{2}/
    // and is still not a date; `new Date("2026-02-30")` yields 2026-03-02 and the
    // report would look exactly like a correct one.
    expect(() => parseGapReportArgs(["--since", "2026-02-30"])).toThrow(
      /2026-02-30.*not a real calendar date/,
    );
  });

  it("rejects other calendar-shaped non-dates for the same reason", () => {
    expect(() => parseGapReportArgs(["--until", "2026-13-01"])).toThrow(/not a real calendar date/);
    expect(() => parseGapReportArgs(["--since", "2027-02-29"])).toThrow(/not a real calendar date/);
    // …and accepts a real leap day, so the check is a calendar check, not a blocklist.
    expect(parseGapReportArgs(["--since", "2028-02-29"]).since).toBe("2028-02-29");
  });

  it("rejects a date that is not strict zero-padded YYYY-MM-DD", () => {
    expect(() => parseGapReportArgs(["--since", "2026-7-3"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseGapReportArgs(["--since", "07/03/2026"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseGapReportArgs(["--since", "2026-07-03T00:00:00Z"])).toThrow(/YYYY-MM-DD/);
  });

  it("rejects a flag consumed as a value: --since --write errors at parse", () => {
    // Not deep inside date arithmetic, where the message would be about a date.
    expect(() => parseGapReportArgs(["--since", "--write"])).toThrow(
      /--since expects a date.*got the flag '--write'/s,
    );
  });

  it("rejects --until as the final argv token instead of falling back to the default ceiling", () => {
    // Silently falling back is how a typo turns into a differently-scoped report
    // that still looks right.
    expect(() => parseGapReportArgs(["--write", "--until"])).toThrow(/--until expects a date/);
    expect(() => parseGapReportArgs(["--since"])).toThrow(/--since expects a date/);
  });

  it("rejects an unrecognized argument rather than ignoring it", () => {
    expect(() => parseGapReportArgs(["--sicne", "2026-07-03"])).toThrow(/unrecognized/i);
    expect(() => parseGapReportArgs(["2026-07-03"])).toThrow(/unrecognized/i);
  });

  it("ignores the bare `--` separator that `pnpm gap-report -- …` passes through", () => {
    // Caught by running the real command, not by a unit test: pnpm forwards the
    // literal `--` into argv, so a parser strict enough to reject unknown tokens
    // rejects the documented invocation itself. The looser `argv.includes(...)`
    // parsing in `push.ts` / `backfill.ts` never had to notice.
    expect(parseGapReportArgs(["--", "--since", "2026-07-03"])).toEqual({
      since: "2026-07-03",
      until: undefined,
      write: false,
    });
    // Still not a date, though — `--` after a date flag is a missing value.
    expect(() => parseGapReportArgs(["--since", "--"])).toThrow(/--since expects a date/);
  });

  it("rejects a repeated date flag rather than letting the last one win", () => {
    // Same defect class as the cases above: last-wins produces a differently-scoped
    // report that still looks right.
    expect(() => parseGapReportArgs(["--since", "2026-07-03", "--since", "2026-07-10"])).toThrow(
      /--since given twice \(2026-07-03 and 2026-07-10\)/,
    );
    expect(() => parseGapReportArgs(["--until", "2026-07-31", "--until", "2026-07-30"])).toThrow(
      /--until given twice/,
    );
  });

  it("accepts the flags it documents, in any order", () => {
    expect(parseGapReportArgs([])).toEqual({ since: undefined, until: undefined, write: false });
    expect(parseGapReportArgs(["--write", "--since", "2026-07-03", "--until", "2026-07-31"])).toEqual({
      since: "2026-07-03",
      until: "2026-07-31",
      write: true,
    });
  });
});

describe("runGapReport — the window's bounds", () => {
  it("refuses a window wider than MAX_WINDOW_DAYS rather than printing one line per calendar day", async () => {
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    await expect(
      runGapReport({ argv: ["--since", "1970-01-01"], now: NOW, paths }),
    ).rejects.toThrow(new RegExp(`window .*${MAX_WINDOW_DAYS}`));
  });

  it("accepts a window exactly at the bound", async () => {
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    // MAX_WINDOW_DAYS days inclusive ends on the ceiling.
    const since = new Date(Date.parse(`${YESTERDAY}T00:00:00Z`) - (MAX_WINDOW_DAYS - 1) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const run = await runGapReport({ argv: ["--since", since], now: NOW, paths });
    expect(run.exitCode).toBe(0);
  });

  it("refuses a --since that the ceiling clamp pulls the window behind", async () => {
    // Found live: `pnpm gap-report -- --since 2026-08-05` printed
    // "no lost days in 2026-08-05…2026-08-04 (0 day(s), 0 anchor(s) checked)" and
    // exited 0. Each date is individually valid; the WINDOW is not. An all-clear
    // that cannot be anything else is the failure mode that looks like success —
    // and with --write it would overwrite the standup's gap-report.json with it.
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    await expect(
      runGapReport({ argv: ["--since", TODAY_CDMX], now: NOW, paths }),
    ).rejects.toThrow(/--since 2026-08-05 is after the effective ceiling 2026-08-04/);
  });

  it("refuses an explicitly inverted window too", async () => {
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    await expect(
      runGapReport({ argv: ["--since", "2026-08-01", "--until", "2026-07-25"], now: NOW, paths }),
    ).rejects.toThrow(/window is empty/);
  });

  it("does not refuse a single-day window, where since equals the ceiling", async () => {
    // The guard is `>`, not `>=`: since === until is one real day, the narrowest
    // report the command can produce, and it must stay reachable.
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    const run = await runGapReport({ argv: ["--since", YESTERDAY], now: NOW, paths });
    expect(run.report.calendarDays).toBe(1);
    expect(run.exitCode).toBe(0);
  });

  it("clamps a far-future --until to yesterday, so it cannot run away", async () => {
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    const run = await runGapReport({
      argv: ["--since", YESTERDAY, "--until", "2099-12-31"],
      now: NOW,
      paths,
    });
    expect(run.report.until).toBe(YESTERDAY);
    expect(run.report.calendarDays).toBe(1);
  });

  it("--until with today's date still produces a report ending yesterday", async () => {
    // The seam with #187: the clamp lives in `computeGapReport` and is NOT
    // re-implemented here. This asserts the CLI cannot defeat it.
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    const run = await runGapReport({
      argv: ["--since", YESTERDAY, "--until", TODAY_CDMX],
      now: NOW,
      paths,
    });
    expect(run.report.until).toBe(YESTERDAY);
    expect(run.lines.join("\n")).not.toContain(TODAY_CDMX);
  });

  it("floors a zero-argument run at the era start while the era is younger than the cap", async () => {
    // The unchanged behavior, pinned so the clamp below cannot quietly narrow
    // today's report: the era start is LATER than 400 days back, so it wins.
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    expect(defaultGapReportSince(NOW)).toBe(LAUNCHD_ERA_START);
    const run = await runGapReport({ argv: [], now: NOW, paths });
    expect(run.report.since).toBe(LAUNCHD_ERA_START);
  });

  it("rolls the zero-argument floor forward once the era outgrows the cap, instead of throwing", async () => {
    // THE REGRESSION THIS EXISTS FOR. The era start is fixed and the ceiling is
    // yesterday, so the default window grows a day per day and crosses
    // MAX_WINDOW_DAYS on 2027-08-08 — at which point the 18:00 job's zero-argument
    // `pnpm gap-report -- --write` would have thrown every night, forever, AFTER
    // every other step had succeeded. Driven by a real future `now`, not by a
    // restated bound.
    const paths = await storeWith([mark("2027-08-06", "cx-a")]);
    const firstOverLimit = new Date("2027-08-08T12:00:00Z");
    // Unclamped this window would be 401 days — one past the cap.
    expect(daysBetween(LAUNCHD_ERA_START, dueThrough(firstOverLimit)) + 1).toBe(
      MAX_WINDOW_DAYS + 1,
    );

    const run = await runGapReport({ argv: [], now: firstOverLimit, paths });
    expect(run.exitCode).toBe(0);
    expect(run.report.calendarDays).toBe(MAX_WINDOW_DAYS);
    expect(run.report.since).toBe("2026-07-04");
    expect(run.report.until).toBe("2027-08-07");
  });

  it("still refuses an explicit --since past the cap — the clamp fills a floor, it does not lift the bound", async () => {
    const paths = await storeWith([mark("2027-08-06", "cx-a")]);
    await expect(
      runGapReport({
        argv: ["--since", LAUNCHD_ERA_START],
        now: new Date("2027-08-08T12:00:00Z"),
        paths,
      }),
    ).rejects.toThrow(new RegExp(`window .*${MAX_WINDOW_DAYS}`));
  });
});

describe("runGapReport — the exit contract", () => {
  it("exits 0 when days are lost", async () => {
    // A lost day is PERMANENT and unfixable. Gating the job's exit on it means a
    // permanently red job, and a permanently red job is one nobody reads.
    // A lost day is reported; a broken job is failed.
    const paths = await storeWith([mark("2026-08-02", "cx-a"), deposit("2026-08-03")]);
    const run = await runGapReport({
      argv: ["--since", "2026-08-02", "--until", YESTERDAY],
      now: NOW,
      paths,
    });
    expect(run.report.lost).toEqual([
      { date: "2026-08-03", reason: "no-marks" },
      { date: "2026-08-04", reason: "no-anchor" },
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.lines.some((line) => line.includes("2 lost day(s)"))).toBe(true);
  });

  it("exits 0 on a clean window too, and still prints the summary", async () => {
    const paths = await storeWith(healthyDay(YESTERDAY));
    const run = await runGapReport({ argv: ["--since", YESTERDAY], now: NOW, paths });
    expect(run.report.lost).toEqual([]);
    expect(run.report.venueDark).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.lines).toEqual([
      "[gap-report] Numisma: no lost days in 2026-08-04…2026-08-04 (1 day(s), 1 anchor(s) checked).",
    ]);
  });

  it("exits 0 on a VENUE-DARK day, and says so — warn only (#266 D8)", async () => {
    // The exit code does not move, and that is mandatory rather than merely
    // preferable: with no market-holiday calendar (D7) this fires on ~9-10 weekday
    // holidays a year, so a non-zero exit would fail the daily automation ten times
    // a year and train the operator to ignore it.
    const paths = await storeWith(CRYPTO.map((id) => mark(YESTERDAY, id)));
    const run = await runGapReport({ argv: ["--since", YESTERDAY], now: NOW, paths });

    expect(run.report.lost).toEqual([]);
    expect(run.report.venueDark).toEqual([
      { date: YESTERDAY, source: "twelvedata", expected: 9 },
    ]);
    expect(run.exitCode).toBe(0);
    expect(run.lines.some((line) => line.includes("VENUE DARK"))).toBe(true);
    expect(run.lines.some((line) => line.includes("Tuesday"))).toBe(true);
    // The lost-day count is untouched: a venue-dark day is not a lost day.
    expect(run.lines.some((line) => line.includes("no lost days"))).toBe(true);
  });

  it("throws — so the shell exits non-zero — when the derivation cannot run", async () => {
    // A quarantined log line is a mark the derivation cannot see. Reporting
    // anyway would manufacture a phantom lost day.
    const dataDir = await mkdtemp(join(tmpdir(), "numisma-gap-cli-"));
    created.push(dataDir);
    const paths = resolveEventStorePaths(dataDir);
    await writeFile(paths.log, `${JSON.stringify(mark(YESTERDAY, "cx-a"))}\n{ not an event }\n`, "utf8");
    await expect(
      runGapReport({ argv: ["--since", YESTERDAY], now: NOW, paths }),
    ).rejects.toThrow(/quarantine/i);
  });

  it("throws — so the shell exits non-zero — when --write cannot persist", async () => {
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    await expect(
      runGapReport({
        argv: ["--since", YESTERDAY, "--write"],
        now: NOW,
        paths,
        writeReport: () => Promise.reject(new Error("disk is full")),
      }),
    ).rejects.toThrow(/disk is full/);
  });

  it("reports where it wrote when --write succeeds", async () => {
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    const run = await runGapReport({
      argv: ["--since", YESTERDAY, "--write"],
      now: NOW,
      paths,
      writeReport: () => Promise.resolve("/tmp/gap-report.json"),
    });
    expect(run.exitCode).toBe(0);
    expect(run.lines.at(-1)).toBe("[gap-report] written: /tmp/gap-report.json");
  });

  it("persists to the data dir by default, with no writer injected", async () => {
    // #189 filled the seam: `--write` now writes `gap-report.json` beside the log
    // and exits 0. No stub, no "not available yet".
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    const run = await runGapReport({
      argv: ["--since", YESTERDAY, "--write"],
      now: NOW,
      paths,
    });
    expect(run.exitCode).toBe(0);
    const written = gapReportPath(paths);
    expect(run.lines.at(-1)).toBe(`[gap-report] written: ${written}`);
    const body = JSON.parse(await readFile(written, "utf8")) as Record<string, unknown>;
    expect(body.schemaVersion).toBe(GAP_REPORT_SCHEMA_VERSION);
    expect(body.until).toBe(YESTERDAY);
  });
});

describe("no environment — the property that lets it run when the projection is what is broken", () => {
  it("runs with no data-dir variable and no projection database URL set", async () => {
    const paths = await storeWith([mark(YESTERDAY, "cx-a")]);
    for (const key of Object.keys(process.env)) {
      if (/^(NUMISMA_DATA_DIR|DATABASE_URL|POSTGRES_|PG|PROJECTION_)/.test(key)) {
        delete process.env[key];
      }
    }
    const run = await runGapReport({ argv: ["--since", YESTERDAY], now: NOW, paths });
    expect(run.exitCode).toBe(0);
  });

  it("resolves its store with no NUMISMA_DATA_DIR set, to an absolute default", async () => {
    delete process.env.NUMISMA_DATA_DIR;
    const paths = resolveGapReportPaths();
    expect(isAbsolute(paths.log)).toBe(true);
    expect(paths.log.endsWith("events.jsonl")).toBe(true);
  });

  it("reaches no database driver at all", async () => {
    // Structural, not incidental: the detector must not depend on the thing whose
    // failure it detects. A future `import { Pool } from "pg"` here fails this.
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(new URL("./gap-report-core.ts", import.meta.url), "utf8"),
    );
    // Read the IMPORT SPECIFIERS, not the prose — the header legitimately names
    // `push-core.ts` when explaining the shell/core split.
    const specifiers = [...source.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(specifiers).toEqual(["@numisma/event-store"]);
    expect(source).not.toMatch(/DATABASE_URL/);
    expect(source).not.toMatch(/process\.env/);
  });
});
