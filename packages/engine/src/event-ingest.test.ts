// Ingest-boundary reliability suite (ADR-003 slice 2). Two gates protect the
// durable log: `parseEvent` validates one event's structure in isolation, and
// `crossReferenceEvent` validates it against the known world (genesis + log ids)
// plus a `PriceMarked` magnitude guard. These tests lock the externally visible
// contract of both — accept the valid shapes, reject the malformed / unknown-
// reference / id-collision / implausible-price cases with a precise path/message.
import {
  applyEventToReference,
  buildEventReference,
  crossReferenceEvent,
  parseEvent,
  PRICE_MARK_MAGNITUDE_THRESHOLD,
  type EventError,
  type FundReviewData,
  type PortfolioEvent,
} from "./index.js";
import { describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";

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

const VALID_DECISION = {
  entryThesis: "thesis",
  invalidationCondition: "invalidation",
  riskBudget: "1R",
  plannedHoldingHorizon: "weeks",
  strategy: "trend",
};

function openedInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-open",
    asOf: "2026-06-05",
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
      lots: [{ quantity: 1, cost: 100, tier: "c1" }],
    },
    decision: { ...VALID_DECISION },
    ...overrides,
  };
}

function closedInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-close",
    asOf: "2026-06-10",
    type: "PositionClosed",
    positionId: "aapl-core",
    ...overrides,
  };
}

function markedInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-mark",
    asOf: "2026-06-06",
    type: "PriceMarked",
    instrumentId: "aapl-usd",
    price: 160,
    ...overrides,
  };
}

/** Assert a result is an event-error and return it for path/message checks. */
function expectRejected(result: ReturnType<typeof parseEvent>): EventError {
  expect(result.kind).toBe("event-error");
  return result as EventError;
}

describe("parseEvent — accepts each verb in its valid shape", () => {
  it("accepts a well-formed PositionOpened with the five decision fields", () => {
    const result = parseEvent(openedInput());
    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.value.type === "PositionOpened") {
      expect(result.value.decision).toEqual(VALID_DECISION);
      expect(result.value.position.lots).toEqual([{ quantity: 1, cost: 100, tier: "c1" }]);
    }
  });

  it("accepts a well-formed PositionClosed", () => {
    const result = parseEvent(closedInput());
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value).toMatchObject({ type: "PositionClosed", positionId: "aapl-core" });
    }
  });

  it("accepts a well-formed PriceMarked, with and without usdMxn", () => {
    expect(parseEvent(markedInput()).kind).toBe("ok");
    const withFx = parseEvent(markedInput({ usdMxn: 19.5 }));
    expect(withFx.kind).toBe("ok");
    if (withFx.kind === "ok" && withFx.value.type === "PriceMarked") {
      expect(withFx.value.usdMxn).toBe(19.5);
    }
  });

  it("trims decision fields and preserves entryFx on lots", () => {
    const result = parseEvent(
      openedInput({
        decision: { ...VALID_DECISION, entryThesis: "  spaced thesis  " },
        position: {
          ...openedInput().position,
          lots: [{ quantity: 1, cost: 100, tier: "c1", entryFx: 25 }],
        },
      }),
    );
    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.value.type === "PositionOpened") {
      expect(result.value.decision.entryThesis).toBe("spaced thesis");
      expect(result.value.position.lots[0]).toEqual({ quantity: 1, cost: 100, tier: "c1", entryFx: 25 });
    }
  });
});

describe("parseEvent — rejects malformed envelopes with a precise path/message", () => {
  it("rejects a non-object", () => {
    expect(expectRejected(parseEvent("nope")).path).toBe("$");
  });

  it("rejects a missing/blank id at path id", () => {
    expect(expectRejected(parseEvent(openedInput({ id: "  " }))).path).toBe("id");
  });

  it("rejects a non-ISO asOf at path asOf", () => {
    const error = expectRejected(parseEvent(markedInput({ asOf: "06/06/2026" })));
    expect(error.path).toBe("asOf");
    expect(error.message).toMatch(/ISO date/);
  });

  it("rejects an unsupported event type at path type", () => {
    const error = expectRejected(parseEvent(markedInput({ type: "PositionMerged" })));
    expect(error.path).toBe("type");
    expect(error.message).toMatch(/Unsupported event type: PositionMerged/);
  });
});

