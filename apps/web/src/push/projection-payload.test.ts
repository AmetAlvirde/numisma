/**
 * D8 forbidden-key contract — what may NOT reach the cloud.
 *
 * Mirror image of `client-bundle.integration.test.ts`: that test asserts what may
 * not reach the BROWSER; this one asserts what may not reach the hosted
 * projection DB. Both convert a silent drift class into a red build.
 *
 * The history this exists to prevent: ADR-007 computed its blast radius over
 * "derived dashboard values, not the raw thesis/risk-budget/invalidation prose",
 * which was accurate when written. The engine then grew `invalidationWatch`
 * (per-position stop levels), `closedBook` (the full realized-P&L blotter, with
 * `strategy` tags on its rows), `priceJourneys` and `reserveReconciliation` — and
 * the push, which serialized the WHOLE `CompositionReport`, silently inherited
 * every one of them. Nothing decided that. The engine grew and nobody was told.
 *
 * `ProjectionReport = Pick<CompositionReport, "totals" | "dashboard">` plus
 * `toProjectionReport`'s key-by-key construction narrows it TODAY. This test is
 * what makes the narrowing survive the NEXT engine increment: it drives a
 * deliberately WIDE report through the real `deriveSnapshot` path and deep-scans
 * every key at every depth of the resulting payload.
 *
 * Two properties keep it honest:
 *  - the scan is recursive over objects AND arrays, and matches forbidden markers
 *    as case-insensitive substrings, so a renamed variant (`invalidationWatch` →
 *    `invalidationLevels`) is still caught;
 *  - a false-pass guard asserts the scanner genuinely FINDS those keys in the wide
 *    INPUT report. A recursive scanner with a bug reports "clean" for everything;
 *    without that assertion this file would be decoration.
 */
import { describe, expect, it } from "vitest";
import type { CompositionReport } from "@numisma/engine";
import { deriveSnapshot, loadFixture } from "./push-core.ts";
import { toProjectionReport } from "../projection/contract.ts";

/**
 * Key markers that must never appear at any depth of the pushed payload. Matched
 * as case-insensitive SUBSTRINGS of the key name, so `invalidation` catches
 * `invalidationWatch`, `invalidationCondition` and a bare `invalidation` alike.
 */
const FORBIDDEN_KEY_MARKERS = [
  "strategy",
  "invalidation",
  "closedBook",
  "entryThesis",
  "riskBudget",
];

/**
 * Every forbidden marker found in `value`, walking objects and arrays to
 * arbitrary depth. Reports `marker @ path` so a failure names where it leaked.
 */
function scanForbiddenKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => scanForbiddenKeys(item, `${path}[${i}]`));
  }
  if (value === null || typeof value !== "object") {
    return [];
  }
  const hits: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const here = `${path}.${key}`;
    const lowered = key.toLowerCase();
    for (const marker of FORBIDDEN_KEY_MARKERS) {
      if (lowered.includes(marker.toLowerCase())) {
        hits.push(`${marker} @ ${here}`);
      }
    }
    hits.push(...scanForbiddenKeys(child, here));
  }
  return hits;
}

/**
 * The shipped fixture, widened so it actually CARRIES every forbidden marker.
 * The fixture on disk has `invalidationWatch: []` and an empty `closedBook`, so
 * pushing it unmodified would prove nothing — the payload would be clean whether
 * or not the narrowing worked. `entryThesis` / `riskBudget` are not on today's
 * `CompositionReport` at all; they are planted here so the scan is proven against
 * all five markers rather than only the three the engine happens to emit now.
 */
