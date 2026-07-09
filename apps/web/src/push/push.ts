/**
 * Push shell (Deliverable C) — headless, price-feed-style script (NOT a package).
 *
 * Loads the fixture CompositionReport and idempotently upserts it into the
 * projection DB using the WRITE credential (PROJECTION_WRITE_DATABASE_URL). The
 * pure derivation and the actual upsert SQL live in `push-core.ts` (importable,
 * unit- and integration-tested); this file is just the argv + credential +
 * process-exit wiring around them, so importing `push-core.ts` never runs the
 * script.
 *
 *   pnpm --filter @numisma/web push            # upsert the fixture snapshot
 *   pnpm --filter @numisma/web push -- --init  # create table first, then upsert
 *   pnpm --filter @numisma/web db:init         # create table only (no upsert)
 *
 * From the repo root: `pnpm push` (and `pnpm db:init`).
 */
import { Pool } from "pg";
import { readSchemaDdl } from "../projection/provision.ts";
import { loadFixture, upsertSnapshot } from "./push-core.ts";

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

  const report = await loadFixture();

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
