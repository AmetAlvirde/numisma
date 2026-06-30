// Reliability suite for the pure fold (ADR-003). The fold is the load-bearing
// projection every read surface consumes, so these tests lock its externally
// visible behavior: as-of windows, verb semantics, ADR-002 tier + entry-FX
// preservation, Close seeding, the FX-at-entry P&L reading, the
// as-of-before-genesis guard, and the seed-immutability (defensive clone)
// guarantee. The 149 existing tests do not exercise foldEvents; this is the
// regression net for the fold's own logic.
import {
  buildCompositionReport,
  foldEvents,
  parseFundReview,
  type FundReviewData,
  type PortfolioEvent,
  type PositionDecision,
  type PositionLot,
  type PositionOpenedEvent,
  type PositionClosedEvent,
  type PriceMarkedEvent,
} from "./index.js";
import { describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";

/** Reference data (portfolios/accounts/instruments) the events below cite. */
function emptyGenesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [
      { id: "core", name: "Core" },
      { id: "tactical", name: "Tactical" },
    ],
    accounts: [
      { id: "xtb-usd", name: "Main Broker", platform: "XTB", currency: "USD" },
      { id: "binance-usd", name: "Liquid Desk", platform: "BINANCE", currency: "USD" },
      { id: "gbm-mxn", name: "Casa de Bolsa", platform: "GBM", currency: "MXN" },
    ],
    instruments: [
      { id: "aapl-usd", name: "Apple Inc.", symbol: "AAPL", currency: "USD" },
      { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
      { id: "cemex-mxn", name: "Cemex", symbol: "CEMEXCPO", currency: "MXN" },
    ],
    reserves: [],
    positions: [],
  };
}

/** emptyGenesis plus one live USD Position (markPrice 150 over cost 100). */
function seededGenesis(): FundReviewData {
  const genesis = emptyGenesis();
  genesis.positions = [
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
  ];
  return genesis;
}

const DECISION: PositionDecision = {
  entryThesis: "thesis",
  invalidationCondition: "invalidation",
  riskBudget: "1R",
  plannedHoldingHorizon: "weeks",
  strategy: "trend",
};

function opened(
  id: string,
  asOf: string,
  position: PositionOpenedEvent["position"],
): PositionOpenedEvent {
  return { id, asOf, type: "PositionOpened", position, decision: DECISION };
}

function closed(id: string, asOf: string, positionId: string): PositionClosedEvent {
  return { id, asOf, type: "PositionClosed", positionId };
}

function marked(
  id: string,
  asOf: string,
  instrumentId: string,
  price: number,
  usdMxn?: number,
): PriceMarkedEvent {
  return {
    id,
    asOf,
    type: "PriceMarked",
    instrumentId,
    price,
    ...(usdMxn !== undefined ? { usdMxn } : {}),
  };
}

function positionById(data: FundReviewData, id: string) {
  return data.positions.find((position) => position.id === id);
}

function sectionRows(
  report: ReturnType<typeof buildCompositionReport>,
  sectionId: "portfolios" | "tempos" | "accounts" | "instruments" | "tiers",
) {
  return report.dashboard.sections.find((section) => section.id === sectionId)?.rows ?? [];
}

describe("foldEvents — fold output is a contract-valid FundReviewData", () => {
  it("the no-event fold parses and composes identically to the genesis seed", () => {
    const genesis = seededGenesis();
    const folded = foldEvents(genesis, []);

    // Provably a valid read model: it survives the same gate hand-authored files do.
    expect(parseFundReview(folded).kind).toBe("ok");

    // No read-model regression: the composition is byte-identical to composing the
    // seed directly (the seeded t0 anchor is a single point, so it adds no journey
    // and — sitting at markPrice — fires no markprice-close-mismatch).
    expect(buildCompositionReport(folded)).toEqual(buildCompositionReport(genesis));
  });

  it("a folded case (open + mark) is still a contract-valid FundReviewData", () => {
    const folded = foldEvents(emptyGenesis(), [
      opened("e1", "2026-06-05", {
        id: "btc-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 1, cost: 100, tier: "c1" }],
      }),
      marked("e2", "2026-06-06", "btc-usd", 130),
    ]);

    expect(parseFundReview(folded).kind).toBe("ok");
    expect(positionById(folded, "btc-core")?.markPrice).toBe(130);
  });
});

