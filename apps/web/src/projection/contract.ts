/**
 * Projection contract — the SINGLE SOURCE OF TRUTH for the composition_snapshot
 * projection DB (ADR-007). Imported by BOTH the web reader (Deliverable E) and
 * the push shell (Deliverable C), so the schema version, the fund-id derivation,
 * and the row shape can never drift between writer and reader.
 *
 * The `report` column is typed as {@link ProjectionReport} — a `Pick` of the
 * engine's `CompositionReport`. That import is the compile-time drift guard: if
 * the engine's dashboard shape changes, `pnpm --filter @numisma/web typecheck`
 * breaks here.
 *
 * This module is the right home for the narrowing (D8): the engine must stay
 * unaware that a cloud exists, so the "what may leave the machine" decision
 * lives on the web side, next to the row shape it governs.
 */
import { Pool } from "pg";
import type { CompositionReport } from "@numisma/engine";

/**
 * The ONLY slice of the engine's `CompositionReport` that is allowed to leave
 * the machine and land in the hosted projection DB (ADR-007 blast radius, as
 * re-decided in D8 of the 2026-07-24 hosted-security grill).
 *
 * DELIBERATELY DROPPED, and each drop is a decision, not an omission:
 *  - `invalidationWatch` — per-position stop levels (instrument, mark, level,
 *    direction, breached). The sharpest item in the system: positions PLUS the
 *    price at which the operator is forced out is materially more useful to an
 *    adversary than either alone. Near-zero value on the phone-glance view that
 *    justified the hosted leg.
 *  - `closedBook` — the full closed-trade blotter with realized P&L and
 *    open/close dates, including per-row `strategy` tags. Trade history, not
 *    current composition.
 *  - `priceJourneys`, `reserveReconciliation`, and the fold diagnostics
 *    (`warnings`, `excluded`, `load`) — operational detail with no phone-glance
 *    use case.
 *
 * WHY A `Pick` AND NOT A HAND-ROLLED INTERFACE: a `Pick` tracks the engine's own
 * types. If `totals` or `dashboard` is RENAMED upstream, this line stops
 * compiling and `pnpm --filter @numisma/web typecheck` goes red. A hand-rolled
 * mirror would keep compiling against a stale copy of the shape and let writer
 * and reader drift apart silently — which is exactly the failure that produced D8
 * in the first place (the engine grew, the projection inherited the growth, and
 * nothing said so).
 *
 * WHAT THE `Pick` DOES NOT DO — read this before trusting it: a `Pick` tracks
 * only the TOP-LEVEL key set. It says nothing about growth *inside* `totals` or
 * `dashboard`. Add `DashboardSummary.entryNote` or `CompositionRow.strategyLabel`
 * upstream and this line still compiles, {@link toProjectionReport} still copies
 * `report.dashboard` wholesale by reference, and the new field serializes
 * straight into the hosted JSONB — the identical drift D8 exists to stop, one
 * level deeper. {@link ProjectionKeyAllowList} is what closes that; it, not the
 * `Pick`, is the durable guard.
 *
 * A `Pick` narrows the TYPE only. The runtime narrowing is
 * {@link toProjectionReport}, which builds the payload key-by-key; a type
 * assertion over the wide object would still serialize every extra key into
 * JSONB. `push/projection-payload.test.ts` is the durable guard on THAT half —
 * it walks the actually-derived payload and allow-lists every key path it finds,
 * so a cast that smuggles the wide object through fails at runtime the same way
 * {@link ProjectionKeyAllowList} fails at compile time.
 *
 * Widening later is cheap by design: widen this `Pick`, bump
 * {@link COMPOSITION_SNAPSHOT_SCHEMA_VERSION}, re-push, deploy. The reader's
 * `status: "stale"` branch refuses a version it does not expect, so a stale
 * snapshot is a clean refusal, never a mis-render.
 */
export interface GlanceMissingMark {
  /**
   * The composition row id the absent mark belongs to — `instrument:<id>`, the
   * engine's own row-id convention. Slice 5's per-row suppression matches on it.
   */
  rowId: string;
  /** The row's display label (`SYMBOL (Name)`) — the same string `sections` carries. */
  label: string;
}

/**
 * The glance block (PRD #146 seam B) — the conclusions the READER cannot reach on
 * its own, computed push-side and shipped as conclusions rather than as inputs.
 *
 * THE RULE THAT PLACES EVERY FIELD HERE: *does this computation need data D8 keeps
 * off the wire?* If yes the push computes it and ships the answer; if no the reader
 * computes it from the wire plus the wall clock. Freshness is therefore NOT here —
 * it is `summary.asOf` against the clock, a render-time derivation. Expectation-vs-
 * arrival IS here, because it needs per-instrument mark dates that must never leave
 * the machine (D14).
 */
