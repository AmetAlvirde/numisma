// THE SEAM'S OWN TESTS for the cash leg and the tier (#audit-14).
//
// WHAT THE END-TO-END SUITES COULD NOT REACH CHEAPLY. Every branch below used to need a
// whole fill act to arrive at: a sidecar, a genesis, a prior log, a torn-act check, a rung
// pick, a book observation, a verdict confirmation and a ladder resolution — all of it
// spelled by index in a fifteen-element answer array — before the FIRST question this
// module asks. Two of the arms (`untiered` prompts for a tier; the override lands on a
// reserve the report does not place) needed a fixture shaped for them all the way down.
// Here they are a reserve literal and one closure.
//
// THE ARITHMETIC IS THE SUBJECT. `D1` weighs the EXCESS over `price × quantity`, never
// post-act available, and the tests below trace the three regions of that number —
// negative (a downward correction, always free), zero (the default, available-neutral BY
// CONSTRUCTION) and positive (the only guarded one) — which the flow-level tests could
// only ever sample one point of.
//
// EVERY FIXTURE IS SYNTHETIC (`O7`). Invented instrument, round decade prices, round
// balances.
import { describe, expect, it } from "vitest";
import {
  parseFundReview,
  pickRestingOrdersAsOf,
  type CommittedRung,
  type FundReviewData,
  type ReserveRecord,
  type RestingOrder,
} from "@numisma/engine";
import { resolveFunding } from "./record-fill-funding.js";

function reserve(overrides: Partial<ReserveRecord> = {}): ReserveRecord {
  return {
    id: "reserve-synthetic",
    portfolioId: "portfolio-synthetic",
    tempo: "Capital",
    executionMode: "live",
    accountId: "account-synthetic",
    currency: "USD",
    amount: 10000,
    lots: [{ quantity: 10000, tier: "c1" }],
    ...overrides,
  };
}

/**
 * A reserve with NO tier attribution at all — `lots` absent, not empty.
 *
 * It needs its own builder because `exactOptionalPropertyTypes` makes the distinction real:
 * `lots: undefined` is not the same type as an omitted `lots`, and `deriveFundingTier`'s
 * `untiered` arm is exactly the omitted case.
 */
function untieredReserve(): ReserveRecord {
  return {
    id: "reserve-synthetic",
    portfolioId: "portfolio-synthetic",
    tempo: "Capital",
    executionMode: "live",
    accountId: "account-synthetic",
    currency: "USD",
    amount: 10000,
  };
}

/** A synthetic fund holding exactly the reserve under test, so the report can place it. */
function fold(funder: ReserveRecord): FundReviewData {
  const parsed = parseFundReview({
    fund: { id: "fund-synthetic", name: "Synthetic", baseCurrency: "USD" },
    review: { asOf: "2026-01-01", usdMxn: 20 },
    portfolios: [{ id: "portfolio-synthetic", name: "Synthetic" }],
    accounts: [
      { id: "account-synthetic", name: "Synthetic Venue", platform: "SYNTH", currency: "USD" },
    ],
    instruments: [
      { id: "instrument-synthetic", name: "Synthetic Asset", symbol: "TEST", currency: "USD" },
    ],
    reserves: [funder],
    positions: [],
  });
  if (parsed.kind !== "ok") {
    throw new Error(`synthetic fold is invalid: ${JSON.stringify(parsed)}`);
  }
  return parsed.value;
}

/** The rung being filled: 10 at 400, so `price × quantity` is a round 4000 at full size. */
function rung(overrides: Partial<CommittedRung> = {}): CommittedRung {
  return {
    orderId: "rung-400",
    observedAt: "2026-01-02T09:00:00",
    symbol: "TEST/USD",
    side: "buy",
    price: 400,
    quantity: 10,
    remainingQuantity: 10,
    committed: 4000,
    currency: "USD",
    fundingReserveId: "reserve-synthetic",
    ...overrides,
  } as CommittedRung;
}