describe("foldEvents — as-of windows", () => {
  const events: PortfolioEvent[] = [
    marked("m1", "2026-06-05", "aapl-usd", 160),
    marked("m2", "2026-06-10", "aapl-usd", 170),
  ];

  it("applies events on or before asOf and excludes those after", () => {
    // Between the two marks: only the 06-05 mark applies.
    expect(positionById(foldEvents(seededGenesis(), events, "2026-06-07"), "aapl-core")?.markPrice).toBe(160);
    // After both: the later mark applies.
    expect(positionById(foldEvents(seededGenesis(), events, "2026-06-10"), "aapl-core")?.markPrice).toBe(170);
  });

  it("includes an event whose asOf exactly equals the boundary", () => {
    // asOf === the mark date: boundary equality is inclusive.
    expect(positionById(foldEvents(seededGenesis(), events, "2026-06-05"), "aapl-core")?.markPrice).toBe(160);
    // One day before the first mark: nothing applies, the genesis mark stands.
    expect(positionById(foldEvents(seededGenesis(), events, "2026-06-04"), "aapl-core")?.markPrice).toBe(150);
  });

  it("lets the latest PriceMarked <= asOf win per instrument", () => {
    const marks: PortfolioEvent[] = [
      marked("a", "2026-06-05", "aapl-usd", 200),
      marked("b", "2026-06-08", "aapl-usd", 210),
      marked("c", "2026-06-12", "aapl-usd", 220),
    ];
    expect(positionById(foldEvents(seededGenesis(), marks, "2026-06-10"), "aapl-core")?.markPrice).toBe(210);
  });

  it("resolves same-day marks by log order (last appended wins)", () => {
    const sameDay: PortfolioEvent[] = [
      marked("first", "2026-06-05", "aapl-usd", 200),
      marked("last", "2026-06-05", "aapl-usd", 210),
    ];
    expect(positionById(foldEvents(seededGenesis(), sameDay, "2026-06-05"), "aapl-core")?.markPrice).toBe(210);
  });
});

describe("foldEvents — verb semantics", () => {
  const open = opened("o1", "2026-06-05", {
    id: "btc-core",
    portfolioId: "tactical",
    tempo: "Liquid",
    executionMode: "live",
    accountId: "binance-usd",
    instrumentId: "btc-usd",
    direction: "long",
    currency: "USD",
    lots: [{ quantity: 1, cost: 100, tier: "c1" }],
  });
  const close = closed("c1", "2026-06-10", "btc-core");

  it("an open adds the Position to composition from its asOf onward", () => {
    expect(positionById(foldEvents(emptyGenesis(), [open], "2026-06-04"), "btc-core")).toBeUndefined();
    // Boundary equality: the position exists as of its open date.
    expect(positionById(foldEvents(emptyGenesis(), [open], "2026-06-05"), "btc-core")).toBeDefined();
  });

  it("a close removes the Position from current composition, but history survives in the log", () => {
    const log: PortfolioEvent[] = [open, close];

    // Open-before / close-after windows resolve per as-of date from the same log.
    expect(positionById(foldEvents(emptyGenesis(), log, "2026-06-07"), "btc-core")).toBeDefined();
    // Boundary equality: the close applies as of its own date.
    expect(positionById(foldEvents(emptyGenesis(), log, "2026-06-10"), "btc-core")).toBeUndefined();
    // Current state (no asOf): closed and gone.
    expect(positionById(foldEvents(emptyGenesis(), log), "btc-core")).toBeUndefined();

    // The log is never mutated: re-folding an earlier window still shows it.
    expect(positionById(foldEvents(emptyGenesis(), log, "2026-06-07"), "btc-core")).toBeDefined();
  });
});

