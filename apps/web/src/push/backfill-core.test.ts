/**
 * Backfill unit tests (PRD #146 slice #149). NO DATABASE and NO private log: a
 * throwaway data dir on disk plus a fake pool that records the SQL it is handed.
 *
 * That combination is the point. The Postgres integration test beside this one is
 * gated on `NUMISMA_TEST_DATABASE_URL` and self-skips, which is right for a WRITE
 * test — but it means the loop's own behaviour (which dates it enumerates, which
 * row key each fold lands on, that the durable log survives all of it) would only
 * ever be proven on a machine with a database. Everything provable without one is
 * proven here, unconditionally, on every machine.
 */
import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { resolveEventStorePaths } from "@numisma/event-store";
import {
  COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
  type SnapshotAnchor,
} from "../projection/contract.ts";
import {
  synthesizeAnchors,
  SYNTHETIC_FUND_NAME,
  SYNTHETIC_START_NAV,
} from "./fixture-synthesis.ts";
import {
  enumerateAnchors,
  foldAnchor,
  runBackfill,
  toSnapshotAnchors,
  writeAnchorFixture,
} from "./backfill-core.ts";
import { loadCurrentReport } from "./push-core.ts";
import {
  makeTempStore,
  priceMarkedLine,
  TEMP_GENESIS_AS_OF,
} from "./push-core.fixtures.ts";

/** A pool that records every upsert instead of holding a connection. */
interface RecordedQuery {
  sql: string;
  params: unknown[];
}
function fakePool(): { pool: Pool; queries: RecordedQuery[] } {
  const queries: RecordedQuery[] = [];
  const pool = {
    query: async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      return { rows: [] };
    },
  } as unknown as Pool;
  return { pool, queries };
}

const dirs: string[] = [];
const savedDataDir = process.env.NUMISMA_DATA_DIR;

