/**
 * THE JOB HEARTBEAT — the one fact the durable log cannot contain.
 *
 * The gap report is a pure function of the log, deliberately: that is what lets it
 * be computed wherever it is asked, and what stops it depending on the thing whose
 * failure it detects. The price of that purity is exact — **a run that fired and
 * died leaves the same evidence as a machine that was switched off**, and a run
 * that fetched cleanly and then failed at a later step leaves no evidence at all.
 * `ops/price-feed/run-daily-fetch.sh` writes this breadcrumb from an `EXIT` trap
 * so those two cases stop looking identical.
 *
 * IT REPAIRS A GUARD THAT IS ALREADY INSTALLED AND ALREADY MUTE. The wrapper's
 * post-check ends in an `exit 1` to protect the durable log against a repeat of the
 * 17-day silent miss (#132). Measured: launchd RECORDS that exit code and
 * `launchctl print` will show it on request, but nothing is PUSHED — no
 * notification, no badge. So the guard is decorative today. This reader is what
 * converts an exit code shown to nobody into a line on a surface opened daily.
 *
 * ── THE VERDICT: THREE TRIGGERS, ONE CLOCK ────────────────────────────────────
 * It speaks when the last run exited NON-ZERO, when the last run that could actually
 * MARK (see the mark-window section below) predates the gap report's ceiling, or when
 * the last run is dated AFTER TODAY.
 *
 * The staleness ceiling is `dueThrough`, imported — **not a second staleness
 * number.** One window rule for the whole increment: a second, independently-derived
 * threshold would drift against the first the moment either one moved, and the
 * reader would start disagreeing with the report beside it.
 *
 * THE THIRD TRIGGER IS MEASURED AGAINST TODAY, NOT AGAINST THE CEILING, and the
 * difference is the whole care in it. The ceiling is YESTERDAY, so a job that ran at
 * 18:00 today and a TUI opened at 20:00 today describe the everyday healthy case —
 * a run already past the ceiling. Calling that "ahead of the window" would fire on
 * the most normal event there is, which is precisely the cry-wolf failure the floor
 * and the ceiling decisions were each chosen to avoid. Future means the run's CDMX
 * trading day is later than TODAY'S: one more comparison off the same clock read
 * and the same CDMX-day crediting, not a new rule.
 *
 * A breadcrumb dated ahead of the present is not a healthy run — a clock is wrong,
 * the file was hand-edited, or something wrote it that had no business doing so. In
 * every one of those cases the heartbeat's OTHER verdicts become untrustworthy,
 * including the staleness comparison. A reader that silently trusts a file it can
 * see is impossible is guaranteeing its correctness by inspection, which is the one
 * thing this increment exists to stop doing.
 *
 * ── SILENCE WHEN ABSENT, AND WHY THAT LOSES NOTHING ───────────────────────────
 * A TUI on a machine that never hosted the job — or a fresh checkout — must not
 * speak on every startup. That is the cry-wolf failure the floor and the ceiling
 * decisions each already rejected; this is the third place it would have appeared.
 * It is safe because the gap report is the backstop: if the job has genuinely
 * stopped, the marks stop landing and the gap report speaks.
 *
 * ── WHY STALENESS READS A DIFFERENT FIELD THAN THE OTHER TWO TRIGGERS ─────────
 * `RunAtLoad` (#185 S2) made the job fire on load as well as on the schedule, and a
 * load can happen at any hour — a 09:00 login is a perfectly ordinary one. Such a
 * run is PRE-MARK-TIME: it stores quotes, emits ZERO marks, and exits 0. Its
 * `finishedAt` is therefore evidence that the SCRIPT ran, and no evidence at all
 * that the DAY was marked.
 *
 * Read against `finishedAt`, staleness went silent in exactly the case it exists
 * for: machine off all evening (day lost), opened at 09:00 next morning, login run
 * exits 0 dated today — `ranOn < ceiling` false, `exitCode` 0, nothing said. The
 * lost day vanished from this channel.
 *
 * A boolean alone cannot fix that, and it is worth saying why, because the obvious
 * patch is wrong: this file holds ONE slot, so the login run OVERWRITES the evening
 * run's breadcrumb. Merely ignoring an out-of-window run for staleness leaves the
 * reader with no date at all — silent again in the same case. Refusing to ignore it
 * cries wolf every morning after a HEALTHY evening.
 *
 * So the writer carries the fact forward instead: `lastMarkWindowFinishedAt` is the
 * finish of the most recent IN-WINDOW run, re-emitted unchanged by runs that land
 * outside the window. Staleness reads that; `exitCode` and the future-date check
 * still read THIS run, so an out-of-window run that FAILS is never hidden.
 *
 * NOT FOLDED INTO `gap-report.json`. Two writers, two languages, two lifetimes —
 * one written by bash on every run, the other by a TypeScript CLI on demand. The
 * standup reads both files; that is cheaper than a shared format neither owner
 * fully controls. Following #189's convention rather than sharing its counter, this
 * file carries a `schemaVersion` OF ITS OWN.
 */