describe("foldEvents — tier + entry-FX preservation (ADR-002)", () => {
  it("carries multi-tier lots and per-lot entryFx into correct per-tier P&L on the MXN path", () => {
    // Mirrors the compose suite's FX attribution case, driven through the fold:
    // a c1 lot acquired at entryFx 25 (vs review FX 20) and an untiered-FX c2 lot,
    // marked to 100 MXN. Cost basis converts at each lot's entry FX; market value
    // at review FX.
    const folded = foldEvents(emptyGenesis(), [
      opened("o", "2026-06-05", {
        id: "cemex-house-money",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "gbm-mxn",
        instrumentId: "cemex-mxn",
        direction: "long",
        currency: "MXN",
        lots: [
          { quantity: 10, cost: 50, tier: "c1", entryFx: 25 },
          { quantity: 10, cost: 80, tier: "c2" },
        ],
      }),
      marked("m", "2026-06-06", "cemex-mxn", 100),
    ]);

    // entryFx survives losslessly into the folded read model.
    expect(positionById(folded, "cemex-house-money")?.lots).toEqual([
      { quantity: 10, cost: 50, tier: "c1", entryFx: 25 },
      { quantity: 10, cost: 80, tier: "c2" },
    ]);

    const report = buildCompositionReport(folded);
    expect(report.dashboard.summary.totalUnrealizedPnlUsd).toBe(40);
    expect(sectionRows(report, "tiers")).toEqual([
      {
        id: "tier:c1",
        kind: "tier",
        label: "c1",
        usdValue: 50,
        percentOfFund: 50,
        costBasisUsd: 20,
        unrealizedPnlUsd: 30,
      },
      {
        id: "tier:c2",
        kind: "tier",
        label: "c2",
        usdValue: 50,
        percentOfFund: 50,
        costBasisUsd: 40,
        unrealizedPnlUsd: 10,
      },
    ]);
  });
});

describe("foldEvents — Close seeding", () => {
  it("seeds a genesis-held instrument's t0 anchor at markPrice, not cost", () => {
    const folded = foldEvents(seededGenesis(), []);
    const anchors = (folded.closes ?? []).filter((close) => close.instrumentId === "aapl-usd");

    // Exactly one anchor, at the genesis date, equal to markPrice (150) not cost (100).
    expect(anchors).toEqual([{ instrumentId: "aapl-usd", asOf: GENESIS_AS_OF, price: 150 }]);
  });

  it("lets a genesis-provided Close win over the seeded markPrice anchor", () => {
    const genesis = seededGenesis();
    genesis.closes = [{ instrumentId: "aapl-usd", asOf: GENESIS_AS_OF, price: 999 }];
    const folded = foldEvents(genesis, []);
    const anchors = (folded.closes ?? []).filter((close) => close.instrumentId === "aapl-usd");

    // The genesis Close is preserved; no synthetic markPrice anchor is added on top.
    expect(anchors).toEqual([{ instrumentId: "aapl-usd", asOf: GENESIS_AS_OF, price: 999 }]);
  });

  it("drops an entry-price anchor when an instrument is first held mid-stream", () => {
    const folded = foldEvents(emptyGenesis(), [
      opened("o", "2026-06-05", {
        id: "btc-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 1, cost: 100, tier: "c1" }],
      }),
    ]);
    const anchors = (folded.closes ?? []).filter((close) => close.instrumentId === "btc-usd");

    // The anchor lands at the open date and equals the weighted-average entry cost.
    expect(anchors).toEqual([{ instrumentId: "btc-usd", asOf: "2026-06-05", price: 100 }]);
  });

  it("yields no journey and no spurious markprice-close-mismatch for a single anchor", () => {
    const report = buildCompositionReport(foldEvents(seededGenesis(), []));

    expect(report.priceJourneys).toEqual([]);
    expect(report.warnings.filter((warning) => warning.code === "markprice-close-mismatch")).toEqual([]);
  });
});