afterEach(async () => {
  if (savedDataDir === undefined) {
    delete process.env.NUMISMA_DATA_DIR;
  } else {
    process.env.NUMISMA_DATA_DIR = savedDataDir;
  }
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

/** Point `NUMISMA_DATA_DIR` at a throwaway store holding `log`. */
async function useStore(log: string): Promise<string> {
  const { dir } = await makeTempStore(log);
  dirs.push(dir);
  process.env.NUMISMA_DATA_DIR = dir;
  return dir;
}

/** Three anchored dates, one of them carrying two events (the dedupe case). */
const THREE_ANCHORS =
  `${priceMarkedLine("m1", "2026-06-05", 160)}\n` +
  `${priceMarkedLine("m2", "2026-06-09", 175)}\n` +
  `${priceMarkedLine("m3", "2026-06-09", 176)}\n` +
  `${priceMarkedLine("m4", "2026-06-12", 180)}\n`;

describe("enumerateAnchors — the log's DISTINCT anchored dates (V3)", () => {
  it("returns each anchored date once, ascending, never a calendar day", async () => {
    await useStore(THREE_ANCHORS);

    // Four events, three anchors — and 06-06 through 06-08 are NOT anchors even
    // though they are calendar days between two of them. A calendar-dense backfill
    // would fold rows on which every instrument was expected and none arrived, and
    // NAV would be permanently blank on them: the log holds no marks for those days
    // and no later run can repair that.
    expect(await enumerateAnchors()).toEqual([
      "2026-06-05",
      "2026-06-09",
      "2026-06-12",
    ]);
  });

  it("sorts by date, not by log order", async () => {
    await useStore(
      `${priceMarkedLine("m1", "2026-06-12", 180)}\n` +
        `${priceMarkedLine("m2", "2026-06-05", 160)}\n`,
    );
    expect(await enumerateAnchors()).toEqual(["2026-06-05", "2026-06-12"]);
  });

  it("returns nothing for an empty log rather than inventing an anchor", async () => {
    await useStore("");
    expect(await enumerateAnchors()).toEqual([]);
  });

  it("accepts explicit paths, so the command is not env-only", async () => {
    const dir = await useStore(THREE_ANCHORS);
    delete process.env.NUMISMA_DATA_DIR;
    expect(await enumerateAnchors(resolveEventStorePaths(dir))).toHaveLength(3);
  });
});

describe("GENESIS IS THE FLOOR", () => {
  it("excludes an event dated before genesis instead of folding a throw", async () => {
    await useStore(
      `${priceMarkedLine("pre", "2026-05-01", 100)}\n` +
        `${priceMarkedLine("m1", "2026-06-05", 160)}\n`,
    );
    // 2026-05-01 precedes the genesis seed (2026-06-01), and `foldEvents` THROWS
    // for such an as-of. Filtering here is what keeps that from surfacing as a
    // mid-run failure on anchor 1 of N with a message about t0.
    expect(TEMP_GENESIS_AS_OF).toBe("2026-06-01");
    expect(await enumerateAnchors()).toEqual(["2026-06-05"]);
  });

  it("the filter has teeth: that same date DOES throw when folded directly", async () => {
    // False-pass guard. If `foldEvents` ever stopped guarding t0, the filter above
    // would be protecting against nothing and this test would say so.
    await useStore(`${priceMarkedLine("m1", "2026-06-05", 160)}\n`);
    await expect(foldAnchor("2026-05-01")).rejects.toThrow(/genesis/i);
  });
});

describe("runBackfill — a loop plus the existing upsert", () => {
  it("upserts exactly one row per anchor, each keyed to its OWN date", async () => {
    await useStore(THREE_ANCHORS);
    const { pool, queries } = fakePool();

    const results = await runBackfill({ pool });

    expect(results.map((r) => r.asOf)).toEqual([
      "2026-06-05",
      "2026-06-09",
      "2026-06-12",
    ]);
    expect(queries).toHaveLength(3);
    // The row key written is the anchor's own date — the parameter that would be
    // wrong if the fold answered "current state" for every anchor.
    expect(queries.map((q) => q.params[1])).toEqual([
      "2026-06-05",
      "2026-06-09",
      "2026-06-12",
    ]);
    // …through the EXACT upsert SQL the daily push runs (R6).
    for (const query of queries) {
      expect(query.sql).toContain("ON CONFLICT (fund_id, as_of)");
      expect(query.sql).toContain("DO UPDATE");
      expect(query.sql).not.toMatch(/\bDELETE\b/);
    }
  });

  it("stamps every row at the current schema version (v3)", async () => {
    await useStore(THREE_ANCHORS);
    const { pool } = fakePool();
    const results = await runBackfill({ pool });
    expect(results.map((r) => r.schemaVersion)).toEqual(
      results.map(() => COMPOSITION_SNAPSHOT_SCHEMA_VERSION),
    );
    expect(results.every((r) => r.written)).toBe(true);
  });

  it("each anchor folds to its OWN state, not to the log's latest", async () => {
    await useStore(THREE_ANCHORS);
    const { pool } = fakePool();
    const results = await runBackfill({ pool });

    // The whole reason the backfill exists: the earlier anchors must NOT carry the
    // final mark. Prices rise 160 → 176 → 180 across the three anchors, so the NAVs
    // must be strictly increasing and the last must equal the current fold.
    const navs = results.map((r) => r.report.totals.fundValueUsd);
    expect(navs[0]).toBeLessThan(navs[1]!);
    expect(navs[1]).toBeLessThan(navs[2]!);
    const current = await loadCurrentReport();
    expect(navs[2]).toBe(current.totals.fundValueUsd);
    expect(current.dashboard.summary.asOf).toBe("2026-06-12");
  });

  it("carries a v3 glance block on every anchor", async () => {
    await useStore(THREE_ANCHORS);
    const { pool } = fakePool();
    for (const anchor of await runBackfill({ pool })) {
      expect(Object.keys(anchor.report).sort()).toEqual([
        "dashboard",
        "glance",
        "totals",
      ]);
      expect(typeof anchor.report.glance.feedGap.expected).toBe("number");
      expect(Array.isArray(anchor.report.glance.suppressed)).toBe(true);
    }
  });

  it("derives without writing when no pool is supplied", async () => {
    await useStore(THREE_ANCHORS);
    const results = await runBackfill();
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.written)).toBe(false);
    // The payload is identical either way — it is the same `deriveSnapshot` with
    // the write removed — which is what makes the fixture a faithful record of what
    // a real run stores.
    const { pool } = fakePool();
    const written = await runBackfill({ pool });
    expect(results.map((r) => r.report)).toEqual(written.map((r) => r.report));
  });

  it("R6: re-running over an unchanged log derives identical payloads", async () => {
    await useStore(THREE_ANCHORS);
    const first = await runBackfill();
    const second = await runBackfill();
    expect(second).toEqual(first);
  });
});

