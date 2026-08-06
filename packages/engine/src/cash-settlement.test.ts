// PROTOTYPE (mvi 2026-06-30-cash-settlement). Behavior lock for the cash leg of
// every capital move: the six verbs (Open→debit, Close→credit, Deposit, Withdraw,
// Transfer) all route through the one `applyReserveDelta` seam, tier-preserving;
// the ingest sufficiency + settlement-magnitude gates reject a non-conserving
// event before it reaches the log. These are the synthetic paths with no pending
// real data — the close→credit path is additionally proven on the real GRAM/RENDER
// drift by `pnpm spine` (see the prototype note). Real-shaped / versioning /
// un-marked / cross-ref-shadow scenarios live in cash-settlement-scenarios.test.ts.
import {
  applyReserveDelta,
  buildEventReference,
  crossReferenceEvent,
  foldEvents,
  reserveDeltasForClose,
  type FundReviewData,
  type PortfolioEvent,
  type ReserveRecord,
} from "./index.js";
import {
  DECISION,
  genesis,
  reserveById,
  tierQty,
} from "./cash-settlement.fixtures.js";
import { describe, expect, it } from "vitest";

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

  it("takes `funding.amount` as authoritative when it diverges from Σ(quantity × cost)", () => {
    // The case above has amount === Σ(quantity × cost) === 300, and so does every
    // other `funding` fixture in the repo — which means nothing here would fail if
    // `reserveDeltasForOpen` ignored its `amount` argument entirely and re-derived
    // the total from the lots. `applyReserveDelta` documents `amount` as ALWAYS
    // authoritative; this is the case that can tell the difference. Same two lots
    // (c1 200 + c2 100 = 300 of cost basis), amount 330 — the extra 30 is real cash
    // that left the reserve (fees, slippage, a partial fill priced up).
    //
    // AND IT MUST SPLIT, NOT LAND. The weighting is by native cost, 2:1 across
    // c1:c2, so the 30 of excess is apportioned 20 / 10 — it does not fall on one
    // Tier. That is the per-Tier assertion below, and it is the half of the
    // contract a total-only check would miss.
    const open: PortfolioEvent = {
      id: "open-btc-divergent",
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
      funding: { reserveId: "tiered", amount: 330 },
    };

    const data = foldEvents(genesis(), [open]);
    const reserve = reserveById(data, "tiered");

    expect(reserve.amount).toBe(1170); // 1500 - 330, NOT 1500 - 300
    expect(tierQty(reserve, "c1")).toBeCloseTo(780, 6); // 1000 - 220 (330 × 200/300)
    expect(tierQty(reserve, "c2")).toBeCloseTo(390, 6); // 500 - 110 (330 × 100/300)
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
