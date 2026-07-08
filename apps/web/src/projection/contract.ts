/**
 * Projection contract — the SINGLE SOURCE OF TRUTH for the composition_snapshot
 * projection DB (ADR-007). Imported by BOTH the web reader (Deliverable E) and
 * the push shell (Deliverable C), so the schema version, the fund-id derivation,
 * and the row shape can never drift between writer and reader.
 *
 * The `report` column is typed as `CompositionReport` from `@numisma/engine`.
 * That import is the compile-time drift guard: if the engine's dashboard shape
 * changes, `pnpm --filter @numisma/web typecheck` breaks here.
 */
import { Pool } from "pg";
import type { CompositionReport } from "@numisma/engine";

/**
 * Version of the CompositionReport shape stored in the projection. Bump this in
 * lockstep with any breaking change to the engine's CompositionReport so the
 * reader can REFUSE to render a stale snapshot instead of mis-rendering it.
 */
export const COMPOSITION_SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Deterministic fund id: slug of the fund name — lowercased, every run of
 * non-alphanumeric characters collapsed to a single "-", leading/trailing "-"
 * trimmed. Fixture ("Sanitized Exploratory Fund") -> "sanitized-exploratory-fund".
 */
export function fundIdOf(report: CompositionReport): string {
  return report.dashboard.summary.fundName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Discriminated result of {@link getLatestSnapshot}. */
export type LatestSnapshot =
  | { status: "empty" }
  | { status: "stale"; storedVersion: number; expectedVersion: number }
  | { status: "ok"; fundId: string; asOf: string; report: CompositionReport };

interface SnapshotRow {
  fund_id: string;
  as_of: string;
  schema_version: number;
  report: CompositionReport;
}

let readerPool: Pool | undefined;

/**
 * Lazily-constructed READ-ONLY projection pool, from PROJECTION_DATABASE_URL.
 * Lazy so merely importing this module (e.g. from the push shell, which uses a
 * different write credential) never opens the read pool. The credential behind
 * this URL is expected to hold SELECT-only grants (see schema.sql, ADR-007).
 */
export function getReaderPool(): Pool {
  if (!readerPool) {
    const connectionString = process.env.PROJECTION_DATABASE_URL;
    if (!connectionString) {
      throw new Error("PROJECTION_DATABASE_URL is not set");
    }
    readerPool = new Pool({ connectionString });
  }
  return readerPool;
}

/**
 * Read the most recent snapshot. Returns a refusal result rather than throwing
 * for the two "expected" bad states:
 *  - no rows yet            -> { status: "empty" }
 *  - stored schema mismatch -> { status: "stale", storedVersion, expectedVersion }
 * Only an actual DB/query failure rejects.
 */
export async function getLatestSnapshot(pool: Pool): Promise<LatestSnapshot> {
  const { rows } = await pool.query<SnapshotRow>(
    `SELECT fund_id, as_of, schema_version, report
       FROM composition_snapshot
      ORDER BY as_of DESC
      LIMIT 1`,
  );

  const row = rows[0];
  if (!row) {
    return { status: "empty" };
  }
  if (row.schema_version !== COMPOSITION_SNAPSHOT_SCHEMA_VERSION) {
    return {
      status: "stale",
      storedVersion: row.schema_version,
      expectedVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    };
  }
  return {
    status: "ok",
    fundId: row.fund_id,
    asOf: row.as_of,
    report: row.report,
  };
}
