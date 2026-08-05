/**
 * The gap-report COMMAND — argument validation, orchestration and rendering, split
 * from the self-executing `gap-report.ts` for the same reason `push-core.ts` is
 * split from `push.ts`: importing the shell would run it, and a command with no
 * importable core has no test surface. This file is that surface; the CLI had none
 * before.
 *
 *   pnpm gap-report                          # print the report
 *   pnpm gap-report -- --since 2026-06-26    # override the calendar floor
 *   pnpm gap-report -- --until 2026-08-04    # override the ceiling
 *   pnpm gap-report -- --write               # …and write gap-report.json beside the log
 *
 * ── WHY THE ARGUMENT CHECKING IS NOT BOILERPLATE ──────────────────────────────
 * One input matters more than all the others: `--since 2026-02-30`. It satisfies
 * `\d{4}-\d{2}-\d{2}` and it is not a date. Handed to `Date` it rolls silently to
 * March 2, and the report then answers a question nobody asked IN THE SAME SHAPE
 * AS A CORRECT ANSWER. **A detector whose entire value is trust cannot have a
 * failure mode that looks like success**, so {@link requireCalendarDate} validates
 * the CALENDAR, not merely the shape — it round-trips the parsed date and rejects
 * anything that did not survive.
 *
 * The same principle governs the rest: a flag consumed as a value (`--since
 * --write`), a trailing `--until` with nothing after it, and an unrecognized
 * argument all STOP. Each of them, ignored, produces a differently-scoped report
 * that still looks right.
 *
 * ── THE EXIT CONTRACT (what the deferred wrapper step will bind to) ────────────
 * **Non-zero on any failure to PRODUCE or PERSIST the report** — a malformed flag,
 * an out-of-bounds window, a derivation that threw, a `--write` that could not
 * write. Everything in this module signals those by THROWING; `gap-report.ts` maps
 * a rejection to exit 1. There is exactly one place the exit code is decided.
 *
 * **Exit 0 when days are lost.** Deliberate, and not to be tightened casually: a
 * lost day is permanent — unmarkable after CDMX midnight — so gating the job's exit
 * on it means a permanently red job, and a permanently red job is one nobody reads.
 * *A lost day is reported; a broken job is failed.* {@link GapReportRun.exitCode}
 * exists so that contract is asserted by a test rather than implied by the absence
 * of code.
 *
 * ── IT NEEDS NO ENVIRONMENT ───────────────────────────────────────────────────
 * No data-dir variable, no projection database URL, no credential. Unlike `push` /
 * `backfill` this touches no database: it is a pure read of `events.jsonl` through
 * the pure derivation in `@numisma/event-store`. That is the property that lets the
 * report be run from anywhere, by anyone, at any time — INCLUDING WHEN THE
 * PROJECTION IS EXACTLY WHAT IS BROKEN. The detector must not depend on the thing
 * whose failure it detects, so it reaches no driver at all, and a test asserts that
 * structurally rather than trusting it to stay true.
 */
import {
  formatGapReport,
  formatGapSummary,
  gapReportPath,
  loadGapReport,
  resolveDataDirDefault,
  resolveEventStorePaths,
  writeGapReportFile,
  type EventStorePaths,
  type GapReport,
} from "@numisma/event-store";

/**
 * The widest window the command will report on, in calendar days (a bit over a
 * year). The CEILING is already pinned to yesterday by `computeGapReport` — which
 * clamps rather than defaults, so no `--until` can push it forward — but nothing
 * bounds how far back a `--since` may reach, and `--since 1970-01-01` would print
 * one line per calendar day for twenty thousand of them. A report nobody can read
 * is a report nobody reads.
 */
export const MAX_WINDOW_DAYS = 400;

export interface GapReportArgs {
  since: string | undefined;
  until: string | undefined;
  write: boolean;
}

const DATE_FLAGS = ["--since", "--until"] as const;

/**
 * Strict `YYYY-MM-DD`, AND a date the calendar actually has.
 *
 * The round-trip is the whole point: `2026-02-30` matches the pattern, and
 * `Date.UTC(2026, 1, 30)` happily yields 2026-03-02. Comparing the normalized
 * result back against the input is what turns a silent roll-forward into an error.
 */
function requireCalendarDate(flag: string, value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    throw new Error(
      `gap-report: ${flag} ${JSON.stringify(value)} is not a strict YYYY-MM-DD date.`,
    );
  }
  const [, year, month, day] = match;
  const normalized = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
    .toISOString()
    .slice(0, 10);
  if (normalized !== value) {
    throw new Error(
      `gap-report: ${flag} ${value} is not a real calendar date ` +
        `(it would roll forward to ${normalized}). Refusing rather than reporting on a ` +
        `window you did not ask for.`,
    );
  }
  return value;
}

/**
 * Parse argv into the command's three inputs, rejecting everything else. Throws on
 * any malformed input — the exit contract's "non-zero on a malformed flag".
 */
