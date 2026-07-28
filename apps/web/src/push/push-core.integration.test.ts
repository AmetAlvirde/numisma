/**
 * Push upsert-idempotency integration test — the `ON CONFLICT (fund_id, as_of)
 * DO UPDATE` in push-core.ts, proven against a REAL throwaway Postgres (pg-mem
 * cannot enforce the primary key / grants the way real pg does). Reuses the
 * shared substrate from slice #123 (pg-substrate.testkit.ts) and pushes through
 * the WRITER cred provisioned by provision.ts, so there is one DB-integration
 * story, not two.
 *
 * SKIPS with a loud warning when NUMISMA_TEST_DATABASE_URL is absent, so
 * `pnpm test` still passes on machines without Postgres. To actually run it:
 *   NUMISMA_TEST_DATABASE_URL=postgres://amet@localhost:5432/numisma pnpm test
 */
import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import type { CompositionReport } from "@numisma/engine";
import { provisionProjection } from "../projection/provision.ts";
import {
  createThrowawayDb,
  hasTestDatabase,
  TEST_DATABASE_URL_ENV,
  type ThrowawayDb,
} from "../projection/pg-substrate.testkit.ts";
import {
  deriveSnapshot,
  loadCurrentFold,
  upsertSnapshot,
} from "./push-core.ts";
import {
  loadFixture,
  makeTempStore,
  priceMarkedLine,
  TEST_GLANCE,
} from "./push-core.fixtures.ts";

const runIntegration = hasTestDatabase();
if (!runIntegration) {
  console.warn(
    `\n[push-core.integration] SKIPPED: ${TEST_DATABASE_URL_ENV} is not set.\n` +
      `  The push upsert-idempotency test needs a REAL throwaway Postgres ` +
      `(pg-mem does not enforce the (fund_id, as_of) primary key / grants).\n` +
      `  Run it with, e.g.:\n` +
      `    NUMISMA_TEST_DATABASE_URL=postgres://amet@localhost:5432/numisma pnpm test\n` +
      `  See docs/projection-provisioning.md.\n`,
  );
}

async function rowCount(pool: Pool): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    "SELECT count(*)::text AS n FROM composition_snapshot",
  );
  const [row] = rows;
  if (!row) throw new Error("count(*) returned no rows");
  return Number(row.n);
}

interface StoredRow {
  fund_id: string;
  as_of: string;
  schema_version: number;
  report: CompositionReport;
  pushed_at: Date;
}

async function readRow(
  pool: Pool,
  fundId: string,
  asOf: string,
): Promise<StoredRow> {
  const { rows } = await pool.query<StoredRow>(
    `SELECT fund_id, as_of, schema_version, report, pushed_at
       FROM composition_snapshot WHERE fund_id = $1 AND as_of = $2`,
    [fundId, asOf],
  );
  expect(rows).toHaveLength(1);
  const [row] = rows;
  if (!row) throw new Error(`no row for (${fundId}, ${asOf})`);
  return row;
}

describe.skipIf(!runIntegration)(
  "push upsert idempotency on (fund_id, as_of)",
  () => {
    let db: ThrowawayDb;
    let writerPool: Pool;
    let report: CompositionReport;

    beforeAll(async () => {
      db = await createThrowawayDb();
      const writer = await db.createLoginRole("writer");
      const reader = await db.createLoginRole("reader");
      // Provision the real DDL + ADR-007 two-role grants with the admin cred,
      // then push exclusively through the WRITER pool (SELECT/INSERT/UPDATE, no
      // DELETE) — the exact runtime privilege the push shell holds.
      await provisionProjection(db.adminPool, {
        writerRole: writer.role,
        readerRole: reader.role,
      });
      writerPool = writer.pool();
      report = await loadFixture();
    }, 60_000);

    afterAll(async () => {
      await db?.drop();
    });

    it("two pushes of the same snapshot yield exactly ONE row, pushed_at refreshed", async () => {
      const { fundId, asOf } = deriveSnapshot(report, TEST_GLANCE);

      // First push: empty table → one row.
      expect(await rowCount(writerPool)).toBe(0);
      await upsertSnapshot(writerPool, report, TEST_GLANCE);
      expect(await rowCount(writerPool)).toBe(1);
      const first = await readRow(writerPool, fundId, asOf);

      // Small gap so the refreshed pushed_at is unambiguously later (now() is a
      // transaction timestamp; two round-trips already differ, but this removes
      // any same-microsecond doubt).
      await new Promise((r) => setTimeout(r, 25));

      // Second push of the SAME (fund_id, as_of): still exactly one row (no
      // duplicate), and pushed_at is bumped by the DO UPDATE.
      await upsertSnapshot(writerPool, report, TEST_GLANCE);
      expect(await rowCount(writerPool)).toBe(1);
      const second = await readRow(writerPool, fundId, asOf);

      expect(second.pushed_at.getTime()).toBeGreaterThan(
        first.pushed_at.getTime(),
      );
    });

    it("DO UPDATE refreshes report + schema_version on conflict (no delete, no dup)", async () => {
      const { fundId, asOf } = deriveSnapshot(report, TEST_GLANCE);

      // Seed a row on the SAME conflict key but with a STALE report + bogus
      // schema_version, so the upsert's UPDATE branch has something observable
      // to correct (the writer cred is allowed to INSERT/UPDATE, not DELETE).
      await writerPool.query(
        `INSERT INTO composition_snapshot (fund_id, as_of, schema_version, report)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (fund_id, as_of)
         DO UPDATE SET schema_version = EXCLUDED.schema_version,
                       report = EXCLUDED.report`,
        [fundId, asOf, 99, JSON.stringify({ stale: true })],
      );
      const before = await readRow(writerPool, fundId, asOf);
      expect(before.schema_version).toBe(99);
      expect(await rowCount(writerPool)).toBe(1);

      // Now push the real fixture through upsertSnapshot: same key → UPDATE.
      const derived = await upsertSnapshot(writerPool, report, TEST_GLANCE);
      expect(await rowCount(writerPool)).toBe(1); // still one row: no duplicate

      const after = await readRow(writerPool, fundId, asOf);
      expect(after.schema_version).toBe(derived.schemaVersion); // 99 → contract version
      // report column now reflects the fixture, not the stale seed.
      expect(after.report.dashboard.summary.fundName).toBe(
        report.dashboard.summary.fundName,
      );
      expect((after.report as { stale?: boolean }).stale).toBeUndefined();
    });
  },
);