/** Answers keyed by a prompt SUBSTRING; an unanticipated prompt throws rather than blanks. */
function scripted(answers: Record<string, string>) {
  const asked: string[] = [];
  return {
    asked,
    ask: async (question: string): Promise<string> => {
      asked.push(question);
      const hit = Object.entries(answers).find(([key]) => question.includes(key));
      if (!hit) {
        throw new Error(`unscripted prompt: ${JSON.stringify(question)}`);
      }
      return hit[1];
    },
  };
}

const NO_RESTING: readonly RestingOrder[] = [];

/**
 * One resting rung of 10 at 400 against the reserve — 4000 of `committed`.
 *
 * THIS IS HOW A RESERVE RUNS OUT OF AVAILABLE in these tests, and it is deliberately not
 * "set the balance to zero": `available = value − committed`, and a reserve with a zero
 * balance also has zero tier attribution (`deriveFundingTier` filters `quantity > 0`), so
 * it would exercise the `untiered` prompt instead of the guard. A funded reserve whose
 * capital is fully claimed by a resting ladder is both the realistic shape and the one that
 * isolates `D1`.
 */
function restingRung(): readonly RestingOrder[] {
  return pickRestingOrdersAsOf([
    {
      id: "rung-400",
      observedAt: "2026-01-02T09:00:00",
      kind: "orderPlaced",
      currency: "USD",
      symbol: "TEST/USD",
      side: "buy",
      price: 400,
      quantity: 10,
      fundingReserveId: "reserve-synthetic",
    },
  ]);
}

describe("resolveFunding — the cash debited", () => {
  it("defaults to price × quantity on a blank line, and says so in the prompt", async () => {
    const io = scripted({ "Cash debited": "" });

    const outcome = await resolveFunding(io.ask, fold(reserve()), NO_RESTING, reserve(), rung(), 10);

    expect(outcome).toEqual({ status: "resolved", fundingAmount: 4000, tier: "c1" });
    // The default is SHOWN. An operator who cannot see the neutral figure cannot tell that
    // Enter is the available-neutral answer.
    expect(io.asked).toEqual(["Cash debited [4000]: "]);
  });

  it("computes the default from THIS fill's quantity, not the rung's whole claim", async () => {
    const io = scripted({ "Cash debited": "" });

    // A partial: 4 of the 10 still claimed.
    const outcome = await resolveFunding(io.ask, fold(reserve()), NO_RESTING, reserve(), rung(), 4);

    expect(outcome).toEqual({ status: "resolved", fundingAmount: 1600, tier: "c1" });
    expect(io.asked).toEqual(["Cash debited [1600]: "]);
  });

  it("refuses a cash figure that is not a positive number", async () => {
    for (const answer of ["nonsense", "0", "-1"]) {
      const io = scripted({ "Cash debited": answer });

      const outcome = await resolveFunding(
        io.ask,
        fold(reserve()),
        NO_RESTING,
        reserve(),
        rung(),
        10,
      );

      // The message quotes the answer TRIMMED — what a blank reports is `''`, not `'  '`.
      expect(outcome).toEqual({
        status: "rejected",
        reason: "bad-quantity",
        message: `'${answer}' is not a positive cash amount`,
      });
    }
  });

  it("treats a WHITESPACE-ONLY line as the default, not as a bad figure", async () => {
    // The prompt advertises `[4000]`, and in this flow a bracketed prompt means a bare
    // Enter takes the default — so the answer is trimmed BEFORE it is judged. Contrast the
    // bracketless `filled_quantity observed` prompt in `record-fill.ts`, where blank
    // REFUSES. The two rules look alike and are opposite, which is why this is asserted
    // rather than assumed.
    const io = scripted({ "Cash debited": "   " });

    const outcome = await resolveFunding(io.ask, fold(reserve()), NO_RESTING, reserve(), rung(), 10);

    expect(outcome).toEqual({ status: "resolved", fundingAmount: 4000, tier: "c1" });
  });
});

