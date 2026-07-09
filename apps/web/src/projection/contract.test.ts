import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";
import type { CompositionReport } from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  fundIdOf,
  getLatestSnapshot,
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
 * the version comparison inside getLatestSnapshot still run for real.
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

describe("getLatestSnapshot", () => {
  it("returns empty when no rows exist", async () => {
    const result = await getLatestSnapshot(poolReturning([]));
    expect(result).toEqual({ status: "empty" });
  });

  it("returns stale when the stored schema_version differs from the expected version", async () => {
    const storedVersion = COMPOSITION_SNAPSHOT_SCHEMA_VERSION + 1;
    const result = await getLatestSnapshot(
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
    const result = await getLatestSnapshot(
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
      fundId: "sanitized-exploratory-fund",
      asOf: "2026-05-29",
      report: fixtureReport,
    });
  });

  it("rejects on an actual DB/query failure rather than returning a refusal", async () => {
    const boom = new Error("connection refused");
    await expect(getLatestSnapshot(poolRejecting(boom))).rejects.toThrow(
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
describe("getLatestSnapshot multi-snapshot arbitration", () => {
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
    const result = await getLatestSnapshot(
      poolReturning([
        snapshotRow("2026-05-08"),
        snapshotRow("2026-05-29"),
        snapshotRow("2026-05-15"),
      ]),
    );
    expect(result).toMatchObject({ status: "ok", asOf: "2026-05-29" });
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
    const result = await getLatestSnapshot(poolReturning([october, september]));
    expect(result).toMatchObject({ status: "ok", asOf: "2026-10-01" });
  });

  it("judges schema staleness on the latest snapshot, not an older ok one", async () => {
    const staleVersion = COMPOSITION_SNAPSHOT_SCHEMA_VERSION + 1;
    const result = await getLatestSnapshot(
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
      getLatestSnapshot(
        poolReturning([snapshotRow("2026-05-29"), snapshotRow("last thursday")]),
      ),
    ).rejects.toThrow(/not a sortable ISO calendar date/);
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
