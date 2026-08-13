/**
 * Backfill shell (PRD #146 seam D, slice #149) — the SEPARATE, KEPT, IDEMPOTENT
 * command V4 asks for. Headless script, not a package: `main().then(...,
 * process.exit)`, so the importable half lives in `backfill-core.ts` exactly as the
 * daily push's does in `push-core.ts`.
 *
 *   pnpm --filter @numisma/web backfill                    # replay every anchor into the DB
 *   pnpm --filter @numisma/web backfill -- --fixture       # …and rewrite the replay fixture
 *   pnpm --filter @numisma/web backfill -- --fixture-only  # rewrite the fixture, no DB, no write
 *
 * From the repo root: `pnpm backfill`.
 *
 * IT TAKES NO DATE ARGUMENT EITHER, AND FOR A DIFFERENT REASON THAN THE PUSH DID.
 * The push is zero-argument because a flag on a nightly cron job is how a cron job
 * eventually writes the wrong date (V4). This command is zero-argument because it
 * enumerates the log's OWN anchored dates (V3) — there is no date for an operator
 * to supply and no calendar to walk. Both commands are therefore un-mis-runnable in
 * the same way, by different means.
 *
 * WHY IT IS SAFE TO RE-RUN, ALWAYS (R6): `ON CONFLICT (fund_id, as_of) DO UPDATE`.
 * A missed daily push punches no permanent hole — the next backfill refolds the
 * complete log and fills it. Re-running over an unchanged log leaves the same row
 * count with identical payloads and a later `pushed_at`, and nothing is ever
 * DELETEd (the writer credential cannot).
 */
import { Pool } from "pg";
import {
  parseBackfillArgs,
  runBackfillAndReport,
  writeAnchorFixture,
} from "./backfill-core.ts";
import { projectionPoolConfig } from "./projection-pool.ts";
import { RunReport } from "./unattended-report.ts";

/**
 * Runs the backfill and returns THE PROCESS'S EXIT CODE.
 *
 * ZERO ON A DISCARD, UNLIKE THE PUSH — deliberate, and the warrant is in
 * `runBackfillAndReport`'s docstring: this command's exit code is read by
 * `ops/price-feed/run-daily-fetch.sh`, which turns any non-zero into a heartbeat the
 * TUI renders as "the daily price job FAILED" on every startup until the sidecar is
 * edited. A standing fact must not permanently redden an errand channel. The discard
 * is REPORTED on stderr regardless, and a failed replay still exits 1 — it throws.
 *
 * The three lines that fold a verdict into prose and a code live in
 * `backfill-core.ts`, not here, so a test can assert their ORDER: this file is a
 * `main().then(..., process.exit)` script that importing would execute.
 */
async function main(): Promise<number> {
  // `argv.slice(2)` drops the node binary and this script's own path; the parser and
  // the reasoning behind its exact-match flag pairing live in `backfill-core.ts`,
  // where a test can reach them.
  const { writeFixture, fixtureOnly } = parseBackfillArgs(process.argv.slice(2));

  // `--fixture-only` needs no credential at all: it folds local disk and writes a
  // local file. Requiring the write URL for it would make regenerating the fixture
  // depend on having production write access, which is the opposite of the point.
  const connectionString = process.env.PROJECTION_WRITE_DATABASE_URL;
  if (!fixtureOnly && !connectionString) {
    throw new Error("PROJECTION_WRITE_DATABASE_URL is not set");
  }

  // `projectionPoolConfig`, never a bare `{ connectionString }`: this command runs
  // unattended under launchd, and a pool with no client-side query deadline wedged
  // the 2026-08-11 22:01 run for twenty hours when the laptop slept mid-backfill.
  // The full account, and why `query_timeout` is the only setting that covers it,
  // is in projection-pool.ts.
  const pool =
    fixtureOnly || !connectionString
      ? undefined
      : new Pool(projectionPoolConfig(connectionString));
  // The run's operator channel. Prose composes by kind; exit codes compose by policy;
  // a co-tenant kind that is prose-only never touches the second one. Both foldings
  // happen in `runBackfillAndReport`, which returns them separately.
  const channel = new RunReport();
  try {
    const { exitCode } = await runBackfillAndReport({
      pool,
      channel,
      emit: (line) => console.error(`[backfill] ${line}`),
      onAnchor: (anchor, index, total) => {
        console.log(
          `[backfill] ${String(index + 1).padStart(3)}/${total} ` +
            `asOf=${anchor.asOf} v${anchor.schemaVersion} ` +
            `nav=${anchor.report.totals.fundValueUsd.toFixed(2)} ` +
            `feedGap=${anchor.report.glance.feedGap.arrived}/${anchor.report.glance.feedGap.expected} ` +
            `reserveFloor=${anchor.report.glance.reserveTargetPct ?? "absent"} ` +
            `suppressed=[${anchor.report.glance.suppressed.join(",")}]` +
            `${anchor.written ? "" : " (not written)"}`,
        );
      },
      // The run's own output. It goes in the hook rather than after the call because
      // the channel is emitted LAST — a diagnostic is the final thing a run says, and
      // one printed mid-replay is a diagnostic positioned to abort one.
      onComplete: async (results) => {
        if (writeFixture) {
          console.log(`[backfill] fixture written: ${await writeAnchorFixture(results)}`);
        }
        const [first] = results;
        console.log(
          `[backfill] ${results.length} anchor(s) ` +
            `${pool ? "upserted" : "derived (no write)"}: ` +
            `${first?.asOf} … ${results[results.length - 1]?.asOf}`,
        );
      },
    });

    return exitCode;
  } finally {
    await pool?.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error("[backfill] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
