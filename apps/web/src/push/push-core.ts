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
import type { CompositionReport, FoldedReview } from "@numisma/engine";
import { buildCompositionReport, pickPolicyAsOf } from "@numisma/engine";
import {
  assertLogFullyLoaded,
  loadEventLog,
  loadFoldedReview,
  resolveEventStorePaths,
  unattendedFoldVerdict,
} from "@numisma/event-store";
import type { LoadedPreferences } from "@numisma/engine";
import {
  loadOrders,
  loadPlans,
  loadPreferences,
  resolveOrdersPath,
  resolvePlansPath,
  resolvePreferencesPath,
  unattendedPreferencesVerdict,
} from "@numisma/preferences";
import type {
  DcaBlock,
  GlanceBlock,
  GlanceVenueDarkDay,
  ProjectionReport,
} from "../projection/contract.ts";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  fundIdOf,
  toProjectionReport,
} from "../projection/contract.ts";
import { buildDcaBlock, type DcaFillInputs } from "./dca-block.ts";
import { buildGlanceBlock, venueDarkOrOmit } from "./glance.ts";
// TYPE-ONLY: this module files into the channel it is handed and never constructs one.
// The shells own the channel's lifetime, because a run has one channel and many kinds.
import type { RunReport } from "./unattended-report.ts";

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

/**
 * The folded read model AND the report built from it, for one anchor.
 *
 * IT EXTENDS THE FOLD'S ENVELOPE rather than copying `data` out of it: `data` is the
 * fold output (kept alongside the report because the glance builder needs the
 * per-instrument mark record, `closes`, that `toProjectionReport` deliberately never
 * lets out of the machine — D14, the conclusion is pushed and the input is not), and
 * `skipped` is every event this fold read and could not apply. Carrying only `data`
 * here would reproduce #293 one layer further out, which is the whole defect PRD #323
 * exists to remove.
 */
export interface FoldedAnchor extends FoldedReview {
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
  // THE WHOLE ENVELOPE GOES ON, unwrapped nowhere: `data` builds the report and
  // `skipped` rides out to the shell, which turns it into prose AFTER the row lands
  // (PRD #323 seam E). Nothing here decides what a dropped event means — this is a
  // loader, and the policy is `unattendedFoldVerdict` (ADR-020 clause 4).
  const { data, skipped } = await loadFoldedReview(paths, asOf);
  const report = buildCompositionReport(data, {
    load: {
      status: "loaded",
      sourcePath: paths.log,
      loadedAt: new Date().toISOString(),
    },
  });
  return { data, skipped, report };
}

/**
 * The Reserve FLOOR in force on `asOf`, read from the ADR-004 preferences sidecar —
 * the push's second privileged input, and the only place in `apps/web` allowed to
 * touch it (`preferences-import-guard.test.ts`).
 *
 * R1 — NO FLOOR IS EVER INVENTED. `loadPreferences` discards a malformed line and
 * returns empty `entries` for a missing or unreadable file; `pickPolicyAsOf` returns
 * `undefined` when nothing is in effect as-of the anchor. Every one of those paths
 * ends here as an absent `reserveTargetPct`, which the glance block encodes as an
 * ABSENT field and the reader renders as a suppressed Reserve slot.
 *
 * IT RETURNS THE WHOLE LOAD, NOT JUST THE FLOOR, and that widening is the Discard
 * Channel's second clause reaching the shell: the skips are a value the caller
 * receives whether or not it looks. Returning only the number would leave the
 * discards visible at this line and nowhere else — which is exactly the silence spec
 * #320 exists to remove, moved one function outward. NOTHING HERE DECIDES WHAT A SKIP
 * MEANS: this is a loader, and the policy is `unattendedPreferencesVerdict`.
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
): Promise<ReserveFloorLoad> {
  const preferences = await loadPreferences(resolvePreferencesPath());
  return {
    reserveTargetPct: pickPolicyAsOf(preferences.entries, asOf)?.reserveTargetPct,
    preferences,
  };
}

/** The floor in force on an anchor, AND the load that answered — skips included. */
export interface ReserveFloorLoad {
  /** Absent whenever no policy is in force as-of the anchor. Never invented (R1). */
  reserveTargetPct: number | undefined;
  /** The whole envelope, so the shell can report what the read discarded. */
  preferences: LoadedPreferences;
}

