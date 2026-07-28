import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import type { CompositionReport } from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  fundIdOf,
  getSnapshotHistory,
  getReaderPool,
  setReaderPoolForTests,
} from "./contract.ts";

// The fixture the push shell + reader share. Its fundName is the canonical
// slug-derivation case ("Sanitized Exploratory Fund" -> "sanitized-exploratory-fund").
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(
  HERE,
  "../../fixtures/composition-report.fixture.json",
);
const fixtureReport = JSON.parse(
  readFileSync(FIXTURE_PATH, "utf-8"),
) as CompositionReport;

/**
 * A Pool stand-in whose only job is to return the rows a `SELECT ... LIMIT 1`
 * would yield. The pg driver is mocked here; the empty/stale/ok arbitration and
 * the version comparison inside getSnapshotHistory still run for real.
 */
function poolReturning(rows: unknown[]): Pool {
  return {
    query: async () => ({ rows }),
  } as unknown as Pool;
}

/**
 * A Pool stand-in whose query rejects — stands in for a real DB/query failure
 * (as opposed to the two "expected" bad states, which resolve to a refusal).
 */
function poolRejecting(error: Error): Pool {
  return {
    query: async () => {
      throw error;
    },
  } as unknown as Pool;
}

/** Build a CompositionReport carrying only the fundName the slug derivation reads. */
function reportNamed(fundName: string): CompositionReport {
  return { dashboard: { summary: { fundName } } } as unknown as CompositionReport;
}

describe("getSnapshotHistory", () => {
  it("returns empty when no rows exist", async () => {
    const result = await getSnapshotHistory(poolReturning([]));
    expect(result).toEqual({ status: "empty" });
  });

  it("returns stale when the stored schema_version differs from the expected version", async () => {
    const storedVersion = COMPOSITION_SNAPSHOT_SCHEMA_VERSION + 1;
    const result = await getSnapshotHistory(
      poolReturning([
        {
          fund_id: "sanitized-exploratory-fund",
          as_of: "2026-05-29",
          schema_version: storedVersion,
          report: fixtureReport,
        },
      ]),
    );
    expect(result).toEqual({
      status: "stale",
      storedVersion,
      expectedVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    });
  });

  it("returns ok when the stored schema_version matches the expected version", async () => {
    const result = await getSnapshotHistory(
      poolReturning([
        {
          fund_id: "sanitized-exploratory-fund",
          as_of: "2026-05-29",
          schema_version: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
          report: fixtureReport,
        },
      ]),
    );
    expect(result).toEqual({
      status: "ok",
      latest: {
        fundId: "sanitized-exploratory-fund",
        asOf: "2026-05-29",
        report: fixtureReport,
      },
      anchors: [
        {
          fundId: "sanitized-exploratory-fund",
          asOf: "2026-05-29",
          report: fixtureReport,
        },
      ],
    });
  });

  it("rejects on an actual DB/query failure rather than returning a refusal", async () => {
    const boom = new Error("connection refused");
    await expect(getSnapshotHistory(poolRejecting(boom))).rejects.toThrow(
      "connection refused",
    );
  });
});

/**
 * Multi-snapshot arbitration (M4). "Latest" must be the genuinely most recent
 * snapshot by its logical `as_of` date — correct by construction, not by the
 * accident that the fixture happens to use zero-padded ISO dates that sort the
 * same lexically and chronologically. These feed several rows to the mocked pool
 * (order-independent, since the SQL no longer sorts) and assert newest-wins.
 */
