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
  // Exact-match argv, so `--init-only` never also trips `--init`.
  const initOnly = process.argv.includes("--init-only");
  const doInit = initOnly || process.argv.includes("--init");

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
  const report = initOnly ? undefined : await loadCurrentReport();

  const pool = new Pool({ connectionString });
  try {
    if (doInit) {
      await initSchema(pool);
    }

    if (!report) {
      console.log("[push] --init-only: schema applied, no snapshot pushed");
      return;
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
