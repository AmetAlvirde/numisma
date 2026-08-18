// Reliability suite for the pure fold (ADR-003). The fold is the load-bearing
// projection every read surface consumes, so these tests lock its externally
// visible behavior: as-of windows, verb semantics, ADR-002 tier + entry-FX
// preservation, Close seeding, the FX-at-entry P&L reading, the
// as-of-before-genesis guard, and the seed-immutability (defensive clone)
// guarantee. The 149 existing tests do not exercise foldEvents; this is the
// regression net for the fold's own logic.
import {
  buildCompositionReport,
  buildEventReference,
  crossReferenceEvent,
  foldEvents,
  parseFundReview,
  reserveDeltasForClose,
  reserveDeltasForOpen,
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
  funding?: PositionOpenedEvent["funding"],
): PositionOpenedEvent {
  const cost = position.lots.reduce((sum, lot) => sum + lot.quantity * lot.cost, 0);
  return {
    id,
    asOf,
    type: "PositionOpened",
    position,
    decision: DECISION,
    // Default funds from a reserve the bare genesis does not hold, so the cash leg
    // no-ops and these position-focused tests keep asserting only the asset leg.
    funding: funding ?? { reserveId: "no-such-reserve", amount: cost },
  };
}

function closed(
  id: string,
  asOf: string,
  positionId: string,
  settlement?: PositionClosedEvent["settlement"],
): PositionClosedEvent {
  return {
    id,
    asOf,
    type: "PositionClosed",
    positionId,
    settlement: settlement ?? { reserveId: "no-such-reserve", proceeds: 1 },
  };
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
    const folded = foldEvents(genesis, []).data;

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
    ]).data;

    expect(parseFundReview(folded).kind).toBe("ok");
    expect(positionById(folded, "btc-core")?.markPrice).toBe(130);
  });
});

