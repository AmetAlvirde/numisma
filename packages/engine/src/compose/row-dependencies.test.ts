/**
 * `composeRowDependencies` — the one engine change in the whole increment
 * (PRD #146 C1, slice #151).
 *
 * WHAT IT HAS TO PROVE, AND WHY THAT IS NOT OBVIOUS. A composition row id names
 * either a grouping (`tempo:Wealth`, `account:t1-usd`, `tier:c1`, `portfolio:core`)
 * or an instrument (`instrument:btc-usd`). Only the last kind carries an instrument
 * in its id at all, so ANY consumer that has to answer *which rows does this
 * instrument's mark poison* has exactly two options: parse the id, which cannot work
 * for the aggregates, or be handed the map. That is why this function exists, and
 * why it lives in the engine — it is a fact about COMPOSITION, not about a cloud.
 *
 * EVERY ASSERTION BELOW IS BUILT SO A NAME-PREFIX IMPLEMENTATION FAILS IT. The
 * decoy fixture at the bottom is the sharp end: an ACCOUNT LITERALLY NAMED `btc`
 * that holds no BTC, beside a tempo named nothing at all that holds only BTC. A
 * prefix guess suppresses the first and misses the second — i.e. it is wrong in both
 * directions at once, which is the only way to show the map is doing real work.
 */
import { describe, expect, it } from "vitest";
import { buildCompositionReport, composeRowDependencies } from "./../index.js";
import type { FundReviewData } from "./../index.js";
import {
  loadSanitizedRealisticFixture,
  parseFixture,
} from "./../fund-composition.fixtures.js";

/** Every row id the composition report actually emits, across all five sections. */
function reportRowIds(data: FundReviewData): string[] {
  return buildCompositionReport(data).dashboard.sections.flatMap((section) =>
    section.rows.map((row) => row.id),
  );
}

/** The rows a missing mark on `instrumentId` poisons, per the map. */
function rowsDependingOn(
  dependencies: ReadonlyMap<string, readonly string[]>,
  instrumentId: string,
): string[] {
  return [...dependencies]
    .filter(([, ids]) => ids.includes(instrumentId))
    .map(([rowId]) => rowId)
    .sort();
}

describe("composeRowDependencies over the realistic fold", () => {
  const data = loadSanitizedRealisticFixture();
  const dependencies = composeRowDependencies(data);

  it("covers EVERY row the composition report emits — no row is unaccounted for", () => {
    // The load-bearing coverage claim. The push reads this map to decide which rows
    // to suppress; a row absent from it would render a number nobody vouched for.
    // Both directions: an entry for a row the report does not emit is equally a bug,
    // because it means the two disagree about what a row IS.
    const rows = reportRowIds(data);
    expect([...new Set(rows)].sort()).toEqual([...dependencies.keys()].sort());
    expect(rows.length).toBeGreaterThan(0);
  });

  it("names instruments for the aggregate rows whose ids name none", () => {
    // `tempo:Wealth` is three instruments across two venues and says so nowhere.
    expect(dependencies.get("tempo:Wealth")).toEqual([
      "aapl-usd",
      "btc-usd",
      "eth-usd",
    ]);
    // `account:gbm-usd` is the equities desk: no crypto anywhere in it.
    expect(dependencies.get("account:gbm-usd")).toEqual([
      "googl-usd",
      "intc-usd",
      "nke-usd",
    ]);
    // An instrument row depends on exactly itself — the ONLY case a prefix guess
    // would have got right.
    expect(dependencies.get("instrument:btc-usd")).toEqual(["btc-usd"]);
  });

  it("splits the rows a missing BTC mark poisons from the rows it does not", () => {
    const poisoned = rowsDependingOn(dependencies, "btc-usd");

    // Aggregates that DO hold BTC — one of each kind, so no single row kind carries
    // the claim.
    for (const rowId of [
      "portfolio:core",
      "portfolio:tactical",
      "tempo:Wealth",
      "tempo:Liquid",
      "account:t1-usd",
      "account:bitso-usd",
      "instrument:btc-usd",
    ]) {
      expect(poisoned, rowId).toContain(rowId);
    }

    // Aggregates that do NOT. `tempo:Reserve` is cash; `account:gbm-usd` is
    // equities only; `instrument:eth-usd` is a different coin on the same venue.
    for (const rowId of [
      "tempo:Reserve",
      "account:gbm-usd",
      "account:bitso-mxn",
      "instrument:eth-usd",
      "instrument:reserve",
    ]) {
      expect(poisoned, rowId).not.toContain(rowId);
    }
  });

  it("reaches the capital-tier rows, which aggregate LOTS rather than positions", () => {
    // Tier rows are the fifth partition and the one built from a different loop
    // (`groupTierLines` walks `tierContributions`, not lines). A map that forgot
    // them would leave the tier table rendering off a poisoned NAV.
    const tierRows = [...dependencies.keys()].filter((id) => id.startsWith("tier:"));
    expect(tierRows.length).toBeGreaterThan(0);
    for (const rowId of tierRows) {
      expect(dependencies.get(rowId)!.length, rowId).toBeGreaterThan(0);
    }
    expect(rowsDependingOn(dependencies, "btc-usd")).toEqual(
      expect.arrayContaining(["tier:c1"]),
    );
  });

  it("is pure: two calls agree, and neither touches the input", () => {
    const before = JSON.stringify(data);
    const again = composeRowDependencies(data);
    expect([...again]).toEqual([...dependencies]);
    expect(JSON.stringify(data)).toBe(before);
  });

  it("lists each instrument once, sorted — the map is a set, not a tally", () => {
    for (const [rowId, ids] of dependencies) {
      expect(new Set(ids).size, rowId).toBe(ids.length);
      expect([...ids].sort(), rowId).toEqual([...ids]);
    }
  });

  it("excludes what the fold excludes — a paper position is not a dependency", () => {
    // `eth-binance-paper` is `executionMode: "paper"` and never enters canonical
    // state, so it must not put `eth-usd` on `account:binance-usd`'s ledger by
    // itself. (It does not, because live ETH sits there too — so the assertion is
    // the one that CAN fail: the excluded `sol-usd` position must appear nowhere.)
    for (const ids of dependencies.values()) {
      expect(ids).not.toContain("sol-usd");
    }
  });
});