import { tradingDayAsOf } from "@numisma/engine";
import { REPORT_TIME_ZONE, dueThrough } from "./gap-report.js";

export const HEARTBEAT_FILENAME = "job-heartbeat.json";

/**
 * This file's OWN schema counter — #189's convention, not #189's number. An integer
 * starting at 1, serialized as the first key, bumped only on a change that would
 * break a reader (a removed or retyped field; adding one does not bump it). Two
 * sidecars with two writers and two lifetimes must not be coupled through a shared
 * version, so `gap-report.json` moves on its schedule and this moves on its own.
 *
 * A version this reader does not recognise is treated as UNREADABLE rather than
 * guessed at — refusing an unknown shape is what makes the bump rule safe to rely on.
 */
export const HEARTBEAT_SCHEMA_VERSION = 2;

/**
 * Versions this reader accepts. **A bump adds to this set rather than replacing it**,
 * because the file on disk is written by a script the operator installs BY HAND (the
 * LaunchAgent is a resolved copy — see docs/price-feed-ops.md), so a reader that only
 * ever accepted the newest version would go blind on every machine between a `git
 * pull` and a reinstall. Version 1 is the pre-#185 shape, before the mark window was
 * recorded; it is read as `markWindow: true`, which is exactly its old behavior.
 */
const READABLE_SCHEMA_VERSIONS: ReadonlySet<number> = new Set([1, 2]);

/** What the wrapper's `printf` records. Dates, a step name and an exit code. */
export interface JobHeartbeat {
  schemaVersion: number;
  /** ISO instant the run began. */
  startedAt: string;
  /** ISO instant the `EXIT` trap fired. */
  finishedAt: string;
  /** The run's exit status — 0, the step-1/post-check 1, or 127 for no node. */
  exitCode: number;
  /** How far the run got: `startup`, `resolve-tools`, `prices-fetch`, … */
  lastStep: string;
  /**
   * Whether THIS run landed at/after the mark time, i.e. whether it was even capable
   * of emitting marks. False for a `RunAtLoad` login/boot run before 18:00 CDMX.
   */
  markWindow: boolean;
  /**
   * The `finishedAt` of the most recent IN-WINDOW run — this run's own when
   * `markWindow`, otherwise carried forward unchanged from the previous breadcrumb.
   * `undefined` means no in-window run is on record at all, which is treated exactly
   * like an absent file: silence, with the gap report as the backstop.
   */
  lastMarkWindowFinishedAt?: string;
}

/**
 * An ISO INSTANT — a date AND a time AND a zone — not merely something `Date` will
 * parse. The distinction is load-bearing: `Date.parse("2026-08-05")` succeeds as UTC
 * midnight, and {@link formatHeartbeatWarning} then reads that through
 * `tradingDayAsOf(…, CDMX)`, which credits it to the PREVIOUS day and emits a false
 * "has not completed since" for a job that finished normally. The wrapper's `printf`
 * cannot emit that shape, so the reach is a hand-edited or foreign-written file —
 * the same case this module already reasons about for its future-dated trigger.
 */
