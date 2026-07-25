/**
 * The shared genesis seed for durable-log tests (TEST INPUT ONLY).
 *
 * This package exists because the durable log's READ PATH was being kept in two
 * parallel copies — one in the TUI, one in the web push shell — and they were
 * free to drift. The seed both surfaces need in order to *test* that read path
 * was the second copy of exactly the same mistake: `packages/event-store`'s own
 * `event-store.test.ts` and `apps/web/src/push/push-core.fixtures.ts` each
 * carried a byte-identical fund/portfolio/account/instrument/reserve/position
 * literal under a different local name. Two copies is this repo's stated seam
 * threshold, so it lives here, beside the code it seeds.
 *
 * Reached from outside the package as `@numisma/event-store/testkit` (a subpath
 * export kept SEPARATE from `.` on purpose: test scaffolding must not be
 * importable from the package's production entry point). Coverage-excluded by
 * `vitest.config.ts`'s `.testkit.ts` glob — it is exercised by the tests that
 * import it, not product code to measure.
 *
 * DELIBERATELY SMALL and legible: one live position, one reserve, two
 * instruments. Cases that need more (a corrupt line, a second open, a price mark)
 * layer events on top rather than growing this.
 */

/** The genesis seed's t0 date — every fold over this seed starts here. */
export const GENESIS_SEED_AS_OF = "2026-06-01";

/** The fund name the seed carries (slugged into the projection row's fund_id). */
export const GENESIS_SEED_FUND_NAME = "Accumulus";

/** A small, legible genesis seed: one live position, one reserve, two instruments. */
export function genesisSeed() {
  return {
    fund: { id: "fund-1", name: GENESIS_SEED_FUND_NAME, baseCurrency: "USD" },
    review: { asOf: GENESIS_SEED_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [
      { id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" },
    ],
    instruments: [
      { id: "aapl-usd", name: "Apple Inc.", symbol: "AAPL", currency: "USD" },
      { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
    ],
    reserves: [
      {
        id: "cash-core",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "USD",
        amount: 1000,
      },
    ],
    positions: [
      {
        id: "aapl-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        markPrice: 150,
        currency: "USD",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
      },
    ],
  };
}
