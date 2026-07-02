// Render locks for the two report sections
// added by the realized-P&L increment (PRD #90, slice #92 / Testing Decision T1):
// `formatClosedBook` (the trade blotter — rows + by-Tempo/by-Tier rollups + grand
// total) and `formatInvalidationWatch` (the OK / ⚠ THESIS INVALIDATED lines). Both
// are empty-guarded: an empty book / empty watch renders NOTHING, which is the
// byte-for-byte-unchanged compatibility contract for pre-existing reports (C1). The
// first non-empty render is locked here as a conscious, reviewable snapshot so a
// real close or mark can never regress the operator-facing text unnoticed.
import { describe, expect, it } from "vitest";
import {
  buildCompositionReport,
  formatClosedBook,
  formatCompositionReport,
  formatInvalidationWatch,
} from "./index.js";
import type { ClosedBook, InvalidationWatchRow } from "./contracts.js";
import {
  loadSanitizedRealisticFixture,
  makeCanonicalFixture,
  parseFixture,
} from "./fund-composition.fixtures.js";

// A populated closed book with two closed Pulse/Tier-c1 positions — one with a
// logged open + strategy, one genesis-held (no `strategy` / `openedAsOf`, so the
// blotter falls back to "—" / "genesis"). Realized rolls up by Tempo, by Tier, and
// to the grand total. Numbers are self-consistent (row realized sums to the
// rollups and the grand total) so the render is deterministic.
function populatedClosedBook(): ClosedBook {
  const rows: ClosedBook["rows"] = [
    {
      positionId: "gram-pos",
      instrumentId: "GRAM",
      tempo: "Pulse",
      strategy: "Momentum",
      direction: "long",
      openedAsOf: "2026-05-01",
      closedAsOf: "2026-06-05",
      costBasisUsd: 500,
      proceedsUsd: 380.03,
      realizedPnlUsd: -119.97,
      tierAttribution: [
        { tier: "c1", costBasisUsd: 500, proceedsUsd: 380.03, realizedPnlUsd: -119.97 },
      ],
    },
    {
      // Genesis-held close: no logged open, so `strategy` / `openedAsOf` are absent.
      positionId: "render-pos",
      instrumentId: "RENDER",
      tempo: "Pulse",
      direction: "long",
      closedAsOf: "2026-06-10",
      costBasisUsd: 600,
      proceedsUsd: 461.66,
      realizedPnlUsd: -138.34,
      tierAttribution: [
        { tier: "c1", costBasisUsd: 600, proceedsUsd: 461.66, realizedPnlUsd: -138.34 },
      ],
    },
  ];
  return {
    rows,
    byTempo: [
      { key: "Pulse", costBasisUsd: 1100, proceedsUsd: 841.69, realizedPnlUsd: -258.31 },
    ],
    byTier: [
      { key: "c1", costBasisUsd: 1100, proceedsUsd: 841.69, realizedPnlUsd: -258.31 },
    ],
    totalRealizedPnlUsd: -258.31,
  };
}

function emptyClosedBook(): ClosedBook {
  return { rows: [], byTempo: [], byTier: [], totalRealizedPnlUsd: 0 };
}

// A populated watch: one non-breached position (OK) and two breached ones — a
// `below` breach (mark ≤ level) and an `above` breach (mark ≥ level). `breached`
// is derived at compose and passed in; the formatter only renders it.
function populatedWatch(): InvalidationWatchRow[] {
  return [
    {
      positionId: "btc-pos",
      instrumentId: "BTC",
      markPrice: 65000,
      level: 60000,
      direction: "below",
      breached: false,
    },
    {
      positionId: "eth-pos",
      instrumentId: "ETH",
      markPrice: 2400,
      level: 2500,
      direction: "below",
      breached: true,
    },
    {
      positionId: "sol-pos",
      instrumentId: "SOL",
      markPrice: 210,
      level: 200,
      direction: "above",
      breached: true,
    },
  ];
}

