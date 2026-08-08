// ONE WORLD-STATE (ADR-015, audit finding 31). The ingest gate's `EventReference` is a
// PROJECTION of `foldEvents(genesis, acceptedSoFar)`, not a second model of the world
// maintained beside it. Until 2026-08-08 `crossref.ts` carried its own per-verb
// transitions — trim splitting, lot appending, reserve crediting, all re-encoded — and
// nothing enforced that the two agreed. They did not: the fold consumed a position on
// close and the shadow did not, so a re-authored second close passed the gate and then
// vanished at fold with `warnings: []` (MUST FIX 1).
//
// These tests pin the DERIVATION, which is the only thing left that can be wrong. Every
// field the guards read is checked against the folded book it comes from, over a batch
// that exercises all ten verbs. A projection bug — reading open positions but not the
// closed book, mapping `lots: []` to `null`, taking the first close per instrument
// instead of the latest — reddens here rather than surfacing as silent NAV drift.
//
// What is deliberately NOT re-tested here: the rejection rules themselves. ADR-015 adds
// and removes no rule, and the guard suites (`event-ingest.test.ts`,
// `reserve-opened.test.ts`, `position-trimmed-reliable.test.ts`) are unchanged in
// substance across it — including MUST FIX 1's second-close lock, which passes now
// because the fold's closed book says the position is retired.
import { describe, expect, it } from "vitest";
import {
  buildEventReference,
  foldEvents,
  walkPendingInbox,
  type CapitalTier,
  type FundReviewData,
  type PortfolioEvent,
} from "../index.js";

const GENESIS_AS_OF = "2026-06-01";
const TIERS: CapitalTier[] = ["c1", "c2", "c3"];

