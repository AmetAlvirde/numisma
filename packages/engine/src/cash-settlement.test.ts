// PROTOTYPE (mvi 2026-06-30-cash-settlement). Behavior lock for the cash leg of
// every capital move: the six verbs (Open→debit, Close→credit, Deposit, Withdraw,
// Transfer) all route through the one `applyReserveDelta` seam, tier-preserving;
// the ingest sufficiency + settlement-magnitude gates reject a non-conserving
// event before it reaches the log. These are the synthetic paths with no pending
// real data — the close→credit path is additionally proven on the real GRAM/RENDER
// drift by `pnpm spine` (see the prototype note).
import {
  applyReserveDelta,
  buildEventReference,
  crossReferenceEvent,
  EVENT_SCHEMA_VERSION,
  foldEvents,
  migrateLegacyEvent,
  parseEvent,
  parseFundReview,
  reserveDeltasForClose,
  type FundReviewData,
  type PortfolioEvent,
  type ReserveRecord,
} from "./index.js";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const AS_OF = "2026-06-01";

const DECISION = {
  entryThesis: "thesis",
  invalidationCondition: "invalidation",
  riskBudget: "1R",
  plannedHoldingHorizon: "weeks",
  strategy: "trend",
};

/** A genesis with one tiered cash reserve, one untiered cash reserve, and one
 * mixed-tier position to close. */