describe("@numisma/engine formatClosedBook", () => {
  it("renders nothing for an empty closed book (compatibility empty-guard)", () => {
    expect(formatClosedBook(emptyClosedBook())).toBe("");
  });

  it("renders every blotter row, the by-Tempo and by-Tier rollups, and the grand total", () => {
    const out = formatClosedBook(populatedClosedBook());

    // Descriptive-only banner — realized must never read as an addition to NAV.
    expect(out).toContain("Descriptive only");

    // One row per closed position, with the genesis-held fallbacks rendered.
    expect(out).toContain("GRAM");
    expect(out).toContain("Momentum");
    expect(out).toContain("RENDER");
    expect(out).toContain("—"); // absent strategy on the genesis-held close
    expect(out).toContain("genesis"); // absent open date on the genesis-held close

    // Both rollups are present and titled.
    expect(out).toContain("Realized by Tempo");
    expect(out).toContain("Realized by Tier");
    expect(out).toContain("Pulse");

    // The grand total.
    expect(out).toContain("Total realized since genesis: -$258.31");
  });

  it("locks the full populated blotter render byte-for-byte", () => {
    expect(formatClosedBook(populatedClosedBook())).toMatchInlineSnapshot(`
      "Realized P&L — Closed Book (blotter)
      ------------------------------------
      Descriptive only — realized profit already sits in a Reserve; NOT re-added to NAV.
      Instrument   Tempo      Strategy       Opened      Closed              Cost     Proceeds     Realized
      -----------------------------------------------------------------------------------------------------
      GRAM         Pulse      Momentum       2026-05-01  2026-06-05       $500.00      $380.03     -$119.97
      RENDER       Pulse      —              genesis     2026-06-10       $600.00      $461.66     -$138.34

      Realized by Tempo
      -----------------
      Key                    Cost     Proceeds     Realized
      Pulse             $1,100.00      $841.69     -$258.31

      Realized by Tier
      ----------------
      Key                    Cost     Proceeds     Realized
      c1                $1,100.00      $841.69     -$258.31

      Total realized since genesis: -$258.31"
    `);
  });
});

describe("@numisma/engine formatInvalidationWatch", () => {
  it("renders nothing for an empty watch (compatibility empty-guard)", () => {
    expect(formatInvalidationWatch([])).toBe("");
  });

  it("renders OK for a non-breached position and ⚠ THESIS INVALIDATED for breached ones", () => {
    const out = formatInvalidationWatch(populatedWatch());

    // Non-breached open position reads OK; breached reads the invalidation flag.
    expect(out).toMatch(/BTC.*OK/);
    expect(out).toContain("⚠ THESIS INVALIDATED");
    expect(out).toMatch(/ETH.*⚠ THESIS INVALIDATED/);
    expect(out).toMatch(/SOL.*⚠ THESIS INVALIDATED/);

    // Exactly one OK line and two invalidation lines.
    expect(out.match(/ OK$/gm)).toHaveLength(1);
    expect(out.match(/⚠ THESIS INVALIDATED/g)).toHaveLength(2);
  });

  it("locks the full populated watch render byte-for-byte", () => {
    expect(formatInvalidationWatch(populatedWatch())).toMatchInlineSnapshot(`
      "Invalidation Watch
      ------------------
      btc-pos              BTC        mark 65000 below 60000  OK
      eth-pos              ETH        mark 2400 below 2500  ⚠ THESIS INVALIDATED
      sol-pos              SOL        mark 210 above 200  ⚠ THESIS INVALIDATED"
    `);
  });
});

describe("@numisma/engine composition report compatibility (empty-guard C1)", () => {
  it("omits both new sections entirely when the fold has no closes and no levels", () => {
    // The canonical + realistic fixtures fold to an empty closed book and empty
    // watch, so the full report must contain neither section header — this is the
    // byte-for-byte-unchanged contract for pre-existing reports.
    for (const data of [
      parseFixture(makeCanonicalFixture()),
      loadSanitizedRealisticFixture(),
    ]) {
      const report = buildCompositionReport(data);
      expect(report.closedBook.rows).toHaveLength(0);
      expect(report.invalidationWatch).toHaveLength(0);

      const formatted = formatCompositionReport(report);
      expect(formatted).not.toContain("Realized P&L — Closed Book");
      expect(formatted).not.toContain("Invalidation Watch");
    }
  });
});