/**
 * One anchor's glance block, AND the loads that produced it.
 *
 * THE SECOND FIELD IS THE SEAM, and it is deliberately a RECORD rather than a pair.
 * This derivation already composes two as-of loads and will compose more; each one
 * that can discard an input owes the shell its envelope, and each gets its own named
 * field here. A tuple, or a bare `LoadedPreferences` return, would make the next
 * tenant rewrite the signature instead of adding a key to it.
 *
 * NOTHING IN HERE REACHES THE WIRE. `deriveSnapshot` takes {@link glance} alone; the
 * envelopes stay on the operator's side of the run, and `projection-payload.test.ts`
 * plus `discard-channel.test.ts` both hold that line.
 */
export interface AnchorGlance {
  /** The block that goes on the wire, and the ONLY field that does. */
  glance: GlanceBlock;
  /** The preferences envelope the floor was read from. Operator channel only. */
  preferences: LoadedPreferences;
  /**
   * The FOLD's envelope — the second tenant, and a SIBLING KEY rather than a second
   * member of a pair, which is the whole reason this interface is a record (PRD #323
   * seam E arriving on spec #320 seam C's seam without rewriting it). Operator channel
   * only: `deriveSnapshot` takes {@link glance} alone, and `fold-discard-surface.test.ts`
   * holds that line the same way `discard-channel.test.ts` holds it for `preferences`.
   */
  folded: FoldedReview;
}

/**
 * The whole push-side glance derivation for one folded anchor: read the floor
 * as-of, derive the venue-dark verdict as-of, then build the block. The single call
 * the push shell makes.
 */
export async function buildGlanceForAnchor(
  fold: FoldedAnchor,
): Promise<AnchorGlance> {
  const asOf = fold.report.dashboard.summary.asOf;
  const floor = await loadReserveFloorAsOf(asOf);
  return {
    glance: buildGlanceBlock(
      fold.data,
      fold.report,
      floor.reserveTargetPct,
      await loadVenueDarkAsOf(asOf),
    ),
    preferences: floor.preferences,
    // Carried, not acted on: the fold that produced `fold.data` already reported what
    // it dropped, and this hands that report on to the shell unchanged.
    folded: { data: fold.data, skipped: fold.skipped },
  };
}

/**
 * #266 D6 — THE VENUE-DARK VERDICT FOR ONE ANCHOR, or `undefined` if it could not be
 * had. This is the wiring D6 called cheap: `apps/web/src/push` already consumes
 * `@numisma/event-store` and already folds this exact log, so no package edge is added.
 *
 * IT CAN NEVER WITHHOLD THE PUSH, and that is D6's absolute condition rather than a
 * defensive habit. Both halves are inside the guard — the read AND the derivation —
 * because either can fail, and neither failure is worth a night without a NAV on the
 * phone. ADR-007's third amendment names the rule: *degrade the branch, never the
 * anchor.* An absent field is contractually "this build could not answer", and no
 * surface may render that as an all-clear.
 *
 * IT DELIBERATELY DOES NOT `assertLogFullyLoaded`, unlike {@link loadFillInputs}. The
 * caller has already folded this same log through `loadFoldedReview`, which asserts it
 * and throws BEFORE anything reaches here — so a partial log has already stopped the
 * push, and re-asserting could only turn a clean run into a withheld one. The residual
 * case is a log that became unreadable between the two reads, and the honest answer
 * there is an absent field, not a failed push.
 *
 * PER-ANCHOR, AND IT COSTS ONE RE-READ OF A SMALL LOCAL FILE. `runBackfill` already
 * re-reads genesis + the log per anchor deliberately (see its header), and
 * `loadFillInputs` re-reads it again; this is a third read of the same warm file over
 * the low tens of anchors. Said out loud rather than hidden: if the anchor count ever
 * makes that matter, the fix is to hoist ONE read through the loop, not to compute the
 * verdict once and stamp it on every historical row.
 */