function isIsoInstant(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

/**
 * Read the breadcrumb. **NEVER THROWS** — anything unreadable is `undefined`, which
 * the verdict treats exactly like an absent file.
 *
 * That is not defensive habit, it is the contract: this is written by a `printf`
 * from a trap that fires while the machine may be in the middle of failing, so a
 * truncated or half-written file is an ordinary outcome rather than an exceptional
 * one. The TUI startup path must not die on a bad breadcrumb. Every field is
 * validated and only the known ones are carried forward, so an unrecognised field
 * cannot ride along into a surface that promises dates and counts only.
 */
export function parseHeartbeat(raw: string | undefined): JobHeartbeat | undefined {
  if (raw === undefined) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return undefined;
  }
  const body = parsed as Record<string, unknown>;
  if (typeof body.schemaVersion !== "number" || !READABLE_SCHEMA_VERSIONS.has(body.schemaVersion)) {
    return undefined;
  }
  const { schemaVersion, startedAt, finishedAt, exitCode, lastStep } = body;
  if (
    !isIsoInstant(startedAt) ||
    !isIsoInstant(finishedAt) ||
    typeof exitCode !== "number" ||
    !Number.isInteger(exitCode) ||
    typeof lastStep !== "string" ||
    lastStep.length === 0
  ) {
    return undefined;
  }
  // ABSENT means version 1 — the shape written before the mark window existed, whose
  // every run was read as evidence of a marked day. Defaulting to `true` keeps that
  // file behaving exactly as it does today rather than making an installed wrapper
  // start warning the moment this reader ships ahead of it.
  const markWindow = body.markWindow === undefined ? true : body.markWindow;
  if (typeof markWindow !== "boolean") {
    return undefined;
  }
  const carried = body.lastMarkWindowFinishedAt;
  if (carried !== undefined && !isIsoInstant(carried)) {
    return undefined;
  }
  // TAKEN AS WRITTEN FOR v2, NEVER SYNTHESIZED. An earlier version derived this from
  // `finishedAt` whenever `markWindow` was true, on the reasoning that an in-window
  // run is its own last in-window run. THAT IS FALSE: being inside the window says
  // only that a run COULD have marked. A provider outage kills every fire at
  // `prices-fetch` — in-window, zero marks — and synthesizing here would credit those
  // failures as evidence the day was covered, re-creating the bug this field exists
  // to close even though the writer is careful not to stamp them. The writer decides;
  // the reader reports.
  //
  // A v1 file is the one exception, and it is a migration rather than a synthesis:
  // that shape predates the distinction and every v1 run was read as marking, so its
  // `finishedAt` keeps meaning what it always meant.
  const lastMarkWindowFinishedAt = carried ?? (schemaVersion === 1 ? finishedAt : undefined);
  // Rebuilt field by field, never spread: an unknown key is dropped here rather
  // than carried into a line the operator reads.
  return {
    schemaVersion,
    startedAt,
    finishedAt,
    exitCode,
    lastStep,
    markWindow,
    ...(lastMarkWindowFinishedAt === undefined ? {} : { lastMarkWindowFinishedAt }),
  };
}

/**
 * The verdict — three triggers. EMPTY MEANS HEALTHY, or unknown, which is
 * deliberately the same thing here (see the header on why silence is safe).
 *
 * Conditions are reported independently when more than one holds: a run that failed
 * AND has not run since is two distinct facts, and collapsing them would hide the
 * older one. The two DATE triggers are mutually exclusive by construction — the
 * ceiling is always a day behind today, so a run cannot be both ahead of today and
 * behind the ceiling.
 */
export function formatHeartbeatWarning(
  heartbeat: JobHeartbeat | undefined,
  now: Date,
): string[] {
  if (heartbeat === undefined) {
    return [];
  }
  const lines: string[] = [];
  // The run's CDMX trading day — the same calendar today and the ceiling are both
  // expressed in, so all three are comparable without a second timezone decision.
  const ranOn = tradingDayAsOf(new Date(heartbeat.finishedAt), REPORT_TIME_ZONE);
  const today = tradingDayAsOf(now, REPORT_TIME_ZONE);
  const ceiling = dueThrough(now);

  if (heartbeat.exitCode !== 0) {
    lines.push(
      `Numisma: the daily price job FAILED on ${ranOn} — exit ${heartbeat.exitCode} ` +
        `at step '${heartbeat.lastStep}'. Nothing pushed this to you; that is why it is here.`,
    );
  }
  // AGAINST TODAY, NOT AGAINST THE CEILING. The ceiling is yesterday, so a job that
  // ran at 18:00 today read by a TUI opened at 20:00 today is already past it —
  // the everyday healthy case, which must stay silent.
  if (ranOn > today) {
    lines.push(
      `Numisma: the daily price job's last run is dated ${ranOn}, ahead of today ` +
        `(${today}) — the machine clock or job-heartbeat.json is wrong, so nothing ` +
        `else this breadcrumb says can be trusted.`,
    );
  }
  // STALENESS READS THE LAST IN-WINDOW RUN, NOT THIS RUN. A pre-mark-time `RunAtLoad`
  // run emits no marks, so crediting its date here would answer "has the job marked
  // the day?" with the fact that a script executed. Undefined means no in-window run
  // is on record — silence, same as an absent file, with the gap report as backstop.
  if (heartbeat.lastMarkWindowFinishedAt !== undefined) {
    const markedOn = tradingDayAsOf(new Date(heartbeat.lastMarkWindowFinishedAt), REPORT_TIME_ZONE);
    if (markedOn < ceiling) {
      lines.push(
        `Numisma: the daily price job has not completed since ${markedOn} — ` +
          `nothing recorded for ${ceiling}.`,
      );
    }
  }
  return lines;
}