describe("getSnapshotHistory multi-snapshot arbitration", () => {
  /** A stored snapshot row with the given `as_of`; overrides tweak a single field. */
  function snapshotRow(
    asOf: string,
    overrides: Partial<{
      fund_id: string;
      schema_version: number;
      report: CompositionReport;
    }> = {},
  ) {
    return {
      fund_id: "sanitized-exploratory-fund",
      as_of: asOf,
      schema_version: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
      report: fixtureReport,
      ...overrides,
    };
  }

  it("returns the snapshot with the most recent as_of regardless of row order", async () => {
    const result = await getSnapshotHistory(
      poolReturning([
        snapshotRow("2026-05-08"),
        snapshotRow("2026-05-29"),
        snapshotRow("2026-05-15"),
      ]),
    );
    expect(result).toMatchObject({
      status: "ok",
      latest: { asOf: "2026-05-29" },
    });
  });

  it("arbitrates on a typed date key, not lexical TEXT order (the trap the old ORDER BY as_of DESC hit)", async () => {
    // Non-zero-padded month: September "2026-9-1" vs October "2026-10-01".
    // October is chronologically LATER, but lexically "2026-10-01" < "2026-9-1"
    // ('1' < '9' at the fifth character), so the old TEXT `ORDER BY as_of DESC
    // LIMIT 1` would return the WRONG, earlier September snapshot.
    const september = snapshotRow("2026-9-1");
    const october = snapshotRow("2026-10-01");

    // Prove the trap is real: a lexical DESC sort picks September, not October.
    const lexicalDescWinner = [september.as_of, october.as_of]
      .sort() // ascending lexical
      .at(-1); // == the row a DESC TEXT sort would place first
    expect(lexicalDescWinner).toBe("2026-9-1");

    // Typed arbitration returns the genuinely-latest October snapshot instead.
    const result = await getSnapshotHistory(poolReturning([october, september]));
    expect(result).toMatchObject({
      status: "ok",
      latest: { asOf: "2026-10-01" },
    });
  });

  it("judges schema staleness on the latest snapshot, not an older ok one", async () => {
    const staleVersion = COMPOSITION_SNAPSHOT_SCHEMA_VERSION + 1;
    const result = await getSnapshotHistory(
      poolReturning([
        snapshotRow("2026-05-08"), // older, current version
        snapshotRow("2026-05-29", { schema_version: staleVersion }), // latest, stale
      ]),
    );
    expect(result).toEqual({
      status: "stale",
      storedVersion: staleVersion,
      expectedVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    });
  });

  it("rejects rather than silently mis-ordering when an as_of is not a sortable ISO date", async () => {
    await expect(
      getSnapshotHistory(
        poolReturning([snapshotRow("2026-05-29"), snapshotRow("last thursday")]),
      ),
    ).rejects.toThrow(/not a sortable ISO calendar date/);
  });
});

/**
 * Seam C — the reader returns HISTORY, not a day (PRD #146 slice #148).
 *
 * D4's named reference (the entire change/delta feature) had no delivery mechanism
 * while the return type carried one row. The QUERY always read them all: no WHERE,
 * no LIMIT, full history into memory, everything but the newest thrown away. These
 * cases are about the widened return SHAPE and the version filter on it.
 */
