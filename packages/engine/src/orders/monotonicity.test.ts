// Spec testing decision 9 — MONOTONICITY PROPOSES AND REFUSES.
//
// Three cases the spec names, plus the two things that make the proposal safe to look at:
// every verdict is stamped `derived` and carries its evidence, and an IMPOSSIBLE verdict
// fails loud rather than being normalized into a plausible one.
//
// NOTHING HERE WRITES, AND THAT IS ASSERTED STRUCTURALLY, NOT BY A SPY. `proposeFillVerdicts`
// is pure and returns values, so `O3` — an inference is never written as an observation —
// holds by construction. The confirmation gate that turns a proposal into a line is tested
// against the flow that owns it, in `apps/tui/src/record-fill.test.ts`.
//
// EVERY FIXTURE IS A SYNTHETIC LADDER (`O7`). Round numbers, invented symbol, no real
// price, size, balance or rung anywhere in this file.
import { describe, expect, it } from "vitest";
import { proposeFillVerdicts, type BookObservation } from "./monotonicity.js";
import type { OrderPlacedRecord } from "./records.js";
import type { RestingOrder } from "./select.js";

const OBSERVED = "2026-01-05T12:00:00";

/** One synthetic rung. Prices are round decades of a made-up instrument. */
function rung(price: number, overrides: Partial<OrderPlacedRecord> = {}): RestingOrder {
  const placed: OrderPlacedRecord = {
    id: `rung-${price}`,
    observedAt: "2026-01-01T09:00:00",
    kind: "orderPlaced",
    currency: "USD",
    symbol: "TEST/USD",
    side: "buy",
    price,
    quantity: 10,
    fundingReserveId: "reserve-synthetic",
    ...overrides,
  };
  return { placed, remainingQuantity: placed.quantity };
}

/** A descending synthetic ladder: 400 / 300 / 200 / 100. */
const LADDER = [rung(400), rung(300), rung(200), rung(100)];

function observe(present: Array<[number, number]>): BookObservation {
  return {
    observedAt: OBSERVED,
    present: present.map(([price, filledQuantity]) => ({ orderId: `rung-${price}`, filledQuantity })),
  };
}

function verdictFor(proposal: ReturnType<typeof proposeFillVerdicts>, price: number) {
  if (proposal.status !== "proposed") {
    throw new Error(`expected a proposal, got ${proposal.status}`);
  }
  const found = proposal.verdicts.find((entry) => entry.orderId === `rung-${price}`);
  if (!found) {
    throw new Error(`no verdict proposed for rung-${price}`);
  }
  return found;
}

describe("case 1 — a GAP with untouched rungs above it is CANCELLED, never a fill", () => {
  // rung-200 is gone; 400 and 300 rest untouched above it. A fill at 200 would have had
  // to trade through both. `D12`: reading the gap as a purchase would "silently convert
  // cancellations into phantom purchases".
  const proposal = proposeFillVerdicts(LADDER, observe([[400, 0], [300, 0], [100, 0]]));

  it("proposes `cancelled` for the vanished middle rung", () => {
    expect(verdictFor(proposal, 200).verdict).toBe("cancelled");
  });

  it("carries the untouched rungs above as the evidence it was derived from", () => {
    expect(verdictFor(proposal, 200).evidence.untouchedAbove).toEqual(["rung-400", "rung-300"]);
    expect(verdictFor(proposal, 200).evidence.disappeared).toBe(true);
  });

  it("leaves the rungs that are still on the book as `resting`", () => {
    expect(verdictFor(proposal, 400).verdict).toBe("resting");
    expect(verdictFor(proposal, 100).verdict).toBe("resting");
  });
});

describe("case 2 — the TOP rung gone with the rest untouched is PROPOSED as filled", () => {
  const proposal = proposeFillVerdicts(LADDER, observe([[300, 0], [200, 0], [100, 0]]));

  it("proposes `filled` for the top rung", () => {
    expect(verdictFor(proposal, 400).verdict).toBe("filled");
  });

  it("has nothing untouched above it — which is the whole warrant for the verdict", () => {
    expect(verdictFor(proposal, 400).evidence.untouchedAbove).toEqual([]);
  });

  it("implies nothing about the rungs BELOW it, which stay `resting`", () => {
    // A fill above says nothing about a lower rung: the price reached 400, not 300.
    expect(verdictFor(proposal, 300).verdict).toBe("resting");
    expect(verdictFor(proposal, 200).verdict).toBe("resting");
  });
});