describe("foldEvents — PositionAddedTo refreshes the entry-VWAC fallback mark", () => {
  it("a scale-in on a not-yet-marked position values the fresh lot at the new blended VWAC (no fabricated unrealized P&L)", () => {
    const folded = foldEvents(emptyGenesis(), [
      opened("open-1", "2026-06-02", {
        id: "scale-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 10, cost: 100, tier: "c1" }],
      }),
      // Scale in at a HIGHER cost with NO PriceMarked for the instrument yet.
      {
        id: "add-1",
        asOf: "2026-06-03",
        type: "PositionAddedTo",
        positionId: "scale-core",
        lot: { quantity: 10, cost: 200, tier: "c1" },
        funding: { reserveId: "no-such-reserve", amount: 2000 },
      },
    ]).data;

    // The fallback mark tracks the new blended VWAC ((10×100 + 10×200) / 20 = 150), NOT
    // the stale open-time average of 100.
    expect(positionById(folded, "scale-core")?.markPrice).toBe(150);

    // Observable consequence: 20 units at 150 == cost basis 3000, so the position is
    // ~0 unrealized — a scale-in with no price move is flat, not a fabricated -1000 loss
    // (the pre-fix bug valued the fresh lot against the old 100).
    const report = buildCompositionReport(folded);
    expect(report.dashboard.summary.totalUnrealizedPnlUsd).toBeCloseTo(0, 6);
  });

  it("a scale-in on a position carrying a REAL mark leaves that mark untouched", () => {
    const folded = foldEvents(emptyGenesis(), [
      opened("open-2", "2026-06-02", {
        id: "marked-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 10, cost: 100, tier: "c1" }],
      }),
      marked("mk-1", "2026-06-03", "btc-usd", 130),
      {
        id: "add-2",
        asOf: "2026-06-04",
        type: "PositionAddedTo",
        positionId: "marked-core",
        lot: { quantity: 10, cost: 200, tier: "c1" },
        funding: { reserveId: "no-such-reserve", amount: 2000 },
      },
    ]).data;

    // A real PriceMarked (130) wins over any VWAC fallback — the add never blends it away.
    expect(positionById(folded, "marked-core")?.markPrice).toBe(130);
  });

  it("refreshes the display Close alongside the blended fallback mark, so a legitimate scale-in fires no markprice-close-mismatch", () => {
    const folded = foldEvents(emptyGenesis(), [
      opened("open-3", "2026-06-02", {
        id: "scale-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 10, cost: 100, tier: "c1" }],
      }),
      {
        id: "add-3",
        asOf: "2026-06-03",
        type: "PositionAddedTo",
        positionId: "scale-core",
        lot: { quantity: 10, cost: 200, tier: "c1" },
        funding: { reserveId: "no-such-reserve", amount: 2000 },
      },
    ]).data;

    // The anchor and the mark move together, but the blend re-prices the fold's own
    // cost anchor IN PLACE at its original date — it never appends a new dated point,
    // because a blended cost is not a price observed on 06-03.
    expect((folded.closes ?? []).filter((close) => close.instrumentId === "btc-usd")).toEqual([
      { instrumentId: "btc-usd", asOf: "2026-06-02", price: 150 },
    ]);

    // ADR-003's claim holds on the event path: no synthetic mismatch for a scale-in.
    const report = buildCompositionReport(folded);
    expect(report.warnings.filter((warning) => warning.code === "markprice-close-mismatch")).toEqual([]);
  });

  it("re-anchors in place when the scale-in lands on the same day as the open", () => {
    // Same-asOf matters because latestCloseByInstrument breaks ties by KEEPING the
    // first: a naive append would leave the stale 100 as the latest Close.
    const folded = foldEvents(emptyGenesis(), [
      opened("open-4", "2026-06-02", {
        id: "sameday-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 10, cost: 100, tier: "c1" }],
      }),
      {
        id: "add-4",
        asOf: "2026-06-02",
        type: "PositionAddedTo",
        positionId: "sameday-core",
        lot: { quantity: 10, cost: 200, tier: "c1" },
        funding: { reserveId: "no-such-reserve", amount: 2000 },
      },
    ]).data;

    expect((folded.closes ?? []).filter((close) => close.instrumentId === "btc-usd")).toEqual([
      { instrumentId: "btc-usd", asOf: "2026-06-02", price: 150 },
    ]);

    const report = buildCompositionReport(folded);
    expect(report.warnings.filter((warning) => warning.code === "markprice-close-mismatch")).toEqual([]);
  });

  it("leaves the display Close alone when the add does not refresh the mark", () => {
    const folded = foldEvents(emptyGenesis(), [
      opened("open-5", "2026-06-02", {
        id: "marked-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 10, cost: 100, tier: "c1" }],
      }),
      marked("mk-2", "2026-06-03", "btc-usd", 130),
      {
        id: "add-5",
        asOf: "2026-06-04",
        type: "PositionAddedTo",
        positionId: "marked-core",
        lot: { quantity: 10, cost: 200, tier: "c1" },
        funding: { reserveId: "no-such-reserve", amount: 2000 },
      },
    ]).data;

    // A real mark owns both sides; the add pushes no anchor of its own.
    expect((folded.closes ?? []).filter((close) => close.instrumentId === "btc-usd")).toEqual([
      { instrumentId: "btc-usd", asOf: "2026-06-02", price: 100 },
      { instrumentId: "btc-usd", asOf: "2026-06-03", price: 130 },
    ]);
  });

  it("a mark landing the SAME day as a scale-in wins the display anchor (no synthetic mismatch)", () => {
    // Events sort stable on (asOf, log order), so the add runs first with no mark yet
    // and blends 150; the mark then lands on the same 06-03. The MARK is the price for
    // that day — a cost blend must never outrank it.
    const folded = foldEvents(emptyGenesis(), [
      opened("open-6", "2026-06-02", {
        id: "sameday-mark-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 10, cost: 100, tier: "c1" }],
      }),
      {
        id: "add-6",
        asOf: "2026-06-03",
        type: "PositionAddedTo",
        positionId: "sameday-mark-core",
        lot: { quantity: 10, cost: 200, tier: "c1" },
        funding: { reserveId: "no-such-reserve", amount: 2000 },
      },
      marked("mk-3", "2026-06-03", "btc-usd", 130),
    ]).data;

    expect(positionById(folded, "sameday-mark-core")?.markPrice).toBe(130);
    const latest = (folded.closes ?? [])
      .filter((close) => close.instrumentId === "btc-usd")
      .reduce((best, close) => (close.asOf >= best.asOf ? close : best));
    expect(latest.price).toBe(130);

    const report = buildCompositionReport(folded);
    expect(report.warnings.filter((warning) => warning.code === "markprice-close-mismatch")).toEqual([]);
  });

  it("an open + add + mark all on ONE day still ends at the mark's price", () => {
    const folded = foldEvents(emptyGenesis(), [
      opened("open-7", "2026-06-02", {
        id: "one-day-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 10, cost: 100, tier: "c1" }],
      }),
      {
        id: "add-7",
        asOf: "2026-06-02",
        type: "PositionAddedTo",
        positionId: "one-day-core",
        lot: { quantity: 10, cost: 200, tier: "c1" },
        funding: { reserveId: "no-such-reserve", amount: 2000 },
      },
      marked("mk-4", "2026-06-02", "btc-usd", 130),
    ]).data;

    expect((folded.closes ?? []).filter((close) => close.instrumentId === "btc-usd")).toEqual([
      { instrumentId: "btc-usd", asOf: "2026-06-02", price: 130 },
    ]);
    const report = buildCompositionReport(folded);
    expect(report.warnings.filter((warning) => warning.code === "markprice-close-mismatch")).toEqual([]);
  });

  it("two marks on the same day keep the LAST one as that day's anchor", () => {
    const folded = foldEvents(emptyGenesis(), [
      opened("open-8", "2026-06-02", {
        id: "twin-mark-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 10, cost: 100, tier: "c1" }],
      }),
      marked("mk-5", "2026-06-03", "btc-usd", 120),
      marked("mk-6", "2026-06-03", "btc-usd", 130),
    ]).data;

    // markPrice is latest-wins (130); the display anchor now agrees instead of
    // stranding the superseded 120 as the day's Close.
    expect(positionById(folded, "twin-mark-core")?.markPrice).toBe(130);
    expect((folded.closes ?? []).filter((close) => close.instrumentId === "btc-usd")).toEqual([
      { instrumentId: "btc-usd", asOf: "2026-06-02", price: 100 },
      { instrumentId: "btc-usd", asOf: "2026-06-03", price: 130 },
    ]);
  });

  it("the scale-in never fabricates a phantom spike in the price journey", () => {
    const folded = foldEvents(emptyGenesis(), [
      opened("open-9", "2026-06-02", {
        id: "journey-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 10, cost: 100, tier: "c1" }],
      }),
      {
        id: "add-9",
        asOf: "2026-06-03",
        type: "PositionAddedTo",
        positionId: "journey-core",
        lot: { quantity: 10, cost: 200, tier: "c1" },
        funding: { reserveId: "no-such-reserve", amount: 2000 },
      },
      marked("mk-7", "2026-06-04", "btc-usd", 105),
    ]).data;

    // Appending the blend as a dated point rendered 100 → 150 → 105: a spike the
    // market never printed, with a nonsense changeAbs/changePct. The journey carries
    // only the re-anchored cost baseline and the real mark.
    const journey = buildCompositionReport(folded).priceJourneys.find(
      (candidate) => candidate.instrumentId === "btc-usd",
    );
    expect(journey?.points).toEqual([
      { asOf: "2026-06-02", price: 150 },
      { asOf: "2026-06-04", price: 105 },
    ]);
    expect(journey?.changeAbs).toBe(-45);
  });

  it("a scale-in never overwrites a GENESIS-provided Close", () => {
    // Genesis closes win (the fold only ever fills instruments that have none), so the
    // add may re-price the fold's own cost anchor but never recorded history.
    const genesis = emptyGenesis();
    genesis.closes = [{ instrumentId: "btc-usd", asOf: GENESIS_AS_OF, price: 95 }];
    const folded = foldEvents(genesis, [
      opened("open-10", GENESIS_AS_OF, {
        id: "genesis-close-core",
        portfolioId: "tactical",
        tempo: "Liquid",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 10, cost: 100, tier: "c1" }],
      }),
      {
        id: "add-10",
        asOf: GENESIS_AS_OF,
        type: "PositionAddedTo",
        positionId: "genesis-close-core",
        lot: { quantity: 10, cost: 200, tier: "c1" },
        funding: { reserveId: "no-such-reserve", amount: 2000 },
      },
    ]).data;

    expect(positionById(folded, "genesis-close-core")?.markPrice).toBe(150);
    expect((folded.closes ?? []).filter((close) => close.instrumentId === "btc-usd")).toEqual([
      { instrumentId: "btc-usd", asOf: GENESIS_AS_OF, price: 95 },
    ]);
  });
});

