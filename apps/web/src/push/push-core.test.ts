/**
 * Pure-derivation unit test (no DB): fixture load → `fundId` / `asOf` /
 * `schemaVersion`. This is the DB-independent half of the push shell — the upsert
 * path itself is covered by push-core.integration.test.ts against a real pg.
 */
import { describe, expect, it } from "vitest";
import type { CompositionReport } from "@numisma/engine";
import { COMPOSITION_SNAPSHOT_SCHEMA_VERSION } from "../projection/contract.ts";
import { deriveSnapshot, loadFixture } from "./push-core.ts";

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
    const { fundId, asOf, schemaVersion } = deriveSnapshot(report);
    expect({ fundId, asOf, schemaVersion }).toEqual({
      fundId: "sanitized-exploratory-fund",
      asOf: "2026-05-29",
      schemaVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    });
  });

  it("stamps the current contract version, whatever the report contents", () => {
    const report = reportWith("Another Fund", "2027-01-01");
    expect(deriveSnapshot(report).schemaVersion).toBe(
      COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    );
  });

  it("takes asOf verbatim from the summary (the conflict key's date half)", () => {
    const report = reportWith("Fund X", "2026-12-31");
    expect(deriveSnapshot(report).asOf).toBe("2026-12-31");
  });
});

describe("loadFixture → deriveSnapshot (the actual push input, no DB)", () => {
  it("loads the shipped fixture and derives its identity/version", async () => {
    const report = await loadFixture();
    const { fundId, asOf, schemaVersion } = deriveSnapshot(report);
    expect({ fundId, asOf, schemaVersion }).toEqual({
      fundId: "sanitized-exploratory-fund",
      asOf: "2026-05-29",
      schemaVersion: COMPOSITION_SNAPSHOT_SCHEMA_VERSION,
    });
  });
});