/**
 * The REAL-FOLD push, proven at the database (PRD #134 slice 2). The block above
 * pushes the committed fixture; this one folds a throwaway durable log through
 * `loadCurrentFold` — the exact source the `push` command now uses — and
 * asserts the two properties the fixture block never did:
 *
 *  - R4: the pushed `report` JSONB carries EXACTLY `totals` and `dashboard`. The
 *    payload's WIDTH, asserted on the stored row rather than on the derivation,
 *    so the narrowing is proven where it matters — in the cloud.
 *  - R3: a second push over the SAME unchanged log leaves exactly one row with an
 *    identical payload; only `pushed_at` moves.
 */
describe.skipIf(!runIntegration)("real-fold push (folds the durable log)", () => {
  let db: ThrowawayDb;
  let writerPool: Pool;
  let tempDir: string;
  const savedDataDir = process.env.NUMISMA_DATA_DIR;

  beforeAll(async () => {
    db = await createThrowawayDb();
    const writer = await db.createLoginRole("writer");
    const reader = await db.createLoginRole("reader");
    await provisionProjection(db.adminPool, {
      writerRole: writer.role,
      readerRole: reader.role,
    });
    writerPool = writer.pool();

    const store = await makeTempStore(
      `${priceMarkedLine("mark-1", "2026-06-05", 160)}\n` +
        `${priceMarkedLine("mark-2", "2026-06-09", 175)}\n`,
    );
    tempDir = store.dir;
    process.env.NUMISMA_DATA_DIR = store.dir;
  }, 60_000);

  afterAll(async () => {
    if (savedDataDir === undefined) {
      delete process.env.NUMISMA_DATA_DIR;
    } else {
      process.env.NUMISMA_DATA_DIR = savedDataDir;
    }
    await rm(tempDir, { recursive: true, force: true });
    await db?.drop();
  });

  it("R4: the pushed report JSONB carries exactly `totals`, `dashboard` and `glance`", async () => {
    const { report } = await loadCurrentFold();
    // Sanity: the fold really ran — asOf is the LATER event's date, not genesis.
    expect(report.dashboard.summary.asOf).toBe("2026-06-09");
    // And the wide report carries more than the payload is allowed to.
    expect(Object.keys(report).length).toBeGreaterThan(3);

    const { fundId, asOf } = await upsertSnapshot(writerPool, report, TEST_GLANCE);
    expect(asOf).toBe("2026-06-09");

    const stored = await readRow(writerPool, fundId, asOf);
    expect(Object.keys(stored.report).sort()).toEqual([
      "dashboard",
      "glance",
      "totals",
    ]);
  });

  it("R3: a second push over the unchanged log — one row, same payload, later pushed_at", async () => {
    const { report: first } = await loadCurrentFold();
    const { fundId, asOf } = await upsertSnapshot(writerPool, first, TEST_GLANCE);
    expect(await rowCount(writerPool)).toBe(1);
    const before = await readRow(writerPool, fundId, asOf);

    await new Promise((r) => setTimeout(r, 25));

    // Fold the SAME log again (no new events) and push again.
    const { report: second } = await loadCurrentFold();
    await upsertSnapshot(writerPool, second, TEST_GLANCE);

    expect(await rowCount(writerPool)).toBe(1);
    const after = await readRow(writerPool, fundId, asOf);
    expect(after.as_of).toBe(before.as_of);
    expect(after.report).toEqual(before.report);
    expect(after.pushed_at.getTime()).toBeGreaterThan(before.pushed_at.getTime());
  });
});
