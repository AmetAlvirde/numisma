/**
 * The gap report's ONE async surface, tested against a real log file on disk.
 *
 * The events written here are synthetic — invented instrument ids and round
 * numbers, no real position, price or balance. What is being asserted is the
 * shell's two jobs and nothing more: that it reads the log at the paths it was
 * HANDED (so a caller's `NUMISMA_DATA_DIR` resolution is honoured rather than
 * re-derived), and that it refuses to run on a partial log.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PortfolioEvent } from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import {
  GAP_REPORT_FILENAME,
  GAP_REPORT_SCHEMA_VERSION,
  gapReportPath,
  loadGapReport,
  writeGapReportFile,
} from "./gap-report-io.js";
import { computeGapReport } from "./gap-report.js";
import { resolveEventStorePaths } from "./event-store.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

/** A throwaway data dir holding exactly the log lines given. */
async function storeWithLog(lines: readonly string[]) {
  const dataDir = await mkdtemp(join(tmpdir(), "numisma-gap-"));
  created.push(dataDir);
  const paths = resolveEventStorePaths(dataDir);
  await writeFile(paths.log, lines.map((line) => `${line}\n`).join(""), "utf8");
  return paths;
}

function mark(date: string, instrumentId: string): PortfolioEvent {
  return { id: `pm-${instrumentId}-${date}`, asOf: date, type: "PriceMarked", instrumentId, price: 100 };
}

function deposit(date: string): PortfolioEvent {
  return { id: `dep-${date}`, asOf: date, type: "Deposit", reserveId: "cash-core", amount: 500, tier: "c1" };
}

const LATER = new Date("2026-08-05T12:00:00Z");

describe("loadGapReport", () => {
  it("derives the report from the log at the paths it was handed", async () => {
    const paths = await storeWithLog(
      [mark("2026-07-10", "cx-a"), deposit("2026-07-11"), mark("2026-07-12", "cx-a")].map((event) =>
        JSON.stringify(event),
      ),
    );
    const report = await loadGapReport(paths, {
      since: "2026-07-10",
      until: "2026-07-12",
      now: LATER,
    });
    expect(report.lost).toEqual([{ date: "2026-07-11", reason: "no-marks" }]);
    expect(report.anchorsChecked).toBe(3);
  });

  it("treats a missing log as a window with no anchors at all", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "numisma-gap-"));
    created.push(dataDir);
    const report = await loadGapReport(resolveEventStorePaths(dataDir), {
      since: "2026-07-10",
      until: "2026-07-11",
      now: LATER,
    });
    expect(report.lost).toEqual([
      { date: "2026-07-10", reason: "no-anchor" },
      { date: "2026-07-11", reason: "no-anchor" },
    ]);
  });

  it("refuses to run on a partial log rather than inventing a lost day", async () => {
    // A quarantined line is a mark this derivation cannot see. Degrading
    // gracefully here would turn a corrupt line into a PHANTOM lost day — a
    // false positive manufactured by the reader, which is the one thing a
    // liveness detector must not do.
    const paths = await storeWithLog([
      JSON.stringify(mark("2026-07-10", "cx-a")),
      "{ this is not an event }",
    ]);
    await expect(
      loadGapReport(paths, { since: "2026-07-10", until: "2026-07-10", now: LATER }),
    ).rejects.toThrow(/quarantine/i);
  });
});

// ── The file the standup reads ───────────────────────────────────────────────

/** A report with both lost-day reasons in it, derived from real events. */
function reportWithBothReasons() {
  return computeGapReport(
    [mark("2026-07-10", "cx-a"), deposit("2026-07-11")],
    { since: "2026-07-10", until: "2026-07-12", now: LATER },
  );
}

async function writeInto(report: ReturnType<typeof computeGapReport>, now = LATER) {
  const dataDir = await mkdtemp(join(tmpdir(), "numisma-gap-"));
  created.push(dataDir);
  const paths = resolveEventStorePaths(dataDir);
  const written = await writeGapReportFile(report, { path: gapReportPath(paths), now });
  const body = JSON.parse(await readFile(written, "utf8")) as Record<string, unknown>;
  return { dataDir, paths, written, body };
}

describe("gapReportPath / GAP_REPORT_FILENAME", () => {
  it("names one fixed file beside the log it derives from", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "numisma-gap-"));
    created.push(dataDir);
    const paths = resolveEventStorePaths(dataDir);
    expect(GAP_REPORT_FILENAME).toBe("gap-report.json");
    expect(gapReportPath(paths)).toBe(join(dataDir, "gap-report.json"));
    // Beside the log, not beside the checkout — the report travels with the data.
    expect(gapReportPath(paths)).toBe(paths.log.replace("events.jsonl", "gap-report.json"));
  });
});

