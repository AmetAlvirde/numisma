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
import type { CompositionReport, FundReviewData } from "@numisma/engine";
import { buildCompositionReport, pickPolicyAsOf } from "@numisma/engine";
import { loadFoldedReview, resolveEventStorePaths } from "@numisma/event-store";
import { loadPreferences, resolvePreferencesPath } from "@numisma/preferences";
import type { GlanceBlock, ProjectionReport } from "../projection/contract.ts";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  fundIdOf,
  toProjectionReport,
} from "../projection/contract.ts";
import { buildGlanceBlock } from "./glance.ts";

/** The folded read model AND the report built from it, for one anchor. */
export interface FoldedAnchor {
  /**
   * The fold output. Kept alongside the report because the glance builder needs the
   * per-instrument mark record (`closes`) that `toProjectionReport` deliberately
   * never lets out of the machine (D14) — the conclusion is pushed, the input is not.
   */
  data: FundReviewData;
  report: CompositionReport;
}

/**
 * THE SOURCE of what gets pushed: the real fold of the durable log, in the same
 * three calls `apps/tui/src/report.ts` makes — resolve the event-store paths
 * (honoring `NUMISMA_DATA_DIR`), fold genesis + `events.jsonl`, build the
 * composition report. This replaced `loadFixture()` (PRD #134 slice 2): the push
 * shell used to publish a committed JSON fixture, so the row was well-formed, the
 * reader rendered it, and the number on the phone was not the fund. There is no
 * `--fixture` flag, no env toggle and no fallback — a flag would preserve the exact
 * ambiguity this change exists to remove.
 *
 * RETURNS THE FOLD AS WELL AS THE REPORT, which is why this is the one entry point
 * and not a pair of them. The glance builder needs the per-instrument mark record
 * the report does not carry, so a report-only wrapper could serve `push.ts` for
 * exactly as long as the glance did not exist; it has since been deleted rather
 * than left standing as an unused second door onto the same fold.
 *
 * `asOf` IS OPTIONAL, AND THE DEFAULT IS THE CONTRACT: called with no argument this
 * folds CURRENT state, exactly as it always did, and that is the only form the
 * daily `push` command uses. The parameter exists for the `backfill` command (PRD
 * #146 seam D / V4), which replays the log's own anchored dates. It threads
 * straight through to `loadFoldedReview(paths, asOf?)` and from there to the pure
 * `foldEvents(genesis, events, asOf?)`, which filters `event.asOf <= asOf`, applies
 * the latest mark <= that date per instrument, and returns `review.asOf = asOf` —
 * which IS the row key `deriveSnapshot` reads. Zero engine work; the as-of fold has
 * existed end to end all along (C1).
 *
 * THIS COMMENT USED TO READ "Takes NO date argument, by decision", on the grounds
 * that an `--as-of` fold "would write a SECOND row keyed to that historical date
 * and quietly change what 'latest' means to the reader". Writing a second row is
 * true and is now the POINT — `composition_snapshot` is `PRIMARY KEY (fund_id,
 * as_of)`, one row per anchor, history-shaped by construction. The second half was
 * never true: `getSnapshotHistory` arbitrates "latest" on a TYPED NUMERIC date key
 * (`asOfSortKey`), never on lexical TEXT order and never on `pushed_at`, so a
 * backfilled 2026-06-30 row cannot out-date 2026-07-26 no matter when it was
 * written. That typed key is what protects the reader, and it is the whole
 * mechanism.
 *
 * What DID survive the fear is operator confusion — a date argument on the command
 * launchd runs nightly is how a cron job eventually writes the wrong date — and V4
 * answers it with a SEPARATE COMMAND rather than a flag. `push.ts` therefore never
 * passes `asOf`; `backfill-core.ts` is the only caller that does. Do not add an
 * `--as-of` flag to the daily push.
 *
 * FAILS LOUD on a partial log: `loadFoldedReview` asserts the log fully loaded, so
 * an unparseable or legacy-shape line throws here rather than upserting a
 * silently-skewed NAV. `push.ts` calls this BEFORE it constructs the Pool, so that
 * throw happens before any connection or write. It never mutates the log (only the
 * read path's quarantine sidecar beside it moves).
 *
 * The `load` provenance block matches the TUI's report path — and is one of the
 * keys `toProjectionReport` drops, so it never reaches the cloud.
 *
 * GENESIS IS THE FLOOR. `foldEvents` THROWS for an `asOf` strictly before the
 * genesis seed's own date, because there is no honest portfolio state before t0.
 * The backfill never trips this because it enumerates the log's OWN anchors, which
 * are at or after genesis by construction — see `enumerateAnchors`, which filters
 * explicitly rather than relying on that. Noted here so a future caller passing an
 * arbitrary date does not rediscover the throw as a mystery failure.
 */
export async function loadCurrentFold(asOf?: string): Promise<FoldedAnchor> {
  const paths = resolveEventStorePaths();
  const data = await loadFoldedReview(paths, asOf);
  const report = buildCompositionReport(data, {
    load: {
      status: "loaded",
      sourcePath: paths.log,
      loadedAt: new Date().toISOString(),
    },
  });
  return { data, report };
}

/**
 * The Reserve FLOOR in force on `asOf`, read from the ADR-004 preferences sidecar —
 * the push's second privileged input, and the only place in `apps/web` allowed to
 * touch it (`preferences-import-guard.test.ts`).
 *
 * R1 — NO FLOOR IS EVER INVENTED. `loadPreferences` quarantines a malformed line
 * (dropping it) and returns `[]` for a missing file; `pickPolicyAsOf` returns
 * `undefined` when nothing is in effect as-of the anchor. Every one of those paths
 * ends here as `undefined`, which the glance block encodes as an ABSENT
 * `reserveTargetPct` and the reader renders as a suppressed Reserve slot.
 *
 * `defaultProfitPolicyEntry` (which is 10) is deliberately NOT imported. It is a
 * SEED FOR A NEW SIDECAR, not a read-gap filler, and `seedDefaultPreferences` sits
 * one import away in the package this module already depends on. Silently rendering
 * a floor the operator never set is precisely what V2/R1 forbid. Do not reach for it.
 *
 * `pickPolicyAsOf` time-travels — it sorts internally and takes the latest entry
 * with `effectiveAt <= asOf` — so a non-monotonic sidecar replays deterministically
 * and slice 3's backfilled rows get the policy in force on their OWN date for free.
 */
export async function loadReserveFloorAsOf(
  asOf: string,
): Promise<number | undefined> {
  const prefs = await loadPreferences(resolvePreferencesPath());
  return pickPolicyAsOf(prefs, asOf)?.reserveTargetPct;
}

/**
 * The whole push-side glance derivation for one folded anchor: read the floor
 * as-of, then build the block. The single call the push shell makes.
 */
export async function buildGlanceForAnchor(
  fold: FoldedAnchor,
): Promise<GlanceBlock> {
  const asOf = fold.report.dashboard.summary.asOf;
  return buildGlanceBlock(fold.data, fold.report, await loadReserveFloorAsOf(asOf));
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
export function deriveSnapshot(
  report: CompositionReport,
  glance: GlanceBlock,
): SnapshotDerivation {
  return {
    fundId: fundIdOf(report),
    asOf: report.dashboard.summary.asOf,
    schemaVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    report: toProjectionReport(report, glance),
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
  glance: GlanceBlock,
): Promise<SnapshotDerivation> {
  const derived = deriveSnapshot(report, glance);
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