export interface GlanceBlock {
  /**
   * The Reserve FLOOR in force on THIS anchor, stamped by the push from the
   * as-of preferences sidecar (R5).
   *
   * ABSENT means no policy was in effect as-of this anchor (or the governing line
   * was quarantined). It is NEVER defaulted and NEVER `10` (V2/R1): rendering a
   * floor the operator never set is precisely the failure the invariant forbids.
   * `defaultProfitPolicyEntry` is a SEED FOR A NEW SIDECAR, not a read-gap filler.
   *
   * C4: the wire says `target`, the UI says `floor`. The divergence is deliberate
   * (renaming would mean migrating an append-only sidecar) — do not "fix" it.
   */
  reserveTargetPct?: number;
  /**
   * D14 — the CONCLUSION of expectation-vs-arrival, never the mark dates it was
   * computed from. `expected` is how many instruments the venue calendar says
   * should have quoted on this anchor; `arrived` how many did; `missing` names the
   * shortfall by row id + label, BOTH of which `sections` already carries, so this
   * block adds zero new classes of data.
   *
   * Rejected: `markAsOf?` on every `CompositionRow`. That ships a per-instrument
   * observation timeline — materially closer to the `priceJourneys` D8 dropped on
   * purpose — and discloses which instruments are actively traded.
   */
  feedGap: {
    expected: number;
    arrived: number;
    missing: GlanceMissingMark[];
  };
  /**
   * V5 — every number whose input was UNEXPECTEDLY absent, named by key. A key
   * present here means "this number would be wrong, so it is not rendered".
   *
   * A LIST OF KEYS, NOT N BOOLEANS, and that encoding is the point: this slice
   * emits the three header keys (`summary.fundValueUsd`, `summary.change`,
   * `summary.reserve`); slice 5 adds `CompositionRow.id`s to the SAME array, at no
   * schema cost. There is no v4 for that extension (C5).
   */
  suppressed: string[];
}

/**
 * The pushed payload: the engine `Pick` above PLUS a third top-level branch the
 * PROJECTION authors.
 *
 * WHY A THIRD BRANCH AND NOT NEW `DashboardSummary` FIELDS. Putting `glance` on
 * `dashboard` means widening an engine type — which drags the TUI along, re-opens
 * D8's "what may leave the machine" one level down, and makes the engine aware a
 * cloud exists. This module's own header states the opposite principle. A block
 * authored here keeps the engine at ZERO contract change (C1) and passes the
 * deletion test cleanly: delete `glance` and the glance feature dies; nothing else
 * notices.
 */
export type ProjectionReport = Pick<CompositionReport, "totals" | "dashboard"> & {
  glance: GlanceBlock;
};

/** Resolves to `T` only when `T` is `true`; otherwise the alias itself errors. */
type Assert<T extends true> = T;

/** Element type of an array type — used to reach INTO `sections` and `rows`. */
type ElementOf<T> = T extends readonly (infer E)[] ? E : never;

/**
 * Compile-time proof that `T`'s key set is EXACTLY `Allowed` — neither side
 * carrying a key the other lacks.
 *
 * Resolves to `true` when they match. When they do not it resolves to an object
 * type whose single SHOUTING property name is the diagnosis and whose value type
 * is the offending key, so the `Assert<...>` below fails with the actual key
 * named in the compiler error rather than a bare `true`/`false` mismatch.
 *
 * Both directions matter. Unlisted keys are the leak this exists to stop; listed
 * keys the type no longer has are how an allow-list rots into decoration.
 */
type KeysAreExactly<T, Allowed extends string> = [
  Exclude<keyof T, Allowed>,
] extends [never]
  ? [Exclude<Allowed, keyof T>] extends [never]
    ? true
    : {
        ALLOW_LIST_NAMES_A_KEY_THE_ENGINE_TYPE_NO_LONGER_HAS: Exclude<
          Allowed,
          keyof T
        >;
      }
  : {
      ENGINE_GREW_A_KEY_THE_PROJECTION_ALLOW_LIST_DOES_NOT_NAME: Exclude<
        keyof T,
        Allowed
      >;
    };

type ProjectionSummary = ProjectionReport["dashboard"]["summary"];
type ProjectionFocus = NonNullable<ProjectionSummary["largestPortfolio"]>;
type ProjectionSection = ElementOf<ProjectionReport["dashboard"]["sections"]>;
type ProjectionRow = ElementOf<ProjectionSection["rows"]>;

