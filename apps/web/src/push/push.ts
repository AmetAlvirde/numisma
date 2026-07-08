/**
 * Push shell (Deliverable C) — headless, price-feed-style script (NOT a package).
 *
 * Loads the fixture CompositionReport and idempotently upserts it into the
 * projection DB using the WRITE credential (PROJECTION_WRITE_DATABASE_URL).
 * Shares the schema version + fund-id derivation with the web reader via the
 * projection contract, so writer and reader can never disagree.
 *
 *   pnpm --filter @numisma/web push            # upsert the fixture snapshot
 *   pnpm --filter @numisma/web push -- --init  # create table first, then upsert
 *   pnpm --filter @numisma/web db:init         # create table only (no upsert)
 *
 * From the repo root: `pnpm push` (and `pnpm db:init`).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import type { CompositionReport } from "@numisma/engine";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  fundIdOf,
} from "../projection/contract.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  HERE,
  "../../fixtures/composition-report.fixture.json",
);
const SCHEMA_PATH = resolve(HERE, "../projection/schema.sql");
const GRANTS_MARKER = "-- >>> GRANTS";

async function loadFixture(): Promise<CompositionReport> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as CompositionReport;
}

/**
 * Run the plain-SQL (pre-GRANTS) half of schema.sql through the driver. The
 * grants half is psql-only (see schema.sql) and is intentionally skipped here.
 */
async function initSchema(pool: Pool): Promise<void> {
  const sql = await readFile(SCHEMA_PATH, "utf-8");
  const markerAt = sql.indexOf(GRANTS_MARKER);
  const ddl = markerAt === -1 ? sql : sql.slice(0, markerAt);
  await pool.query(ddl);
  console.log("[push] schema applied (composition_snapshot table)");
}

async function main(): Promise<void> {
  const doInit = process.argv.includes("--init");

  const connectionString = process.env.PROJECTION_WRITE_DATABASE_URL;
  if (!connectionString) {
    throw new Error("PROJECTION_WRITE_DATABASE_URL is not set");
  }

  const report = await loadFixture();
  const fundId = fundIdOf(report);
  const asOf = report.dashboard.summary.asOf;
  const schemaVersion = COMPOSITION_SNAPSHOT_SCHEMA_VERSION;

  const pool = new Pool({ connectionString });
  try {
    if (doInit) {
      await initSchema(pool);
    }

    await pool.query(
      `INSERT INTO composition_snapshot (fund_id, as_of, schema_version, report)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (fund_id, as_of)
       DO UPDATE SET report = EXCLUDED.report,
                     schema_version = EXCLUDED.schema_version,
                     pushed_at = now()`,
      [fundId, asOf, schemaVersion, JSON.stringify(report)],
    );

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