function genesis(): FundReviewData {
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

function reserveById(data: FundReviewData, id: string): ReserveRecord {
  const reserve = data.reserves.find((candidate) => candidate.id === id);
  if (!reserve) {
    throw new Error(`reserve ${id} missing from fold output`);
  }
  return reserve;
}

function tierQty(reserve: ReserveRecord, tier: "c1" | "c2" | "c3"): number {
  return reserve.lots?.find((lot) => lot.tier === tier)?.quantity ?? 0;
}

describe("cash leg — Open debits the funding reserve, tiered by the lots' own tiers", () => {
  it("debits each Tier by what it funded", () => {
    const open: PortfolioEvent = {
      id: "open-btc",
      asOf: "2026-06-02",
      type: "PositionOpened",
      position: {
        id: "btc-pos",
        portfolioId: "core",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "venue",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [
          { quantity: 1, cost: 200, tier: "c1" },
          { quantity: 1, cost: 100, tier: "c2" },
        ],
      },
      decision: DECISION,
      funding: { reserveId: "tiered", amount: 300 },
    };

    const data = foldEvents(genesis(), [open]);
    const reserve = reserveById(data, "tiered");

    expect(reserve.amount).toBe(1200); // 1500 - 300
    expect(tierQty(reserve, "c1")).toBe(800); // 1000 - 200
    expect(tierQty(reserve, "c2")).toBe(400); // 500 - 100
    expect(data.positions.some((position) => position.id === "btc-pos")).toBe(true);
  });
});

describe("cash leg — Close credits the settlement reserve, proceeds tiered proportionally", () => {
  it("splits proceeds by the closed position's cost-basis tier mix; loss falls per Tier", () => {
    // alt-pos cost basis: c1 100 + c2 300 = 400. Proceeds 360 = a realized loss.
    // c1 weight 25% → 90 (lost 10), c2 weight 75% → 270 (lost 30). Lineage shrinks
    // honestly on the same Tier it was risked on.
    const close: PortfolioEvent = {
      id: "close-alt",
      asOf: "2026-06-03",
      type: "PositionClosed",
      positionId: "alt-pos",
      settlement: { reserveId: "tiered", proceeds: 360 },
    };

    const data = foldEvents(genesis(), [close]);
    const reserve = reserveById(data, "tiered");

    expect(reserve.amount).toBe(1860); // 1500 + 360
    expect(tierQty(reserve, "c1")).toBeCloseTo(1090, 6); // 1000 + 90
    expect(tierQty(reserve, "c2")).toBeCloseTo(770, 6); // 500 + 270
    expect(data.positions.some((position) => position.id === "alt-pos")).toBe(false);
  });

  it("conserves the credited total exactly even when the split has a float residual", () => {
    const deltas = reserveDeltasForClose(
      [
        { quantity: 3, cost: 1, tier: "c1" },
        { quantity: 3, cost: 1, tier: "c2" },
        { quantity: 3, cost: 1, tier: "c3" },
      ],
      100, // does not divide evenly by 3
    );
    const sum = deltas.reduce((total, delta) => total + delta.amount, 0);
    expect(sum).toBeCloseTo(100, 10);
  });
});

describe("cash leg — Deposit / Withdraw / Transfer route through the same seam", () => {
  it("Deposit credits the named Tier", () => {
    const deposit: PortfolioEvent = {
      id: "dep",
      asOf: "2026-06-02",
      type: "Deposit",
      reserveId: "tiered",
      amount: 250,
      tier: "c1",
    };
    const reserve = reserveById(foldEvents(genesis(), [deposit]), "tiered");
    expect(reserve.amount).toBe(1750);
    expect(tierQty(reserve, "c1")).toBe(1250);
    expect(tierQty(reserve, "c2")).toBe(500);
  });

  it("Withdraw debits the named Tier", () => {
    const withdraw: PortfolioEvent = {
      id: "wd",
      asOf: "2026-06-02",
      type: "Withdraw",
      reserveId: "tiered",
      amount: 200,
      tier: "c2",
    };
    const reserve = reserveById(foldEvents(genesis(), [withdraw]), "tiered");
    expect(reserve.amount).toBe(1300);
    expect(tierQty(reserve, "c2")).toBe(300);
  });

  it("Transfer conserves total NAV and carries the Tier across reserves", () => {
    const transfer: PortfolioEvent = {
      id: "xfer",
      asOf: "2026-06-02",
      type: "Transfer",
      fromReserveId: "tiered",
      toReserveId: "untiered",
      amount: 150,
      tier: "c1",
    };
    const data = foldEvents(genesis(), [transfer]);
    const from = reserveById(data, "tiered");
    const to = reserveById(data, "untiered");

    expect(from.amount).toBe(1350); // 1500 - 150
    expect(tierQty(from, "c1")).toBe(850);
    expect(to.amount).toBe(950); // 800 + 150 (untiered: amount only, no lots)
    expect(to.lots).toBeUndefined();
  });

  it("an untiered reserve moves only its amount on Deposit", () => {
    const deposit: PortfolioEvent = {
      id: "dep-u",
      asOf: "2026-06-02",
      type: "Deposit",
      reserveId: "untiered",
      amount: 100,
      tier: "c3",
    };
    const reserve = reserveById(foldEvents(genesis(), [deposit]), "untiered");
    expect(reserve.amount).toBe(900);
    expect(reserve.lots).toBeUndefined();
  });
});

describe("cash leg — ingest gates reject a non-conserving event before the log", () => {
  it("fails loud on an insufficient-Tier debit (Withdraw exceeds the Tier balance)", () => {
    const reference = buildEventReference(genesis());
    const overdraft: PortfolioEvent = {
      id: "wd-too-much",
      asOf: "2026-06-02",
      type: "Withdraw",
      reserveId: "tiered",
      amount: 600, // c2 only holds 500
      tier: "c2",
    };
    const result = crossReferenceEvent(overdraft, reference);
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.message).toMatch(/holds only 500/);
    }
  });

  it("accepts a debit within the Tier balance", () => {
    const reference = buildEventReference(genesis());
    const ok: PortfolioEvent = {
      id: "wd-ok",
      asOf: "2026-06-02",
      type: "Withdraw",
      reserveId: "tiered",
      amount: 500,
      tier: "c2",
    };
    expect(crossReferenceEvent(ok, reference).kind).toBe("ok");
  });

  it("rejects an unknown settlement reserve on a Close", () => {
    const reference = buildEventReference(genesis());
    const close: PortfolioEvent = {
      id: "close-ghost-reserve",
      asOf: "2026-06-02",
      type: "PositionClosed",
      positionId: "alt-pos",
      settlement: { reserveId: "ghost", proceeds: 400 },
    };
    const result = crossReferenceEvent(close, reference);
    expect(result.kind).toBe("event-error");
  });

  it("settlement-magnitude gate rejects wildly-off proceeds, accepts plausible ones", () => {
    const reference = buildEventReference(genesis());
    // alt-pos: 20 units @ last close (genesis markPrice) 40 → expected ~800.
    const plausible: PortfolioEvent = {
      id: "close-plausible",
      asOf: "2026-06-02",
      type: "PositionClosed",
      positionId: "alt-pos",
      settlement: { reserveId: "tiered", proceeds: 760 }, // -5%
    };
    expect(crossReferenceEvent(plausible, reference).kind).toBe("ok");

    const fatFinger: PortfolioEvent = {
      ...plausible,
      id: "close-fat-finger",
      settlement: { reserveId: "tiered", proceeds: 8000 }, // 10x — unit slip
    };
    const result = crossReferenceEvent(fatFinger, reference);
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("settlement.proceeds");
    }
  });
});