/**
 * THE DURABLE NARROWING GUARD (D8) — an exhaustive ALLOW-LIST over every key at
 * every depth of {@link ProjectionReport}, checked by the compiler.
 *
 * WHY AN ALLOW-LIST AND NOT A BLOCKLIST: "what may leave the machine" is a
 * closed question, so it needs closed-world enforcement. A blocklist of known-bad
 * key names (`strategy`, `invalidation`, …) only ever catches the leaks somebody
 * already thought of; a field nobody anticipated passes it by construction. This
 * inverts the polarity — every key must be named HERE to be allowed out, so an
 * engine increment that adds ANY field under `totals` or `dashboard` fails
 * `pnpm --filter @numisma/web typecheck` and forces a deliberate re-decision
 * instead of silently inheriting it.
 *
 * WHEN THIS GOES RED: do not reflexively paste the new key in. Decide whether it
 * may leave the machine at all. If yes, add it here and bump
 * {@link COMPOSITION_SNAPSHOT_SCHEMA_VERSION}. If no, drop it in
 * {@link toProjectionReport} — which then has to stop copying its parent
 * wholesale and construct that level key-by-key too.
 *
 * Exported so it can never be dead-code-eliminated or flagged unused; it carries
 * no runtime value and is erased at build.
 */
export type ProjectionKeyAllowList = {
  totals: Assert<
    KeysAreExactly<
      ProjectionReport["totals"],
      "baseCurrency" | "fundValueUsd" | "usdMxn"
    >
  >;
  dashboard: Assert<
    KeysAreExactly<ProjectionReport["dashboard"], "summary" | "sections">
  >;
  summary: Assert<
    KeysAreExactly<
      ProjectionSummary,
      | "fundName"
      | "asOf"
      | "fundValueUsd"
      | "usdMxn"
      | "totalUnrealizedPnlUsd"
      | "largestPortfolio"
      | "largestTempo"
      | "largestAccount"
      | "largestInstrument"
      | "reserve"
      | "dataSafety"
    >
  >;
  summaryDataSafety: Assert<
    KeysAreExactly<
      ProjectionSummary["dataSafety"],
      | "nonLiveExcluded"
      | "invalidExcluded"
      | "shortDeferredExcluded"
      | "hasWarnings"
    >
  >;
  /** Shared by every `largest*` field and `reserve` on the summary. */
  summaryFocus: Assert<
    KeysAreExactly<
      ProjectionFocus,
      "rowId" | "kind" | "label" | "usdValue" | "percentOfFund"
    >
  >;
  section: Assert<
    KeysAreExactly<ProjectionSection, "id" | "title" | "rows">
  >;
  sectionRow: Assert<
    KeysAreExactly<
      ProjectionRow,
      | "id"
      | "kind"
      | "label"
      | "usdValue"
      | "percentOfFund"
      | "costBasisUsd"
      | "unrealizedPnlUsd"
    >
  >;
  /**
   * The glance branch. The compile-time half is weaker here BY NATURE — the
   * projection owns `GlanceBlock`, so widening the type and widening the allow-list
   * are one edit away from each other, where the engine branches above are guarded
   * across a package boundary. The RUNTIME guard is not weaker:
   * `push/projection-payload.test.ts` walks the actually-derived payload and
   * allow-lists every key path it finds, so a wider block fails there the same way
   * an engine growth fails here. These three lines still earn their keep as the
   * place a reviewer sees the block's shape declared as closed.
   */
  glance: Assert<
    KeysAreExactly<GlanceBlock, "reserveTargetPct" | "feedGap" | "suppressed">
  >;
  glanceFeedGap: Assert<
    KeysAreExactly<GlanceBlock["feedGap"], "expected" | "arrived" | "missing">
  >;
  glanceMissing: Assert<KeysAreExactly<GlanceMissingMark, "rowId" | "label">>;
};

/**
 * Build the pushed payload BY EXPLICIT CONSTRUCTION — the runtime half of the
 * {@link ProjectionReport} narrowing.
 *
 * Key-by-key on purpose. `report as ProjectionReport` would satisfy the compiler
 * while the value at runtime is still the whole wide report, and every dropped
 * field would serialize straight into the `report` JSONB column. The type is the
 * intent; this function is the enforcement.
 *
 * `glance` is a REQUIRED argument, not an optional one with a default. There is no
 * honest empty glance: an all-zero `feedGap` asserts "nothing was expected and
 * nothing is missing", which on a real Tuesday outage is the false *no* a triage
 * surface cannot have. A caller that has no glance to give must not push.
 */
