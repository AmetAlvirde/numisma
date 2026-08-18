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
  EVENT_SCHEMA_VERSION,
  foldEvents,
  parseEvent,
  parseFundReview,
  reserveDeltasForClose,
  reserveDeltasForOpen,
  type FundReviewData,
  type PortfolioEvent,
  type PositionDecision,
  type PositionLot,
  type PositionOpenedEvent,
  type PositionClosedEvent,
  type PositionTrimmedEvent,
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
    // FUNDED, NOT EMPTY (#371). The helpers below used to default their cash legs to a
    // reserve the genesis did not hold, so the leg no-opped and a position-focused test
    // could ignore it. A reserve miss is now a TOTAL discard, so that default would drop
    // the very events these tests are about. The balance is deliberately far larger than
    // any fixture spends, so no debit here can go negative and distract from the asset
    // leg these tests actually assert on.
    reserves: [
      {
        id: "desk-usd",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "binance-usd",
        currency: "USD",
        amount: 1_000_000,
        lots: [{ quantity: 1_000_000, tier: "c1" }],
      },
    ],
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
    // Defaults to the genesis desk reserve, which is funded far beyond any fixture's
    // spend, so the cash leg APPLIES and stays uninteresting — these position-focused
    // tests keep asserting only the asset leg. It must name a reserve that exists: a
    // miss now discards the whole event (#371), which would drop the open outright.
    funding: funding ?? { reserveId: "desk-usd", amount: cost },
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
    settlement: settlement ?? { reserveId: "desk-usd", proceeds: 1 },
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
        funding: { reserveId: "desk-usd", amount: 2000 },
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
        funding: { reserveId: "desk-usd", amount: 2000 },
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
        funding: { reserveId: "desk-usd", amount: 2000 },
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
        funding: { reserveId: "desk-usd", amount: 2000 },
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
        funding: { reserveId: "desk-usd", amount: 2000 },
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
        funding: { reserveId: "desk-usd", amount: 2000 },
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
        funding: { reserveId: "desk-usd", amount: 2000 },
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
        funding: { reserveId: "desk-usd", amount: 2000 },
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
        funding: { reserveId: "desk-usd", amount: 2000 },
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
    //
    // THIS TEST OWNS ITS RESERVE, because it asserts FUND-WIDE tier percentages and any
    // standing balance would land in the rollup beside the position. It is funded with
    // exactly this open's cost, tier-matched to its lots (c1 500 + c2 800 = 1300), so
    // the funding debit drains it to zero on both tiers and the fund is the position
    // alone. Before #371 the open named an absent reserve and its cash leg no-opped;
    // a reserve miss now discards the whole event, so the leg has to be real — and it
    // has to land somewhere that leaves these percentages meaning what they meant.
    const genesis = emptyGenesis();
    genesis.reserves = [
      {
        id: "desk-usd",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "binance-usd",
        currency: "USD",
        amount: 1300,
        lots: [
          { quantity: 500, tier: "c1" },
          { quantity: 800, tier: "c2" },
        ],
      },
    ];
    const folded = foldEvents(genesis, [
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

describe("a cash leg with no lot provenance discards the WHOLE event (#329)", () => {
  // Any lot at all puts a key in `costByTier`, so `tierWeightedDeltas` returns an empty
  // list ONLY when it is handed no lots. The old code returned a full-magnitude delta on
  // the `?? "c1"` fallback — it MINTED c1 capital for a cash movement carrying no
  // provenance whatsoever, and `applyReserveDelta` booked it as real. That is not a bad
  // attribution, it is an invented one.
  //
  // THE EMPTY LIST IS A DISCARD OF THE EVENT, NOT OF THE LEG. Dropping only the cash
  // leg and letting the arm carry on is worse than the invented `c1`: the closed-book
  // row would raise realized P&L by the full proceeds while NO reserve was credited, so
  // the money would not be misattributed, it would be gone. `provenance-absent` on
  // ADR-020's Discard Channel therefore means what `position-absent` already means in
  // these same arms — nothing applied.
  //
  // WHICH ROUTE IS REACHABLE. `parseLots` rejects `lots: []`, and the durable log is
  // parsed line-by-line on load (`loadEventLog`), so a lot-less OPEN cannot reach the
  // fold through ingest OR through `loadFoldedReview`; it is pinned below as a pure
  // arm, with the parser guard that makes it unreachable pinned beside it. The credit
  // legs are a different story: a removal naming a tier the position holds no lots in
  // is parse-legal (`parse.ts` requires only a positive quantity) and only the
  // cross-ref sufficiency gate stops it — a gate `loadFoldedReview` does not run, since
  // it calls `foldEvents` on the durable log directly. That is the migration-shaped
  // route the conservation tests below use.

  const DISCARD_GENESIS_RESERVE = 1000;

  /** Genesis with one funded USD reserve and one all-c1 BTC position (3 @ 100). */
  function trimmableGenesis(): FundReviewData {
    const genesis = emptyGenesis();
    genesis.reserves = [
      {
        id: "desk-usd",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "binance-usd",
        currency: "USD",
        amount: DISCARD_GENESIS_RESERVE,
      },
    ];
    genesis.positions = [
      {
        id: "btc-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        markPrice: 120,
        currency: "USD",
        lots: [{ quantity: 3, cost: 100, tier: "c1" }],
      },
    ];
    return genesis;
  }

  /** A trim whose removals name `tier`; `c2` on the genesis above removes nothing. */
  function trimmed(
    id: string,
    asOf: string,
    tier: "c1" | "c2" | "c3",
    quantity: number,
    settlement: { reserveId: string; proceeds: number },
  ): PositionTrimmedEvent {
    return {
      id,
      asOf,
      type: "PositionTrimmed",
      positionId: "btc-core",
      removals: [{ tier, quantity }],
      settlement,
    };
  }

  /** Total realized P&L on the closed book — the figure a partial discard inflates. */
  function realizedPnl(folded: ReturnType<typeof foldEvents>): number {
    return (folded.data.closedPositions ?? []).reduce((sum, row) => sum + row.realizedPnlUsd, 0);
  }

  it("returns an empty delta list for empty lots on both legs", () => {
    expect(reserveDeltasForOpen([], 400)).toEqual([]);
    expect(reserveDeltasForClose([], 250)).toEqual([]);
  });

  it("discards a trim naming a tier the position holds no lots in — nothing applies", () => {
    // THE REACHABLE PRODUCER. `splitTierRemoval` returns `removed: []` when the named
    // tier's total quantity is zero, so the proceeds have no provenance to inherit.
    // Every clause here is a distinct way the old partial discard leaked: the row
    // booked P&L, the mutation retired the asset, the reserve stayed flat while both
    // happened.
    const folded = foldEvents(trimmableGenesis(), [
      trimmed("evt-trim-empty-tier", "2026-06-03", "c2", 1, {
        reserveId: "desk-usd",
        proceeds: 130,
      }),
    ]);

    expect(folded.skipped).toEqual([
      {
        eventId: "evt-trim-empty-tier",
        index: 0,
        verb: "PositionTrimmed",
        reason: "provenance-absent",
        detail: expect.any(String),
      },
    ]);
    // No partial row, so no realized P&L moved.
    expect(folded.data.closedPositions ?? []).toEqual([]);
    expect(realizedPnl(folded)).toBe(0);
    // The asset leg is untouched: same position, same lots, not retired.
    expect(folded.data.positions).toHaveLength(1);
    expect(folded.data.positions[0]!.id).toBe("btc-core");
    expect(folded.data.positions[0]!.lots).toEqual([{ quantity: 3, cost: 100, tier: "c1" }]);
    // And the reserve never moved.
    expect(folded.data.reserves[0]!.amount).toBe(DISCARD_GENESIS_RESERVE);
  });

  it("discards a close of a position a trim already emptied — the position stays open", () => {
    // The same door, one verb along: a full-quantity trim is rejected at ingest but is
    // parse-legal, so a durable log can hold one. It leaves the position open with no
    // lots, and the close that follows has no provenance for its proceeds. The trim
    // itself applies in full — it is the BASELINE the close must not move.
    const applyingTrim = trimmed("evt-trim-all", "2026-06-03", "c1", 3, {
      reserveId: "desk-usd",
      proceeds: 360,
    });
    const baseline = foldEvents(trimmableGenesis(), [applyingTrim]);
    expect(baseline.skipped).toEqual([]);
    expect(baseline.data.reserves[0]!.amount).toBe(DISCARD_GENESIS_RESERVE + 360);
    expect(realizedPnl(baseline)).toBe(60); // 360 proceeds − 300 cost basis
    expect(baseline.data.positions[0]!.lots).toEqual([]);

    const folded = foldEvents(trimmableGenesis(), [
      applyingTrim,
      closed("evt-close-lotless", "2026-06-04", "btc-core", {
        reserveId: "desk-usd",
        proceeds: 500,
      }),
    ]);

    expect(folded.skipped).toEqual([
      {
        eventId: "evt-close-lotless",
        index: 1,
        verb: "PositionClosed",
        reason: "provenance-absent",
        detail: expect.any(String),
      },
    ]);
    // Exactly the trim's own row — the close booked nothing. Under the partial discard
    // this was two rows and 560 of realized P&L against a reserve that never saw the
    // second 500.
    expect(folded.data.closedPositions ?? []).toHaveLength(1);
    expect(realizedPnl(folded)).toBe(60);
    expect(folded.data.reserves[0]!.amount).toBe(DISCARD_GENESIS_RESERVE + 360);
    // Not retired: `positions.delete` never ran.
    expect(folded.data.positions.map((position) => position.id)).toEqual(["btc-core"]);
  });

  it("reports provenance-absent and NOT reserve-absent when the reserve is also missing", () => {
    // Precedence is a decision: there is nothing to apply, so whether the reserve
    // exists is moot, and a reserve miss that never happened must not be reported.
    // One event, one finding, on this path.
    const folded = foldEvents(trimmableGenesis(), [
      trimmed("evt-trim-empty-tier", "2026-06-03", "c2", 1, {
        reserveId: "no-such-reserve",
        proceeds: 130,
      }),
    ]);

    expect(folded.skipped).toHaveLength(1);
    expect(folded.skipped[0]!.reason).toBe("provenance-absent");
  });

  it("keeps the new reason's prose free of figures and of event content", () => {
    const folded = foldEvents(trimmableGenesis(), [
      trimmed("evt-trim-empty-tier", "2026-06-03", "c2", 1, {
        reserveId: "desk-usd",
        proceeds: 130,
      }),
    ]);

    const skip = folded.skipped[0]!;
    expect(skip.reason).toBe("provenance-absent");
    expect(skip.detail).not.toMatch(/\d/); // no figure of any kind
    expect(skip.detail).not.toContain(skip.verb); // the verb has its own field
    expect(skip.detail).not.toContain(skip.eventId);
    expect(skip.detail).not.toContain("desk-usd");
    expect(skip.detail).not.toContain("btc-core");
    expect(skip.detail.length).toBeGreaterThan(0);
  });

  it("discards a lot-less open whole — no position, no anchor, no debit", () => {
    // `foldEvents` is exported and pure, so the open arm must be internally consistent
    // even though nothing in production can hand it this event (see the parser pin
    // below). Registering the ghost while dropping its funding debit would put a
    // position on the read model that no reserve paid for.
    const folded = foldEvents(trimmableGenesis(), [
      opened(
        "evt-lotless-open",
        "2026-06-02",
        {
          id: "ghost-core",
          portfolioId: "core",
          tempo: "Capital",
          executionMode: "live",
          accountId: "binance-usd",
          instrumentId: "aapl-usd",
          direction: "long",
          currency: "USD",
          lots: [],
        },
        { reserveId: "desk-usd", amount: 400 },
      ),
    ]);

    expect(folded.skipped).toEqual([
      {
        eventId: "evt-lotless-open",
        index: 0,
        verb: "PositionOpened",
        reason: "provenance-absent",
        detail: expect.any(String),
      },
    ]);
    expect(folded.data.positions.map((position) => position.id)).toEqual(["btc-core"]);
    expect(folded.data.reserves[0]!.amount).toBe(DISCARD_GENESIS_RESERVE);
    // No entry-price anchor was seeded for the instrument the ghost named.
    expect((folded.data.closes ?? []).some((close) => close.instrumentId === "aapl-usd")).toBe(
      false,
    );
  });

  it("cannot arrive through ingest: the parser rejects an open with no lots", () => {
    // WHAT THIS BUYS. It is the reason the test above pins an arm no production route
    // reaches, and it is the tripwire on that claim: the durable log is parsed on load,
    // so relaxing `parseLots` would make the lot-less open a LIVE route into the fold
    // and this test reddens to say so. Everything else in the fixture is valid, so the
    // empty `lots` is the only thing under test.
    const result = parseEvent({
      schemaVersion: EVENT_SCHEMA_VERSION,
      id: "evt-lotless-open",
      asOf: "2026-06-02",
      type: "PositionOpened",
      position: {
        id: "ghost-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "aapl-usd",
        direction: "long",
        currency: "USD",
        lots: [],
      },
      decision: DECISION,
      funding: { reserveId: "desk-usd", amount: 400 },
    });

    expect(result.kind).toBe("event-error");
    expect(result).toMatchObject({ path: "position.lots" });
  });
});

describe("a cash leg naming an ABSENT RESERVE discards the WHOLE event (#371)", () => {
  // THE RULING THIS PINS. `reserve-absent` used to mean two different things depending
  // on which arm raised it. On the four explicit-tier cash arms it meant "nothing
  // applied" — there is nothing else in those arms to apply. On the four LOT-DERIVED
  // arms it meant "everything except the cash": a close booked its row and retired the
  // position, a trim booked a partial row and mutated the lots, an open registered a
  // position, an add grew one — each against a reserve that never moved. And `Transfer`
  // debited its source when only the destination was missing.
  //
  // Nothing in `FoldSkipReason`, in `SKIP_DETAIL`, or in the prose told a reader which
  // sense was in force; the difference lived only in the shape of the call sites. Every
  // member of the vocabulary now means the fold applied NOTHING AT ALL, which is what
  // makes each reason's fixed notice ("No state moved.") true wherever it can be raised.
  //
  // REACHABILITY IS UNCHANGED and is migration-shaped, the same caveat #366 and #367
  // carry: the cross-ref existence gate rejects an unknown reserve before the fold runs,
  // so on the gated path none of this can happen. It is reachable through callers that
  // fold the durable log directly — `loadFoldedReview` in `event-store.ts`.

  const RESERVE_START = 5000;

  /** One funded USD reserve and one all-c1 BTC position (2 @ 100, marked 150). */
  function reserveGenesis(): FundReviewData {
    const genesis = emptyGenesis();
    genesis.reserves = [
      {
        id: "desk-usd",
        portfolioId: "core",
        tempo: "Reserve",
        executionMode: "live",
        accountId: "binance-usd",
        currency: "USD",
        amount: RESERVE_START,
        lots: [{ quantity: RESERVE_START, tier: "c1" }],
      },
    ];
    genesis.positions = [
      {
        id: "btc-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "binance-usd",
        instrumentId: "btc-usd",
        direction: "long",
        markPrice: 150,
        currency: "USD",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
      },
    ];
    return genesis;
  }

  /** Total realized P&L on the closed book — the figure a partial discard inflates. */
  function realized(folded: ReturnType<typeof foldEvents>): number {
    return (folded.data.closedPositions ?? []).reduce((sum, row) => sum + row.realizedPnlUsd, 0);
  }

  function onlySkip(folded: ReturnType<typeof foldEvents>) {
    expect(folded.skipped).toHaveLength(1);
    return folded.skipped[0]!;
  }

  it("discards a CLOSE naming an absent settlement reserve — the position stays open", () => {
    // The defect in its original form (#371): the row carried the full proceeds into
    // realized P&L and `positions.delete` retired the asset, while no reserve was ever
    // credited. The money did not move to the wrong place, it left the fund entirely.
    const folded = foldEvents(reserveGenesis(), [
      closed("evt-close-ghost-reserve", "2026-06-04", "btc-core", {
        reserveId: "no-such-reserve",
        proceeds: 300,
      }),
    ]);

    expect(onlySkip(folded)).toMatchObject({
      eventId: "evt-close-ghost-reserve",
      index: 0,
      verb: "PositionClosed",
      reason: "reserve-absent",
    });
    expect(folded.data.closedPositions ?? []).toEqual([]);
    expect(realized(folded)).toBe(0);
    expect(folded.data.positions.map((position) => position.id)).toEqual(["btc-core"]);
    expect(folded.data.positions[0]!.lots).toEqual([{ quantity: 2, cost: 100, tier: "c1" }]);
    expect(folded.data.reserves[0]!.amount).toBe(RESERVE_START);
  });

  it("discards a TRIM naming an absent settlement reserve — the lots are untouched", () => {
    const folded = foldEvents(reserveGenesis(), [
      {
        id: "evt-trim-ghost-reserve",
        asOf: "2026-06-04",
        type: "PositionTrimmed",
        positionId: "btc-core",
        removals: [{ tier: "c1", quantity: 1 }],
        settlement: { reserveId: "no-such-reserve", proceeds: 150 },
      },
    ]);

    expect(onlySkip(folded)).toMatchObject({
      verb: "PositionTrimmed",
      reason: "reserve-absent",
    });
    expect(folded.data.closedPositions ?? []).toEqual([]);
    expect(realized(folded)).toBe(0);
    // The asset leg never moved: still 2 units, not 1.
    expect(folded.data.positions[0]!.lots).toEqual([{ quantity: 2, cost: 100, tier: "c1" }]);
    expect(folded.data.reserves[0]!.amount).toBe(RESERVE_START);
  });

  it("discards an OPEN naming an absent funding reserve — no position, no anchor", () => {
    // A position registered while its debit dropped is a holding no reserve paid for:
    // NAV invention rather than misattribution.
    const folded = foldEvents(reserveGenesis(), [
      opened(
        "evt-open-ghost-reserve",
        "2026-06-04",
        {
          id: "aapl-new",
          portfolioId: "core",
          tempo: "Capital",
          executionMode: "live",
          accountId: "binance-usd",
          instrumentId: "aapl-usd",
          direction: "long",
          currency: "USD",
          lots: [{ quantity: 4, cost: 50, tier: "c1" }],
        },
        { reserveId: "no-such-reserve", amount: 200 },
      ),
    ]);

    expect(onlySkip(folded)).toMatchObject({
      verb: "PositionOpened",
      reason: "reserve-absent",
    });
    expect(folded.data.positions.map((position) => position.id)).toEqual(["btc-core"]);
    expect(folded.data.reserves[0]!.amount).toBe(RESERVE_START);
    // No entry-price anchor was seeded for the instrument the discarded open named.
    expect((folded.data.closes ?? []).some((close) => close.instrumentId === "aapl-usd")).toBe(
      false,
    );
  });

  it("discards an ADD naming an absent funding reserve — the lot is not appended", () => {
    // THE SITE THAT NEEDED THE ARM RESTRUCTURED. The cash leg used to run LAST here with
    // its return ignored, so the lot was already on the position by the time the debit
    // dropped — the fund grew by a lot nothing paid for. The leg now runs first and
    // gates, exactly as the open arm does.
    const folded = foldEvents(reserveGenesis(), [
      {
        id: "evt-add-ghost-reserve",
        asOf: "2026-06-04",
        type: "PositionAddedTo",
        positionId: "btc-core",
        lot: { quantity: 3, cost: 120, tier: "c1" },
        funding: { reserveId: "no-such-reserve", amount: 360 },
      },
    ]);

    expect(onlySkip(folded)).toMatchObject({
      verb: "PositionAddedTo",
      reason: "reserve-absent",
    });
    expect(folded.data.positions[0]!.lots).toEqual([{ quantity: 2, cost: 100, tier: "c1" }]);
    expect(folded.data.reserves[0]!.amount).toBe(RESERVE_START);
  });

  it("still applies each arm in full when the reserve IS present — the gate is not a block", () => {
    // The other half of every gate: it must stop only the case it names. One fold
    // exercising all four lot-derived arms against the real reserve, with no skips.
    const folded = foldEvents(reserveGenesis(), [
      {
        id: "evt-add-real",
        asOf: "2026-06-03",
        type: "PositionAddedTo",
        positionId: "btc-core",
        lot: { quantity: 2, cost: 100, tier: "c1" },
        funding: { reserveId: "desk-usd", amount: 200 },
      },
      closed("evt-close-real", "2026-06-05", "btc-core", {
        reserveId: "desk-usd",
        proceeds: 600,
      }),
    ]);

    expect(folded.skipped).toEqual([]);
    // 4 units at cost 100 == 400 basis; 600 proceeds == 200 realized.
    expect(realized(folded)).toBe(200);
    expect(folded.data.positions).toEqual([]);
    // 5000 − 200 funding + 600 proceeds.
    expect(folded.data.reserves[0]!.amount).toBe(RESERVE_START - 200 + 600);
  });

  it("keeps the reason's prose free of figures and of event content", () => {
    // The notice prints unasked on channels a human reads daily, so it stays fixed and
    // quotable. Widened here to the reserve-absent path now that it names the EVENT.
    const skip = onlySkip(
      foldEvents(reserveGenesis(), [
        closed("evt-close-ghost-reserve", "2026-06-04", "btc-core", {
          reserveId: "no-such-reserve",
          proceeds: 300,
        }),
      ]),
    );

    expect(skip.reason).toBe("reserve-absent");
    expect(skip.detail).not.toMatch(/\d/);
    expect(skip.detail).not.toContain(skip.verb);
    expect(skip.detail).not.toContain(skip.eventId);
    expect(skip.detail).not.toContain("no-such-reserve");
    expect(skip.detail).not.toContain("btc-core");
    expect(skip.detail.length).toBeGreaterThan(0);
  });
});
