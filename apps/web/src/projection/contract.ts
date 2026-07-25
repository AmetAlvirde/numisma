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
export type ProjectionReport = Pick<CompositionReport, "totals" | "dashboard">;

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
};

/**
 * Build the pushed payload BY EXPLICIT CONSTRUCTION — the runtime half of the
 * {@link ProjectionReport} narrowing.
 *
 * Key-by-key on purpose. `report as ProjectionReport` would satisfy the compiler
 * while the value at runtime is still the whole wide report, and every dropped
 * field would serialize straight into the `report` JSONB column. The type is the
 * intent; this function is the enforcement.
 */
export function toProjectionReport(report: CompositionReport): ProjectionReport {
  return {
    totals: report.totals,
    dashboard: report.dashboard,
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
 */
export const COMPOSITION_SNAPSHOT_SCHEMA_VERSION = 2;

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
  | { status: "ok"; fundId: string; asOf: string; report: ProjectionReport };

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
 */
function asOfSortKey(asOf: string): number {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(asOf);
  if (!match) {
    throw new Error(
      `getLatestSnapshot: as_of ${JSON.stringify(asOf)} is not a sortable ISO calendar date`,
    );
  }
  const [, year, month, day] = match;
  return Number(year) * 10000 + Number(month) * 100 + Number(day);
}

/**
 * Read the most recent snapshot. Returns a refusal result rather than throwing
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
 */
export async function getLatestSnapshot(pool: Pool): Promise<LatestSnapshot> {
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

  if (latest.schema_version !== COMPOSITION_SNAPSHOT_SCHEMA_VERSION) {
    return {
      status: "stale",
      storedVersion: latest.schema_version,
      expectedVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    };
  }
  return {
    status: "ok",
    fundId: latest.fund_id,
    asOf: latest.as_of,
    report: latest.report,
  };
}