describe("resolveFunding — `D1`, the override guard, and only upward", () => {
  it("lets a DOWNWARD correction through untouched — it frees availability", async () => {
    // A reserve with NOTHING available: 4000 of capital, all 4000 of it committed to the
    // resting ladder. A downward correction must still pass — it spends LESS than the
    // fill's own available-neutral figure, so it cannot drive a reserve negative however
    // fully claimed the reserve is.
    const spent = reserve({ amount: 4000, lots: [{ quantity: 4000, tier: "c1" }] });
    const io = scripted({ "Cash debited": "3900" });

    const outcome = await resolveFunding(io.ask, fold(spent), restingRung(), spent, rung(), 10);

    expect(outcome).toEqual({ status: "resolved", fundingAmount: 3900, tier: "c1" });
  });

  it("lets the NEUTRAL default through on a reserve with nothing available", async () => {
    // THE EXEMPTION, ISOLATED. `Δavailable = price × quantity − cash debited` is exactly
    // zero here, so the act cannot break `available ≥ 0` whatever shape the book is in.
    // A guard written as "post-act available ≥ 0" would refuse this, and refusing a fill
    // that really happened at the venue is the failure this arm exists to prevent.
    const spent = reserve({ amount: 4000, lots: [{ quantity: 4000, tier: "c1" }] });
    const io = scripted({ "Cash debited": "" });

    const outcome = await resolveFunding(io.ask, fold(spent), restingRung(), spent, rung(), 10);

    expect(outcome).toEqual({ status: "resolved", fundingAmount: 4000, tier: "c1" });
  });

  it("admits an upward override the reserve can cover", async () => {
    // 10000 in the reserve, 4000 of it committed to the resting rung — 6000 available. The
    // excess is 100 and there is room.
    const io = scripted({ "Cash debited": "4100" });

    const outcome = await resolveFunding(
      io.ask,
      fold(reserve()),
      restingRung(),
      reserve(),
      rung(),
      10,
    );

    expect(outcome).toEqual({ status: "resolved", fundingAmount: 4100, tier: "c1" });
  });

  it("refuses an upward override larger than the reserve's available, naming the arithmetic", async () => {
    // 4050 of capital, 4000 committed to the resting rung — 50 available against a 100
    // excess.
    const small = reserve({ amount: 4050, lots: [{ quantity: 4050, tier: "c1" }] });
    const io = scripted({ "Cash debited": "4100" });

    const outcome = await resolveFunding(io.ask, fold(small), restingRung(), small, rung(), 10);

    // ONLY THE EXCESS IS WEIGHED — 100 against 4050 available — and the message shows the
    // operator all three numbers so they can see which one bound.
    expect(outcome).toEqual({
      status: "rejected",
      reason: "uncovered-override",
      message:
        "you asked to debit 4100 against 'reserve-synthetic', 100 more than the 4000 this " +
        "fill accounts for, and 'reserve-synthetic' has only 50 available (4050 balance " +
        "less 4000 committed). The fill's own arithmetic is available-neutral; only the " +
        "extra is spending capital that is not there, and a negative available is an " +
        "IMPOSSIBLE state rather than a warning. Record the fill at 4000, or record the " +
        "fee or funding difference as its own act",
    });
  });

  it("refuses an upward override against a reserve the report cannot place", async () => {
    // Paper execution mode: the available-capital report declines to place it, so there is
    // nothing to weigh the excess against. A DIFFERENT refusal from "not enough", because
    // it needs a different next move.
    const paper = reserve({ executionMode: "paper" });
    const io = scripted({ "Cash debited": "4100" });

    const outcome = await resolveFunding(io.ask, fold(paper), NO_RESTING, paper, rung(), 10);

    expect(outcome).toEqual({
      status: "rejected",
      reason: "uncovered-override",
      message:
        "you asked to debit 4100 against 'reserve-synthetic' — 100 more than the 4000 this " +
        "fill accounts for — but the available-capital report does not place that reserve " +
        "(paper execution mode, an unsupported currency, a dangling account reference), so " +
        "the excess cannot be weighed against anything. The fill itself is recordable at " +
        "the default figure",
    });
  });

  it("never consults the report at all when the override is not upward", async () => {
    // A paper reserve is unplaceable, so ANY call into the report would refuse. The neutral
    // and downward answers resolve, which is how we know the guard was never entered.
    const paper = reserve({ executionMode: "paper" });
    for (const answer of ["", "3999"]) {
      const io = scripted({ "Cash debited": answer });
      const outcome = await resolveFunding(io.ask, fold(paper), NO_RESTING, paper, rung(), 10);
      expect(outcome.status).toBe("resolved");
    }
  });
});