export function parseGapReportArgs(argv: readonly string[]): GapReportArgs {
  const args: GapReportArgs = { since: undefined, until: undefined, write: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    // `pnpm gap-report -- --since X` forwards the literal `--` into argv. It is a
    // separator, not an argument, and dropping it is what makes the DOCUMENTED
    // invocation work against a parser strict enough to reject typos.
    if (token === "--") {
      continue;
    }
    if (token === "--write") {
      args.write = true;
      continue;
    }
    const dateFlag = DATE_FLAGS.find((flag) => flag === token);
    if (dateFlag === undefined) {
      throw new Error(
        `gap-report: unrecognized argument ${JSON.stringify(token)}. ` +
          `Expected --since <YYYY-MM-DD>, --until <YYYY-MM-DD> or --write.`,
      );
    }
    const value = argv[index + 1];
    // A missing value and a FLAG-as-value are the same defect — the next token is
    // not a date — and both are caught here rather than inside date arithmetic,
    // where the message would be about a date the user never typed.
    if (value === undefined || value.startsWith("--")) {
      const got = value === undefined ? "nothing followed it" : `got the flag '${value}'`;
      throw new Error(`gap-report: ${dateFlag} expects a date (YYYY-MM-DD); ${got}.`);
    }
    const parsed = requireCalendarDate(dateFlag, value);
    // A REPEATED flag is the same defect class as the three above: `--since A
    // --since B` silently last-wins, and the report that comes back is scoped to a
    // window the operator did not intend but cannot tell apart from the one they
    // did. Refusing costs nothing; the alternative is a right-looking answer.
    const existing = dateFlag === "--since" ? args.since : args.until;
    if (existing !== undefined) {
      throw new Error(
        `gap-report: ${dateFlag} given twice (${existing} and ${parsed}). ` +
          `Refusing rather than silently using the last one.`,
      );
    }
    if (dateFlag === "--since") {
      args.since = parsed;
    } else {
      args.until = parsed;
    }
    index += 1;
  }
  return args;
}

/** The store this command reads, honoring `NUMISMA_DATA_DIR` when it is set. */
export function resolveGapReportPaths(): EventStorePaths {
  return resolveEventStorePaths(resolveDataDirDefault());
}

export interface GapReportRunOptions {
  argv: readonly string[];
  /** The instant "yesterday" is measured from. Injected so the run is testable. */
  now: Date;
  /** The resolved store. Defaults to {@link resolveGapReportPaths}. */
  paths?: EventStorePaths | undefined;
  /**
   * Persistence. Defaults to writing `gap-report.json` beside the log in `paths`
   * — the standup's one well-known file. Injectable so the failure path (a write
   * that throws must exit non-zero) is testable without breaking a disk.
   */
  writeReport?: ((report: GapReport) => Promise<string>) | undefined;
}

export interface GapReportRun {
  /** Exactly what the command prints, in order. */
  lines: string[];
  report: GapReport;
  /**
   * ALWAYS 0 on a successful run — including a run that found lost days. Failures
   * throw instead. The field exists so the "exit 0 when days are lost" contract is
   * something a test asserts, not something the absence of code implies.
   */
  exitCode: 0;
}

/**
 * Parse, derive, render. Throws on every failure to produce or persist the report;
 * resolves with `exitCode: 0` otherwise, lost days or not.
 */
export async function runGapReport(options: GapReportRunOptions): Promise<GapReportRun> {
  const args = parseGapReportArgs(options.argv);
  const paths = options.paths ?? resolveGapReportPaths();

  const report = await loadGapReport(paths, {
    since: args.since,
    until: args.until,
    now: options.now,
  });

  // Bounded AFTER deriving, deliberately: `report.until` is the effective ceiling
  // the derivation already clamped, so this reads the real window instead of
  // re-deriving — and re-deriving the clamp here is exactly how the two would
  // drift. The derivation is a linear walk; it is the PRINTING that must be bounded.
  // DIRECTION BEFORE WIDTH. `--since 2026-08-05` is a real calendar date that the
  // ceiling clamp then pulls `until` BEHIND, and the derivation's walk over an
  // inverted window is empty by construction: zero days, zero lost, a confident
  // all-clear — the failure mode that looks like success this whole command exists
  // to refuse. With `--write` that all-clear overwrites the standup's file.
  //
  // It belongs to the COMMAND, not to `computeGapReport`: the derivation is a pure
  // function whose empty-on-inverted result is deliberate and tested. Read here off
  // the POST-CLAMP window, for the same reason the width check is.
  if (report.since > report.until) {
    throw new Error(
      `gap-report: --since ${report.since} is after the effective ceiling ` +
        `${report.until}, so the window is empty. An empty window reports no lost ` +
        `days no matter what the log holds; refusing rather than printing an ` +
        `all-clear nobody asked for.`,
    );
  }

  if (report.calendarDays > MAX_WINDOW_DAYS) {
    throw new Error(
      `gap-report: the window ${report.since}…${report.until} spans ` +
        `${report.calendarDays} days, over the ${MAX_WINDOW_DAYS}-day maximum. ` +
        `Narrow it with --since.`,
    );
  }

  const lines = formatGapReport(report).map((line) => `[gap-report] ${line}`);
  lines.push(`[gap-report] ${formatGapSummary(report)}`);

  if (args.write) {
    // The file lands beside the log in the store this run actually read, so a
    // `NUMISMA_DATA_DIR` the caller honoured is honoured here too. A write that
    // throws propagates: failing to PERSIST the report is failing to produce it,
    // and #188's contract makes that a non-zero exit.
    const write =
      options.writeReport ??
      ((written: GapReport) =>
        writeGapReportFile(written, { path: gapReportPath(paths), now: options.now }));
    lines.push(`[gap-report] written: ${await write(report)}`);
  }

  return { lines, report, exitCode: 0 };
}
