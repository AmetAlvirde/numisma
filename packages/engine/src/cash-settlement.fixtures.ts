// Shared fixtures/helpers for the cash-leg behavior locks, used by both
// cash-settlement.test.ts and cash-settlement-scenarios.test.ts. Split out so the
// specs stay navigable; contains NO describe/it/test. (Coverage excludes
// **/*.fixtures.ts.)
import {
  parseFundReview,
  type FundReviewData,
  type ReserveRecord,
} from "./index.js";
import { readFileSync } from "node:fs";

export const AS_OF = "2026-06-01";

export const DECISION = {
  entryThesis: "thesis",
  invalidationCondition: "invalidation",
  riskBudget: "1R",
  plannedHoldingHorizon: "weeks",
  strategy: "trend",
};

/** A genesis with one tiered cash reserve, one untiered cash reserve, and one
 * mixed-tier position to close. */
export function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "venue", name: "Venue", platform: "BITGET", currency: "USD" }],
    instruments: [
      { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
      { id: "alt-usd", name: "Altcoin", symbol: "ALT", currency: "USD" },
    ],
    reserves: [
      {
        id: "tiered",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "venue",
        currency: "USD",
        amount: 1500,
        lots: [
          { quantity: 1000, tier: "c1" },
          { quantity: 500, tier: "c2" },
        ],
      },
      {
        id: "untiered",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "venue",
        currency: "USD",
        amount: 800,
      },
    ],
    positions: [
      {
        id: "alt-pos",
        portfolioId: "core",
        tempo: "Pulse",
        executionMode: "live",
        accountId: "venue",
        instrumentId: "alt-usd",
        direction: "long",
        markPrice: 40,
        currency: "USD",
        // Mixed tiers: c1 cost basis 100, c2 cost basis 300 → 25% / 75% weights.
        lots: [
          { quantity: 10, cost: 10, tier: "c1" },
          { quantity: 10, cost: 30, tier: "c2" },
        ],
      },
    ],
  };
}

export function reserveById(data: FundReviewData, id: string): ReserveRecord {
  const reserve = data.reserves.find((candidate) => candidate.id === id);
  if (!reserve) {
    throw new Error(`reserve ${id} missing from fold output`);
  }
  return reserve;
}

export function tierQty(reserve: ReserveRecord, tier: "c1" | "c2" | "c3"): number {
  return reserve.lots?.find((lot) => lot.tier === tier)?.quantity ?? 0;
}

/**
 * A real-SHAPED (not synthetic-toy) fixture: multi-portfolio, multi-venue,
 * multi-currency, with a three-tier BITGET USDT settlement Reserve and a
 * genuinely mixed-tier alt Pulse to close — the structure of the real
 * GRAM/RENDER-into-Bitget drift this MVI fixes, but with SYNTHETIC balances (no
 * real amounts/venues enter the repo). Real balances stay out; only the shape is
 * real. The prototype only ever proved the mixed-tier proceeds split on a
 * synthetic toy + the one real drift that happened to be pure-c1; this fixture is
 * what moves the mixed-tier path from prototype to reliable.
 */
export function realShapedGenesis(): FundReviewData {
  const parsed = parseFundReview(
    JSON.parse(
      readFileSync(
        new URL(
          "../tests/fixtures/sanitized-mixed-tier-close-review.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  if (parsed.kind !== "ok") {
    throw new Error(`mixed-tier fixture must parse, got ${parsed.kind}`);
  }
  return parsed.value;
}
