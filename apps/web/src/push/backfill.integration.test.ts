/**
 * Backfill integration test (PRD #146 slice #149) — the REAL log replayed into a
 * REAL throwaway Postgres, through the WRITER credential, over the exact
 * `ON CONFLICT (fund_id, as_of) DO UPDATE` the daily push runs.
 *
 * THIS IS A WRITE TEST, AND SELF-SKIPPING IS RIGHT FOR IT. It proves that 28 rows
 * land, at v3, with the right NAVs, and that a second run is idempotent — claims
 * that are simply not checkable without a database and without the operator's
 * private log. It is gated on BOTH.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY: the correctness of the anchors themselves.
 * That would put the increment's load-bearing claim behind this gate, passing by
 * skipping on every machine and CI run without Postgres. The anchors are asserted
 * unconditionally in `anchor-fixture.test.ts` against the committed fixture, and
 * slice 4's verdict replay reads the same file. The Postgres test proves the WRITE;
 * the fixture keeps the VERDICT honest. Two different claims, two different gates.
 *
 * To actually run it:
 *   NUMISMA_TEST_DATABASE_URL=postgres://amet@localhost:5432/numisma pnpm test
 */
import { access, readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { resolveEventStorePaths } from "@numisma/event-store";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  type ProjectionReport,
} from "../projection/contract.ts";
import { provisionProjection } from "../projection/provision.ts";
import {
  createThrowawayDb,
  hasTestDatabase,
  TEST_DATABASE_URL_ENV,
  type ThrowawayDb,
} from "../projection/pg-substrate.testkit.ts";
import { enumerateAnchors, runBackfill } from "./backfill-core.ts";

/** The operator's real durable log — private, git-ignored, absent on most machines. */
async function realLogAvailable(): Promise<boolean> {
  try {
    const paths = resolveEventStorePaths();
    await access(paths.genesis);
    await access(paths.log);
    return true;
  } catch {
    return false;
  }
}

const hasDb = hasTestDatabase();
const hasLog = await realLogAvailable();
const runIntegration = hasDb && hasLog;

if (!runIntegration) {
  console.warn(
    `\n[backfill.integration] SKIPPED: ` +
      `${hasDb ? "" : `${TEST_DATABASE_URL_ENV} is not set. `}` +
      `${hasLog ? "" : "the private durable log is not on this machine. "}` +
      `\n  This test replays the REAL log into a REAL throwaway Postgres; it needs both.` +
      `\n  The anchor payloads it would write are asserted unconditionally in ` +
      `anchor-fixture.test.ts.\n`,
  );
}

/** The three folds with independently known answers (07-25 is the lost Saturday). */
const KNOWN_NAVS: [asOf: string, nav: number][] = [
  ["2026-07-24", 19590.01],
  ["2026-07-25", 19619.62],
  ["2026-07-26", 19753.61],
];

interface StoredRow {
  fund_id: string;
  as_of: string;
  schema_version: number;
  report: ProjectionReport;
  pushed_at: Date;
}

async function readAll(pool: Pool): Promise<StoredRow[]> {
  const { rows } = await pool.query<StoredRow>(
    `SELECT fund_id, as_of, schema_version, report, pushed_at
       FROM composition_snapshot ORDER BY as_of`,
  );
  return rows;
}

describe.skipIf(!runIntegration)("backfill → the projection DB", () => {
  let db: ThrowawayDb;
  let writerPool: Pool;
  let anchors: string[];
  let first: StoredRow[];

  beforeAll(async () => {
    db = await createThrowawayDb();
    const writer = await db.createLoginRole("writer");
    const reader = await db.createLoginRole("reader");
    // The real DDL + ADR-007 two-role grants, then every write through the WRITER
    // pool (SELECT/INSERT/UPDATE, no DELETE) — the exact runtime privilege the
    // backfill command holds.
    await provisionProjection(db.adminPool, {
      writerRole: writer.role,
      readerRole: reader.role,
    });
    writerPool = writer.pool();

    anchors = await enumerateAnchors();
    await runBackfill({ pool: writerPool });
    first = await readAll(writerPool);
  }, 180_000);

  afterAll(async () => {
    await db?.drop();
  });

  it("writes ONE row per anchored date — 28 of them", async () => {
    // 28, not 34: of the 34 calendar days from genesis, 28 are anchored. Five of
    // the six gaps are pre-launchd weekdays that would fold to rows where all
    // thirteen instruments were expected and absent, i.e. NAV permanently blank on
    // five historical rows no later run could repair (V3).
    expect(anchors).toHaveLength(28);
    expect(first).toHaveLength(28);
    expect(first.map((r) => r.as_of)).toEqual(anchors);
  });

  it("stamps every row at schema_version = 3", () => {
    expect(new Set(first.map((r) => r.schema_version))).toEqual(
      new Set([COMPOSITION_SNAPSHOT_SCHEMA_VERSION]),
    );
    expect(COMPOSITION_SNAPSHOT_SCHEMA_VERSION).toBe(3);
  });

  it("reproduces the three known-good NAVs exactly, Saturday included", () => {
    for (const [asOf, nav] of KNOWN_NAVS) {
      const row = first.find((r) => r.as_of === asOf);
      expect(row, `no row for ${asOf}`).toBeDefined();
      expect(row!.report.totals.fundValueUsd, asOf).toBeCloseTo(nav, 2);
    }
    // 07-25 is the Saturday NO PUSH EVER CAPTURED. Before this command the
    // projection held 07-24 and 07-26 with a hole between them, so a delta against
    // "the previous row" compared Sunday to Friday.
    expect(first.map((r) => r.as_of)).toContain("2026-07-25");
  });

  it("every stored payload is exactly `{ totals, dashboard, glance }` (D8)", () => {
    for (const row of first) {
      expect(Object.keys(row.report).sort(), row.as_of).toEqual([
        "dashboard",
        "glance",
        "totals",
      ]);
      expect(row.report.dashboard.summary.asOf).toBe(row.as_of);
    }
  });

  it("R6: a second run leaves 28 rows, identical payloads, later pushed_at", async () => {
    // A gap so the refreshed pushed_at is unambiguously later (now() is a
    // transaction timestamp).
    await new Promise((r) => setTimeout(r, 25));
    await runBackfill({ pool: writerPool });
    const second = await readAll(writerPool);

    // No duplicates: the conflict key absorbed all 28 re-writes.
    expect(second).toHaveLength(28);
    expect(second.map((r) => r.as_of)).toEqual(first.map((r) => r.as_of));
    expect(second.map((r) => r.report)).toEqual(first.map((r) => r.report));
    expect(second.map((r) => r.schema_version)).toEqual(
      first.map((r) => r.schema_version),
    );
    for (const [index, row] of second.entries()) {
      expect(row.pushed_at.getTime(), row.as_of).toBeGreaterThan(
        first[index]!.pushed_at.getTime(),
      );
    }
  });

  it("R7: the durable log is byte-identical after the full backfill", async () => {
    // Re-asserted across all 28 folds (twice over, by now — this runs after the
    // idempotence case). The read path's only write is the quarantine sidecar
    // BESIDE the log, and only for a log that does not read clean.
    const paths = resolveEventStorePaths();
    const before = await readFile(paths.log);
    const beforeGenesis = await readFile(paths.genesis);

    await runBackfill({ pool: writerPool });

    expect(await readFile(paths.log)).toEqual(before);
    expect(await readFile(paths.genesis)).toEqual(beforeGenesis);
  });
});