export function toProjectionReport(
  report: CompositionReport,
  glance: GlanceBlock,
): ProjectionReport {
  return {
    totals: report.totals,
    dashboard: report.dashboard,
    glance,
  };
}

/**
 * Version of the payload shape stored in the projection. Bump this in lockstep
 * with any breaking change to {@link ProjectionReport} so the reader can REFUSE
 * to render a stale snapshot instead of mis-rendering it.
 *
 * History:
 *  - v1 — the whole engine `CompositionReport` was pushed.
 *  - v2 — payload narrowed to `{ totals, dashboard }` (D8). `invalidationWatch`,
 *    `closedBook` (and its `strategy` tags), `priceJourneys`,
 *    `reserveReconciliation` and the fold diagnostics no longer leave the
 *    machine. A v1 row read by a v2 reader yields `status: "stale"`.
 *  - v3 — the third top-level `glance` branch (PRD #146 seam B): the as-of Reserve
 *    floor, the derived `feedGap` conclusion, and the `suppressed` key list. The
 *    engine's contract is UNCHANGED by this bump (C1) — the block is authored here.
 *    A v2 row read by a v3 reader is `status: "stale"`, and v2 rows are dropped
 *    from `anchors` entirely (see {@link getSnapshotHistory}), which is what makes
 *    the cutover graceful: the next daily push writes a v3 row that renders
 *    immediately, and leftover v2 rows are simply unresolvable as references until
 *    the backfill upgrades them.
 *
 * C5: a two-sided Reserve range, if it ever ships, arrives as an additive optional
 * `reserveCeilingPct?` — and `suppressed` absorbs new numbers without a shape
 * change. Neither is a v4.
 */
export const COMPOSITION_SNAPSHOT_SCHEMA_VERSION = 3;

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

/** One stored anchor: a single `(fund_id, as_of)` row's identity plus its payload. */
export interface SnapshotAnchor {
  fundId: string;
  asOf: string;
  report: ProjectionReport;
}

/**
 * Discriminated result of {@link getSnapshotHistory}.
 *
 * Same `empty | stale | ok` union the single-day reader always returned, widened on
 * the `ok` branch to carry BOTH `latest` and the full `anchors` history. D4's named
 * reference — the entire change/delta feature — has no delivery mechanism without
 * it, because the app could previously only ever see one day.
 *
 * Nearest-anchor resolution (V3) deliberately does NOT live here. It is a pure
 * function over `anchors` and belongs to slice 4's verdict module: this query
 * returns the anchors, it does not interpret them.
 */
export type SnapshotHistory =
  | { status: "empty" }
  | { status: "stale"; storedVersion: number; expectedVersion: number }
  | { status: "ok"; latest: SnapshotAnchor; anchors: SnapshotAnchor[] };