describe("cash leg — a Transfer must be same-currency (M2)", () => {
  /** genesis() plus a peso Reserve, so a Transfer can straddle currencies. A
   * Transfer moves the raw `amount` with no FX conversion, so a USD↔MXN move
   * would silently distort NAV — the guard rejects it at the cross-ref gate. */
  function genesisWithPesoReserve(): FundReviewData {
    const base = genesis();
    return {
      ...base,
      accounts: [
        ...base.accounts,
        { id: "venue-mx", name: "Venue MX", platform: "GBM", currency: "MXN" },
      ],
      reserves: [
        ...base.reserves,
        {
          id: "peso",
          portfolioId: "core",
          tempo: "Reserve",
          executionMode: "live",
          accountId: "venue-mx",
          currency: "MXN",
          amount: 30000,
        },
      ],
    };
  }

  it("rejects a cross-currency Transfer loud, before the log (T2)", () => {
    const reference = buildEventReference(genesisWithPesoReserve());
    const crossCurrency: PortfolioEvent = {
      id: "xfer-usd-to-mxn",
      asOf: "2026-06-02",
      type: "Transfer",
      fromReserveId: "tiered", // USD
      toReserveId: "peso", // MXN
      amount: 100,
      tier: "c1",
    };
    const result = crossReferenceEvent(crossCurrency, reference);
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("toReserveId");
      expect(result.message).toMatch(/same-currency/);
    }
  });

  it("accepts a same-currency Transfer at the cross-ref gate", () => {
    const reference = buildEventReference(genesisWithPesoReserve());
    const sameCurrency: PortfolioEvent = {
      id: "xfer-usd-to-usd",
      asOf: "2026-06-02",
      type: "Transfer",
      fromReserveId: "tiered", // USD
      toReserveId: "untiered", // USD
      amount: 100,
      tier: "c1",
    };
    expect(crossReferenceEvent(sameCurrency, reference).kind).toBe("ok");
  });
});

describe("the seam — applyReserveDelta is the one place the invariant lives", () => {
  it("mints a missing Tier lot on a credit and keeps amount authoritative", () => {
    const reserve: ReserveRecord = {
      id: "r",
      portfolioId: "core",
      tempo: "Reserve",
      executionMode: "live",
      accountId: "venue",
      currency: "USD",
      amount: 100,
      lots: [{ quantity: 100, tier: "c1" }],
    };
    applyReserveDelta(reserve, [{ tier: "c3", amount: 50 }]);
    expect(reserve.amount).toBe(150);
    expect(tierQty(reserve, "c3")).toBe(50);
  });

  it("moves only amount for an untiered reserve", () => {
    const reserve: ReserveRecord = {
      id: "r",
      portfolioId: "core",
      tempo: "Reserve",
      executionMode: "live",
      accountId: "venue",
      currency: "USD",
      amount: 100,
    };
    applyReserveDelta(reserve, [{ tier: "c1", amount: -40 }]);
    expect(reserve.amount).toBe(60);
    expect(reserve.lots).toBeUndefined();
  });
});

