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
