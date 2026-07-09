/**
 * Throwaway-Postgres test substrate (SHARED — slice #123 establishes it, slice
 * #127 reuses it). Grant enforcement and upsert idempotency cannot be tested
 * against pg-mem (it does not enforce role privileges), so these tests need a
 * REAL Postgres. This helper points at one via an env-provided connection
 * string and gives each test file a fully isolated, disposable database plus
 * ad-hoc login roles.
 *
 * ── How to point it at a database ──────────────────────────────────────────
 *   Set NUMISMA_TEST_DATABASE_URL to a SUPERUSER (or CREATEDB + CREATEROLE)
 *   Postgres URL, e.g.:
 *     export NUMISMA_TEST_DATABASE_URL="postgres://postgres@localhost:5432/postgres"
 *   Then `pnpm test` runs the integration tests. When the env var is ABSENT the
 *   integration tests SKIP (with a loud console warning) so `pnpm test` still
 *   passes on machines without Postgres. See docs/projection-provisioning.md.
 *
 *   In CI: provide a Postgres service and export NUMISMA_TEST_DATABASE_URL to
 *   point at it (GitHub Actions `services: postgres:17` — no Docker-in-Docker /
 *   testcontainers dependency). See docs/projection-provisioning.md §CI.
 *
 * ── Usage (gate with hasTestDatabase()) ────────────────────────────────────
 *   import { hasTestDatabase, createThrowawayDb } from "./pg-substrate.testkit.ts";
 *   describe.skipIf(!hasTestDatabase())("...", () => {
 *     let db;
 *     beforeAll(async () => {
 *       db = await createThrowawayDb();
 *       const writer = await db.createLoginRole("writer");
 *       await provisionProjection(db.adminPool, { writerRole: writer.role, ... });
 *       const writerPool = writer.pool();
 *     });
 *     afterAll(async () => { await db?.drop(); });
 *   });
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { assertValidRoleName } from "./provision.ts";

/** Env var naming the throwaway-Postgres superuser URL. */
export const TEST_DATABASE_URL_ENV = "NUMISMA_TEST_DATABASE_URL";

/** The configured test-database URL, or undefined when unset/blank. */
export function testDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env[TEST_DATABASE_URL_ENV]?.trim();
  return raw ? raw : undefined;
}

/** True when a throwaway-Postgres URL is configured (gate integration tests on this). */
export function hasTestDatabase(env: NodeJS.ProcessEnv = process.env): boolean {
  return testDatabaseUrl(env) !== undefined;
}

/** A random lowercase-hex token safe to embed in identifiers and passwords. */
function token(): string {
  return randomBytes(8).toString("hex");
}

/** Rewrite a base URL to point at a different database, keeping host/port/creds. */
function urlForDatabase(baseUrl: string, database: string): string {
  const u = new URL(baseUrl);
  u.pathname = `/${database}`;
  return u.toString();
}

/** Rewrite a URL's credentials (used to build role-scoped connection strings). */
function urlWithCredentials(baseUrl: string, user: string, password: string): string {
  const u = new URL(baseUrl);
  u.username = encodeURIComponent(user);
  u.password = encodeURIComponent(password);
  return u.toString();
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * A `pg.Pool` with a mandatory idle-client error handler attached.
 *
 * node-postgres re-emits an idle client's async errors on the Pool, and an
 * EventEmitter `"error"` with NO listener becomes an UNCAUGHT exception that
 * kills the whole `vitest` run — even though every test passed. Teardown makes
 * this concrete: `drop()` runs `DROP DATABASE ... WITH (FORCE)`, which SIGTERMs
 * any backend still attached to the throwaway db; that backend sends a FATAL
 * 57P01 ("terminating connection due to administrator command") to a connection
 * that may still be draining after `pool.end()`. Swallowing it here is correct:
 * these pools are per-test-file and short-lived, and a termination during
 * teardown is expected, not a test signal. Without this handler the failure is a
 * flaky "1 unhandled error" that appears only when worker scheduling loses the
 * race — the worst kind of CI red.
 */
function newPool(connectionString: string): Pool {
  const pool = new Pool({ connectionString });
  pool.on("error", () => {
    // Expected teardown noise (e.g. 57P01 from DROP DATABASE ... FORCE). The
    // integration tests assert on query results, never on idle-client events.
  });
  return pool;
}

/** A login role created inside a {@link ThrowawayDb}. */
export interface LoginRole {
  /** The generated (unique) role name. */
  role: string;
  /** Connection string that authenticates AS this role against the throwaway db. */
  url: string;
  /** Open a pool as this role; tracked and closed by {@link ThrowawayDb.drop}. */
  pool(): Pool;
}

/** An isolated, disposable Postgres database plus the roles created in it. */
export interface ThrowawayDb {
  /** Connection string to the throwaway database (admin credentials). */
  databaseUrl: string;
  /** Admin pool against the throwaway database (superuser/owner). */
  adminPool: Pool;
  /** Create a unique LOGIN role (prefix is namespaced with a random suffix). */
  createLoginRole(prefix: string): Promise<LoginRole>;
  /** Close every pool, drop every created role, and DROP the database. */
  drop(): Promise<void>;
}

/**
 * Create a fresh, isolated Postgres database for one test file. Requires
 * {@link hasTestDatabase} (caller must gate). The database name is randomised
 * so parallel test files never collide; `drop()` removes it and all roles.
 */
export async function createThrowawayDb(): Promise<ThrowawayDb> {
  const baseUrl = testDatabaseUrl();
  if (!baseUrl) {
    throw new Error(
      `${TEST_DATABASE_URL_ENV} is not set — gate callers with hasTestDatabase().`,
    );
  }

  // Maintenance connection (the base URL's own database) — used to CREATE/DROP
  // the throwaway database, which cannot be done from within it.
  const maintPool = newPool(baseUrl);
  const dbName = `numisma_test_${token()}`;
  await maintPool.query(`CREATE DATABASE ${quoteIdent(dbName)}`);

  const databaseUrl = urlForDatabase(baseUrl, dbName);
  const adminPool = newPool(databaseUrl);

  const createdRoles: string[] = [];
  const rolePools: Pool[] = [];

  return {
    databaseUrl,
    adminPool,

    async createLoginRole(prefix: string): Promise<LoginRole> {
      const role = assertValidRoleName(`${prefix}_${token()}`);
      const password = token(); // lowercase hex — safe to interpolate
      await adminPool.query(
        `CREATE ROLE ${quoteIdent(role)} LOGIN PASSWORD '${password}'`,
      );
      createdRoles.push(role);
      const url = urlWithCredentials(databaseUrl, role, password);
      return {
        role,
        url,
        pool() {
          const p = newPool(url);
          rolePools.push(p);
          return p;
        },
      };
    },

    async drop(): Promise<void> {
      await Promise.allSettled(rolePools.map((p) => p.end()));
      await adminPool.end();
      // Drop the database FIRST: it holds the grants that make each role a
      // dependency, so a role cannot be dropped while the database survives.
      await maintPool.query(
        `DROP DATABASE IF EXISTS ${quoteIdent(dbName)} WITH (FORCE)`,
      );
      for (const role of createdRoles) {
        await maintPool.query(`DROP ROLE IF EXISTS ${quoteIdent(role)}`);
      }
      await maintPool.end();
    },
  };
}