interface SnapshotRow {
  fund_id: string;
  as_of: string;
  schema_version: number;
  report: ProjectionReport;
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
 * TEST-ONLY seam for the module-level `readerPool` singleton. NOT part of the
 * production reader/writer contract — do not call from app code.
 *
 * `getReaderPool()` memoizes a lazily-constructed pool in module scope, which
 * would otherwise leak across tests (a pool set up in one test would be returned
 * to the next). This lets a test reset the singleton (`setReaderPoolForTests()`
 * with no argument) or inject a stub pool (`setReaderPoolForTests(stub)`) so each
 * test starts from a known state. Production lazy construction from
 * PROJECTION_DATABASE_URL in `getReaderPool()` is unchanged.
 */
export function setReaderPoolForTests(pool?: Pool): void {
  readerPool = pool;
}

/**
 * Chronologically-comparable sort key for an `as_of` calendar date.
 *
 * `as_of` is stored as TEXT (schema.sql), so a SQL `ORDER BY as_of` is a *lexical*
 * TEXT sort — correct ONLY while every value is strict zero-padded ISO
 * (`YYYY-MM-DD`). It silently picks the wrong "latest" the moment a value is not
 * zero-padded: lexically `"2026-10-01" < "2026-9-1"` (because `'1' < '9'` at the
 * fifth character), yet October is chronologically *after* September. We therefore
 * arbitrate "latest" on a *typed* numeric key (year*10000 + month*100 + day)
 * rather than trusting TEXT order.
 *
 * Throwing on an unparseable `as_of` keeps the contract honest: a value we cannot
 * order chronologically must not silently win or lose under a lexical fallback.
 *
 * EXPORTED (it was module-private) so `anchors` can be ordered THROUGH the same key
 * the "latest" arbitration uses, and so slice 4's nearest-anchor resolution can too.
 * Re-deriving date ordering by string comparison anywhere else would re-introduce
 * exactly the lexical trap described above, in a second place.
 */
export function asOfSortKey(asOf: string): number {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(asOf);
  if (!match) {
    throw new Error(
      `getSnapshotHistory: as_of ${JSON.stringify(asOf)} is not a sortable ISO calendar date`,
    );
  }
  const [, year, month, day] = match;
  return Number(year) * 10000 + Number(month) * 100 + Number(day);
}

/**
 * Read the projection's ANCHOR HISTORY. Returns a refusal result rather than throwing
 * for the two "expected" bad states:
 *  - no rows yet            -> { status: "empty" }
 *  - stored schema mismatch -> { status: "stale", storedVersion, expectedVersion }
 * Only an actual DB/query failure — or an `as_of` we cannot order (see
 * {@link asOfSortKey}) — rejects.
 *
 * "Latest" is arbitrated in-process on a typed date key, NOT by a SQL
 * `ORDER BY as_of ... LIMIT 1`: `as_of` is a TEXT column, so a SQL sort is lexical
 * and mis-picks the latest for any non-zero-padded date. It is also decided by the
 * snapshot's logical `as_of` date, never by `pushed_at` — `pushed_at` is refreshed
 * on every upsert, so an old-dated snapshot re-pushed must not win.
 *
 * SCOPE — single fund (ADR-007). The product is single-tenant/single-fund, so
 * this deliberately scans the whole `composition_snapshot` table with no
 * `WHERE fund_id` filter and arbitrates across every row. That is intentional,
 * not an oversight: the in-process typed-date arbitration above requires reading
 * all candidate rows anyway, and a `LIMIT` would have to follow a (lexically
 * unsafe) SQL sort. If funds ever coexist, add a `fund_id` parameter + filter
 * here so one fund's snapshots can't out-date another's.
 *
 * THIS IS A RETURN-SHAPE WIDENING, NOT A NEW QUERY AND NOT A PAYLOAD CHANGE. The
 * SELECT below is byte-identical to the one the single-day reader ran: no WHERE, no
 * LIMIT. It has ALWAYS pulled full history into memory and thrown all but the newest
 * away. The AAR's "apps/web can only ever show a single day" was true of the return
 * TYPE, never of the query. Measured cost: 3,093 bytes/row — 28 anchors ≈ 87 KB, a
 * year ≈ 1.1 MB.
 *
 * `anchors` is filtered to `COMPOSITION_SNAPSHOT_SCHEMA_VERSION` and ordered
 * ASCENDING through {@link asOfSortKey}. The version filter is not defensive
 * decoration — it is what makes the v2→v3 cutover graceful: leftover v2 rows stay in
 * the table (no credential in this system can DELETE one, V6) and are simply
 * unresolvable as references until the backfill upgrades them, instead of being
 * handed to a v3 reader that would mis-render them.
 */
export async function getSnapshotHistory(pool: Pool): Promise<SnapshotHistory> {
  const { rows } = await pool.query<SnapshotRow>(
    `SELECT fund_id, as_of, schema_version, report
       FROM composition_snapshot`,
  );

  let latest: SnapshotRow | undefined;
  let latestKey = -Infinity;
  for (const row of rows) {
    const key = asOfSortKey(row.as_of);
    if (key > latestKey) {
      latest = row;
      latestKey = key;
    }
  }

  if (!latest) {
    return { status: "empty" };
  }

  // Staleness is judged on the LATEST row, not on an older ok one: if the newest
  // thing the projection holds is a version this build does not understand, the
  // honest answer is a refusal, not a render of some older row that happens to fit.
  if (latest.schema_version !== COMPOSITION_SNAPSHOT_SCHEMA_VERSION) {
    return {
      status: "stale",
      storedVersion: latest.schema_version,
      expectedVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    };
  }

  const anchors = rows
    .filter((row) => row.schema_version === COMPOSITION_SNAPSHOT_SCHEMA_VERSION)
    .map((row) => ({ key: asOfSortKey(row.as_of), row }))
    .sort((a, b) => a.key - b.key)
    .map(({ row }) => toAnchor(row));

  return { status: "ok", latest: toAnchor(latest), anchors };
}

function toAnchor(row: SnapshotRow): SnapshotAnchor {
  return { fundId: row.fund_id, asOf: row.as_of, report: row.report };
}