describe("resolveFunding — the tier is READ, never re-decided (T4)", () => {
  it("derives the tier from a single-tier reserve without asking", async () => {
    const io = scripted({ "Cash debited": "" });

    const outcome = await resolveFunding(
      io.ask,
      fold(reserve({ lots: [{ quantity: 10000, tier: "c2" }] })),
      NO_RESTING,
      reserve({ lots: [{ quantity: 10000, tier: "c2" }] }),
      rung(),
      10,
    );

    expect(outcome).toEqual({ status: "resolved", fundingAmount: 4000, tier: "c2" });
    // No tier prompt. Asking when the answer is already attributed would be a chance to
    // contradict the Transfer that set it.
    expect(io.asked).toEqual(["Cash debited [4000]: "]);
  });

  it("refuses rather than prompts when the reserve holds more than one tier", async () => {
    const mixed = reserve({
      lots: [
        { quantity: 6000, tier: "c1" },
        { quantity: 4000, tier: "c3" },
      ],
    });
    const io = scripted({ "Cash debited": "" });

    const outcome = await resolveFunding(io.ask, fold(mixed), NO_RESTING, mixed, rung(), 10);

    expect(outcome).toEqual({
      status: "rejected",
      reason: "ambiguous-tier",
      message:
        "'reserve-synthetic' holds c1 and c3; the tier ordering was decided at Transfer " +
        "time and this act does not get to re-decide it",
    });
    // THE ABSENCE OF A PROMPT IS THE ASSERTION. An ask here would let the operator re-order
    // capital at fill time, which is the one thing `T4` forbids — and the scripted stub
    // would throw on it rather than quietly answering.
    expect(io.asked).toEqual(["Cash debited [4000]: "]);
  });

  it("asks for a tier ONLY when the reserve carries no attribution at all", async () => {
    const untiered = untieredReserve();
    const io = scripted({ "Cash debited": "", "Capital tier": "c3" });

    const outcome = await resolveFunding(io.ask, fold(untiered), NO_RESTING, untiered, rung(), 10);

    expect(outcome).toEqual({ status: "resolved", fundingAmount: 4000, tier: "c3" });
    // There is no prior ordering to honor and none to violate, so naming a tier here is a
    // FIRST naming, not an override.
    expect(io.asked).toEqual(["Cash debited [4000]: ", "  Capital tier for this lot (c1/c2/c3): "]);
  });

  it("refuses anything that is not one of the three tiers, including a near miss", async () => {
    for (const answer of ["c4", "C1", "", "c1 c2", "tier1"]) {
      const untiered = untieredReserve();
      const io = scripted({ "Cash debited": "", "Capital tier": answer });

      const outcome = await resolveFunding(
        io.ask,
        fold(untiered),
        NO_RESTING,
        untiered,
        rung(),
        10,
      );

      expect(outcome).toEqual({
        status: "rejected",
        reason: "ambiguous-tier",
        message: `'${answer.trim()}' is not a capital tier`,
      });
    }
  });

  it("accepts each of the three tiers, trimmed", async () => {
    for (const tier of ["c1", "c2", "c3"] as const) {
      const untiered = untieredReserve();
      const io = scripted({ "Cash debited": "", "Capital tier": `  ${tier}  ` });

      const outcome = await resolveFunding(
        io.ask,
        fold(untiered),
        NO_RESTING,
        untiered,
        rung(),
        10,
      );

      expect(outcome).toEqual({ status: "resolved", fundingAmount: 4000, tier });
    }
  });

  it("asks for the cash BEFORE the tier, and never reaches the tier on a bad cash figure", async () => {
    const untiered = untieredReserve();
    const io = scripted({ "Cash debited": "nonsense", "Capital tier": "c1" });

    const outcome = await resolveFunding(io.ask, fold(untiered), NO_RESTING, untiered, rung(), 10);

    expect(outcome.status).toBe("rejected");
    expect(io.asked).toEqual(["Cash debited [4000]: "]);
  });
});
