/**
 * The job heartbeat's reader — the half of #191 that CAN be tested.
 *
 * The writer is five lines of bash in `ops/price-feed/run-daily-fetch.sh` and the
 * repo has no shell-test infrastructure; this slice deliberately does not invent
 * one. The mitigation is to keep the bash to a trap and a `printf` and to test
 * everything downstream of it exhaustively — so these fixtures are written in the
 * EXACT byte shape that `printf` emits, not in a shape convenient for the parser.
 * If the two ever disagree, that is the bug this file exists to catch.
 *
 * Dates, step names and exit codes only. No figures of any kind — the same privacy
 * property `gap-report.json` carries, for the same reason.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addDays, tradingDayAsOf } from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import { resolveEventStorePaths } from "./event-store.js";
import {
  HEARTBEAT_FILENAME,
  HEARTBEAT_SCHEMA_VERSION,
  formatHeartbeatWarning,
  parseHeartbeat,
} from "./heartbeat.js";
import { heartbeatPath, loadHeartbeatLines } from "./heartbeat-io.js";
import { REPORT_TIME_ZONE, dueThrough } from "./gap-report.js";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.map((dir) => rm(dir, { recursive: true, force: true })));
  created.length = 0;
});

/**
 * Byte-for-byte what the wrapper's `printf` writes — same key order, same
 * two-space indent, same trailing newline.
 */
function heartbeatFileBody(fields: {
  startedAt: string;
  finishedAt: string;
  exitCode: number;
  lastStep: string;
  schemaVersion?: number;
}): string {
  return (
    `{\n` +
    `  "schemaVersion": ${fields.schemaVersion ?? 1},\n` +
    `  "startedAt": "${fields.startedAt}",\n` +
    `  "finishedAt": "${fields.finishedAt}",\n` +
    `  "exitCode": ${fields.exitCode},\n` +
    `  "lastStep": "${fields.lastStep}"\n` +
    `}\n`
  );
}

async function storeWithHeartbeat(raw: string | undefined) {
  const dataDir = await mkdtemp(join(tmpdir(), "numisma-heartbeat-"));
  created.push(dataDir);
  const paths = resolveEventStorePaths(dataDir);
  if (raw !== undefined) {
    await writeFile(heartbeatPath(paths), raw, "utf8");
  }
  return { dataDir, paths };
}

// 06:00 CDMX on 2026-08-05 → the gap report's ceiling is 2026-08-04.
const NOW = new Date("2026-08-05T12:00:00Z");
const CEILING = "2026-08-04";

/**
 * A run that fired at the 18:00 CDMX mark time on the given CDMX day.
 *
 * THE UTC OFFSET IS THE POINT, not incidental bookkeeping. CDMX is UTC-6, so an
 * 18:05 finish on day D is `D+1T00:05:00Z` — the instant is stamped with
 * TOMORROW's UTC date. A fixture that wrote `D T00:05:00Z` would be describing the
 * PREVIOUS CDMX evening, which is precisely the off-by-one this whole increment
 * exists to prevent. (This helper was wrong in exactly that way on first writing,
 * and the reader caught it.)
 */
function ranOn(day: string, exitCode = 0, lastStep = "complete"): string {
  const nextUtcDay = addDays(day, 1);
  return heartbeatFileBody({
    startedAt: `${nextUtcDay}T00:00:00Z`, // 18:00 CDMX on `day`
    finishedAt: `${nextUtcDay}T00:05:00Z`, // 18:05 CDMX on `day`
    exitCode,
    lastStep,
  });
}

