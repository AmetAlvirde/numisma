// The pure seams of the fill act: the derived join id, the torn-act detector built on it,
// "one Position per ladder", and the funding tier that is READ rather than re-decided.
//
// The two-file sequencing, the rollback and the confirmation gates are behaviour of the
// shell that owns the writes and are tested there (`apps/tui/src/record-fill.test.ts`).
//
// EVERY FIXTURE IS SYNTHETIC (`O7`). Round numbers, invented ids, no real figure anywhere.
import { describe, expect, it } from "vitest";
import type { PositionRecord } from "../contracts.js";
import type { PortfolioEvent } from "../events/types.js";
import {
  buildFillAct,
  deriveFundingTier,
  fillEventId,
  parseFillEventId,
  reconcileFillActs,
  resolveLadderPosition,
} from "./fill.js";
import type { CommittedRung } from "./committed.js";
import type { OrderRecord } from "./records.js";

const RUNG: CommittedRung = {
  orderId: "synth:TEST/USD:buy:400:2026-01-02T09:00:00",
  observedAt: "2026-01-02T09:00:00",
  currency: "USD",
  symbol: "TEST/USD",
  side: "buy",
  price: 400,
  quantity: 10,
  remainingQuantity: 10,
  fundingReserveId: "reserve-synthetic",
  committed: 4000,
};

function position(overrides: Partial<PositionRecord> = {}): PositionRecord {
  return {
    id: "position-synthetic",
    portfolioId: "portfolio-synthetic",
    tempo: "Capital",
    executionMode: "live",
    accountId: "account-synthetic",
    instrumentId: "instrument-synthetic",
    direction: "long",
    markPrice: 400,
    currency: "USD",
    lots: [{ quantity: 10, cost: 400, tier: "c1" }],
    ...overrides,
  };
}

describe("the derived join id", () => {
  it("round-trips an order id that itself contains colons", () => {
    const id = fillEventId(RUNG.orderId, "2026-01-05T12:00:00");
    expect(parseFillEventId(id)).toEqual({
      orderId: RUNG.orderId,
      observedAt: "2026-01-05T12:00:00",
    });
  });

  it("keys on (orderId, observedAt) so successive PARTIALS do not collide", () => {
    expect(fillEventId(RUNG.orderId, "2026-01-05T12:00:00")).not.toBe(
      fillEventId(RUNG.orderId, "2026-01-06T12:00:00"),
    );
  });

  it("does not claim an ordinary event id as a fill", () => {
    expect(parseFillEventId("some-hand-authored-event")).toBeUndefined();
  });
});

describe("reconcileFillActs — the crash window is arithmetic, not a guess", () => {
  const filledLine: OrderRecord = {
    id: RUNG.orderId,
    observedAt: "2026-01-05T12:00:00",
    kind: "orderFilled",
    currency: "USD",
    filledQuantity: 10,
  };
  const lot: PortfolioEvent = {
    id: fillEventId(RUNG.orderId, "2026-01-05T12:00:00"),
    asOf: "2026-01-05",
    type: "PositionAddedTo",
    positionId: "position-synthetic",
    lot: { quantity: 10, cost: 400, tier: "c1" },
    funding: { reserveId: "reserve-synthetic", amount: 4000 },
  };

  it("reports nothing when both halves are on disk", () => {
    expect(reconcileFillActs([lot], [filledLine])).toEqual([]);
  });

  it("reports the lot whose orderFilled line is missing", () => {
    expect(reconcileFillActs([lot], [])[0]?.kind).toBe("lot-without-fill");
  });

  it("reports the orderFilled line whose lot is missing", () => {
    expect(reconcileFillActs([], [filledLine])[0]?.kind).toBe("fill-without-lot");
  });

  it("ignores events that are not fill acts at all", () => {
    const mark: PortfolioEvent = {
      id: "hand-authored-mark",
      asOf: "2026-01-05",
      type: "PriceMarked",
      instrumentId: "instrument-synthetic",
      price: 400,
    };
    expect(reconcileFillActs([mark, lot], [filledLine])).toEqual([]);
  });
});

