/**
 * The job heartbeat's reader, and — since #185 S2 — the writer it must agree with.
 *
 * The writer is a trap and a `printf` in `ops/price-feed/run-daily-fetch.sh`. #191
 * could only approach it indirectly: the fixtures below are written in the EXACT
 * byte shape that `printf` emits rather than a shape convenient for the parser, so
 * that a drift between the two would show up here.
 *
 * That is no longer the only defence. Adding `markWindow` (#185 S2) meant editing
 * BOTH halves at once, which is precisely when they drift — so the last describe in
 * this file now RUNS the wrapper and feeds its real output to `parseHeartbeat`. The
 * fixtures still earn their place: they reach the dates and exit codes a live run
 * cannot be made to produce on demand.
 *
 * Dates, step names and exit codes only. No figures of any kind — the same privacy
 * property `gap-report.json` carries, for the same reason.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
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
  /** Omitted ⇒ the v1 shape, which the reader must go on treating as in-window. */
  markWindow?: boolean;
  lastMarkWindowFinishedAt?: string;
}): string {
  return (
    `{\n` +
    `  "schemaVersion": ${fields.schemaVersion ?? 1},\n` +
    `  "startedAt": "${fields.startedAt}",\n` +
    `  "finishedAt": "${fields.finishedAt}",\n` +
    `  "exitCode": ${fields.exitCode},\n` +
    `  "lastStep": "${fields.lastStep}"` +
    (fields.markWindow === undefined ? `` : `,\n  "markWindow": ${fields.markWindow}`) +
    (fields.lastMarkWindowFinishedAt === undefined
      ? ``
      : `,\n  "lastMarkWindowFinishedAt": "${fields.lastMarkWindowFinishedAt}"`) +
    `\n}\n`
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
    expect(HEARTBEAT_SCHEMA_VERSION).toBe(2);
    const future = heartbeatFileBody({
      startedAt: "2026-08-01T00:00:00Z",
      finishedAt: "2026-08-01T00:05:00Z",
      exitCode: 1,
      lastStep: "spine",
      schemaVersion: 3,
    });
    expect(parseHeartbeat(future)).toBeUndefined();
    expect(formatHeartbeatWarning(parseHeartbeat(future), NOW)).toEqual([]);
  });
});

/**
 * `RunAtLoad` (#185 S2) lets the job fire at ANY hour, and a pre-mark-time run emits
 * zero marks while exiting 0. Read naively, that healthy-looking breadcrumb silences
 * the one trigger that reports a lost day.
 */
