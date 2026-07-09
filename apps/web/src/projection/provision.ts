/**
 * Projection provisioning (ADR-007 / ADR-010) — reproducible & idempotent.
 *
 * Replaces the hand-run, undocumented `psql -v` step. The projection table
 * (DDL, from schema.sql) AND the two-role grants (writer append-only, reader
 * SELECT-only) are applied through the node-postgres driver, from configured
 * role names, in one re-runnable step. Running it twice is a no-op the second
 * time: `CREATE TABLE IF NOT EXISTS` plus `GRANT`/`REVOKE` (which Postgres
 * treats idempotently).
 *
 * Role names arrive as config, not as user input, but they are still validated
 * against a strict identifier grammar before being interpolated — the grants
 * are built in code and go straight to the pg driver, so a stray `:`, `"` or
 * `;` (a psql meta-command, or an injection attempt) must never slip through.
 * This is the structural replacement for the old `schema.sql` "-- >>> GRANTS"
 * split: DDL and grants now live in physically separate producers, so a
 * reworded comment can neither skip the grants nor feed psql meta-commands to
 * the driver.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Pool } from "pg";

/** The projection table these grants + this DDL govern. */
export const PROJECTION_TABLE = "composition_snapshot";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(HERE, "./schema.sql");

/**
 * The DDL half of provisioning: the driver-safe `CREATE TABLE IF NOT EXISTS`
 * from schema.sql. No grants, no psql meta-commands — asserted by
 * provision.test.ts.
 */
export function readSchemaDdl(): string {
  return readFileSync(SCHEMA_PATH, "utf-8");
}

/**
 * Postgres identifier grammar we accept for a role name: a lowercase letter or
 * underscore, then lowercase letters / digits / underscores. Deliberately
 * strict — it forbids every character that could carry a psql meta-command
 * (`:`), break out of the quoted identifier (`"`), or inject SQL (`;`, spaces).
 */
const ROLE_NAME_RE = /^[a-z_][a-z0-9_]*$/;

/**
 * Validate a role name before it is interpolated into a GRANT/REVOKE. Throws
 * loudly on anything outside {@link ROLE_NAME_RE} rather than quoting-and-hoping.
 */
export function assertValidRoleName(role: string): string {
  if (!ROLE_NAME_RE.test(role)) {
    throw new Error(
      `Invalid projection role name ${JSON.stringify(role)}: must match ${ROLE_NAME_RE} ` +
        `(lowercase letters, digits, underscore; leading letter or underscore). ` +
        `Role names are interpolated into GRANT/REVOKE, so this grammar is enforced.`,
    );
  }
  return role;
}

/** Double-quote a validated identifier (defence in depth; the value is already ASCII-safe). */
function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export interface ProjectionRoles {
  /** Push shell's role: SELECT + INSERT + UPDATE, NO DELETE (append/upsert). */
  writerRole: string;
  /** Web app's role: SELECT only; writes revoked. ADR-007-critical. */
  readerRole: string;
}

/** Default role names, matching `.env.example`. */
export const DEFAULT_PROJECTION_ROLES: ProjectionRoles = {
  writerRole: "numisma_push",
  readerRole: "numisma_web",
};

/** Resolve role names from the environment, falling back to the defaults. */
export function rolesFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ProjectionRoles {
  return {
    writerRole: env.PROJECTION_WRITER_ROLE ?? DEFAULT_PROJECTION_ROLES.writerRole,
    readerRole: env.PROJECTION_READER_ROLE ?? DEFAULT_PROJECTION_ROLES.readerRole,
  };
}

/**
 * The ADR-007 two-role grants, as individual driver-safe statements. Each is
 * idempotent in Postgres (re-granting / re-revoking the same privilege is a
 * no-op). Order-independent. Throws if either role name is invalid.
 *
 *   WRITER: SELECT, INSERT, UPDATE          (NO DELETE — append/upsert only)
 *   READER: SELECT; REVOKE INSERT/UPDATE/DELETE (belt-and-suspenders)
 */
export function buildGrantStatements(roles: ProjectionRoles): string[] {
  const writer = quoteIdent(assertValidRoleName(roles.writerRole));
  const reader = quoteIdent(assertValidRoleName(roles.readerRole));
  return [
    `GRANT SELECT, INSERT, UPDATE ON ${PROJECTION_TABLE} TO ${writer}`,
    `GRANT SELECT ON ${PROJECTION_TABLE} TO ${reader}`,
    `REVOKE INSERT, UPDATE, DELETE ON ${PROJECTION_TABLE} FROM ${reader}`,
  ];
}

/**
 * Provision the projection: apply the DDL, then the two-role grants, through
 * `pool` (an ADMIN/owner credential — able to CREATE the table and GRANT on
 * it; NOT the runtime reader or writer cred). Idempotent: safe to re-run.
 *
 * The writer and reader login roles must already exist (they are part of DB
 * setup / created by the test substrate); this grants privileges to them.
 */
export async function provisionProjection(
  pool: Pool,
  roles: ProjectionRoles,
): Promise<void> {
  await pool.query(readSchemaDdl());
  for (const statement of buildGrantStatements(roles)) {
    await pool.query(statement);
  }
}