describe("parseEvent — five-decision-field coherence gate", () => {
  for (const field of [
    "entryThesis",
    "invalidationCondition",
    "riskBudget",
    "plannedHoldingHorizon",
    "strategy",
  ] as const) {
    it(`rejects a PositionOpened missing ${field}`, () => {
      const decision: Record<string, unknown> = { ...VALID_DECISION };
      delete decision[field];
      const error = expectRejected(parseEvent(openedInput({ decision })));
      expect(error.path).toBe(`decision.${field}`);
    });
  }

  it("rejects a PositionOpened with no decision object at path decision", () => {
    const input = openedInput();
    delete (input as Record<string, unknown>).decision;
    expect(expectRejected(parseEvent(input)).path).toBe("decision");
  });
});

describe("parseEvent — lot validation", () => {
  function withLots(lots: unknown) {
    return openedInput({ position: { ...openedInput().position, lots } });
  }

  it("rejects an empty lot array", () => {
    expect(expectRejected(parseEvent(withLots([]))).path).toBe("position.lots");
  });

  it("rejects a non-positive quantity", () => {
    expect(expectRejected(parseEvent(withLots([{ quantity: 0, cost: 100, tier: "c1" }]))).path).toBe(
      "position.lots[0].quantity",
    );
  });

  it("rejects a non-positive cost", () => {
    expect(expectRejected(parseEvent(withLots([{ quantity: 1, cost: -5, tier: "c1" }]))).path).toBe(
      "position.lots[0].cost",
    );
  });

  it("rejects an unknown tier", () => {
    expect(expectRejected(parseEvent(withLots([{ quantity: 1, cost: 100, tier: "c9" }]))).path).toBe(
      "position.lots[0].tier",
    );
  });

  it("rejects a non-positive entryFx", () => {
    expect(
      expectRejected(parseEvent(withLots([{ quantity: 1, cost: 100, tier: "c1", entryFx: 0 }]))).path,
    ).toBe("position.lots[0].entryFx");
  });
});

describe("buildEventReference — derives the known world from the seed", () => {
  it("collects genesis position/reserve/portfolio/account/instrument ids", () => {
    const reference = buildEventReference(genesis());
    expect([...reference.positionIds]).toEqual(["aapl-core"]);
    expect([...reference.reserveIds]).toEqual(["cash-core"]);
    expect([...reference.portfolioIds]).toEqual(["core"]);
    expect([...reference.accountIds]).toEqual(["xtb-usd"]);
    expect([...reference.instrumentIds].sort()).toEqual(["aapl-usd", "btc-usd"]);
  });

  it("seeds last-close from a held instrument's markPrice at the genesis date", () => {
    const reference = buildEventReference(genesis());
    expect(reference.lastClose.get("aapl-usd")).toEqual({ price: 150, asOf: GENESIS_AS_OF });
  });

  it("lets a more recent genesis-provided Close win over the markPrice seed", () => {
    const withClose = genesis();
    withClose.closes = [{ instrumentId: "aapl-usd", asOf: "2026-06-02", price: 155 }];
    const reference = buildEventReference(withClose);
    expect(reference.lastClose.get("aapl-usd")).toEqual({ price: 155, asOf: "2026-06-02" });
  });

  it("folds prior log events into the reference (an opened id becomes known)", () => {
    const opened = parseEvent(openedInput());
    if (opened.kind !== "ok") throw new Error("fixture should parse");
    const reference = buildEventReference(genesis(), [opened.value]);
    expect(reference.positionIds.has("btc-core")).toBe(true);
    // The mid-stream open seeds an entry-price close for its instrument.
    expect(reference.lastClose.get("btc-usd")).toEqual({ price: 100, asOf: "2026-06-05" });
  });
});

describe("crossReferenceEvent — id collision (MF1)", () => {
  it("rejects a PositionOpened whose id collides with a genesis position id", () => {
    const opened = openedInput({ position: { ...openedInput().position, id: "aapl-core" } });
    const result = crossReferenceEvent(asEvent(opened), buildEventReference(genesis()));
    const error = expectRejected(result);
    expect(error.path).toBe("position.id");
    expect(error.message).toMatch(/collides with an existing position id/);
  });

  it("rejects a PositionOpened whose id collides with a genesis reserve id", () => {
    const opened = openedInput({ position: { ...openedInput().position, id: "cash-core" } });
    const error = expectRejected(crossReferenceEvent(asEvent(opened), buildEventReference(genesis())));
    expect(error.path).toBe("position.id");
    expect(error.message).toMatch(/collides with an existing reserve id/);
  });

  it("accepts a PositionOpened with a fresh id and known references", () => {
    expect(crossReferenceEvent(asEvent(openedInput()), buildEventReference(genesis())).kind).toBe("ok");
  });
});