/**
 * THE DECOY — the fixture a name-prefix implementation cannot survive.
 *
 * `account:btc` holds nothing but ETH. `tempo:Storage` holds nothing but BTC. A
 * prefix guess suppresses the account (wrong: its number is fine) and leaves the
 * tempo standing (wrong, and WORSE: that is a number rendered off a mark that never
 * arrived — the false *no* the whole invariant exists to prevent).
 */
const DECOY: unknown = {
  fund: { id: "decoy", name: "Decoy Fund", baseCurrency: "USD" },
  review: { asOf: "2026-07-27", usdMxn: 17.31 },
  portfolios: [{ id: "only", name: "Only" }],
  accounts: [
    // An account id that LITERALLY IS an instrument id — and holds none of it.
    { id: "btc", name: "Confusingly Named Desk", platform: "XTB", currency: "USD" },
    { id: "vault", name: "Vault", platform: "T1", currency: "USD" },
  ],
  instruments: [
    { id: "btc", name: "Bitcoin", symbol: "BTC", currency: "USD" },
    { id: "eth", name: "Ether", symbol: "ETH", currency: "USD" },
  ],
  reserves: [],
  positions: [
    {
      id: "eth-in-the-btc-account",
      portfolioId: "only",
      tempo: "Trading",
      executionMode: "live",
      accountId: "btc",
      instrumentId: "eth",
      direction: "long",
      markPrice: 3000,
      currency: "USD",
      lots: [{ quantity: 2, cost: 5000, tier: "c1" }],
    },
    {
      id: "btc-in-the-vault",
      portfolioId: "only",
      tempo: "Storage",
      executionMode: "live",
      accountId: "vault",
      instrumentId: "btc",
      direction: "long",
      markPrice: 100000,
      currency: "USD",
      lots: [{ quantity: 0.1, cost: 8000, tier: "c1" }],
    },
  ],
  closes: [],
};

describe("the decoy: an id that names an instrument it does not hold", () => {
  const dependencies = composeRowDependencies(parseFixture(DECOY));

  it("does NOT put btc on the account merely named `btc`", () => {
    expect(dependencies.get("account:btc")).toEqual(["eth"]);
  });

  it("DOES put btc on the tempo whose id names nothing", () => {
    expect(dependencies.get("tempo:Storage")).toEqual(["btc"]);
  });

  it("so a missing btc mark poisons the tempo and spares the account", () => {
    const poisoned = rowsDependingOn(dependencies, "btc");
    expect(poisoned).toContain("tempo:Storage");
    expect(poisoned).toContain("account:vault");
    expect(poisoned).not.toContain("account:btc");
    expect(poisoned).not.toContain("tempo:Trading");
  });
});