describe("the heartbeat shares the gap report's ceiling", () => {
  it("uses dueThrough, not a second staleness number of its own", () => {
    // One window rule for the whole increment. A second, independently-derived
    // threshold would drift against the first the moment either moved.
    expect(dueThrough(NOW)).toBe(CEILING);
    // A run ON the ceiling is current; the day before it is not. That boundary IS
    // `dueThrough`, so moving the ceiling moves this with it.
    expect(formatHeartbeatWarning(parseHeartbeat(ranOn(CEILING)), NOW)).toEqual([]);
    expect(formatHeartbeatWarning(parseHeartbeat(ranOn("2026-08-03")), NOW)).not.toEqual([]);
  });

  it("credits a run to its CDMX day, not to the UTC date on the instant", () => {
    // The 18:00 CDMX job finishes stamped with TOMORROW's UTC date. Reading that
    // stamp literally would call every single healthy run a day stale — the same
    // local-vs-UTC off-by-one the gap report's own docstring names.
    const finishedAt = "2026-08-05T00:05:00Z"; // 18:05 CDMX on 2026-08-04
    const parsed = parseHeartbeat(
      heartbeatFileBody({ startedAt: finishedAt, finishedAt, exitCode: 0, lastStep: "complete" }),
    );
    expect(formatHeartbeatWarning(parsed, NOW)).toEqual([]);
  });

  it("A RUN RECORDED TODAY STAYS SILENT — the regression the future check could introduce", () => {
    // THE everyday healthy case, and the one this whole increment has been guarding
    // against getting wrong: the job runs at 18:00 CDMX and the TUI is opened at
    // 20:00 the SAME day. That run is already past the ceiling (which is yesterday),
    // so a "future" check measured against the ceiling instead of against today
    // would fire on the most normal event there is — cry-wolf, rebuilt.
    const tuiOpenedAt2000 = new Date("2026-08-06T02:00:00Z"); // 20:00 CDMX on 2026-08-05
    expect(tradingDayAsOf(tuiOpenedAt2000, REPORT_TIME_ZONE)).toBe("2026-08-05");
    expect(dueThrough(tuiOpenedAt2000)).toBe("2026-08-04"); // the ceiling is BEHIND the run
    expect(
      formatHeartbeatWarning(parseHeartbeat(ranOn("2026-08-05", 0, "complete")), tuiOpenedAt2000),
    ).toEqual([]);
  });

  it("never calls a job stale for not having run today", () => {
    // The ceiling is yesterday at every hour, so the day still in progress is never
    // held against the job — the same reason the gap report never names today.
    const lateToday = new Date("2026-08-06T05:59:00Z"); // 23:59 CDMX on 2026-08-05
    expect(dueThrough(lateToday)).toBe("2026-08-04");
    // A run earlier TODAY (2026-08-05) is ahead of the ceiling, so it is not stale
    // even one minute before CDMX midnight.
    expect(formatHeartbeatWarning(parseHeartbeat(ranOn("2026-08-05")), lateToday)).toEqual([]);
  });
});

describe("formatHeartbeatWarning — the six cases", () => {
  it("1. GREEN RUN: a clean run on the ceiling day says nothing", () => {
    expect(formatHeartbeatWarning(parseHeartbeat(ranOn(CEILING, 0, "complete")), NOW)).toEqual([]);
  });

  it("2. RED RUN: a non-zero exit speaks, naming the step and the code", () => {
    // The case the whole slice exists for: launchd recorded this exit code and
    // pushed it to nobody.
    expect(
      formatHeartbeatWarning(parseHeartbeat(ranOn(CEILING, 127, "resolve-tools")), NOW),
    ).toEqual([
      "Numisma: the daily price job FAILED on 2026-08-04 — exit 127 at step 'resolve-tools'. " +
        "Nothing pushed this to you; that is why it is here.",
    ]);
  });

  it("3. STALE RUN: a clean run that predates the ceiling speaks", () => {
    expect(formatHeartbeatWarning(parseHeartbeat(ranOn("2026-08-02")), NOW)).toEqual([
      "Numisma: the daily price job has not completed since 2026-08-02 — nothing recorded for 2026-08-04.",
    ]);
  });

  it("4. ABSENT FILE: says nothing at all", () => {
    // A machine that never hosted the job, or a fresh checkout, must not speak on
    // every startup. Safe because the gap report is the backstop: if the job has
    // genuinely stopped, the marks stop landing and IT speaks.
    expect(formatHeartbeatWarning(undefined, NOW)).toEqual([]);
    expect(parseHeartbeat(undefined)).toBeUndefined();
  });

  it("5. MALFORMED FILE: treated as absent, never a throw", () => {
    // The TUI startup path must not die on a bad breadcrumb.
    for (const bad of [
      "",
      "   ",
      "not json at all",
      "{",
      '{\n  "schemaVersion": 1,\n  "startedAt": "2026-08-04T00:0', // truncated mid-write
      "[]",
      "null",
      '{"schemaVersion": 1}',
      '{"schemaVersion": 1, "startedAt": "nope", "finishedAt": "nope", "exitCode": 0, "lastStep": "x"}',
      '{"schemaVersion": 1, "startedAt": "2026-08-04T00:00:00Z", "finishedAt": "2026-08-04T00:00:00Z", "exitCode": "zero", "lastStep": "x"}',
    ]) {
      expect(() => parseHeartbeat(bad)).not.toThrow();
      expect(parseHeartbeat(bad), `should be unreadable: ${JSON.stringify(bad)}`).toBeUndefined();
      expect(formatHeartbeatWarning(parseHeartbeat(bad), NOW)).toEqual([]);
    }
  });

  it("6. FUTURE-DATED FILE: speaks, because a breadcrumb it can see is impossible cannot be trusted", () => {
    // A heartbeat stamped ahead of the present is not a healthy run — a clock is
    // wrong, the file was hand-edited, or something wrote it that had no business
    // doing so. In every one of those cases the heartbeat's OTHER verdicts become
    // untrustworthy, including the staleness comparison. Staying quiet about it
    // would be guaranteeing correctness by inspection.
    expect(formatHeartbeatWarning(parseHeartbeat(ranOn("2027-01-01")), NOW)).toEqual([
      "Numisma: the daily price job's last run is dated 2027-01-01, ahead of today " +
        "(2026-08-05) — the machine clock or job-heartbeat.json is wrong, so nothing " +
        "else this breadcrumb says can be trusted.",
    ]);
  });

  it("6b. a FAILED future-dated run says BOTH things", () => {
    const lines = formatHeartbeatWarning(parseHeartbeat(ranOn("2027-01-01", 1, "spine")), NOW);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("FAILED on 2027-01-01 — exit 1 at step 'spine'");
    expect(lines[1]).toContain("ahead of today");
    // Never also "stale": a run ahead of today cannot be behind the ceiling.
    expect(lines.some((line) => line.includes("has not completed since"))).toBe(false);
  });

  it("says BOTH things when a run is stale and failed", () => {
    const lines = formatHeartbeatWarning(parseHeartbeat(ranOn("2026-08-01", 1, "commit")), NOW);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("FAILED");
    expect(lines[1]).toContain("has not completed since");
  });

  it("ignores a schemaVersion it does not understand rather than misreading it", () => {
    // #189's convention: the version is bumped only when the shape changes in a way
    // that breaks a reader. Refusing an unknown one is what makes that promise safe.
    expect(HEARTBEAT_SCHEMA_VERSION).toBe(1);
    const future = heartbeatFileBody({
      startedAt: "2026-08-01T00:00:00Z",
      finishedAt: "2026-08-01T00:05:00Z",
      exitCode: 1,
      lastStep: "spine",
      schemaVersion: 2,
    });
    expect(parseHeartbeat(future)).toBeUndefined();
    expect(formatHeartbeatWarning(parseHeartbeat(future), NOW)).toEqual([]);
  });
});