describe("writeGapReportFile", () => {
  it("round-trips the report into the data dir, lost and lines in agreement", async () => {
    const report = reportWithBothReasons();
    const { written, body, dataDir } = await writeInto(report);

    expect(written).toBe(join(dataDir, "gap-report.json"));
    expect(body.generatedAt).toBe(LATER.toISOString());
    expect(body.since).toBe("2026-07-10");
    expect(body.until).toBe("2026-07-12");
    expect(body.calendarDays).toBe(3);
    expect(body.anchorsChecked).toBe(2);
    expect(body.lost).toEqual([
      { date: "2026-07-11", reason: "no-marks" },
      { date: "2026-07-12", reason: "no-anchor" },
    ]);
    // The structured array and the rendered lines describe the SAME days — the
    // duplication is deliberate (the standup can `jq -r '.lines[]'`), so it has to
    // be kept honest.
    expect(body.lines).toHaveLength(report.lost.length);
    for (const [index, day] of report.lost.entries()) {
      expect((body.lines as string[])[index]).toContain(day.date);
    }
    expect(body.summary).toContain("2 lost day(s)");
  });

  it("carries a schemaVersion — asserted, not merely documented", async () => {
    const { body } = await writeInto(reportWithBothReasons());
    expect(body.schemaVersion).toBe(GAP_REPORT_SCHEMA_VERSION);
    expect(GAP_REPORT_SCHEMA_VERSION).toBe(1);
    // An integer, so a reader can compare it. Slice #191's sibling
    // `job-heartbeat.json` follows the same convention with its own counter.
    expect(Number.isInteger(body.schemaVersion)).toBe(true);
    // First key in the serialized body, so `head -2` on the file tells you what
    // you are reading before you parse it.
    expect(Object.keys(body)[0]).toBe("schemaVersion");
  });

  it("writes a clean report too, with an empty lost array and no lines", async () => {
    const report = computeGapReport([mark("2026-07-10", "cx-a")], {
      since: "2026-07-10",
      until: "2026-07-10",
      now: LATER,
    });
    const { body } = await writeInto(report);
    expect(body.lost).toEqual([]);
    expect(body.lines).toEqual([]);
    expect(body.summary).toContain("no lost days");
  });

  it("overwrites the one fixed file rather than rotating", async () => {
    // Deliberately unchanged: no rotation, no history. "The standup reads THE
    // file" needs exactly one well-known name.
    const dataDir = await mkdtemp(join(tmpdir(), "numisma-gap-"));
    created.push(dataDir);
    const paths = resolveEventStorePaths(dataDir);
    const first = await writeGapReportFile(reportWithBothReasons(), {
      path: gapReportPath(paths),
      now: LATER,
    });
    const second = await writeGapReportFile(
      computeGapReport([mark("2026-07-10", "cx-a")], {
        since: "2026-07-10",
        until: "2026-07-10",
        now: LATER,
      }),
      { path: gapReportPath(paths), now: LATER },
    );
    expect(second).toBe(first);
    const body = JSON.parse(await readFile(first, "utf8")) as Record<string, unknown>;
    expect(body.lost).toEqual([]); // the second run's content, not the first's
  });
});

// ── The privacy walk ─────────────────────────────────────────────────────────
//
// THE CHECK THAT REPLACES INSPECTION.
//
// `gap-report.json` is written beside the private durable log and is meant to be
// pasted into a standup, so it must carry NO NAV, no positions, no prices, no
// balances, no magnitudes of any kind. Grepping for the literal string "NAV"
// would not catch that — THE NEXT FIELD SOMEONE ADDS WILL NOT BE CALLED NAV. So
// the check is inverted into an allowlist over the SERIALIZED BODY:
//
//   1. Every key must be one this file knows about. An unfamiliar key FAILS BY
//      DEFAULT, which is the only rule that can catch a field nobody has thought
//      of yet.
//   2. Every number must be a non-negative INTEGER — a count. A magnitude is a
//      decimal, and a count of days can never be one.
//   3. Every string must be a calendar date, an ISO instant, a known reason enum,
//      or one of the two rendered text fields.
//   4. Inside those rendered strings, every numeric token must be a date or one of
//      the report's own counts, and no currency symbol or decimal may appear. That
//      is what stops a magnitude riding in on a sentence.
//
// IT LIVES AT MODULE SCOPE ON PURPOSE. Both tests below drive THIS function — one
// asserting it returns nothing for the real written body, the other asserting the
// exact violations it returns for a deliberately poisoned one. A walk that could
// only ever say yes would pass the first test and fail the second, which is the
// whole point: a guard that is never shown saying *no* is a guard guaranteed by
// inspection again.
const ALLOWED_KEYS = new Set([
  "schemaVersion",
  "generatedAt",
  "since",
  "until",
  "calendarDays",
  "anchorsChecked",
  "lost",
  "date",
  "reason",
  "summary",
  "lines",
]);
const REASONS = new Set(["no-anchor", "no-marks"]);
const RENDERED_KEYS = new Set(["summary", "lines"]);
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/;