describe("one Position per ladder", () => {
  const ladder = { accountId: "account-synthetic", instrumentId: "instrument-synthetic" };

  it("says NONE when the ladder has not opened yet — the first fill OPENS", () => {
    expect(resolveLadderPosition([], ladder)).toEqual({ status: "none" });
  });

  it("says ONE when the ladder already has its Position — the fill APPENDS", () => {
    expect(resolveLadderPosition([position()], ladder)).toEqual({
      status: "one",
      positionId: "position-synthetic",
    });
  });

  it("REFUSES rather than guessing when two Positions match", () => {
    const resolved = resolveLadderPosition(
      [position(), position({ id: "position-other" })],
      ladder,
    );
    expect(resolved.status).toBe("ambiguous");
  });

  it("does not match a Position in a different account or on a different instrument", () => {
    expect(
      resolveLadderPosition([position({ accountId: "account-elsewhere" })], ladder).status,
    ).toBe("none");
    expect(
      resolveLadderPosition([position({ instrumentId: "instrument-other" })], ladder).status,
    ).toBe("none");
  });
});

describe("the funding tier is READ, never re-decided (`T4`)", () => {
  it("derives the tier from a single-tier reserve with no question asked", () => {
    expect(deriveFundingTier({ lots: [{ quantity: 10000, tier: "c1" }] })).toEqual({
      status: "derived",
      tier: "c1",
    });
  });

  it("is AMBIGUOUS when the reserve holds several tiers — the caller must refuse", () => {
    const derived = deriveFundingTier({
      lots: [
        { quantity: 10000, tier: "c1" },
        { quantity: 5000, tier: "c2" },
      ],
    });
    expect(derived.status).toBe("ambiguous");
  });

  it("ignores an exhausted tier rather than calling the reserve ambiguous", () => {
    expect(
      deriveFundingTier({
        lots: [
          { quantity: 10000, tier: "c1" },
          { quantity: 0, tier: "c2" },
        ],
      }),
    ).toEqual({ status: "derived", tier: "c1" });
  });

  it("says UNTIERED when there is no prior ordering to honour", () => {
    expect(deriveFundingTier({})).toEqual({ status: "untiered" });
  });
});

describe("buildFillAct — both halves, built together", () => {
  const act = buildFillAct({
    rung: RUNG,
    filledQuantity: 10,
    observedAt: "2026-01-05T12:00:00",
    fundingAmount: 4000,
    tier: "c1",
    target: { mode: "add", positionId: "position-synthetic" },
  });

  it("derives the event's asOf from the fill stamp rather than taking a second one", () => {
    expect(act.event.asOf).toBe("2026-01-05");
    expect(act.order.observedAt).toBe("2026-01-05T12:00:00");
  });

  it("gives both halves the same quantity, from one source", () => {
    expect(act.order.filledQuantity).toBe(10);
    if (act.event.type !== "PositionAddedTo") throw new Error("expected an add");
    expect(act.event.lot.quantity).toBe(act.order.filledQuantity);
  });

  it("carries the lot's cost PER UNIT, equal to the cash that really left the reserve", () => {
    if (act.event.type !== "PositionAddedTo") throw new Error("expected an add");
    expect(act.event.lot.cost * act.event.lot.quantity).toBe(act.event.funding.amount);
  });

  it("funds from the reserve the RUNG declared, never one chosen here", () => {
    expect(act.event.funding.reserveId).toBe(RUNG.fundingReserveId);
  });

  it("opens with the five authored decision fields when the ladder has no Position", () => {
    const opened = buildFillAct({
      rung: RUNG,
      filledQuantity: 10,
      observedAt: "2026-01-05T12:00:00",
      fundingAmount: 4000,
      tier: "c1",
      target: {
        mode: "open",
        position: {
          id: "position-synthetic",
          portfolioId: "portfolio-synthetic",
          tempo: "Capital",
          executionMode: "live",
          accountId: "account-synthetic",
          instrumentId: "instrument-synthetic",
          direction: "long",
          currency: "USD",
        },
        decision: {
          entryThesis: "synthetic",
          invalidationCondition: "synthetic",
          riskBudget: "synthetic",
          plannedHoldingHorizon: "synthetic",
          strategy: "synthetic",
        },
      },
    });
    expect(opened.event.type).toBe("PositionOpened");
    if (opened.event.type !== "PositionOpened") throw new Error("expected an open");
    expect(Object.keys(opened.event.decision)).toHaveLength(5);
    // No plan behind it: nothing in the act references a DCA plan, a ladder id or a
    // target positionId declared at placement time.
    expect(opened.event.position.lots).toHaveLength(1);
  });
});
