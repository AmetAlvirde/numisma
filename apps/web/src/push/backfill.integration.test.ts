/**
 * Backfill integration test (PRD #146 slice #149) — the REAL log replayed into a
 * REAL throwaway Postgres, through the WRITER credential, over the exact
 * `ON CONFLICT (fund_id, as_of) DO UPDATE` the daily push runs.
 *
 * THIS IS A WRITE TEST, AND SELF-SKIPPING IS RIGHT FOR IT. It proves that one row
 * per anchored date lands, at v3, with the right NAVs, and that a second run is
 * idempotent — claims
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
import { dirname, join } from "node:path";
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

/**
 * The folds with independently known answers (07-25 is the lost Saturday).
 *
 * THE VALUES ARE NOT IN THIS REPOSITORY, WHICH IS PUBLIC. They are the real fund's
 * NAV on three real dates — an external oracle, and the only thing in this test that
 * could not be replaced by a fiction without making the assertion meaningless. They
 * live beside the private log, in `known-navs.json` under the data directory:
 *
 *   [["2026-07-24", 12345.67], ...]   // shape only — not the real values
 *
 * That costs nothing in reach: this test is ALREADY gated on the private log being
 * present, so the oracle is available on exactly the machines that can run it. When
 * the file is absent the NAV assertion self-skips and says so; every other claim —
 * row count, schema version, idempotency — still runs.
 */
async function loadKnownNavs(): Promise<[asOf: string, nav: number][] | null> {
  try {
    const raw = await readFile(
      join(dirname(resolveEventStorePaths().log), "known-navs.json"),
      "utf8",
    );
    return JSON.parse(raw) as [asOf: string, nav: number][];
  } catch {
    return null;
  }
}

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

  it("writes ONE row per anchored date, and nothing else", async () => {
    // NOT a count. `enumerateAnchors` reads the REAL log, which gains a day on
    // every push, so any number written here goes red on the next evening's run —
    // on precisely the machines that can run this test. The claim is a
    // correspondence: the rows in the table ARE the enumerated anchors, in order,
    // one apiece. Fewer calendar days are anchored than have elapsed — the
    // pre-launchd weekdays would fold to rows where all thirteen instruments were
    // expected and absent, i.e. NAV permanently blank on history no later run could
    // repair (V3) — and enumeration, not this assertion, is what decides which.
    expect(anchors.length).toBeGreaterThan(0);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect([...anchors].sort()).toEqual(anchors);
    expect(first).toHaveLength(anchors.length);
    expect(first.map((r) => r.as_of)).toEqual(anchors);
  });

  it("stamps every row at schema_version = 4", () => {
    expect(new Set(first.map((r) => r.schema_version))).toEqual(
      new Set([COMPOSITION_SNAPSHOT_SCHEMA_VERSION]),
    );
    expect(COMPOSITION_SNAPSHOT_SCHEMA_VERSION).toBe(4);
  });

  it("reproduces the known-good NAVs exactly, Saturday included", async () => {
    const knownNavs = await loadKnownNavs();
    if (knownNavs === null) {
      console.warn(
        `\n[backfill.integration] NAV oracle SKIPPED: no 'known-navs.json' beside the ` +
          `private log.\n  The real NAVs are the one thing here that cannot live in a ` +
          `public repository, so they are read from the private side.\n  Every other ` +
          `claim in this test still ran.\n`,
      );
    } else {
      for (const [asOf, nav] of knownNavs) {
        const row = first.find((r) => r.as_of === asOf);
        expect(row, `no row for ${asOf}`).toBeDefined();
        expect(row!.report.totals.fundValueUsd, asOf).toBeCloseTo(nav, 2);
      }
    }
    // 07-25 is the Saturday NO PUSH EVER CAPTURED. Before this command the
    // projection held 07-24 and 07-26 with a hole between them, so a delta against
    // "the previous row" compared Sunday to Friday. This holds with or without the
    // oracle, so it is asserted outside the branch.
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

  it("R6: a second run leaves the same rows, identical payloads, later pushed_at", async () => {
    // A gap so the refreshed pushed_at is unambiguously later (now() is a
    // transaction timestamp).
    await new Promise((r) => setTimeout(r, 25));
    await runBackfill({ pool: writerPool });
    const second = await readAll(writerPool);

    // No duplicates: the conflict key absorbed every re-write. Compared against the
    // FIRST run rather than a count — idempotence is "the second run changed
    // nothing", which is a cross-run equality, and stating it that way survives the
    // log growing by a day.
    expect(second).toHaveLength(first.length);
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
    // Re-asserted across every fold (twice over, by now — this runs after the
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