describe("case 3 — filled_quantity > 0 weakens to TOUCHED, never `filled`", () => {
  // The top rung is still on the book with a PARTIAL fill against it. The honest test is
  // `filled_quantity > 0` and it says the price reached the rung — not that the claim is
  // gone. The remainder is still resting and still encumbers the reserve.
  const proposal = proposeFillVerdicts(LADDER, observe([[400, 4], [300, 0], [200, 0], [100, 0]]));

  it("proposes `touched`", () => {
    expect(verdictFor(proposal, 400).verdict).toBe("touched");
  });

  it("never proposes `filled` for a rung still on the book, however large the partial", () => {
    const exhausted = proposeFillVerdicts(
      LADDER,
      observe([[400, 10], [300, 0], [200, 0], [100, 0]]),
    );
    expect(verdictFor(exhausted, 400).verdict).toBe("touched");
    if (exhausted.status !== "proposed") throw new Error("expected a proposal");
    expect(exhausted.verdicts.map((entry) => entry.verdict)).not.toContain("filled");
  });

  it("carries the observed filled quantity as its evidence", () => {
    expect(verdictFor(proposal, 400).evidence.observedFilledQuantity).toBe(4);
    expect(verdictFor(proposal, 400).evidence.disappeared).toBe(false);
  });
});

describe("every verdict is stamped DERIVED and carries evidence", () => {
  const proposal = proposeFillVerdicts(LADDER, observe([[300, 0], [200, 0], [100, 0]]));

  it("stamps `derived` on every proposal, with no way to stamp anything else", () => {
    if (proposal.status !== "proposed") throw new Error("expected a proposal");
    expect(proposal.verdicts).not.toHaveLength(0);
    for (const verdict of proposal.verdicts) {
      expect(verdict.provenance).toBe("derived");
      expect(verdict.evidence).toBeDefined();
      expect(verdict.rationale.length).toBeGreaterThan(0);
    }
  });
});

describe("an IMPOSSIBLE verdict fails loud rather than being normalized", () => {
  it("refuses observed fill evidence BELOW an untouched rung", () => {
    // This is not a gap and that is the point. The venue is stating the price REACHED
    // rung-200, which it cannot have done while 400 and 300 sit untouched above.
    const proposal = proposeFillVerdicts(
      LADDER,
      observe([[400, 0], [300, 0], [200, 3], [100, 0]]),
    );
    expect(proposal.status).toBe("impossible");
    if (proposal.status !== "impossible") throw new Error("expected impossible");
    expect(proposal.contradictions[0]?.kind).toBe("fill-below-untouched-rung");
    expect(proposal.contradictions[0]?.orderId).toBe("rung-200");
  });

  it("proposes NOTHING alongside a contradiction — the whole book is discredited", () => {
    const proposal = proposeFillVerdicts(
      LADDER,
      observe([[400, 0], [300, 0], [200, 3], [100, 0]]),
    );
    expect(proposal).not.toHaveProperty("verdicts");
  });

  it("refuses a filled quantity larger than the rung was ever PLACED for", () => {
    const proposal = proposeFillVerdicts([rung(400)], observe([[400, 99]]));
    expect(proposal.status).toBe("impossible");
    if (proposal.status !== "impossible") throw new Error("expected impossible");
    expect(proposal.contradictions[0]?.kind).toBe("filled-quantity-exceeds-order");
  });

  it("refuses an observation naming a rung that was never resting", () => {
    const proposal = proposeFillVerdicts([rung(400)], {
      observedAt: OBSERVED,
      present: [{ orderId: "rung-unheard-of", filledQuantity: 0 }],
    });
    expect(proposal.status).toBe("impossible");
    if (proposal.status !== "impossible") throw new Error("expected impossible");
    expect(proposal.contradictions[0]?.kind).toBe("unknown-rung");
  });
});

