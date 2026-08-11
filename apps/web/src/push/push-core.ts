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
import {
  assertLogFullyLoaded,
  loadEventLog,
  loadFoldedReview,
  resolveEventStorePaths,
} from "@numisma/event-store";
import {
  loadOrders,
  loadPlans,
  loadPreferences,
  resolveOrdersPath,
  resolvePlansPath,
  resolvePreferencesPath,
} from "@numisma/preferences";
import type { DcaBlock, GlanceBlock, ProjectionReport } from "../projection/contract.ts";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  fundIdOf,
  toProjectionReport,
} from "../projection/contract.ts";
import { buildDcaBlock, type DcaFillInputs } from "./dca-block.ts";
import { buildGlanceBlock } from "./glance.ts";

/** What the push shell's two flags decide, once argv has been read. */
export interface PushArgs {
  /** Apply the DDL before anything else. Set by `--init` AND by `--init-only`. */
  init: boolean;
  /** Apply the DDL and STOP — no fold, no upsert, no durable log required. */
  initOnly: boolean;
}

/**
 * Parse the push shell's argv. Lives here, not in `push.ts`, because `push.ts` is a
 * self-executing script: importing it to test it would run the push. The flag
 * PAIRING is the part worth a test — `--init` and `--init-only` were once fused,
 * which made `pnpm db:init` fold the durable log first and throw ENOENT on exactly
 * the bootstrap and recovery paths it exists for (the shell's header tells the
 * story). That regression was invisible to the suite until a Neon reset; it is not
 * anymore.
 *
 * EXACT-MATCH, so `--init-only` never also trips `--init` by substring. It sets
 * `init` DELIBERATELY and separately: `--init-only` still applies the DDL, it just
 * stops there.
 *
 * DELIBERATELY PERMISSIVE, unlike `parseGapReportArgs`, which rejects an unknown
 * token. That parser takes VALUES (`--since <date>`), where a typo silently rescopes
 * the answer; these two flags are booleans whose absence is the safe default, and
 * the push runs from launchd nightly. Refusing to run on an unrecognized token would
 * turn a harmless typo into a missed day. Ignoring one also lets the literal `--`
 * that pnpm forwards for `pnpm push -- --init` fall through with no special case.
 */
export function parsePushArgs(argv: readonly string[]): PushArgs {
  const initOnly = argv.includes("--init-only");
  return { init: initOnly || argv.includes("--init"), initOnly };
}

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

/**
 * The whole push-side DCA derivation for one folded anchor: read the plans sidecar,
 * then narrow its as-of roster to the wire block. The push's THIRD privileged input,
 * and — with `plans-import-guard.test.ts` — the only place in `apps/web` allowed to
 * name it.
 *
 * PER-ANCHOR, NOT ONCE: the selection is as-of, so an anchor before a plan's
 * `effectiveAt` resolves `none` and the branch is honestly empty on that date. The
 * backfill gets that for free by calling this per anchor, with no special-casing, in
 * exactly the way `loadReserveFloorAsOf` time-travels beside it.
 *
 * BORN-NESS COMES FROM THE FOLD — open positions AND the closed book, the same recipe
 * `pnpm plans` uses at the desk. A position that has been closed WAS realized, so
 * omitting the closed book would render a finished trade `pending` forever.
 *
 * THE READ IS NOT DEFENDED HERE and must not be: `loadPlans` is TOTAL. A missing file
 * is `loaded`-with-empty, the normal starting state; a real read error is
 * `load-failed`, which the block carries as `source: "unreadable"`. Wrapping this in a
 * `try` that produced an empty block would erase precisely that distinction.
 */
export async function buildDcaForAnchor(fold: FoldedAnchor): Promise<DcaBlock> {
  const asOf = fold.report.dashboard.summary.asOf;
  const existingPositionIds = new Set<string>([
    ...fold.data.positions.map((position) => position.id),
    ...(fold.data.closedPositions ?? []).map((closed) => closed.positionId),
  ]);
  return buildDcaBlock(
    await loadPlans(resolvePlansPath()),
    asOf,
    existingPositionIds,
    await loadFillInputs(fold),
  );
}

