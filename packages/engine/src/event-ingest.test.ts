// Ingest-boundary reliability suite (ADR-003 slice 2). Two gates protect the
// durable log: `parseEvent` validates one event's structure in isolation, and
// `crossReferenceEvent` validates it against the known world (genesis + log ids)
// plus a `PriceMarked` magnitude guard. These tests lock the externally visible
// contract of both — accept the valid shapes, reject the malformed / unknown-
// reference / id-collision / implausible-price cases with a precise path/message.
import {
  applyEventToReference,
  buildCompositionReport,
  buildEventReference,
  crossReferenceEvent,
  parseEvent,
  parseFundReview,
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
    funding: { reserveId: "cash-core", amount: 100 },
    ...overrides,
  };
}

function closedInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-close",
    asOf: "2026-06-10",
    type: "PositionClosed",
    positionId: "aapl-core",
    // aapl-core is 2 lots @ last close 150 → expected ~300; proceeds at expected
    // so the default sails through the settlement-magnitude gate.
    settlement: { reserveId: "cash-core", proceeds: 300 },
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

function invalidationInput(overrides: Record<string, unknown> = {}) {
  return {
    id: "e-invalidation",
    asOf: "2026-06-08",
    type: "InvalidationMarked",
    positionId: "aapl-core",
    price: 120,
    direction: "below",
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
    // `accountCurrencies` widened from a bare id Set to an account→currency Map so the
    // `ReserveOpened` gate can hard-reject a Reserve denominated differently from
    // its account. Existence still reads `.has()`; the currency is the new payload.
    expect([...reference.accountCurrencies.keys()]).toEqual(["xtb-usd"]);
    expect(reference.accountCurrencies.get("xtb-usd")).toBe("USD");
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
    // btc-core is 1 lot @ entry/last close 100 → expected ~100; settle at it.
    const close = closedInput({ positionId: "btc-core", settlement: { reserveId: "cash-core", proceeds: 100 } });
    expect(crossReferenceEvent(asEvent(close), reference).kind).toBe("ok");
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

describe("crossReferenceEvent — InvalidationMarked reference + post-close gate (R4)", () => {
  it("accepts a valid mark on a known open position", () => {
    expect(
      crossReferenceEvent(asEvent(invalidationInput()), buildEventReference(genesis())).kind,
    ).toBe("ok");
  });

  it("accepts a mark on a position opened earlier in the same batch", () => {
    const reference = buildEventReference(genesis());
    applyEventToReference(reference, asEvent(openedInput())); // opens btc-core
    expect(
      crossReferenceEvent(asEvent(invalidationInput({ positionId: "btc-core" })), reference).kind,
    ).toBe("ok");
  });

  it("rejects a dangling-id mark (unknown position) fail-loud", () => {
    const error = expectRejected(
      crossReferenceEvent(asEvent(invalidationInput({ positionId: "ghost" })), buildEventReference(genesis())),
    );
    expect(error.path).toBe("positionId");
    expect(error.message).toMatch(/neither the genesis seed nor the log contains/);
  });

  it("rejects a post-close mark and names the closed case distinctly (R4)", () => {
    const reference = buildEventReference(genesis());
    applyEventToReference(reference, asEvent(closedInput())); // retires aapl-core
    const error = expectRejected(
      crossReferenceEvent(asEvent(invalidationInput({ positionId: "aapl-core" })), reference),
    );
    expect(error.path).toBe("positionId");
    expect(error.message).toMatch(/already closed/);
  });
});

// Audit 2026-08-07 MUST FIX 1. `PositionClosed` was the one position-targeting verb
// whose gate never consulted the retired-id set — trim and add-to both reject a
// post-close event, close did not. Ingest dedup keys on event id alone, so a
// re-authored close carrying a FRESH id passed the gate a second time: the cross-ref
// shadow credited the proceeds again while the fold silently dropped the event, and
// NAV drifted with `warnings: []` — the silent-cash-leg class ADR-003's fail-loud
// posture exists to eliminate.
//
// The closed world-state below is built by running a real close through
// `applyEventToReference` and never by reaching into the reference's internals, so
// these locks hold whatever encoding the gate later uses to remember a retired id.
describe("crossReferenceEvent — PositionClosed post-close gate (audit MUST FIX 1)", () => {
  it("accepts the first close of a known open position", () => {
    expect(crossReferenceEvent(asEvent(closedInput()), buildEventReference(genesis())).kind).toBe(
      "ok",
    );
  });

  it("rejects a re-authored second close of an already-closed position", () => {
    const reference = buildEventReference(genesis());
    const first = asEvent(closedInput());
    expect(crossReferenceEvent(first, reference).kind).toBe("ok");
    applyEventToReference(reference, first); // retires aapl-core

    // A fresh event id: the durable log's id-keyed dedup cannot see this as a
    // duplicate, so the gate is the only thing standing between it and the fold.
    const second = asEvent(closedInput({ id: "e-close-reauthored", asOf: "2026-06-11" }));
    const error = expectRejected(crossReferenceEvent(second, reference));
    expect(error.path).toBe("positionId");
    expect(error.message).toMatch(/already closed/);
  });

  // A dangling close (unknown id) staying distinct from a post-close rejection is
  // already locked by the MF1 case above — not re-asserted here.
});

// Audit 2026-08-07 finding 5. The two ingest doors used to disagree about what a
// valid Lot is: the event door demanded a positive quantity/cost/entryFx, the
// genesis door demanded only `typeof === "number"`, and `canonical.ts` — the last
// line of defense — demanded only non-negative. So `{ quantity: 10, cost: 0 }` was
// rejected as a `PositionOpened` and admitted unwarned as a seed, with the whole
// market value reading as unrealized gain and nothing on screen saying so.
//
// One predicate now answers "is this Lot valid?" for all three sites, so these
// cases are written as a matrix: the SAME degenerate lot goes through the genesis
// door, the event door, and the compose gate, and all three must refuse it.
describe("Lot validity — one predicate across both ingest doors (audit finding 5)", () => {
  const DEGENERATE_LOTS: ReadonlyArray<{ label: string; lot: Record<string, unknown>; field: string }> = [
    { label: "a zero cost", lot: { quantity: 10, cost: 0, tier: "c1" }, field: "cost" },
    { label: "a negative cost", lot: { quantity: 10, cost: -5, tier: "c1" }, field: "cost" },
    { label: "a zero quantity", lot: { quantity: 0, cost: 100, tier: "c1" }, field: "quantity" },
    { label: "a negative quantity", lot: { quantity: -1, cost: 100, tier: "c1" }, field: "quantity" },
    { label: "a NaN cost", lot: { quantity: 1, cost: Number.NaN, tier: "c1" }, field: "cost" },
    {
      label: "a zero entryFx",
      lot: { quantity: 1, cost: 100, tier: "c1", entryFx: 0 },
      field: "entryFx",
    },
  ];

  /** The genesis seed of `genesis()`, with its one position's lots replaced. */
  function seedWithLots(lots: unknown): Record<string, unknown> {
    const seed = genesis() as unknown as Record<string, unknown>;
    const positions = seed.positions as Array<Record<string, unknown>>;
    return { ...seed, positions: [{ ...positions[0], lots }] };
  }

  describe.each(DEGENERATE_LOTS)("$label", ({ lot, field }) => {
    it("is rejected by the genesis door, naming the field", () => {
      const result = parseFundReview(seedWithLots([lot]));
      expect(result.kind).toBe("schema-error");
      expect(result.kind === "schema-error" ? result.path : undefined).toBe(
        `positions[0].lots[0].${field}`,
      );
    });

    it("is rejected by the event door, naming the same field", () => {
      const input = openedInput({ position: { ...openedInput().position, lots: [lot] } });
      expect(expectRejected(parseEvent(input)).path).toBe(`position.lots[0].${field}`);
    });

    it("is excluded with a warning by the compose gate if it reaches it anyway", () => {
      // Straight to `buildCompositionReport` with a typed-but-degenerate seed:
      // `canonical.ts` is defense in depth for data that did not come through a
      // parse door (a fold result, a hand-edited image), so it may not be silent.
      const data = genesis();
      data.positions[0]!.lots = [lot] as unknown as (typeof data.positions)[0]["lots"];
      const report = buildCompositionReport(data);

      expect(report.excluded.invalid).toBeGreaterThan(0);
      expect(report.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "invalid-position-number",
            recordId: "aapl-core",
            message: expect.stringContaining(field) as unknown as string,
          }),
        ]),
      );
    });
  });

  it("still accepts a well-formed lot through the genesis door", () => {
    expect(parseFundReview(seedWithLots([{ quantity: 2, cost: 100, tier: "c1", entryFx: 20 }])).kind).toBe(
      "ok",
    );
  });

  it("keeps admitting a signed cash (Reserve) Lot — tier attribution nets, it does not accumulate", () => {
    // The cash-lot rule is deliberately NOT the position-lot rule: a Reserve's
    // tier overlay is a signed decomposition of `amount`, so a negative leg is
    // legitimate and `buildReserveTierContributions` — not the parser — judges it.
    const seed = genesis() as unknown as Record<string, unknown>;
    const reserves = seed.reserves as Array<Record<string, unknown>>;
    const result = parseFundReview({
      ...seed,
      reserves: [
        {
          ...reserves[0],
          lots: [
            { quantity: -100, tier: "c1" },
            { quantity: 1100, tier: "c2" },
          ],
        },
      ],
    });
    expect(result.kind).toBe("ok");
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