// `ObservedRungState.filledQuantity` is CUMULATIVE-SINCE-PLACEMENT (#176). It used to be
// compared against `remainingQuantity`, which `pickRestingOrdersAsOf` has ALREADY taken
// the recorded fills out of — so the two sides of the comparison were on different bases
// and an honest venue reading contradicted itself past the halfway point.
describe("`filledQuantity` is cumulative, and the check compares it with like", () => {
  /** rung-400 placed for 10, with 7 already recorded as filled: 3 is still claimed. */
  const partlyFilled: RestingOrder = { ...rung(400), remainingQuantity: 3 };

  it("does NOT contradict an honest cumulative reading above the remaining claim", () => {
    // The venue honestly shows 7 filled of the 10 the rung was placed for. 7 exceeds the
    // 3 still claimed, and that is not a contradiction — it is the same 7 counted once.
    const proposal = proposeFillVerdicts(
      [partlyFilled, rung(300)],
      observe([[400, 7], [300, 0]]),
    );
    expect(proposal.status).toBe("proposed");
    expect(verdictFor(proposal, 400).verdict).toBe("touched");
    expect(verdictFor(proposal, 400).evidence.observedFilledQuantity).toBe(7);
    // And the unrelated rung below still gets its own verdict rather than being
    // discredited along with the whole book.
    expect(verdictFor(proposal, 300).verdict).toBe("resting");
  });

  it("still trips on a reading larger than the rung was EVER placed for", () => {
    // 11 of a rung placed for 10. Genuinely impossible on any basis — the check is
    // corrected, not weakened.
    const proposal = proposeFillVerdicts([partlyFilled], observe([[400, 11]]));
    expect(proposal.status).toBe("impossible");
    if (proposal.status !== "impossible") throw new Error("expected impossible");
    expect(proposal.contradictions[0]?.kind).toBe("filled-quantity-exceeds-order");
  });
});

describe("condition 1 — the inference holds only across SIMULTANEOUSLY resting rungs", () => {
  it("excludes a rung placed after the observation instead of reasoning over it", () => {
    // rung-500 was placed AFTER the look at the book, so it was not on the book at that
    // moment. Counting it as "untouched above" would turn a fill into a cancellation on
    // evidence that did not exist yet.
    const later = rung(500, { id: "rung-500", observedAt: "2026-01-09T09:00:00" });
    const proposal = proposeFillVerdicts(
      [later, ...LADDER],
      observe([[300, 0], [200, 0], [100, 0]]),
    );
    if (proposal.status !== "proposed") throw new Error("expected a proposal");
    expect(proposal.excluded).toEqual(["rung-500"]);
    expect(verdictFor(proposal, 400).verdict).toBe("filled");
    expect(verdictFor(proposal, 400).evidence.untouchedAbove).toEqual([]);
  });
});

describe("a fill on one symbol implies nothing about a rung on another", () => {
  it("groups the reasoning per symbol", () => {
    const other = rung(900, { id: "other-900", symbol: "OTHER/USD" });
    const proposal = proposeFillVerdicts([other, ...LADDER], {
      observedAt: OBSERVED,
      present: [
        { orderId: "other-900", filledQuantity: 0 },
        { orderId: "rung-300", filledQuantity: 0 },
        { orderId: "rung-200", filledQuantity: 0 },
        { orderId: "rung-100", filledQuantity: 0 },
      ],
    });
    // The untouched higher-priced rung on the OTHER symbol must not veto the top rung's
    // proposed fill on this one.
    expect(verdictFor(proposal, 400).verdict).toBe("filled");
  });
});

describe("resting SELLS are out of the reasoning entirely", () => {
  it("ignores a sell rung — it encumbers the asset, not the cash ladder", () => {
    const sell = rung(500, { id: "sell-500", side: "sell" });
    const proposal = proposeFillVerdicts([sell, ...LADDER], observe([[300, 0], [200, 0], [100, 0]]));
    if (proposal.status !== "proposed") throw new Error("expected a proposal");
    expect(proposal.verdicts.map((entry) => entry.orderId)).not.toContain("sell-500");
    expect(verdictFor(proposal, 400).verdict).toBe("filled");
  });
});
