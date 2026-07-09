/**
 * Push core (Deliverable C) — the IMPORTABLE, self-exec-free half of the push
 * shell. `push.ts` is a `main().then(..., process.exit)` script: importing it
 * would run it. This module holds the two pieces worth asserting on their own —
 * the pure fixture→derivation and the real upsert SQL — so a unit test can cover
 * the derivation without a DB and the integration test can drive the EXACT upsert
 * path (`INSERT ... ON CONFLICT (fund_id, as_of) DO UPDATE`) the script runs, not
 * a copy of it. `push.ts` now just wires argv + credentials around these.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Pool } from "pg";
import type { CompositionReport } from "@numisma/engine";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  fundIdOf,
} from "../projection/contract.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the fixture CompositionReport the push shell projects. */
export const FIXTURE_PATH = resolve(
  HERE,
  "../../fixtures/composition-report.fixture.json",
);

/** Load and parse the fixture CompositionReport from disk. */
export async function loadFixture(): Promise<CompositionReport> {
  const raw = await readFile(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as CompositionReport;
}

/** The three projected identity/versioning columns derived from a report. */
export interface SnapshotDerivation {
  /** Deterministic fund id (slug of the fund name) — the conflict key's first half. */
  fundId: string;
  /** Snapshot's logical calendar date — the conflict key's second half. */
  asOf: string;
  /** The contract schema version stamped on the row. */
  schemaVersion: number;
}

/**
 * PURE derivation: fixture report → the `(fund_id, as_of, schema_version)` that
 * key and version the projected row. Delegates to the shared projection contract
 * (`fundIdOf`, `COMPOSITION_SNAPSHOT_SCHEMA_VERSION`) so writer and reader can
 * never disagree. No I/O, no DB — unit-testable on its own.
 */
export function deriveSnapshot(report: CompositionReport): SnapshotDerivation {
  return {
    fundId: fundIdOf(report),
    asOf: report.dashboard.summary.asOf,
    schemaVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  };
}

/**
 * Idempotently upsert a report into `composition_snapshot` through `pool` (the
 * WRITE credential). Append/upsert only — the `ON CONFLICT (fund_id, as_of) DO
 * UPDATE` refreshes `report` / `schema_version` and bumps `pushed_at`; it never
 * DELETEs, so a re-push of the same `(fund_id, as_of)` yields exactly ONE row and
 * the ADR-007 no-DELETE writer invariant holds. Returns the derivation applied.
 */
export async function upsertSnapshot(
  pool: Pool,
  report: CompositionReport,
): Promise<SnapshotDerivation> {
  const derived = deriveSnapshot(report);
  await pool.query(
    `INSERT INTO composition_snapshot (fund_id, as_of, schema_version, report)
     VALUES ($1, $2, $3, $4::jsonb)
     ON CONFLICT (fund_id, as_of)
     DO UPDATE SET report = EXCLUDED.report,
                   schema_version = EXCLUDED.schema_version,
                   pushed_at = now()`,
    [derived.fundId, derived.asOf, derived.schemaVersion, JSON.stringify(report)],
  );
  return derived;
}
