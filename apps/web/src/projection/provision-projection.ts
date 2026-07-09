/**
 * Provisioning CLI (ADR-007 / ADR-010) — the reproducible, idempotent
 * replacement for the hand-run `psql -v writer_role=... -f schema.sql` step.
 *
 *   pnpm --filter @numisma/web db:provision   # from repo root: pnpm db:provision
 *
 * Applies the DDL + the two-role grants through the node-postgres driver using
 * a ONE-SHOT ADMIN credential (PROJECTION_ADMIN_DATABASE_URL) — a superuser or
 * the table owner, used only at provisioning time and NOT held by any running
 * service. The runtime reader/writer creds (PROJECTION_DATABASE_URL /
 * PROJECTION_WRITE_DATABASE_URL) are unchanged and stay split-privilege.
 *
 * Role names come from PROJECTION_WRITER_ROLE / PROJECTION_READER_ROLE
 * (defaults: numisma_push / numisma_web). The writer + reader login roles must
 * already exist. Safe to run repeatedly — the second run is a no-op.
 */
import { Pool } from "pg";
import { provisionProjection, rolesFromEnv } from "./provision.ts";

async function main(): Promise<void> {
  const connectionString = process.env.PROJECTION_ADMIN_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "PROJECTION_ADMIN_DATABASE_URL is not set (one-shot admin/owner credential " +
        "used only for provisioning). See docs/projection-provisioning.md",
    );
  }

  const roles = rolesFromEnv();
  const pool = new Pool({ connectionString });
  try {
    await provisionProjection(pool, roles);
    console.log(
      `[provision] projection ready (table + ADR-007 grants) ` +
        `writer=${roles.writerRole} reader=${roles.readerRole}`,
    );
  } finally {
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(
      "[provision] failed:",
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  },
);
