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
 * It speaks when the last run exited NON-ZERO, when the last run PREDATES the gap
 * report's ceiling, or when the last run is dated AFTER TODAY.
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
export const HEARTBEAT_SCHEMA_VERSION = 1;

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
  if (body.schemaVersion !== HEARTBEAT_SCHEMA_VERSION) {
    return undefined;
  }
  const { startedAt, finishedAt, exitCode, lastStep } = body;
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
  // Rebuilt field by field, never spread: an unknown key is dropped here rather
  // than carried into a line the operator reads.
  return { schemaVersion: HEARTBEAT_SCHEMA_VERSION, startedAt, finishedAt, exitCode, lastStep };
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
  if (ranOn < ceiling) {
    lines.push(
      `Numisma: the daily price job has not completed since ${ranOn} — ` +
        `nothing recorded for ${ceiling}.`,
    );
  }
  return lines;
}