async function loadVenueDarkAsOf(
  asOf: string,
): Promise<GlanceVenueDarkDay[] | undefined> {
  try {
    const log = await loadEventLog(resolveEventStorePaths().log);
    return venueDarkOrOmit(log.events, asOf);
  } catch {
    return undefined;
  }
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

/**
 * The preferences report's KIND on the run's operator channel. Named and exported so a
 * co-tenant kind is added beside it rather than by editing a string literal in three
 * shells — and so a test can ask for this kind's lines alone.
 */
export const PREFERENCES_DIAGNOSTIC_KIND = "preferences";

/**
 * The FOLD report's kind on the run's operator channel — the co-tenant
 * {@link PREFERENCES_DIAGNOSTIC_KIND} was named for, added beside it exactly as that
 * constant's docstring promised rather than by editing a string literal in three shells.
 *
 * A KIND IS THE QUESTION THE DIAGNOSTIC ANSWERS (ADR-020). "Which lines of the policy
 * sidecar could not be read" and "which events of the durable log could not be applied"
 * are two questions, so they are two kinds, and the channel bounds them separately —
 * neither can starve the other no matter how loud one gets.
 */
export const FOLD_DIAGNOSTIC_KIND = "fold";

/** Everything one unattended anchor needs in order to push and then report. */
export interface UnattendedPushInput {
  pool: Pool;
  report: CompositionReport;
  /** The glance AND the envelopes it was derived from — see {@link AnchorGlance}. */
  anchor: AnchorGlance;
  dca: DcaBlock;
  /** The run's shared operator channel. Other kinds may already have filed into it. */
  channel: RunReport;
  /** Where the channel is written. Injected so the ORDERING below is assertable. */
  emit?: ((line: string) => void) | undefined;
}

/** What the run produced, and how it should end. */
export interface UnattendedPush {
  derived: SnapshotDerivation;
  /**
   * THIS KIND'S exit code, not the run's. A caller with more than one diagnostic kind
   * composes the codes itself — kinds do not share an exit policy, and a function that
   * returned "the run's code" would be deciding for tenants it does not know about.
   */
  exitCode: number;
}

/**
 * UPSERT FIRST, REPORT AFTER — the whole point of spec #320's seam C, and the reason
 * this function exists at all rather than three lines inside `push.ts`'s `main()`.
 *
 * `buildGlanceForAnchor` runs BEFORE the upsert, so a diagnostic raised where the
 * discard is discovered is one refactor away from withholding the snapshot. The
 * Discard Channel's fifth clause forbids exactly that: availability of the fund's
 * daily view outranks the completeness of any one sidecar. So the skips are CARRIED —
 * out of the loader in its envelope, through {@link AnchorGlance}, to here — and only
 * turned into prose and an exit code once the row has landed. `push.ts` is a
 * self-executing script that no test may import, which is why the ordering lives in
 * this importable function instead: `discard-channel.test.ts` drives it with a pool
 * and an emitter sharing one sequence log, so "after" is asserted rather than read off
 * the shell's line order.
 *
 * THE THREE LINES AFTER THE UPSERT ARE THE CO-TENANCY SEAM, and they are deliberately
 * not collapsed into a helper: derive one kind's verdict, file its PROSE under its own
 * kind, return its EXIT CODE separately. A second kind is three more lines in the same
 * shape, with its own exit policy — including one that is always zero — and neither
 * kind's report can starve the other, because the channel bounds per kind.
 */
export async function pushAnchorAndReport(
  input: UnattendedPushInput,
): Promise<UnattendedPush> {
  const derived = await upsertSnapshot(
    input.pool,
    input.report,
    input.anchor.glance,
    input.dca,
  );

  const verdict = unattendedPreferencesVerdict(input.anchor.preferences);
  input.channel.add(PREFERENCES_DIAGNOSTIC_KIND, verdict.messages);
  // THE SECOND KIND, in the same three-line shape and with its own exit policy — which
  // is that it HAS none. `unattendedFoldVerdict` returns prose and nothing else, so
  // there is no code to fold in here and no way to write one by accident; a fold
  // discard points into append-only history and can never extinguish, so an exit code
  // would redden this run's errand channel permanently (ADR-020; spec #323 R7).
  input.channel.add(
    FOLD_DIAGNOSTIC_KIND,
    unattendedFoldVerdict(input.anchor.folded).messages,
  );
  input.channel.emit(input.emit ?? ((line) => console.error(line)));
  return { derived, exitCode: verdict.exitCode };
}