function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" }],
    instruments: [
      { id: "aapl-usd", name: "Apple Inc.", symbol: "AAPL", currency: "USD" },
      { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
    ],
    reserves: [
      {
        id: "tiered",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
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
        accountId: "xtb-usd",
        currency: "USD",
        amount: 200,
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

/**
 * One batch through all ten verbs, in log order. Every settlement lands at the
 * instrument's folded last close so the magnitude gates pass on merit rather than on a
 * widened dial — `btc-usd`'s anchor is 110 because the scale-in re-prices the fold's
 * own cost baseline from 100 to the blended VWAC, which is exactly the kind of fact
 * the gate can only get right by reading the fold.
 */
function batch(): Record<string, unknown>[] {
  return [
    { id: "e-deposit", asOf: "2026-06-02", type: "Deposit", reserveId: "tiered", amount: 100, tier: "c1" },
    {
      id: "e-open",
      asOf: "2026-06-03",
      type: "PositionOpened",
      position: {
        id: "btc-core",
        portfolioId: "core",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 1, cost: 100, tier: "c2" }],
      },
      decision: {
        entryThesis: "thesis",
        invalidationCondition: "invalidation",
        riskBudget: "1R",
        plannedHoldingHorizon: "weeks",
        strategy: "trend",
      },
      funding: { reserveId: "tiered", amount: 100 },
    },
    {
      id: "e-add",
      asOf: "2026-06-04",
      type: "PositionAddedTo",
      positionId: "btc-core",
      lot: { quantity: 1, cost: 120, tier: "c2" },
      funding: { reserveId: "tiered", amount: 120 },
    },
    { id: "e-mark", asOf: "2026-06-05", type: "PriceMarked", instrumentId: "aapl-usd", price: 160 },
    {
      id: "e-trim",
      asOf: "2026-06-06",
      type: "PositionTrimmed",
      positionId: "aapl-core",
      removals: [{ tier: "c1", quantity: 1 }],
      settlement: { reserveId: "untiered", proceeds: 160 },
    },
    {
      id: "e-close",
      asOf: "2026-06-07",
      type: "PositionClosed",
      positionId: "btc-core",
      settlement: { reserveId: "tiered", proceeds: 220 },
    },
    {
      id: "e-reserve",
      asOf: "2026-06-08",
      type: "ReserveOpened",
      reserve: {
        id: "capital-cash",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "USD",
      },
    },
    {
      id: "e-transfer",
      asOf: "2026-06-09",
      type: "Transfer",
      fromReserveId: "tiered",
      toReserveId: "capital-cash",
      amount: 50,
      tier: "c1",
    },
    { id: "e-withdraw", asOf: "2026-06-10", type: "Withdraw", reserveId: "tiered", amount: 30, tier: "c1" },
    {
      id: "e-invalidation",
      asOf: "2026-06-11",
      type: "InvalidationMarked",
      positionId: "aapl-core",
      price: 120,
      direction: "below",
    },
  ];
}

/** Walk the batch through the real gate and return the accepted log; fail loud if the
 * fixture itself is refused, so a stale expectation can never quietly narrow coverage. */
function acceptedBatch(): PortfolioEvent[] {
  const walk = walkPendingInbox(batch(), { genesis: genesis() });
  expect(walk.invalid).toBeUndefined();
  expect(walk.rejected.map((rejection) => `${rejection.event.id}: ${rejection.message}`)).toEqual([]);
  expect(walk.accepted).toHaveLength(batch().length);
  return walk.accepted;
}

describe("the gate's world IS the fold's world (ADR-015)", () => {
  it("projects every folded Reserve, amount and Tier mix, with untiered staying null", () => {
    const accepted = acceptedBatch();
    const reference = buildEventReference(genesis(), accepted);
    const folded = foldEvents(genesis(), accepted);

    // Same Reserve set, in both directions — the gate holds no Reserve the fold dropped
    // and misses none the fold birthed (`capital-cash` exists only because of the verb).
    expect(reference.reserveBalances.size).toBe(folded.reserves.length);
    expect([...reference.reserveIds].sort()).toEqual(folded.reserves.map((r) => r.id).sort());
    expect(reference.reserveIds.has("capital-cash")).toBe(true);

    for (const reserve of folded.reserves) {
      const view = reference.reserveBalances.get(reserve.id);
      expect(view).toBeDefined();
      if (!view) continue;
      expect(view.amount).toBeCloseTo(reserve.amount, 9);
      expect(view.currency).toBe(reserve.currency);
      if (reserve.lots) {
        expect(view.tiers).not.toBeNull();
        for (const tier of TIERS) {
          const folded_ = reserve.lots
            .filter((lot) => lot.tier === tier)
            .reduce((sum, lot) => sum + lot.quantity, 0);
          expect(view.tiers?.get(tier) ?? 0).toBeCloseTo(folded_, 9);
        }
      } else {
        // Untiered: `amount` is the whole truth, and the gate must not invent Tiers.
        expect(view.tiers).toBeNull();
      }
    }

    // The batch actually moved cash — total, per Tier, and into an untiered Reserve —
    // so none of the above is vacuous. (Deliberately asymmetric amounts: an earlier
    // draft of this fixture happened to net every balance back to its genesis value,
    // which would have made the whole comparison pass on a broken projection.)
    expect(reference.reserveBalances.get("tiered")?.amount).toBeCloseTo(1520, 9);
    expect(reference.reserveBalances.get("tiered")?.tiers?.get("c1")).toBeCloseTo(1020, 9);
    expect(reference.reserveBalances.get("untiered")?.amount).toBeCloseTo(360, 9);

    // A born-but-never-funded Reserve is tiered-because-empty, NOT untiered: the fold
    // gives it `lots: []`, which is truthy, so the first credit mints a real Tier lot.
    // Projecting that to `null` would make the gate read a Deposit's `tier` as
    // irrelevant and launder the provenance the Transfer verb exists to preserve. Taken
    // from the world as of the birth, before this batch's Transfer funds it.
    const atBirth = buildEventReference(
      genesis(),
      accepted.slice(0, accepted.findIndex((event) => event.id === "e-transfer")),
    );
    expect(atBirth.reserveBalances.get("capital-cash")).toEqual({
      amount: 0,
      tiers: new Map(),
      currency: "USD",
      bornAsOf: "2026-06-08",
    });
  });

  it("takes the retired set from the fold's closed book, and open lots from its survivors", () => {
    const accepted = acceptedBatch();
    const reference = buildEventReference(genesis(), accepted);
    const folded = foldEvents(genesis(), accepted);

    // btc-core was closed; aapl-core was only TRIMMED, so it survives. The gate learns
    // both facts from the fold rather than from a per-verb ledger of its own.
    expect([...reference.closedPositionIds]).toEqual(["btc-core"]);
    expect(folded.positions.map((position) => position.id)).toEqual(["aapl-core"]);

    // A retired id stays KNOWN — it existed, and close-and-reopen mints a fresh id —
    // which is what lets the gate say "already closed" instead of "never heard of it".
    expect(reference.positionIds.has("btc-core")).toBe(true);
    expect(reference.positionIds.has("aapl-core")).toBe(true);

    // Only the survivors carry lots, and they are the fold's post-trim lots: 2 c1 units
    // less the 1 the trim removed.
    expect([...reference.positionLots.keys()]).toEqual(["aapl-core"]);
    expect(reference.positionLots.get("aapl-core")?.lots).toEqual(
      folded.positions.find((position) => position.id === "aapl-core")?.lots,
    );
    expect(
      reference.positionLots.get("aapl-core")?.lots.reduce((sum, lot) => sum + lot.quantity, 0),
    ).toBeCloseTo(1, 9);

    // The trim's PARTIAL closed-book row must not retire its position: the fold keeps it
    // open, so the gate must too, or every post-trim verb would fail loud wrongly.
    expect((folded.closedPositions ?? []).some((row) => row.partial === true)).toBe(true);
    expect(reference.closedPositionIds.has("aapl-core")).toBe(false);
  });

  it("takes last-close from the fold's own closes[], including a scale-in's re-priced anchor", () => {
    const accepted = acceptedBatch();
    const reference = buildEventReference(genesis(), accepted);

    // aapl-usd: the genesis t0 anchor at 150, superseded by the real mark at 160.
    expect(reference.lastClose.get("aapl-usd")).toEqual({ price: 160, asOf: "2026-06-05" });

    // btc-usd: the fold mints an entry anchor at the open's VWAC (100) and then
    // RE-PRICES it in place to the blended 110 when the scale-in lands, keeping the
    // anchor's original date. The gate reads 110 because that is the baseline the fold
    // shows; the deleted shadow tracked 100 and would have judged the next mark against
    // a cost the book no longer displays.
    expect(reference.lastClose.get("btc-usd")).toEqual({ price: 110, asOf: "2026-06-03" });
  });

  it("carries the two facts the folded output cannot: the genesis date and each Reserve's birth", () => {
    const accepted = acceptedBatch();
    const reference = buildEventReference(genesis(), accepted);

    // The fold restamps `review.asOf` to the latest event, so `genesisAsOf` is read off
    // the seed. The birth-date gate depends on it for seeded Reserves.
    expect(reference.genesisAsOf).toBe(GENESIS_AS_OF);
    expect(foldEvents(genesis(), accepted).review.asOf).not.toBe(GENESIS_AS_OF);

    // A seeded Reserve exists from the instant the world does; a log-born one from its
    // own `ReserveOpened`. Neither is on the folded `ReserveRecord`.
    expect(reference.reserveBalances.get("tiered")?.bornAsOf).toBe(GENESIS_AS_OF);
    expect(reference.reserveBalances.get("capital-cash")?.bornAsOf).toBe("2026-06-08");
  });
});