async function loadWideReport(): Promise<CompositionReport> {
  const fixture = await loadFixture();
  return {
    ...fixture,
    invalidationWatch: [
      {
        positionId: "pos:btc-core",
        instrumentId: "BTC",
        markPrice: 61250.5,
        level: 57800,
        direction: "below",
        breached: false,
      },
      {
        positionId: "pos:sol-pulse",
        instrumentId: "SOL",
        markPrice: 142.75,
        level: 158.4,
        direction: "above",
        breached: true,
      },
    ],
    closedBook: {
      rows: [
        {
          positionId: "pos:eth-swing",
          instrumentId: "ETH",
          tempo: "Pulse",
          strategy: "breakout-retest",
          direction: "long",
          openedAsOf: "2026-03-02",
          closedAsOf: "2026-04-18",
          costBasisUsd: 2400,
          proceedsUsd: 3120.75,
          realizedPnlUsd: 720.75,
          tierAttribution: [
            { tier: "core", realizedPnlUsd: 720.75, strategy: "breakout-retest" },
          ],
          entryThesis: "reclaim of the March range high",
          riskBudget: { maxLossUsd: 240, percentOfFund: 2.2 },
        },
      ],
      byTempo: [
        {
          key: "Pulse",
          realizedPnlUsd: 720.75,
          costBasisUsd: 2400,
          proceedsUsd: 3120.75,
        },
      ],
      byTier: [
        {
          key: "core",
          realizedPnlUsd: 720.75,
          costBasisUsd: 2400,
          proceedsUsd: 3120.75,
        },
      ],
      totalRealizedPnlUsd: 720.75,
    },
  } as unknown as CompositionReport;
}

describe("D8 forbidden-key contract (what may not reach the cloud)", () => {
  it("finds every forbidden marker in the WIDE input — the scanner has teeth", async () => {
    // False-pass guard. A buggy recursive scanner returns [] for everything, which
    // would make the leak assertions below vacuous. Assert the scanner detects all
    // five markers in the un-narrowed report BEFORE trusting it to clear a payload.
    const wide = await loadWideReport();
    const hits = scanForbiddenKeys(wide);
    for (const marker of FORBIDDEN_KEY_MARKERS) {
      expect(
        hits.filter((h) => h.startsWith(`${marker} @`)),
        `scanner found no "${marker}" in the wide report — the fixture is not wide ` +
          `enough, or the scanner is broken. Either way the leak checks are vacuous.`,
      ).not.toEqual([]);
    }
    // The markers must also be reachable at NESTED depth, not only top level, or
    // the recursion itself is untested.
    expect(hits.some((h) => h.includes("closedBook.rows[0]"))).toBe(true);
  });

  it("pushes no forbidden key at any depth of the derived payload", async () => {
    const wide = await loadWideReport();
    const leaks = scanForbiddenKeys(deriveSnapshot(wide).report);
    expect(leaks, `pushed payload leaks:\n${leaks.join("\n")}`).toEqual([]);
  });

  it("narrows the payload to exactly { totals, dashboard }", async () => {
    const wide = await loadWideReport();
    expect(Object.keys(deriveSnapshot(wide).report).sort()).toEqual([
      "dashboard",
      "totals",
    ]);
  });

  it("carries totals and dashboard through intact", async () => {
    const wide = await loadWideReport();
    const { report } = deriveSnapshot(wide);
    expect(report.totals).toEqual(wide.totals);
    expect(report.dashboard).toEqual(wide.dashboard);
    // The narrowing must be by CONSTRUCTION, not a cast: a `report as
    // ProjectionReport` would leave the wide object at runtime and serialize every
    // dropped key into JSONB. Serializing the payload is the runtime proof.
    const serialized = JSON.parse(JSON.stringify(report)) as unknown;
    expect(scanForbiddenKeys(serialized)).toEqual([]);
    expect(Object.keys(serialized as object).sort()).toEqual([
      "dashboard",
      "totals",
    ]);
  });

  it("narrows the shipped fixture the same way (the real push input)", async () => {
    const fixture = await loadFixture();
    expect(Object.keys(toProjectionReport(fixture)).sort()).toEqual([
      "dashboard",
      "totals",
    ]);
    expect(scanForbiddenKeys(toProjectionReport(fixture))).toEqual([]);
  });
});
