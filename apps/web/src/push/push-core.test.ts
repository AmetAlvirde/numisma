/**
 * Pure-derivation unit test (no DB): fixture load → `fundId` / `asOf` /
 * `schemaVersion`. This is the DB-independent half of the push shell — the upsert
 * path itself is covered by push-core.integration.test.ts against a real pg.
 */
import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { CompositionReport } from "@numisma/engine";
import { quarantineLogPath } from "@numisma/event-store";
import { COMPOSITION_SNAPSHOT_SCHEMA_VERSION } from "../projection/contract.ts";
import { deriveSnapshot, loadCurrentReport } from "./push-core.ts";
import {
  loadFixture,
  makeTempStore,
  priceMarkedLine,
  TEMP_GENESIS_AS_OF,
  TEST_GLANCE,
} from "./push-core.fixtures.ts";

/** Minimal report shaped just enough for the derivation under test. */
function reportWith(fundName: string, asOf: string): CompositionReport {
  return {
    totals: { baseCurrency: "USD", fundValueUsd: 0, usdMxn: 0 },
    dashboard: { summary: { fundName, asOf } },
  } as unknown as CompositionReport;
}

describe("deriveSnapshot (pure fixture → derivation)", () => {
  it("derives fundId (name slug), asOf, and the contract schema version", () => {
    const report = reportWith("Sanitized Exploratory Fund", "2026-05-29");
    const { fundId, asOf, schemaVersion } = deriveSnapshot(report, TEST_GLANCE);
    expect({ fundId, asOf, schemaVersion }).toEqual({
      fundId: "sanitized-exploratory-fund",
      asOf: "2026-05-29",
      schemaVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    });
  });

  it("stamps the current contract version, whatever the report contents", () => {
    const report = reportWith("Another Fund", "2027-01-01");
    expect(deriveSnapshot(report, TEST_GLANCE).schemaVersion).toBe(
      COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    );
  });

  it("takes asOf verbatim from the summary (the conflict key's date half)", () => {
    const report = reportWith("Fund X", "2026-12-31");
    expect(deriveSnapshot(report, TEST_GLANCE).asOf).toBe("2026-12-31");
  });
});

describe("loadFixture → deriveSnapshot (a TEST input, no longer the push input)", () => {
  it("loads the shipped fixture and derives its identity/version", async () => {
    const report = await loadFixture();
    const { fundId, asOf, schemaVersion } = deriveSnapshot(report, TEST_GLANCE);
    expect({ fundId, asOf, schemaVersion }).toEqual({
      fundId: "sanitized-exploratory-fund",
      asOf: "2026-05-29",
      schemaVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    });
  });
});

/**
 * The real fold over a throwaway durable log — the source line this slice
 * changed. No DB, no network: genesis seed + an events.jsonl on disk, folded to
 * CURRENT state (loadCurrentReport takes no date argument by decision — an
 * `--as-of` fold would write a SECOND row keyed to that date and quietly change
 * what "latest" means to the reader).
 */
describe("loadCurrentReport (the real fold of the durable log)", () => {
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

  async function useStore(log: string): Promise<{ dir: string; log: string }> {
    const { dir, paths } = await makeTempStore(log);
    dirs.push(dir);
    process.env.NUMISMA_DATA_DIR = dir;
    return { dir, log: paths.log };
  }

  it("folds genesis + the log to current state: asOf is the LATER event's date", async () => {
    await useStore(
      `${priceMarkedLine("mark-1", "2026-06-05", 160)}\n` +
        `${priceMarkedLine("mark-2", "2026-06-09", 175)}\n`,
    );

    const report = await loadCurrentReport();

    // The later of the two events wins — not genesis, not the earlier mark.
    expect(report.dashboard.summary.asOf).toBe("2026-06-09");
    expect(report.dashboard.summary.asOf).not.toBe(TEMP_GENESIS_AS_OF);
    // A real fold, not an empty shell: the marked price reached the totals.
    expect(report.totals.fundValueUsd).toBeGreaterThan(0);
  });

  it("supplies the same load-provenance block the TUI's report path supplies", async () => {
    const { log } = await useStore(
      `${priceMarkedLine("mark-1", "2026-06-05", 160)}\n`,
    );

    const report = await loadCurrentReport();

    expect(report.load?.status).toBe("loaded");
    expect(report.load?.sourcePath).toBe(log);
    expect(typeof report.load?.loadedAt).toBe("string");
  });

  it("R1/R2: an unparseable log line throws, and the log stays byte-identical", async () => {
    const body =
      `${priceMarkedLine("mark-1", "2026-06-05", 160)}\n` +
      `{ this is not JSON\n`;
    const { log } = await useStore(body);
    const before = await readFile(log);

    await expect(loadCurrentReport()).rejects.toThrow(/unloadable line/i);

    // R2: the durable log itself is never written. (The quarantine SIDECAR
    // beside it is expected — the read path writes it as a consequence of
    // reading — and is explicitly not a violation.)
    const after = await readFile(log);
    expect(after.equals(before)).toBe(true);
    await expect(readFile(quarantineLogPath(log), "utf8")).resolves.toContain(
      "not valid JSON",
    );
  });
});
