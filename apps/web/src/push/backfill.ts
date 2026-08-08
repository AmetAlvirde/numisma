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
  runBackfill,
  writeAnchorFixture,
} from "./backfill-core.ts";

async function main(): Promise<void> {
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

  const pool =
    fixtureOnly || !connectionString ? undefined : new Pool({ connectionString });
  try {
    const results = await runBackfill({
      pool,
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
    });

    if (writeFixture) {
      console.log(`[backfill] fixture written: ${await writeAnchorFixture(results)}`);
    }

    const [first] = results;
    console.log(
      `[backfill] ${results.length} anchor(s) ` +
        `${pool ? "upserted" : "derived (no write)"}: ` +
        `${first?.asOf} … ${results[results.length - 1]?.asOf}`,
    );
  } finally {
    await pool?.end();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("[backfill] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