describe("foldEvents — as-of windows", () => {
  const events: PortfolioEvent[] = [
    marked("m1", "2026-06-05", "aapl-usd", 160),
    marked("m2", "2026-06-10", "aapl-usd", 170),
  ];

  it("applies events on or before asOf and excludes those after", () => {
    // Between the two marks: only the 06-05 mark applies.
    expect(positionById(foldEvents(seededGenesis(), events, "2026-06-07").data, "aapl-core")?.markPrice).toBe(160);
    // After both: the later mark applies.
    expect(positionById(foldEvents(seededGenesis(), events, "2026-06-10").data, "aapl-core")?.markPrice).toBe(170);
  });

  it("includes an event whose asOf exactly equals the boundary", () => {
    // asOf === the mark date: boundary equality is inclusive.
    expect(positionById(foldEvents(seededGenesis(), events, "2026-06-05").data, "aapl-core")?.markPrice).toBe(160);
    // One day before the first mark: nothing applies, the genesis mark stands.
    expect(positionById(foldEvents(seededGenesis(), events, "2026-06-04").data, "aapl-core")?.markPrice).toBe(150);
  });

  it("lets the latest PriceMarked <= asOf win per instrument", () => {
    const marks: PortfolioEvent[] = [
      marked("a", "2026-06-05", "aapl-usd", 200),
      marked("b", "2026-06-08", "aapl-usd", 210),
      marked("c", "2026-06-12", "aapl-usd", 220),
    ];
    expect(positionById(foldEvents(seededGenesis(), marks, "2026-06-10").data, "aapl-core")?.markPrice).toBe(210);
  });

  it("resolves same-day marks by log order (last appended wins)", () => {
    const sameDay: PortfolioEvent[] = [
      marked("first", "2026-06-05", "aapl-usd", 200),
      marked("last", "2026-06-05", "aapl-usd", 210),
    ];
    expect(positionById(foldEvents(seededGenesis(), sameDay, "2026-06-05").data, "aapl-core")?.markPrice).toBe(210);
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
    expect(positionById(foldEvents(emptyGenesis(), [open], "2026-06-04").data, "btc-core")).toBeUndefined();
    // Boundary equality: the position exists as of its open date.
    expect(positionById(foldEvents(emptyGenesis(), [open], "2026-06-05").data, "btc-core")).toBeDefined();
  });

  it("a close removes the Position from current composition, but history survives in the log", () => {
    const log: PortfolioEvent[] = [open, close];

    // Open-before / close-after windows resolve per as-of date from the same log.
    expect(positionById(foldEvents(emptyGenesis(), log, "2026-06-07").data, "btc-core")).toBeDefined();
    // Boundary equality: the close applies as of its own date.
    expect(positionById(foldEvents(emptyGenesis(), log, "2026-06-10").data, "btc-core")).toBeUndefined();
    // Current state (no asOf): closed and gone.
    expect(positionById(foldEvents(emptyGenesis(), log).data, "btc-core")).toBeUndefined();

    // The log is never mutated: re-folding an earlier window still shows it.
    expect(positionById(foldEvents(emptyGenesis(), log, "2026-06-07").data, "btc-core")).toBeDefined();
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
    ]).data;

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
    const folded = foldEvents(seededGenesis(), []).data;
    const anchors = (folded.closes ?? []).filter((close) => close.instrumentId === "aapl-usd");

    // Exactly one anchor, at the genesis date, equal to markPrice (150) not cost (100).
    expect(anchors).toEqual([{ instrumentId: "aapl-usd", asOf: GENESIS_AS_OF, price: 150 }]);
  });

  it("lets a genesis-provided Close win over the seeded markPrice anchor", () => {
    const genesis = seededGenesis();
    genesis.closes = [{ instrumentId: "aapl-usd", asOf: GENESIS_AS_OF, price: 999 }];
    const folded = foldEvents(genesis, []).data;
    const anchors = (folded.closes ?? []).filter((close) => close.instrumentId === "aapl-usd");

    // The genesis Close is preserved; no synthetic markPrice anchor is added on top.
    expect(anchors).toEqual([{ instrumentId: "aapl-usd", asOf: GENESIS_AS_OF, price: 999 }]);
  });

  it("still seeds the t0 anchor when the genesis Close PREDATES the review date", () => {
    // The genesis close is stale history, not the seed's valuation. Suppressing the
    // t0 anchor for it made that older price the instrument's LATEST close — and since
    // ADR-015 the ingest magnitude guard compares against exactly this array, so the
    // next honest mark at the seed's own markPrice would read as a fat finger.
    const genesis = seededGenesis();
    genesis.closes = [{ instrumentId: "aapl-usd", asOf: "2026-05-01", price: 40 }];
    const folded = foldEvents(genesis, []).data;
    const anchors = (folded.closes ?? []).filter((close) => close.instrumentId === "aapl-usd");

    // Recorded history is preserved AND the t0 anchor is minted on top of it.
    expect(anchors).toEqual([
      { instrumentId: "aapl-usd", asOf: "2026-05-01", price: 40 },
      { instrumentId: "aapl-usd", asOf: GENESIS_AS_OF, price: 150 },
    ]);

    // The consequence that makes this load-bearing: the gate's comparison point is the
    // t0 anchor (150), so a legitimate 150 mark is admitted rather than rejected as a
    // 275% deviation off the stale 40 — which would stall the price feed outright.
    const reference = buildEventReference(genesis);
    expect(reference.lastClose.get("aapl-usd")).toEqual({ price: 150, asOf: GENESIS_AS_OF });
    expect(crossReferenceEvent(marked("m", "2026-06-02", "aapl-usd", 150), reference).kind).toBe("ok");
  });

  it("mints one anchor for an instrument carrying several genesis positions", () => {
    // Multi-position instruments are normal in the real seed. The tie-break is
    // first-position-wins, and it is safe because they share one instrument markPrice.
    const genesis = seededGenesis();
    genesis.positions = [
      ...genesis.positions,
      { ...genesis.positions[0]!, id: "aapl-tactical", portfolioId: "tactical" },
    ];
    const folded = foldEvents(genesis, []).data;

    expect((folded.closes ?? []).filter((close) => close.instrumentId === "aapl-usd")).toEqual([
      { instrumentId: "aapl-usd", asOf: GENESIS_AS_OF, price: 150 },
    ]);
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
    ]).data;
    const anchors = (folded.closes ?? []).filter((close) => close.instrumentId === "btc-usd");

    // The anchor lands at the open date and equals the weighted-average entry cost.
    expect(anchors).toEqual([{ instrumentId: "btc-usd", asOf: "2026-06-05", price: 100 }]);
  });

  it("yields no journey and no spurious markprice-close-mismatch for a single anchor", () => {
    const report = buildCompositionReport(foldEvents(seededGenesis(), []).data);

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
    ]).data;

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
    ]).data;
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
    ]).data;
    expect(buildCompositionReport(flatFx).dashboard.summary.totalUnrealizedPnlUsd).toBe(0);
  });
});