describe("foldEvents — FX-at-entry P&L semantics", () => {
  it("reads a no-mark open as a pure FX-translation gain/loss when entryFx != review FX", () => {
    // entryFx 25 over review FX 20: markPrice falls back to the weighted-average
    // cost (50 MXN), so the position is "frozen at entry" in native units — yet the
    // USD P&L is NOT zero. Cost converts at 25 (20 USD), value at 20 (25 USD): +5.
    const folded = foldEvents(emptyGenesis(), [
      opened("o", "2026-06-05", {
        id: "cemex-fx",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "gbm-mxn",
        instrumentId: "cemex-mxn",
        direction: "long",
        currency: "MXN",
        lots: [{ quantity: 10, cost: 50, tier: "c1", entryFx: 25 }],
      }),
    ]);

    expect(positionById(folded, "cemex-fx")?.markPrice).toBe(50); // weighted-average cost
    const pnl = buildCompositionReport(folded).dashboard.summary.totalUnrealizedPnlUsd;
    expect(pnl).not.toBe(0);
    expect(pnl).toBe(5);
  });

  it("reads a no-mark open as exactly 0 for USD or when entryFx == review FX", () => {
    // USD: no FX translation, frozen-at-entry P&L is genuinely 0.
    const usd = foldEvents(emptyGenesis(), [
      opened("o", "2026-06-05", {
        id: "aapl-fx",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "xtb-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
      }),
    ]);
    expect(buildCompositionReport(usd).dashboard.summary.totalUnrealizedPnlUsd).toBe(0);

    // MXN but entryFx == review FX (20): the FX translation is the identity, P&L 0.
    const flatFx = foldEvents(emptyGenesis(), [
      opened("o", "2026-06-05", {
        id: "cemex-flat",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "gbm-mxn",
        instrumentId: "cemex-mxn",
        direction: "long",
        currency: "MXN",
        lots: [{ quantity: 10, cost: 50, tier: "c1", entryFx: 20 }],
      }),
    ]);
    expect(buildCompositionReport(flatFx).dashboard.summary.totalUnrealizedPnlUsd).toBe(0);
  });
});

describe("foldEvents — as-of-before-genesis guard", () => {
  it("throws rather than folding to a misleading pre-genesis snapshot", () => {
    expect(() => foldEvents(seededGenesis(), [], "2026-05-31")).toThrow(/precedes the genesis seed date/);
  });

  it("accepts asOf exactly equal to the genesis date as the genesis state", () => {
    const folded = foldEvents(seededGenesis(), [], GENESIS_AS_OF);
    expect(folded.review.asOf).toBe(GENESIS_AS_OF);
    expect(folded.positions.map((position) => position.id)).toEqual(["aapl-core"]);
  });
});

describe("foldEvents — the seed is never mutated (defensive clone)", () => {
  it("returns sub-objects that are not shared by reference with the genesis seed", () => {
    const genesis = seededGenesis();
    const folded = foldEvents(genesis, []);

    expect(folded.fund).not.toBe(genesis.fund);
    expect(folded.portfolios).not.toBe(genesis.portfolios);
    expect(folded.accounts).not.toBe(genesis.accounts);
    expect(folded.instruments).not.toBe(genesis.instruments);
    expect(folded.reserves).not.toBe(genesis.reserves);
    expect(folded.positions[0]).not.toBe(genesis.positions[0]);
  });

  it("isolates a consumer mutation of the fold output from the seed", () => {
    const genesis = seededGenesis();
    genesis.reserves = [
      {
        id: "cash",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "xtb-usd",
        currency: "USD",
        amount: 1000,
      },
    ];
    const folded = foldEvents(genesis, []);

    // A future consumer writing through the read model must not reach the seed.
    folded.fund.name = "Mutated";
    folded.portfolios[0]!.name = "Mutated";
    folded.instruments[0]!.symbol = "MUT";
    folded.reserves[0]!.amount = 0;
    folded.positions[0]!.markPrice = 0;

    expect(genesis.fund.name).toBe("Accumulus");
    expect(genesis.portfolios[0]!.name).toBe("Core");
    expect(genesis.instruments[0]!.symbol).toBe("AAPL");
    expect(genesis.reserves[0]!.amount).toBe(1000);
    expect(genesis.positions[0]!.markPrice).toBe(150);
  });
});
