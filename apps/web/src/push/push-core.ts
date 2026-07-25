/**
 * Push core (Deliverable C) — the IMPORTABLE, self-exec-free half of the push
 * shell. `push.ts` is a `main().then(..., process.exit)` script: importing it
 * would run it. This module holds the pieces worth asserting on their own — the
 * real fold of the durable log, the pure derivation and the real upsert SQL — so
 * a unit test can cover
 * the derivation without a DB and the integration test can drive the EXACT upsert
 * path (`INSERT ... ON CONFLICT (fund_id, as_of) DO UPDATE`) the script runs, not
 * a copy of it. `push.ts` now just wires argv + credentials around these.
 */
import type { Pool } from "pg";
import type { CompositionReport } from "@numisma/engine";
import { buildCompositionReport } from "@numisma/engine";
import { loadFoldedReview, resolveEventStorePaths } from "@numisma/event-store";
import type { ProjectionReport } from "../projection/contract.ts";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  fundIdOf,
  toProjectionReport,
} from "../projection/contract.ts";

/**
 * THE SOURCE of what gets pushed: the real fold of the durable log, in the same
 * three calls `apps/tui/src/report.ts` makes — resolve the event-store paths
 * (honoring `NUMISMA_DATA_DIR`), fold genesis + `events.jsonl` to CURRENT state,
 * build the composition report. This replaced `loadFixture()` (PRD #134 slice 2):
 * the push shell used to publish a committed JSON fixture, so the row was
 * well-formed, the reader rendered it, and the number on the phone was not the
 * fund. There is no `--fixture` flag, no env toggle and no fallback — a flag
 * would preserve the exact ambiguity this change exists to remove.
 *
 * Takes NO date argument, by decision: it always folds current state. An
 * `--as-of` fold would write a SECOND row keyed to that historical date and
 * quietly change what "latest" means to the reader.
 *
 * FAILS LOUD on a partial log: `loadFoldedReview` asserts the log fully loaded,
 * so an unparseable or legacy-shape line throws here rather than upserting a
 * silently-skewed NAV. `push.ts` calls this BEFORE it constructs the Pool, so
 * that throw happens before any connection or write. It never mutates the log
 * (only the read path's quarantine sidecar beside it moves).
 *
 * The `load` provenance block matches the TUI's report path — and is one of the
 * keys `toProjectionReport` drops, so it never reaches the cloud.
 */
export async function loadCurrentReport(): Promise<CompositionReport> {
  const paths = resolveEventStorePaths();
  const data = await loadFoldedReview(paths);
  return buildCompositionReport(data, {
    load: {
      status: "loaded",
      sourcePath: paths.log,
      loadedAt: new Date().toISOString(),
    },
  });
}

/** The three projected identity/versioning columns derived from a report. */
export interface SnapshotDerivation {
  /** Deterministic fund id (slug of the fund name) — the conflict key's first half. */
  fundId: string;
  /** Snapshot's logical calendar date — the conflict key's second half. */
  asOf: string;
  /** The contract schema version stamped on the row. */
  schemaVersion: number;
  /**
   * The NARROWED payload written to the `report` JSONB column — built key-by-key
   * by `toProjectionReport`, never the wide `CompositionReport` (D8). Everything
   * outside `{ totals, dashboard }` stops here and never leaves the machine.
   */
  report: ProjectionReport;
}

/**
 * PURE derivation: engine report → the `(fund_id, as_of, schema_version, report)`
 * actually written to the projection. Delegates to the shared projection contract
 * (`fundIdOf`, `COMPOSITION_SNAPSHOT_SCHEMA_VERSION`, `toProjectionReport`) so
 * writer and reader can never disagree. No I/O, no DB — unit-testable on its own.
 *
 * The `report` field is the WHOLE payload the push sends: `upsertSnapshot`
 * serializes exactly this and nothing else, so a test over `deriveSnapshot` is a
 * test over what reaches the cloud.
 */
export function deriveSnapshot(report: CompositionReport): SnapshotDerivation {
  return {
    fundId: fundIdOf(report),
    asOf: report.dashboard.summary.asOf,
    schemaVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    report: toProjectionReport(report),
  };
}

/**
 * Idempotently upsert a report into `composition_snapshot` through `pool` (the
 * WRITE credential). Append/upsert only — the `ON CONFLICT (fund_id, as_of) DO
 * UPDATE` refreshes `report` / `schema_version` and bumps `pushed_at`; it never
 * DELETEs, so a re-push of the same `(fund_id, as_of)` yields exactly ONE row and
 * the ADR-007 no-DELETE writer invariant holds. Returns the derivation applied.
 *
 * The JSONB written is `derived.report` — the narrowed `{ totals, dashboard }`
 * built by `toProjectionReport`, NOT the wide report passed in (D8).
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
    [
      derived.fundId,
      derived.asOf,
      derived.schemaVersion,
      JSON.stringify(derived.report),
    ],
  );
  return derived;
}
