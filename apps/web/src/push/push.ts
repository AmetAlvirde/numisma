/**
 * Push shell (Deliverable C) — headless, price-feed-style script (NOT a package).
 *
 * Folds the REAL durable event log (`NUMISMA_DATA_DIR`) into a CompositionReport
 * and idempotently upserts it into the projection DB using the WRITE credential
 * (PROJECTION_WRITE_DATABASE_URL). There is no fixture path and no flag that
 * restores one: this command can only push real data. The
 * pure derivation, the actual upsert SQL and the argv parse all live in
 * `push-core.ts` (importable, unit- and integration-tested); this file is just the
 * credential + ordering + process-exit wiring around them, so importing
 * `push-core.ts` never runs the script.
 *
 *   pnpm --filter @numisma/web push                 # fold the log, upsert the snapshot
 *   pnpm --filter @numisma/web push -- --init       # create table first, then upsert
 *   pnpm --filter @numisma/web db:init              # create table ONLY (no fold, no upsert)
 *
 * From the repo root: `pnpm push` (and `pnpm db:init`).
 *
 * `db:init` runs `--init-only`, and that flag exists SPECIFICALLY so provisioning
 * does not depend on the durable log. `--init` and `--init-only` used to be the
 * same flag, which made the documented "create table only" behaviour a fiction:
 * every path folded `NUMISMA_DATA_DIR` first, so on a machine where the data dir
 * is not yet populated — or right after a Neon reset, which ADR-007 calls a
 * non-event because you just re-project — `pnpm db:init` threw ENOENT on
 * `genesis.json` and the `composition_snapshot` table was never created. That is
 * the one thing the command exists to do, and it failed on exactly the bootstrap
 * and recovery paths it is for.
 */
import { Pool } from "pg";
import { readSchemaDdl } from "../projection/provision.ts";
import {
  buildDcaForAnchor,
  buildGlanceForAnchor,
  loadCurrentFold,
  parsePushArgs,
  upsertSnapshot,
} from "./push-core.ts";

/**
 * Apply the DDL (composition_snapshot table) through the driver for one-command
 * local setup with the writer cred. schema.sql is DDL-only (grants live in
 * provision.ts and are applied by `db:provision`), so there is no marker to
 * split on and no chance of feeding psql meta-commands to the pg driver.
 */
async function initSchema(pool: Pool): Promise<void> {
  await pool.query(readSchemaDdl());
  console.log("[push] schema applied (composition_snapshot table)");
}

async function main(): Promise<void> {
  // `argv.slice(2)` drops the node binary and this script's own path; the parser and
  // the reasoning behind its exact-match flag pairing live in `push-core.ts`, where a
  // test can reach them.
  const { init: doInit, initOnly } = parsePushArgs(process.argv.slice(2));

  const connectionString = process.env.PROJECTION_WRITE_DATABASE_URL;
  if (!connectionString) {
    throw new Error("PROJECTION_WRITE_DATABASE_URL is not set");
  }

  // Fold BEFORE the Pool exists, on every path that WRITES. A partial/corrupt log
  // throws here, so the process exits non-zero having opened no connection and
  // written nothing. Do not move this below `new Pool(...)`.
  //
  // `--init-only` skips the fold entirely rather than ordering it later: the
  // invariant that matters is "a corrupt log never reaches the upsert", and DDL is
  // not an upsert. Provisioning must not need a durable log to exist at all — see
  // the header. `CREATE TABLE IF NOT EXISTS` makes re-running it harmless.
  //
  // The glance block is built here too, BEFORE the Pool, for the same reason: it
  // reads the preferences sidecar off local disk (the push's second privileged
  // input), and a disk failure must fail the process without having connected or
  // written. An ABSENT floor is not a failure — it is R1's answer, carried onto the
  // wire as an absent `reserveTargetPct`.
  //
  // The DCA block joins them on the same side of the Pool and for the third time the
  // same reason: it reads the plans sidecar off local disk. An UNREADABLE sidecar is
  // not a failure either — it is carried onto the wire as `source: "unreadable"`, the
  // one answer an empty branch could never give.
  const fold = initOnly ? undefined : await loadCurrentFold();
  const glance = fold ? await buildGlanceForAnchor(fold) : undefined;
  const dca = fold ? await buildDcaForAnchor(fold) : undefined;

  const pool = new Pool({ connectionString });
  try {
    if (doInit) {
      await initSchema(pool);
    }

    if (!fold || !glance || !dca) {
      console.log("[push] --init-only: schema applied, no snapshot pushed");
      return;
    }

    const { fundId, asOf, schemaVersion } = await upsertSnapshot(
      pool,
      fold.report,
      glance,
      dca,
    );

    console.log(
      `[push] pushed snapshot fundId=${fundId} asOf=${asOf} schemaVersion=${schemaVersion} ` +
        `feedGap=${glance.feedGap.arrived}/${glance.feedGap.expected} ` +
        `reserveFloor=${glance.reserveTargetPct ?? "absent"} ` +
        `suppressed=[${glance.suppressed.join(",")}] ` +
        `dca=${dca.source}/${dca.positions.length}`,
    );
  } finally {
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error("[push] failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