describe("R7 — the backfill never mutates the durable log", () => {
  it("leaves genesis and events.jsonl byte-identical across every fold", async () => {
    const dir = await useStore(THREE_ANCHORS);
    const paths = resolveEventStorePaths(dir);
    const before = {
      genesis: await readFile(paths.genesis),
      log: await readFile(paths.log),
    };

    const { pool } = fakePool();
    const results = await runBackfill({ pool });
    expect(results).toHaveLength(3);

    // Re-asserted ACROSS the folds, not on one of them: the loop reads the log once
    // per anchor, and a read path that mutated would do it N times.
    expect(await readFile(paths.log)).toEqual(before.log);
    expect(await readFile(paths.genesis)).toEqual(before.genesis);
    // No quarantine sidecar appears for a clean log either.
    await expect(readFile(`${paths.log}.quarantine`)).rejects.toThrow();
  });
});

describe("the replay fixture writer", () => {
  it("SANITIZES: what it writes is never the real payload it derived", async () => {
    // The committed file lands in a PUBLIC repository, so the writer routes through
    // `synthesizeAnchors` with no flag and no second path. This is the assertion that
    // says so on the bytes: same dates, same shape, DIFFERENT magnitudes.
    const dir = await useStore(THREE_ANCHORS);
    const results = await runBackfill();
    const path = `${dir}/anchors.fixture.json`;

    await writeAnchorFixture(results, path);
    const written = JSON.parse(await readFile(path, "utf-8")) as {
      anchors: SnapshotAnchor[];
    };

    expect(written.anchors.map((a) => a.asOf)).toEqual(results.map((r) => r.asOf));
    expect(written.anchors[0]?.report.totals.fundValueUsd).toBe(
      SYNTHETIC_START_NAV,
    );
    for (const [index, anchor] of written.anchors.entries()) {
      expect(anchor.report.totals.fundValueUsd, anchor.asOf).not.toBe(
        results[index]!.report.totals.fundValueUsd,
      );
      expect(anchor.report.dashboard.summary.fundName).toBe(SYNTHETIC_FUND_NAME);
      // …and it is the SANITIZER doing it, not a coincidence of this log: the
      // written payload equals what synthesis produces from the derived one.
      expect(anchor).toEqual(
        synthesizeAnchors(toSnapshotAnchors(results))[index],
      );
    }
  });

  it("writes the SnapshotAnchor shape the reader returns, at the current version", async () => {
    const dir = await useStore(THREE_ANCHORS);
    const results = await runBackfill();
    const path = `${dir}/anchors.fixture.json`;

    await writeAnchorFixture(results, path);
    const parsed = JSON.parse(await readFile(path, "utf-8")) as {
      schemaVersion: number;
      anchors: { fundId: string; asOf: string; report: unknown }[];
    };

    expect(parsed.schemaVersion).toBe(COMPOSITION_SNAPSHOT_SCHEMA_VERSION);
    // Exactly `{ fundId, asOf, report }` per anchor — the same shape
    // `getSnapshotHistory` hands the reader, so slice 4 replays through the
    // identical seam a real DB read uses and needs no adapter.
    expect(parsed.anchors.map((a) => Object.keys(a).sort())).toEqual(
      results.map(() => ["asOf", "fundId", "report"]),
    );
    expect(parsed.anchors.map((a) => a.asOf)).toEqual(results.map((r) => r.asOf));
    // The payload is the SANITIZED one (see the case above) — the shape is the
    // reader's, the magnitudes are synthesis's.
    expect(parsed.anchors.map((a) => a.report)).toEqual(
      synthesizeAnchors(toSnapshotAnchors(results)).map((a) => a.report),
    );
  });

  it("is byte-deterministic, so a diff on the committed file means the LOG changed", async () => {
    const dir = await useStore(THREE_ANCHORS);
    const path = `${dir}/anchors.fixture.json`;
    await writeAnchorFixture(await runBackfill(), path);
    const first = await readFile(path, "utf-8");
    await writeAnchorFixture(await runBackfill(), path);
    expect(await readFile(path, "utf-8")).toBe(first);
  });
});