// T1 (M1 / ADR-003 amendment): the durable-log migration/versioning contract. A
// legacy (pre-cash-leg / v1) open/close must fail loud with a defined migration
// path — never a silent quarantine that skews the fold — and the one-shot
// `migrateLegacyEvent` grafts an operator-supplied cash leg through the same v2 gate.
describe("durable-log versioning — a legacy open/close fails loud with a migration path", () => {
  /** A v1-shape close: a real record written before the cash leg existed. */
  const legacyClose = {
    id: "legacy-close-alt",
    asOf: "2026-06-03",
    type: "PositionClosed",
    positionId: "alt-pos",
  };
  /** A v1-shape open: no funding leg. */
  const legacyOpen = {
    id: "legacy-open-btc",
    asOf: "2026-06-02",
    type: "PositionOpened",
    position: {
      id: "btc-pos",
      portfolioId: "core",
      tempo: "Liquid",
      executionMode: "live",
      accountId: "venue",
      instrumentId: "btc-usd",
      direction: "long",
      currency: "USD",
      lots: [{ quantity: 1, cost: 200, tier: "c1" }],
    },
    decision: DECISION,
  };

  it("parseEvent rejects a legacy close (no settlement) and points at the migration", () => {
    const result = parseEvent(legacyClose);
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("settlement");
      expect(result.message).toMatch(/migrate/i);
    }
  });

  it("parseEvent rejects a legacy open (no funding) and points at the migration", () => {
    const result = parseEvent(legacyOpen);
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("funding");
      expect(result.message).toMatch(/migrate/i);
    }
  });

  it("parseEvent refuses a record tagged newer than this build supports", () => {
    const future = { ...legacyClose, schemaVersion: EVENT_SCHEMA_VERSION + 1, settlement: { reserveId: "tiered", proceeds: 360 } };
    const result = parseEvent(future);
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("schemaVersion");
      expect(result.message).toMatch(/newer than this build/i);
    }
  });

  it("accepts a current-version record carrying the schemaVersion marker", () => {
    const v2 = { ...legacyClose, schemaVersion: EVENT_SCHEMA_VERSION, settlement: { reserveId: "tiered", proceeds: 360 } };
    expect(parseEvent(v2).kind).toBe("ok");
  });

  it("migrateLegacyEvent grafts a supplied settlement onto a legacy close → a valid v2 event", () => {
    // alt-pos: qty 20 × last close (genesis markPrice) 40 → expected ≈ 800; 600 is
    // within the ±50% settlement-magnitude band, so the cross-ref gate accepts it.
    const result = migrateLegacyEvent(legacyClose, { settlement: { reserveId: "tiered", proceeds: 600 } });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.value.type === "PositionClosed") {
      expect(result.value.settlement).toEqual({ reserveId: "tiered", proceeds: 600 });
      // The migrated event then passes the same cross-ref gate every event faces.
      const reference = buildEventReference(genesis());
      expect(crossReferenceEvent(result.value, reference).kind).toBe("ok");
    }
  });

  it("migrateLegacyEvent grafts a supplied funding onto a legacy open → a valid v2 event", () => {
    const result = migrateLegacyEvent(legacyOpen, { funding: { reserveId: "tiered", amount: 200 } });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.value.type === "PositionOpened") {
      expect(result.value.funding).toEqual({ reserveId: "tiered", amount: 200 });
    }
  });

  it("migrateLegacyEvent rejects a leg that does not match the record's verb", () => {
    const result = migrateLegacyEvent(legacyClose, { funding: { reserveId: "tiered", amount: 200 } });
    expect(result.kind).toBe("event-error");
  });
});

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
function realShapedGenesis(): FundReviewData {
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

// T4 (D2) + T5: lock proportional proceeds-tiering + loss-absorption on a
// real-shaped mixed-tier close, and lock the fee-residual-folded-into-the-split
// semantics as intended. gram-bitget-pulse cost basis: c1 2000×0.04 = 80,
// c2 1000×0.04 = 40 → total 120, weights 2/3 c1 and 1/3 c2. It settles into the
// three-tier pulse-bitget-usdt Reserve, so the per-Tier credit is observable
// (unlike an untiered USDT reserve that only moves `amount`).
describe("cash leg — mixed-tier close on a real-shaped fixture (T4)", () => {
  it("splits proceeds proportionally across the closed Tier mix; loss falls per Tier; aggregate exact", () => {
    // Proceeds 108 (net of fees) < basis 120 → a realized loss of 12. Split by the
    // 2/3 : 1/3 cost-basis weights: c1 gets 72 (lost 8), c2 gets 36 (lost 4). c3 is
    // not in the position, so it is untouched — coherent lineage, no laundering.
    const close: PortfolioEvent = {
      id: "close-gram",
      asOf: "2026-06-27",
      type: "PositionClosed",
      positionId: "gram-bitget-pulse",
      settlement: { reserveId: "pulse-bitget-usdt", proceeds: 108 },
    };

    // It is a genuinely ingestable event: the settlement-magnitude gate accepts it
    // (3000 units × last close 0.04 → expected 120; 108 is −10%, inside ±50%).
    const reference = buildEventReference(realShapedGenesis());
    expect(crossReferenceEvent(close, reference).kind).toBe("ok");

    const data = foldEvents(realShapedGenesis(), [close]);
    const reserve = reserveById(data, "pulse-bitget-usdt");

    // Aggregate exact: authoritative `amount` moves by exactly the proceeds.
    expect(reserve.amount).toBeCloseTo(1108, 6); // 1000 + 108

    // Per-Tier coherent: each risked Tier is credited its proportional share, and
    // the sum of the Tier credits equals the proceeds exactly (no drift).
    expect(tierQty(reserve, "c1")).toBeCloseTo(772, 6); // 700 + 72
    expect(tierQty(reserve, "c2")).toBeCloseTo(236, 6); // 200 + 36
    expect(tierQty(reserve, "c3")).toBeCloseTo(100, 6); // untouched — not in the position
    const creditedToTiers =
      tierQty(reserve, "c1") - 700 + (tierQty(reserve, "c2") - 200) + (tierQty(reserve, "c3") - 100);
    expect(creditedToTiers).toBeCloseTo(108, 6);

    // Loss-absorption: the 12 loss is borne per Tier in proportion to what each
    // risked (c1 lost 8 of its 80 basis, c2 lost 4 of its 40) — not dumped on one.
    expect(80 - (tierQty(reserve, "c1") - 700)).toBeCloseTo(8, 6);
    expect(40 - (tierQty(reserve, "c2") - 200)).toBeCloseTo(4, 6);

    expect(data.positions.some((position) => position.id === "gram-bitget-pulse")).toBe(false);
    // Untouched holdings survive the fold unchanged (real-shaped structure intact).
    expect(data.positions.some((position) => position.id === "render-bitget-pulse")).toBe(true);
    expect(data.positions.some((position) => position.id === "btc-xtb-wealth")).toBe(true);
  });

  it("folds the fee-residual into the proportional split rather than a separate line (T5)", () => {
    // Fee-residual semantics: fees are netted INTO `proceeds` before the split, so
    // the fee shrinks each Tier's credit in proportion — it is never carved out as
    // its own reserve line/Tier. Contrast the same close at gross (120) vs net
    // (108) proceeds: the 12 fee is absorbed as 8 on c1 and 4 on c2 (the 2/3 : 1/3
    // weights), and NO extra Tier appears.
    const gramLots = [
      { quantity: 2000, cost: 0.04, tier: "c1" as const },
      { quantity: 1000, cost: 0.04, tier: "c2" as const },
    ];
    const grossDeltas = reserveDeltasForClose(gramLots, 120); // no fee
    const netDeltas = reserveDeltasForClose(gramLots, 108); // 12 fee netted in

    const byTier = (deltas: { tier: string; amount: number }[], tier: string) =>
      deltas.find((delta) => delta.tier === tier)?.amount ?? 0;

    // The fee is spread across exactly the position's Tiers, by the same weights.
    expect(byTier(grossDeltas, "c1") - byTier(netDeltas, "c1")).toBeCloseTo(8, 6);
    expect(byTier(grossDeltas, "c2") - byTier(netDeltas, "c2")).toBeCloseTo(4, 6);

    // No separate "fee" line: the split carries only the Tiers the position risked.
    expect(netDeltas.map((delta) => delta.tier).sort()).toEqual(["c1", "c2"]);

    // And on the folded Reserve, the fee mints no extra lot — c3 stays exactly as
    // it was; the residual lives entirely inside the c1/c2 proportional credits.
    const close: PortfolioEvent = {
      id: "close-gram-net",
      asOf: "2026-06-27",
      type: "PositionClosed",
      positionId: "gram-bitget-pulse",
      settlement: { reserveId: "pulse-bitget-usdt", proceeds: 108 },
    };
    const reserve = reserveById(foldEvents(realShapedGenesis(), [close]), "pulse-bitget-usdt");
    expect(reserve.lots?.map((lot) => lot.tier).sort()).toEqual(["c1", "c2", "c3"]);
    expect(tierQty(reserve, "c3")).toBeCloseTo(100, 6);
  });
});

// T3 (D1): the deliberate settlement-magnitude gate-skip. The proceeds gate
// compares against expected = closed quantity × the instrument's last known
// close. When the instrument has no meaningful prior mark (`lastClose` absent, or
// a markPrice-0 sentinel → expected <= 0) there is no baseline, so the gate is
// SKIPPED and any proceeds is accepted. This is a scoped deferral (D1), not an
// oversight: it is only safe while every closeable instrument is guaranteed a
// prior mark. Locked here so the skip can't silently change behavior, and so the
// day that always-marked invariant weakens, this test is where the exposure shows.
describe("cash leg — un-marked-instrument close skips the settlement-magnitude gate (T3/D1)", () => {
  /** genesis() with the alt instrument left un-marked (markPrice 0) — expected
   * proceeds collapses to 0, so the magnitude gate has no baseline to check. */
  function genesisUnmarked(): FundReviewData {
    const base = genesis();
    return {
      ...base,
      positions: base.positions.map((position) => ({ ...position, markPrice: 0 })),
    };
  }

  it("accepts wildly-off proceeds on an un-marked instrument (gate skipped, D1)", () => {
    const reference = buildEventReference(genesisUnmarked());
    // 40× the ~800 a marked close would expect: on a MARKED instrument the gate
    // rejects this (see the fat-finger test above); with no prior mark it sails
    // through, un-sanity-checked. That is the deliberate, scoped gate-skip.
    const wildlyOff: PortfolioEvent = {
      id: "close-unmarked",
      asOf: "2026-06-02",
      type: "PositionClosed",
      positionId: "alt-pos",
      settlement: { reserveId: "tiered", proceeds: 32000 },
    };
    expect(crossReferenceEvent(wildlyOff, reference).kind).toBe("ok");
  });

  it("contrast: the SAME proceeds are rejected once the instrument carries a mark", () => {
    // Same event, same amount — the only difference is the marked genesis. This is
    // what makes the skip explicit: the gate's protection is contingent entirely on
    // the prior mark, exactly the always-marked invariant D1 is scoped to.
    const reference = buildEventReference(genesis());
    const wildlyOff: PortfolioEvent = {
      id: "close-marked",
      asOf: "2026-06-02",
      type: "PositionClosed",
      positionId: "alt-pos",
      settlement: { reserveId: "tiered", proceeds: 32000 },
    };
    const result = crossReferenceEvent(wildlyOff, reference);
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("settlement.proceeds");
    }
  });
});
