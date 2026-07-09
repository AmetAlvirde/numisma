/**
 * ADR-007 credential-invariant integration test — the manual 8/8 probe,
 * automated. Runs against a REAL throwaway Postgres (pg-mem cannot enforce role
 * privileges). SKIPS with a loud warning when NUMISMA_TEST_DATABASE_URL is
 * absent, so `pnpm test` still passes on machines without Postgres.
 *
 * Asserts the two-role split provisioning actually enforces:
 *   reader  SELECT ok · INSERT/UPDATE/DELETE denied
 *   writer  SELECT/INSERT/UPDATE ok · DELETE denied
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { provisionProjection } from "./provision.ts";
import {
  createThrowawayDb,
  hasTestDatabase,
  TEST_DATABASE_URL_ENV,
  type ThrowawayDb,
} from "./pg-substrate.testkit.ts";

const runIntegration = hasTestDatabase();
if (!runIntegration) {
  console.warn(
    `\n[provision.integration] SKIPPED: ${TEST_DATABASE_URL_ENV} is not set.\n` +
      `  The ADR-007 grant-enforcement test needs a REAL throwaway Postgres ` +
      `(pg-mem cannot enforce role privileges).\n` +
      `  Run it with, e.g.:\n` +
      `    NUMISMA_TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm test\n` +
      `  See docs/projection-provisioning.md.\n`,
  );
}

// Postgres "insufficient_privilege" — the code a denied grant raises.
const INSUFFICIENT_PRIVILEGE = "42501";

async function expectDenied(op: Promise<unknown>): Promise<void> {
  await expect(op).rejects.toMatchObject({ code: INSUFFICIENT_PRIVILEGE });
}

describe.skipIf(!runIntegration)(
  "ADR-007 two-role grant enforcement (8/8 credential probe)",
  () => {
    let db: ThrowawayDb;
    let writerPool: Pool;
    let readerPool: Pool;
    let roles: { writerRole: string; readerRole: string };

    beforeAll(async () => {
      db = await createThrowawayDb();
      const writer = await db.createLoginRole("writer");
      const reader = await db.createLoginRole("reader");
      roles = { writerRole: writer.role, readerRole: reader.role };

      // Apply the real provisioning (DDL + grants) with the admin cred.
      await provisionProjection(db.adminPool, roles);

      writerPool = writer.pool();
      readerPool = reader.pool();

      // Seed one row (as admin) so UPDATE/DELETE have a target.
      await db.adminPool.query(
        `INSERT INTO composition_snapshot (fund_id, as_of, schema_version, report)
         VALUES ('seed-fund', '2026-01-01', 1, '{}'::jsonb)`,
      );
    }, 60_000);

    afterAll(async () => {
      await db?.drop();
    });

    describe("writer credential (append/upsert, no delete)", () => {
      it("is ACCEPTED on SELECT", async () => {
        const { rows } = await writerPool.query(
          "SELECT fund_id FROM composition_snapshot WHERE fund_id = 'seed-fund'",
        );
        expect(rows).toHaveLength(1);
      });

      it("is ACCEPTED on INSERT", async () => {
        await expect(
          writerPool.query(
            `INSERT INTO composition_snapshot (fund_id, as_of, schema_version, report)
             VALUES ('writer-insert', '2026-02-01', 1, '{}'::jsonb)`,
          ),
        ).resolves.toBeDefined();
      });

      it("is ACCEPTED on UPDATE", async () => {
        await expect(
          writerPool.query(
            "UPDATE composition_snapshot SET schema_version = 1 WHERE fund_id = 'seed-fund'",
          ),
        ).resolves.toBeDefined();
      });

      it("is DENIED on DELETE", async () => {
        await expectDenied(
          writerPool.query(
            "DELETE FROM composition_snapshot WHERE fund_id = 'seed-fund'",
          ),
        );
      });
    });

    describe("reader credential (SELECT only)", () => {
      it("is ACCEPTED on SELECT", async () => {
        const { rows } = await readerPool.query(
          "SELECT fund_id FROM composition_snapshot WHERE fund_id = 'seed-fund'",
        );
        expect(rows).toHaveLength(1);
      });

      it("is DENIED on INSERT", async () => {
        await expectDenied(
          readerPool.query(
            `INSERT INTO composition_snapshot (fund_id, as_of, schema_version, report)
             VALUES ('reader-insert', '2026-03-01', 1, '{}'::jsonb)`,
          ),
        );
      });

      it("is DENIED on UPDATE", async () => {
        await expectDenied(
          readerPool.query(
            "UPDATE composition_snapshot SET schema_version = 2 WHERE fund_id = 'seed-fund'",
          ),
        );
      });

      it("is DENIED on DELETE", async () => {
        await expectDenied(
          readerPool.query(
            "DELETE FROM composition_snapshot WHERE fund_id = 'seed-fund'",
          ),
        );
      });
    });

    it("re-provisioning is a no-op the second time (idempotent)", async () => {
      // Second application against the already-provisioned DB must not throw,
      // and the enforcement must still hold afterwards.
      await expect(
        provisionProjection(db.adminPool, roles),
      ).resolves.toBeUndefined();
      await expectDenied(
        readerPool.query(
          "DELETE FROM composition_snapshot WHERE fund_id = 'seed-fund'",
        ),
      );
    });
  },
);
