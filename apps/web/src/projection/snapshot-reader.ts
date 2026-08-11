/**
 * The projection's POSTGRES READER — the only module in `apps/web` that opens the
 * read-only projection pool and queries the `composition_snapshot` table at runtime.
 * (The name appears elsewhere — `contract.ts` prose, the push shell, the
 * provisioning DDL — but this is the sole pg reader of it.)
 *
 * WHY IT IS NOT IN `contract.ts`. The contract is what everything imports: the row
 * shape, the schema version, the fund-id derivation, the narrowing guard. The
 * reader is what ONE caller imports (`lib/dashboard.ts`, behind a server function).
 * While both lived in one file, `import { anything } from "./contract.ts"` was a
 * value import of the `pg` driver, so any runtime constant the contract wanted to
 * share dragged the driver toward the client bundle
 * (`client-bundle.integration.test.ts`). The repo paid for that twice — `as-of.ts`
 * exists because a browser-reachable module needed one function out of here, and a
 * shared key list got copy-pasted rather than shared. Splitting the file makes the
 * contract half a safe home for shared runtime values; `contract.test.ts` asserts
 * that half stays pg-free from the module graph, not from this comment.
 *
 * The dependency runs ONE WAY: this module imports the contract, never the reverse.
 */
import { Pool } from "pg";
import { asOfSortKey } from "./as-of.ts";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  isSupportedSchemaVersion,
  MIN_SUPPORTED_SNAPSHOT_SCHEMA_VERSION,
  type ProjectionReport,
  type SnapshotAnchor,
  type SnapshotHistory,
} from "./contract.ts";

/** One `composition_snapshot` row exactly as the SELECT below returns it. */
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
 * Read the projection's ANCHOR HISTORY. Returns a refusal result rather than throwing
 * for the two "expected" bad states:
 *  - no rows yet            -> { status: "empty" }
 *  - version outside the supported RANGE -> { status: "stale", storedVersion, expectedVersions }
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
 * TYPE, never of the query. Measured cost: 3,093 bytes/row — 28 anchors was ≈ 87 KB, a
 * year ≈ 1.1 MB.
 *
 * `anchors` is filtered to the SUPPORTED RANGE (see
 * {@link MIN_SUPPORTED_SNAPSHOT_SCHEMA_VERSION}) and ordered ASCENDING through
 * {@link asOfSortKey}. The version filter is not defensive decoration — it is what
 * keeps an unrenderable row out of the history: a v2 row stays in the table (no
 * credential in this system can DELETE one, V6) and is simply unresolvable as a
 * reference, instead of being handed to a reader that would mis-render it. Rows INSIDE
 * the range are kept whole and whatever the newer shape added arrives absent on them,
 * which is a true statement about that day rather than a gap to paper over.
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
  //
  // A RANGE, NOT AN EQUALITY, since spec #285 — and the two comparisons below are the
  // two places that had to move together. See
  // `MIN_SUPPORTED_SNAPSHOT_SCHEMA_VERSION` for why the reader deploys first.
  if (!isSupportedSchemaVersion(latest.schema_version)) {
    return {
      status: "stale",
      storedVersion: latest.schema_version,
      expectedVersions: {
        min: MIN_SUPPORTED_SNAPSHOT_SCHEMA_VERSION,
        max: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
      },
    };
  }

  const anchors = rows
    // The SECOND of the two comparisons. Left at equality it would have dropped every
    // in-range older anchor from the history while the latest row rendered — the delta
    // feature silently reading one day again.
    .filter((row) => isSupportedSchemaVersion(row.schema_version))
    .map((row) => ({ key: asOfSortKey(row.as_of), row }))
    .sort((a, b) => a.key - b.key)
    .map(({ row }) => toAnchor(row));

  return { status: "ok", latest: toAnchor(latest), anchors };
}

function toAnchor(row: SnapshotRow): SnapshotAnchor {
  return { fundId: row.fund_id, asOf: row.as_of, report: row.report };
}