describe("parseHeartbeat — over the writer's exact bytes", () => {
  it("reads the shape the wrapper's printf emits", () => {
    const parsed = parseHeartbeat(
      heartbeatFileBody({
        startedAt: "2026-08-04T23:00:00Z",
        finishedAt: "2026-08-04T23:00:41Z",
        exitCode: 0,
        lastStep: "complete",
      }),
    );
    expect(parsed).toEqual({
      schemaVersion: 1,
      startedAt: "2026-08-04T23:00:00Z",
      finishedAt: "2026-08-04T23:00:41Z",
      exitCode: 0,
      lastStep: "complete",
    });
  });

  it("carries dates, a step name and an exit code — and nothing else", () => {
    // The privacy property, in the shape #189 established: an unknown key means a
    // field nobody classified, so the parse drops it rather than passing it on.
    const parsed = parseHeartbeat(
      '{"schemaVersion":1,"startedAt":"2026-08-04T00:00:00Z","finishedAt":"2026-08-04T00:01:00Z",' +
        '"exitCode":0,"lastStep":"complete","navUsd":12345.67}',
    );
    expect(Object.keys(parsed ?? {}).sort()).toEqual([
      "exitCode",
      "finishedAt",
      "lastStep",
      "schemaVersion",
      "startedAt",
    ]);
    expect(JSON.stringify(parsed)).not.toContain("12345");
  });
});

describe("loadHeartbeatLines — the IO shell", () => {
  it("names the file beside the gap report in the data dir", async () => {
    const { dataDir, paths } = await storeWithHeartbeat(undefined);
    expect(HEARTBEAT_FILENAME).toBe("job-heartbeat.json");
    expect(heartbeatPath(paths)).toBe(join(dataDir, "job-heartbeat.json"));
  });

  it("is silent when the file is absent", async () => {
    const { paths } = await storeWithHeartbeat(undefined);
    expect(await loadHeartbeatLines(paths, NOW)).toEqual([]);
  });

  it("speaks for a failed run recorded on disk", async () => {
    const { paths } = await storeWithHeartbeat(ranOn(CEILING, 127, "resolve-tools"));
    const lines = await loadHeartbeatLines(paths, NOW);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("exit 127");
  });

  it("is silent for a healthy run recorded on disk", async () => {
    const { paths } = await storeWithHeartbeat(ranOn(CEILING));
    expect(await loadHeartbeatLines(paths, NOW)).toEqual([]);
  });

  it("never throws on a truncated file — a half-written breadcrumb is not fatal", async () => {
    const { paths } = await storeWithHeartbeat('{\n  "schemaVersion": 1,\n  "started');
    await expect(loadHeartbeatLines(paths, NOW)).resolves.toEqual([]);
  });
});