describe("a run outside the mark window is not evidence that the day was marked", () => {
  /** A `RunAtLoad` run at 09:00 CDMX on `day` — before the 18:00 mark time. */
  function loginRunOn(
    day: string,
    options: { exitCode?: number; lastStep?: string; carried?: string } = {},
  ): string {
    return heartbeatFileBody({
      schemaVersion: 2,
      startedAt: `${day}T15:00:00Z`, // 09:00 CDMX on `day`
      finishedAt: `${day}T15:02:00Z`, // 09:02 CDMX on `day`
      exitCode: options.exitCode ?? 0,
      lastStep: options.lastStep ?? "complete",
      markWindow: false,
      ...(options.carried === undefined ? {} : { lastMarkWindowFinishedAt: options.carried }),
    });
  }

  it("STILL REPORTS THE LOST DAY after a clean login run — the #185 S2 regression", () => {
    // Machine off through the evening of 2026-08-04 (the ceiling), opened 09:00 the
    // next morning: the LaunchAgent loads, RunAtLoad fires, 0 marks, exit 0. Before
    // this fix that run's own date satisfied the staleness check and 08-04 vanished
    // from this channel entirely. The carried date is the last real evening, 08-03.
    const lines = formatHeartbeatWarning(
      parseHeartbeat(loginRunOn("2026-08-05", { carried: "2026-08-04T00:05:00Z" })),
      NOW,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("has not completed since 2026-08-03");
    expect(lines[0]).toContain(`nothing recorded for ${CEILING}`);
  });

  it("stays silent when the evening before it DID mark — no cry-wolf on a healthy morning", () => {
    // Same login run, but 2026-08-04 was marked at 18:05 CDMX (stamped 08-05T00:05Z).
    // The out-of-window run must not manufacture a warning either.
    expect(
      formatHeartbeatWarning(
        parseHeartbeat(loginRunOn("2026-08-05", { carried: "2026-08-05T00:05:00Z" })),
        NOW,
      ),
    ).toEqual([]);
  });

  it("still surfaces a FAILED login run — the exit code is about this run, not the window", () => {
    // Out-of-window only disqualifies a run as evidence of MARKING. A run that died
    // at exit 127 with no node still has to reach the operator.
    const lines = formatHeartbeatWarning(
      parseHeartbeat(
        loginRunOn("2026-08-05", {
          exitCode: 127,
          lastStep: "resolve-tools",
          carried: "2026-08-05T00:05:00Z",
        }),
      ),
      NOW,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("FAILED");
    expect(lines[0]).toContain("exit 127");
    expect(lines[0]).toContain("resolve-tools");
  });

  it("says nothing about staleness when no in-window run is on record at all", () => {
    // First ever load on a fresh machine: no evening has happened yet, so there is
    // no date to be stale against. Silence, exactly as for an absent file — the gap
    // report is the backstop.
    const parsed = parseHeartbeat(loginRunOn("2026-08-05"));
    expect(parsed?.lastMarkWindowFinishedAt).toBeUndefined();
    expect(formatHeartbeatWarning(parsed, NOW)).toEqual([]);
  });

  it("reads a v1 file exactly as it did before, so an un-reinstalled wrapper is not broken", () => {
    // The installed LaunchAgent/wrapper is a hand-resolved copy, so this reader will
    // ship ahead of it. A v1 breadcrumb must keep behaving, not start crying.
    expect(formatHeartbeatWarning(parseHeartbeat(ranOn(CEILING)), NOW)).toEqual([]);
    expect(formatHeartbeatWarning(parseHeartbeat(ranOn("2026-08-03")), NOW)).toHaveLength(1);
  });

  it("refuses a markWindow that is not a boolean rather than coercing it", () => {
    expect(
      parseHeartbeat(
        '{"schemaVersion":2,"startedAt":"2026-08-04T00:00:00Z","finishedAt":"2026-08-04T00:01:00Z",' +
          '"exitCode":0,"lastStep":"complete","markWindow":"yes"}',
      ),
    ).toBeUndefined();
  });
});

/**
 * THE ONE SEAM THE FIXTURES ABOVE CANNOT COVER. Every other test in this file feeds
 * the reader bytes a TEST wrote in the shape the wrapper is BELIEVED to emit. The
 * failure mode that costs a real day is the two drifting apart — a `printf` edited
 * without the parser, or the reverse — and a hand-written fixture agrees with
 * whichever side wrote it.
 *
 * So run the actual script. It is pointed at a nonexistent repo so it dies at the
 * `cd` in well under a second, which is enough: the heartbeat is written from an
 * EXIT trap installed before anything else, and a failing run is the case the
 * breadcrumb exists for.
 */
describe("the wrapper's own bytes, read by the reader that must consume them", () => {
  const wrapper = fileURLToPath(
    new URL("../../../ops/price-feed/run-daily-fetch.sh", import.meta.url),
  );

  /** Run the wrapper against a throwaway data dir and return the breadcrumb it left. */
  async function runWrapper(): Promise<string> {
    const dataDir = await mkdtemp(join(tmpdir(), "numisma-heartbeat-wrapper-"));
    created.push(dataDir);
    try {
      execFileSync("/bin/bash", [wrapper], {
        env: {
          ...process.env,
          NUMISMA_DATA_DIR: dataDir,
          NUMISMA_REPO_DIR: join(dataDir, "no-such-repo"),
          NUMISMA_PRICEFEED_ENV: join(dataDir, "no-such-env"),
          NUMISMA_PRICEFEED_LOG_DIR: join(dataDir, "logs"),
        },
        stdio: "ignore",
      });
    } catch {
      // EXPECTED: there is no repo to `cd` into, so the run dies early and non-zero.
      // That is the case the breadcrumb exists for, and the trap still fires.
    }
    return readFile(join(dataDir, "job-heartbeat.json"), "utf8");
  }

  it("writes a heartbeat parseHeartbeat accepts, at the version this reader expects", async () => {
    const parsed = parseHeartbeat(await runWrapper());
    // Unparseable here means the printf and the parser have drifted — the exact
    // break that would silently blind this channel in production.
    expect(parsed).toBeDefined();
    expect(parsed?.schemaVersion).toBe(HEARTBEAT_SCHEMA_VERSION);
    expect(parsed?.lastStep).toBe("startup");
    expect(parsed?.exitCode).not.toBe(0);
    // Asserted as a TYPE, not a value: which branch it takes depends on the wall
    // clock, and pinning that would make this test pass or fail by time of day.
    expect(typeof parsed?.markWindow).toBe("boolean");
  });

  it("emits no lastMarkWindowFinishedAt at all when there is none to carry", async () => {
    // Written EMPTY it would fail the ISO-instant check and take the whole file
    // down as unreadable — losing the exit code too, on a first-ever failing run.
    const raw = await runWrapper();
    const parsed = parseHeartbeat(raw);
    expect(parsed).toBeDefined();
    if (!raw.includes("lastMarkWindowFinishedAt")) {
      expect(parsed?.lastMarkWindowFinishedAt).toBeUndefined();
    }
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
      // A v1 file predates the mark window, so it is read the way it always was:
      // the run counts as in-window and is its own last in-window run.
      markWindow: true,
      lastMarkWindowFinishedAt: "2026-08-04T23:00:41Z",
    });
  });

  it("rejects a date-only finishedAt, which Date.parse would accept as UTC midnight", () => {
    // `"2026-08-05"` parses; read through tradingDayAsOf in CDMX it lands on
    // 2026-08-04, so a job that completed normally would be reported as not having
    // completed since the day before. Unreadable is the honest answer, and the
    // reader treats it exactly like an absent file.
    expect(
      parseHeartbeat(
        heartbeatFileBody({
          startedAt: "2026-08-04",
          finishedAt: "2026-08-05",
          exitCode: 0,
          lastStep: "complete",
        }),
      ),
    ).toBeUndefined();
    // Nor a bare time, nor an instant with no zone at all.
    expect(
      parseHeartbeat(
        heartbeatFileBody({
          startedAt: "2026-08-04T23:00:00Z",
          finishedAt: "2026-08-04T23:00:41",
          exitCode: 0,
          lastStep: "complete",
        }),
      ),
    ).toBeUndefined();
  });

  it("accepts the offset and fractional-second forms an ISO instant may take", () => {
    // The tightening is to the WRITTEN CONTRACT — an ISO instant — not to the one
    // wrapper's exact bytes. A conforming writer must not be refused.
    for (const finishedAt of ["2026-08-04T23:00:41.250Z", "2026-08-04T17:00:41-06:00"]) {
      expect(
        parseHeartbeat(
          heartbeatFileBody({
            startedAt: "2026-08-04T23:00:00Z",
            finishedAt,
            exitCode: 0,
            lastStep: "complete",
          }),
        )?.finishedAt,
      ).toBe(finishedAt);
    }
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
      "lastMarkWindowFinishedAt",
      "lastStep",
      "markWindow",
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