describe("getSnapshotHistory anchors", () => {
  function anchorRow(asOf: string, schemaVersion = COMPOSITION_SNAPSHOT_SCHEMA_VERSION) {
    return {
      fund_id: "sanitized-exploratory-fund",
      as_of: asOf,
      schema_version: schemaVersion,
      report: fixtureReport,
    };
  }

  it("returns every anchor ASCENDING, regardless of the order the rows arrive in", async () => {
    const result = await getSnapshotHistory(
      poolReturning([
        anchorRow("2026-07-26"),
        anchorRow("2026-07-24"),
        anchorRow("2026-07-25"),
      ]),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.anchors.map((a) => a.asOf)).toEqual([
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]);
    // `latest` is still the newest, and it is the same anchor the history ends on.
    expect(result.latest.asOf).toBe("2026-07-26");
    expect(result.anchors.at(-1)).toEqual(result.latest);
  });

  it("orders through the TYPED date key, not lexical TEXT order", async () => {
    // The same trap the "latest" arbitration dodges, one level out: sorting anchors
    // by string would place October BEFORE a non-zero-padded September, and slice 4
    // would resolve "nearest anchor <= target" to the wrong day.
    const result = await getSnapshotHistory(
      poolReturning([anchorRow("2026-10-01"), anchorRow("2026-9-1")]),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.anchors.map((a) => a.asOf)).toEqual(["2026-9-1", "2026-10-01"]);
    // Prove the trap is real rather than assuming it: a lexical sort inverts these.
    expect(["2026-10-01", "2026-9-1"].sort()).toEqual(["2026-10-01", "2026-9-1"]);
  });

  it("DROPS rows at another schema version from anchors — the v2→v3 cutover", async () => {
    // The graceful-cutover case. Leftover v2 rows stay in the table (no credential
    // in this system can DELETE one, V6) but must never be handed to a v3 reader as
    // a reference: they are simply unresolvable until the backfill upgrades them.
    const stale = COMPOSITION_SNAPSHOT_SCHEMA_VERSION - 1;
    const result = await getSnapshotHistory(
      poolReturning([
        anchorRow("2026-07-20", stale),
        anchorRow("2026-07-24", stale),
        anchorRow("2026-07-26"),
      ]),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // The newest row is current, so the surface renders — and it renders with the
    // ONE anchor it can actually trust.
    expect(result.anchors.map((a) => a.asOf)).toEqual(["2026-07-26"]);
    expect(result.latest.asOf).toBe("2026-07-26");
  });

  it("carries the full payload on every anchor, not just on latest", async () => {
    const result = await getSnapshotHistory(
      poolReturning([anchorRow("2026-07-24"), anchorRow("2026-07-26")]),
    );
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    for (const anchor of result.anchors) {
      expect(anchor.report).toBe(fixtureReport);
      expect(anchor.fundId).toBe("sanitized-exploratory-fund");
    }
  });
});

describe("fundIdOf slug derivation", () => {
  it("derives the canonical fixture slug", () => {
    expect(fundIdOf(fixtureReport)).toBe("sanitized-exploratory-fund");
    // Guard against the fixture drifting out from under the canonical case.
    expect(fundIdOf(reportNamed("Sanitized Exploratory Fund"))).toBe(
      "sanitized-exploratory-fund",
    );
  });

  it("lowercases mixed casing", () => {
    expect(fundIdOf(reportNamed("MixedCASE Fund"))).toBe("mixedcase-fund");
  });

  it("collapses runs of punctuation and whitespace to a single separator", () => {
    expect(fundIdOf(reportNamed("Foo   &&&   Bar!!!Baz"))).toBe("foo-bar-baz");
  });

  it("trims leading and trailing separators", () => {
    expect(fundIdOf(reportNamed("  --Alpha Fund--  "))).toBe("alpha-fund");
    expect(fundIdOf(reportNamed("!!!Omega!!!"))).toBe("omega");
  });

  it("preserves digits", () => {
    expect(fundIdOf(reportNamed("Fund 2026 v2"))).toBe("fund-2026-v2");
  });

  it("passes an already-slugged name through unchanged", () => {
    expect(fundIdOf(reportNamed("already-slug"))).toBe("already-slug");
  });
});

describe("getReaderPool (lazy singleton + test seam)", () => {
  const saved = process.env.PROJECTION_DATABASE_URL;

  afterEach(async () => {
    // Never leak a pool (or an injected stub) into the next test.
    setReaderPoolForTests(undefined);
    if (saved === undefined) {
      delete process.env.PROJECTION_DATABASE_URL;
    } else {
      process.env.PROJECTION_DATABASE_URL = saved;
    }
  });

  it("throws when PROJECTION_DATABASE_URL is not set", () => {
    setReaderPoolForTests(undefined);
    delete process.env.PROJECTION_DATABASE_URL;
    expect(() => getReaderPool()).toThrow("PROJECTION_DATABASE_URL is not set");
  });

  it("lazily constructs a pool from PROJECTION_DATABASE_URL and memoizes it", async () => {
    setReaderPoolForTests(undefined);
    process.env.PROJECTION_DATABASE_URL =
      "postgres://reader@localhost:5432/projection";
    // pg's Pool does not connect until first query, so constructing it here opens
    // no socket; this exercises the real lazy-construction branch.
    const first = getReaderPool();
    expect(first).toBeInstanceOf(Pool);
    // Second call returns the memoized instance, not a fresh pool.
    expect(getReaderPool()).toBe(first);
    await first.end();
  });

  it("returns an injected stub without touching the environment", () => {
    setReaderPoolForTests(undefined);
    delete process.env.PROJECTION_DATABASE_URL;
    const stub = poolReturning([]);
    setReaderPoolForTests(stub);
    // Env is unset, yet no throw: the injected stub short-circuits construction.
    expect(getReaderPool()).toBe(stub);
  });
});
