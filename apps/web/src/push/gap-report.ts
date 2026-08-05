/**
 * The gap-report SHELL — a self-executing `main().then(..., process.exit)` script,
 * split from the importable `gap-report-core.ts` for the same reason `push.ts` is
 * split from `push-core.ts`: importing this file would run it.
 *
 *   pnpm gap-report                          # print the report
 *   pnpm gap-report -- --since 2026-06-26    # override the calendar floor
 *   pnpm gap-report -- --until 2026-08-04    # override the ceiling
 *   pnpm gap-report -- --write               # …and write gap-report.json beside the log
 *
 * THE EXIT CONTRACT LIVES HERE, IN ONE PLACE. Everything that can go wrong —
 * a malformed flag, an out-of-bounds window, a derivation that threw, a `--write`
 * that could not write — reaches this file as a REJECTION and becomes exit 1.
 * A successful run is exit 0 EVEN WHEN DAYS ARE LOST: a lost day is permanent, so
 * failing on one would mean a permanently red job, and a permanently red job is one
 * nobody reads. *A lost day is reported; a broken job is failed.* The reasoning,
 * and the tests that hold it, are in `gap-report-core.ts`.
 *
 * NO ENVIRONMENT REQUIRED — no data-dir variable, no projection database URL, no
 * credential. See the core's header for why that property is load-bearing.
 *
 * `argv.slice(2)` drops the node binary and this script's own path; everything
 * after them is the user's, and an unrecognized token is an error rather than a
 * shrug.
 */
import { runGapReport } from "./gap-report-core.ts";

runGapReport({ argv: process.argv.slice(2), now: new Date() }).then(
  (run) => {
    for (const line of run.lines) {
      console.log(line);
    }
    process.exit(run.exitCode);
  },
  (error: unknown) => {
    console.error("[gap-report] failed:", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
