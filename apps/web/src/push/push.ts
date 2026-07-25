/**
 * Push shell (Deliverable C) — headless, price-feed-style script (NOT a package).
 *
 * Folds the REAL durable event log (`NUMISMA_DATA_DIR`) into a CompositionReport
 * and idempotently upserts it into the projection DB using the WRITE credential
 * (PROJECTION_WRITE_DATABASE_URL). There is no fixture path and no flag that
 * restores one: this command can only push real data. The
 * pure derivation and the actual upsert SQL live in `push-core.ts` (importable,
 * unit- and integration-tested); this file is just the argv + credential +
 * process-exit wiring around them, so importing `push-core.ts` never runs the
 * script.
 *
 *   pnpm --filter @numisma/web push            # fold the log, upsert the snapshot
 *   pnpm --filter @numisma/web push -- --init  # create table first, then upsert
 *   pnpm --filter @numisma/web db:init         # create table only (no upsert)
 *
 * From the repo root: `pnpm push` (and `pnpm db:init`).
 */
import { Pool } from "pg";
import { readSchemaDdl } from "../projection/provision.ts";
import { loadCurrentReport, upsertSnapshot } from "./push-core.ts";

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
  const doInit = process.argv.includes("--init");

  const connectionString = process.env.PROJECTION_WRITE_DATABASE_URL;
  if (!connectionString) {
    throw new Error("PROJECTION_WRITE_DATABASE_URL is not set");
  }

  // Fold BEFORE the Pool exists. A partial/corrupt log throws here, so the
  // process exits non-zero having opened no connection and written nothing —
  // including on the `--init` path. Do not move this below `new Pool(...)`.
  const report = await loadCurrentReport();

  const pool = new Pool({ connectionString });
  try {
    if (doInit) {
      await initSchema(pool);
    }

    const { fundId, asOf, schemaVersion } = await upsertSnapshot(pool, report);

    console.log(
      `[push] pushed snapshot fundId=${fundId} asOf=${asOf} schemaVersion=${schemaVersion}`,
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