/**
 * THE PUSH'S FOURTH PRIVILEGED INPUT — the orders sidecar (spec #285, slice 3), and the
 * first time the push has read it at all.
 *
 * WHY IT IS READ NOW, having been kept off this path deliberately until today. The wall
 * `orders-stay-off-the-wire.test.ts` holds was never "orders are untouchable"; it was
 * that ORDERS-DERIVED CAPITAL — committed, available, encumbered — must not reach the
 * phone under any name. That is unchanged and still asserted. What crosses now is the
 * fill path's CONCLUSIONS about a declared ladder, and they cannot be computed without
 * the stream that produced them. The wall therefore moved from "no orders in the push"
 * to "no raw order rows past `dca-block.ts`", which is a boundary the tests can state.
 *
 * `undefined` MEANS NO RECONCILIATION WAS POSSIBLE, and the two cases that produce it
 * are both "the stream I have is not the stream that exists":
 *
 *  - `unreadable` — a real read error. Reconciling over nothing would publish
 *    "declared, nothing placed" for a ladder that may be fully filled.
 *  - a `loaded` file with SKIPPED LINES. A skipped line may be the very fill that
 *    explains a lot, so a partial stream understates what the venue did — the direction
 *    that costs money, and the same reason the loader reports skips rather than
 *    swallowing them. Absence is the honest answer; a warned skip is not a licence.
 *
 * An `absent` file is NOT one of them: no sidecar means no orders, which reconciles
 * perfectly well to a ladder with nothing placed. That is a fact, not a gap.
 *
 * THE RAW EVENT LIST IS READ HERE TOO, and it is PLUMBING RATHER THAN A NEW CROSSING:
 * this module already folds genesis + `events.jsonl` on the line above, so the durable
 * log is an input the push has always had. What it did not have is the log's own EVENTS —
 * `loadFoldedReview` returns the folded read model, which by design carries no event list
 * — and the torn-act detector pairs raw events against sidecar lines by a derived id, so
 * the fold cannot answer it. A second read of a file already read this second is the
 * whole cost; the alternative is re-implementing `loadFoldedReview`'s three calls in web
 * source, which would fork the "refuse a partial log" policy into two places. The same
 * `assertLogFullyLoaded` runs on it, so a quarantined line fails loud here as well: a
 * dropped line could be the very lot whose `orderFilled` half exists, which would publish
 * a torn act that is really a read gap.
 */
async function loadFillInputs(fold: FoldedAnchor): Promise<DcaFillInputs | undefined> {
  const load = await loadOrders(resolveOrdersPath());
  if (load.status === "unreadable") {
    return undefined;
  }
  const orders = load.status === "absent" ? [] : load.records;
  if (load.status === "loaded" && load.skips.length > 0) {
    return undefined;
  }
  const paths = resolveEventStorePaths();
  const log = await loadEventLog(paths.log);
  assertLogFullyLoaded(log, paths.log);
  return {
    orders,
    // UNBOUNDED, deliberately: `buildDcaBlock` applies the anchor to this stream and to
    // the order stream in one place, so the two halves of an act can never be bounded by
    // two different rules.
    events: log.events,
    positions: new Map(
      fold.data.positions.map((position) => [
        position.id,
        { lots: position.lots, currency: position.currency },
      ]),
    ),
    // The fold's own review rate, PASSED rather than fetched — the reconciliation is
    // pure and a rate looked up inside it would make a historical answer depend on when
    // it was asked. It is only ever the fallback: a lot's own `entryFx` wins.
    reviewFx: fold.data.review.usdMxn,
  };
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
   * outside `{ totals, dashboard, glance, dca }` stops here and never leaves the
   * machine.
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
  dca: DcaBlock,
): SnapshotDerivation {
  return {
    fundId: fundIdOf(report),
    asOf: report.dashboard.summary.asOf,
    schemaVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    report: toProjectionReport(report, glance, dca),
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
  dca: DcaBlock,
): Promise<SnapshotDerivation> {
  const derived = deriveSnapshot(report, glance, dca);
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