describe("foldEvents — as-of-before-genesis guard", () => {
  it("throws rather than folding to a misleading pre-genesis snapshot", () => {
    expect(() => foldEvents(seededGenesis(), [], "2026-05-31").data).toThrow(/precedes the genesis seed date/);
  });

  it("accepts asOf exactly equal to the genesis date as the genesis state", () => {
    const folded = foldEvents(seededGenesis(), [], GENESIS_AS_OF).data;
    expect(folded.review.asOf).toBe(GENESIS_AS_OF);
    expect(folded.positions.map((position) => position.id)).toEqual(["aapl-core"]);
  });
});

describe("foldEvents — the seed is never mutated (defensive clone)", () => {
  it("returns sub-objects that are not shared by reference with the genesis seed", () => {
    const genesis = seededGenesis();
    const folded = foldEvents(genesis, []).data;

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
    const folded = foldEvents(genesis, []).data;

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

describe("tier-weighted deltas — the zero-cost arm attributes in canonical Tier order (#329)", () => {
  // RULED BEHAVIOUR, NOT A PIN. `tierWeightedDeltas` normally splits a cash delta
  // across the lots' Tiers by cost-basis weight, but when the lots carry no cost
  // at all (`totalCost === 0`) there is no weight to split by. It attributes the
  // WHOLE delta to the canonically FIRST Tier that holds a lot — `present[0]`, in
  // c1/c2/c3 order — never to `lots[0].tier`.
  //
  // WHY ORDER, NOT INSERTION. Keying on `lots[0]` made the answer depend on array
  // order, so two callers holding the same position with the same lots ordered
  // differently credited different Tiers. Nothing else in the function behaves
  // that way: the proportional path iterates `present`, which is already
  // canonical. `present[0]` is order-independent, and it degenerates to the old
  // answer whenever exactly one Tier holds lots — the common shape.
  //
  // WHY NOT AN EVEN SPLIT across `present`: with every cost weight zero there is
  // no cost-basis weight to split by, and an even split would invent a weighting
  // the data does not carry (and drag in residual handling).

  it("attributes the whole close credit to the canonically first present Tier when every lot has zero cost", () => {
    // Zero-cost lots across two Tiers, deliberately ordered c3-then-c1 so the
    // answer distinguishes "the first Tier present in c1/c2/c3 order" (c1) from
    // "the first lot's tier" (c3) — and from any proportional split, which would
    // have to divide by a zero total cost.
    const zeroCostLots: PositionLot[] = [
      { quantity: 4, cost: 0, tier: "c3" },
      { quantity: 6, cost: 0, tier: "c1" },
    ];

    const deltas = reserveDeltasForClose(zeroCostLots, 250);

    expect(deltas).toEqual([{ tier: "c1", amount: 250 }]);
  });

  it("debits the same single Tier on the open leg, sign-flipped", () => {
    const zeroCostLots: PositionLot[] = [
      { quantity: 1, cost: 0, tier: "c2" },
      { quantity: 1, cost: 0, tier: "c1" },
    ];

    expect(reserveDeltasForOpen(zeroCostLots, 80)).toEqual([{ tier: "c1", amount: -80 }]);
  });

  it("returns the identical delta list however the same zero-cost lots are ordered", () => {
    // The defect stated as a property: attribution must be a function of WHICH
    // Tiers hold lots, not of the order the caller happened to build the array in.
    const c3First: PositionLot[] = [
      { quantity: 4, cost: 0, tier: "c3" },
      { quantity: 6, cost: 0, tier: "c2" },
    ];
    const c2First: PositionLot[] = [
      { quantity: 6, cost: 0, tier: "c2" },
      { quantity: 4, cost: 0, tier: "c3" },
    ];

    expect(reserveDeltasForClose(c3First, 250)).toEqual(reserveDeltasForClose(c2First, 250));
    expect(reserveDeltasForOpen(c3First, 80)).toEqual(reserveDeltasForOpen(c2First, 80));
  });

  it("splits proportionally the moment ANY lot carries cost — the fallback is the exception", () => {
    // Same Tier mix and lot order as the first case, but with real cost basis, so
    // the normal path runs: two deltas, weighted 40/60, in c1/c2/c3 Tier order
    // rather than lot order. Deleting the degenerate arm would have to make the
    // first case look like this one (or NaN) — this is the contrast that gives
    // the pin its teeth.
    const costedLots: PositionLot[] = [
      { quantity: 4, cost: 10, tier: "c3" },
      { quantity: 6, cost: 10, tier: "c1" },
    ];

    expect(reserveDeltasForClose(costedLots, 250)).toEqual([
      { tier: "c1", amount: 150 },
      { tier: "c3", amount: 100 },
    ]);
  });
});