describe("crossReferenceEvent — unknown reference (MF1)", () => {
  it("rejects a PositionClosed for an id neither seed nor log contains", () => {
    const error = expectRejected(
      crossReferenceEvent(asEvent(closedInput({ positionId: "ghost" })), buildEventReference(genesis())),
    );
    expect(error.path).toBe("positionId");
    expect(error.message).toMatch(/neither the genesis seed nor the log contains/);
  });

  it("rejects a PriceMarked for an unknown instrument id", () => {
    const error = expectRejected(
      crossReferenceEvent(asEvent(markedInput({ instrumentId: "ghost-usd" })), buildEventReference(genesis())),
    );
    expect(error.path).toBe("instrumentId");
  });

  it("rejects a PositionOpened citing an unknown instrument/account/portfolio", () => {
    const reference = buildEventReference(genesis());
    const badInstrument = openedInput({ position: { ...openedInput().position, instrumentId: "ghost" } });
    expect(expectRejected(crossReferenceEvent(asEvent(badInstrument), reference)).path).toBe(
      "position.instrumentId",
    );
    const badAccount = openedInput({ position: { ...openedInput().position, accountId: "ghost" } });
    expect(expectRejected(crossReferenceEvent(asEvent(badAccount), reference)).path).toBe(
      "position.accountId",
    );
    const badPortfolio = openedInput({ position: { ...openedInput().position, portfolioId: "ghost" } });
    expect(expectRejected(crossReferenceEvent(asEvent(badPortfolio), reference)).path).toBe(
      "position.portfolioId",
    );
  });

  it("accepts a PositionClosed for an id introduced earlier in the same batch", () => {
    const reference = buildEventReference(genesis());
    applyEventToReference(reference, asEvent(openedInput())); // opens btc-core
    expect(crossReferenceEvent(asEvent(closedInput({ positionId: "btc-core" })), reference).kind).toBe(
      "ok",
    );
  });
});

describe("crossReferenceEvent — PriceMarked magnitude guard (MF3)", () => {
  it("accepts a mark just inside the threshold", () => {
    // last close 150; +50% = 225 is the boundary, 224 is inside.
    expect(crossReferenceEvent(asEvent(markedInput({ price: 224 })), buildEventReference(genesis())).kind).toBe(
      "ok",
    );
  });

  it("accepts a mark exactly at the threshold boundary", () => {
    // |225/150 - 1| = 0.5 == threshold; rejection is strictly beyond.
    expect(
      crossReferenceEvent(asEvent(markedInput({ price: 150 * (1 + PRICE_MARK_MAGNITUDE_THRESHOLD) })), buildEventReference(genesis()))
        .kind,
    ).toBe("ok");
  });

  it("rejects a fat-finger mark beyond the threshold (currency-unit slip)", () => {
    // An MXN-scale number (~20x) entered against a USD instrument.
    const error = expectRejected(
      crossReferenceEvent(asEvent(markedInput({ price: 3000 })), buildEventReference(genesis())),
    );
    expect(error.path).toBe("price");
    expect(error.message).toMatch(/sanity threshold/);
  });

  it("rejects a mark below the lower bound", () => {
    expect(
      crossReferenceEvent(asEvent(markedInput({ price: 10 })), buildEventReference(genesis())).kind,
    ).toBe("event-error");
  });

  it("honors a caller-supplied tighter threshold", () => {
    // +20% (180) passes at the default 0.5 but fails a 0.1 threshold.
    const reference = buildEventReference(genesis());
    expect(crossReferenceEvent(asEvent(markedInput({ price: 180 })), reference).kind).toBe("ok");
    expect(
      crossReferenceEvent(asEvent(markedInput({ price: 180 })), reference, { magnitudeThreshold: 0.1 }).kind,
    ).toBe("event-error");
  });

  it("accepts any magnitude for an instrument with no prior close (nothing to compare)", () => {
    // btc-usd is a genesis instrument but unheld → no seeded close.
    const reference = buildEventReference(genesis());
    expect(reference.lastClose.has("btc-usd")).toBe(false);
    expect(
      crossReferenceEvent(asEvent(markedInput({ instrumentId: "btc-usd", price: 99999 })), reference).kind,
    ).toBe("ok");
  });
});

/** Parse a fixture input and unwrap to a typed event (fixtures are valid). */
function asEvent(input: Record<string, unknown>): PortfolioEvent {
  const result = parseEvent(input);
  if (result.kind !== "ok") {
    throw new Error(`fixture should parse but got ${result.path}: ${result.message}`);
  }
  return result.value;
}