/** Every way `body` violates "dates and counts only", each as `path: reason`. */
function privacyViolations(body: unknown, counts: ReadonlySet<string>): string[] {
  const failures: string[] = [];
  const walk = (value: unknown, path: string, renderedField: boolean): void => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`, renderedField));
      return;
    }
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (!ALLOWED_KEYS.has(key)) {
          failures.push(`${path}.${key}: unknown key — a new field must prove it is a date or a count`);
          continue;
        }
        walk(child, `${path}.${key}`, renderedField || RENDERED_KEYS.has(key));
      }
      return;
    }
    if (typeof value === "number") {
      if (!Number.isInteger(value) || value < 0) {
        failures.push(`${path}: ${value} is not a count`);
      }
      return;
    }
    if (typeof value !== "string") {
      failures.push(`${path}: ${typeof value} is neither a date nor a count`);
      return;
    }
    if (ISO_DATE.test(value) || ISO_INSTANT.test(value) || REASONS.has(value)) {
      return;
    }
    if (!renderedField) {
      failures.push(`${path}: ${JSON.stringify(value)} is not a date, an instant or a known label`);
      return;
    }
    // A rendered sentence. No currency, no decimals, and every number in it must
    // already be a date or one of this report's counts.
    if (/[$€£¥]|\d+\.\d/.test(value)) {
      failures.push(`${path}: ${JSON.stringify(value)} carries a magnitude`);
      return;
    }
    const residue = value.replace(/\d{4}-\d{2}-\d{2}/g, "");
    for (const token of residue.match(/\d+/g) ?? []) {
      if (!counts.has(token)) {
        failures.push(`${path}: the number ${token} is not one of this report's counts`);
      }
    }
  };
  walk(body, "body", false);
  return failures;
}

/** The only numbers a report's rendered sentences are allowed to contain. */
function countsOf(report: ReturnType<typeof computeGapReport>): ReadonlySet<string> {
  return new Set([
    String(report.calendarDays),
    String(report.anchorsChecked),
    String(report.lost.length),
    String(GAP_REPORT_SCHEMA_VERSION),
  ]);
}

/** The `path` half of each violation, sorted — key order is not the assertion. */
function violationPaths(violations: readonly string[]): string[] {
  return violations.map((violation) => violation.slice(0, violation.indexOf(":"))).sort();
}

describe("the privacy property — dates and counts only", () => {
  it("carries nothing but dates, counts, a version and known labels", async () => {
    const report = reportWithBothReasons();
    const { body } = await writeInto(report);
    expect(privacyViolations(body, countsOf(report))).toEqual([]);
  });

  it("names every magnitude smuggled into the body — the same walk, saying no", async () => {
    // The counterpart of the test above, driving THE SAME function. Without it,
    // a walk that pushed nothing under any circumstance would pass — testing the
    // rule and never the thing the rule is applied to, which is the exact defect
    // this whole increment exists to remove.
    //
    // Four poisonings, three distinct rules:
    //   `navUsd`             a new top-level field — the unknown-key rule
    //   `lost[0].navUsd`     the same rule INSIDE an array of objects, so a walk
    //                        that stopped descending into `lost` fails here
    //   `anchorsChecked`     a decimal where a count belongs — the number rule
    //   `lines[2]`           a magnitude inside a rendered sentence, where the key
    //                        allowlist cannot help — the rendered-string rule
    const report = reportWithBothReasons();
    const { body } = await writeInto(report);
    const lost = body.lost as Array<Record<string, unknown>>;
    const smuggled = {
      ...body,
      navUsd: 12_345.67,
      anchorsChecked: 2.5,
      lost: [{ ...lost[0], navUsd: 68_000.12 }, ...lost.slice(1)],
      lines: [...(body.lines as string[]), "Numisma: NAV is $12,345.67"],
    };

    const violations = privacyViolations(smuggled, countsOf(report));
    expect(violationPaths(violations)).toEqual([
      "body.anchorsChecked",
      "body.lines[2]",
      "body.lost[0].navUsd",
      "body.navUsd",
    ]);
    expect(violations.find((v) => v.startsWith("body.anchorsChecked"))).toContain("is not a count");
    expect(violations.find((v) => v.startsWith("body.lines[2]"))).toContain("carries a magnitude");
    expect(violations.find((v) => v.startsWith("body.navUsd"))).toContain("unknown key");
  });

  it("catches a magnitude that hides behind no currency symbol at all", async () => {
    // The subtlest case: a bare number in a sentence, no `$`, no decimal. It is
    // caught because every number in a rendered line must already be one of the
    // report's own counts.
    const report = reportWithBothReasons();
    const { body } = await writeInto(report);
    const violations = privacyViolations(
      { ...body, lines: ["Numisma: the fund holds 41230 units"] },
      countsOf(report),
    );
    expect(violations).toEqual([
      "body.lines[0]: the number 41230 is not one of this report's counts",
    ]);
  });
});
