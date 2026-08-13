// ADR-017, THE TRIM HALF — the second and last of its two sites. "A close is the
// position's last dated event" is one sentence the gate enforces from two directions:
// `requirePositionUntouchedAfter` refuses a close dated behind an accepted verb, and
// this direction must refuse a verb dated ON OR AFTER an accepted close — no more than
// that. Until this file it asked `closedPositionIds.has(id)`, a membership test with no
// date in it, and so refused a correctly-dated trim along with the genuinely-late ones.
//
// THE COMPARISON IS NOT THE WORK, and that is why this half lands after the add-to's.
// `EventReference.positionLots` is the fold's SURVIVORS, so a retired position has no
// entry at all. Relax only the membership test and two things follow:
//
//   1. the position-lot-sufficiency gate sees `available = 0` and refuses the trim
//      anyway, now with a WORSE message ("removes 0.5 … which holds only 0");
//   2. the settlement-magnitude gate SILENTLY STOPS FIRING — it is guarded on
//      `if (held && last !== undefined)`, and with `held` undefined a backdated trim
//      would be admitted with no proceeds sanity check at all, while every other trim
//      keeps one. Nothing would go red. Nothing would complain.
//
// So the trim is judged against the world AS OF ITS OWN DATE — ADR-015's doctrine one
// level deeper: the gate judges against the fold, and for a backdated verb the relevant
// fold is the one at the verb's own date. `held` comes back as a side effect, which is
// why (2) is fixed structurally rather than by a separate patch. THE ABSURD-PROCEEDS
// TEST BELOW IS THIS FILE'S LOAD-BEARING ONE: without it, (2) ships unnoticed.
//
// Fixtures mirror `position-seal.test.ts` and `position-backdated-add-to.test.ts` (same
// genesis seed, same `openLate`, same `ingestBatch` harness) so all three files describe
// one rule from its several ends.
import {
  buildEventReference,
  crossReferenceEvent,
  foldEvents,
  parseEvent,
  type FundReviewData,
  type PortfolioEvent,
} from "./index.js";
import { describe, expect, it } from "vitest";

const GENESIS_AS_OF = "2026-06-01";
const OPENED_AS_OF = "2026-06-05";
/** The date `btc-late` is retired on in every batch below. */
const CLOSED_AS_OF = "2026-06-10";
/** Two days behind the close — the ADR's own worked case. */
const BACKDATED_AS_OF = "2026-06-08";

function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "bitget-usd", name: "Bitget", platform: "BITGET", currency: "USD" }],
    instruments: [{ id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" }],
    reserves: [
      {
        id: "pulse-cash",
        portfolioId: "core",
        tempo: "Pulse",
        executionMode: "live",
        accountId: "bitget-usd",
        currency: "USD",
        amount: 1000,
        lots: [
          { quantity: 600, tier: "c1" },
          { quantity: 400, tier: "c2" },
        ],
      },
    ],
    positions: [
      {
        id: "btc-core",
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "bitget-usd",
        instrumentId: "btc-usd",
        direction: "long",
        markPrice: 100,
        currency: "USD",
        lots: [{ quantity: 2, cost: 100, tier: "c1" }],
      },
    ],
  };
}

/** The LOG-BORN position: `btc-late`, born 2026-06-05, one lot of 1 @ 100. */
function openLate(): Record<string, unknown> {
  return {
    id: "evt-open-late",
    asOf: OPENED_AS_OF,
    type: "PositionOpened",
    position: {
      id: "btc-late",
      portfolioId: "core",
      tempo: "Capital",
      executionMode: "live",
      accountId: "bitget-usd",
      instrumentId: "btc-usd",
      direction: "long",
      currency: "USD",
      lots: [{ quantity: 1, cost: 100, tier: "c1" }],
    },
    decision: {
      entryThesis: "thesis",
      invalidationCondition: "invalidation",
      riskBudget: "1R",
      plannedHoldingHorizon: "weeks",
      strategy: "trend",
    },
    funding: { reserveId: "pulse-cash", amount: 100 },
  };
}

const trimPayload = (
  id: string,
  asOf: string,
  quantity = 0.5,
  proceeds = 50,
): Record<string, unknown> => ({
  id,
  asOf,
  type: "PositionTrimmed",
  positionId: "btc-late",
  removals: [{ quantity, tier: "c1" }],
  settlement: { reserveId: "pulse-cash", proceeds },
});

const closePayload = (id: string, asOf: string, proceeds = 100): Record<string, unknown> => ({
  id,
  asOf,
  type: "PositionClosed",
  positionId: "btc-late",
  settlement: { reserveId: "pulse-cash", proceeds },
});

function accepted(input: Record<string, unknown>): PortfolioEvent {
  const result = parseEvent(input);
  if (result.kind !== "ok") {
    throw new Error(`expected parse to accept: ${result.path}: ${result.message}`);
  }
  return result.value;
}

/** The ingest contract in miniature: parse then cross-reference in LOG order against
 * genesis + everything committed so far (ADR-015), aborting the batch on the first
 * rejection. All-or-nothing, so `committed` is evidence and not a partial log. */
function ingestBatch(inputs: Record<string, unknown>[]): {
  committed: PortfolioEvent[];
  rejection: { path: string; message: string } | null;
} {
  const committed: PortfolioEvent[] = [];
  for (const input of inputs) {
    const parsed = parseEvent(input);
    if (parsed.kind !== "ok") {
      return { committed: [], rejection: { path: parsed.path, message: parsed.message } };
    }
    const checked = crossReferenceEvent(parsed.value, buildEventReference(genesis(), committed));
    if (checked.kind !== "ok") {
      return { committed: [], rejection: { path: checked.path, message: checked.message } };
    }
    committed.push(parsed.value);
  }
  return { committed, rejection: null };
}

/** `[Opened 06-05, Closed 06-10, Trimmed <asOf>]` — the close arrives FIRST, which is
 * the arrival order the date-blind guard could not judge. */
const closeThenTrim = (
  asOf: string,
  quantity = 0.5,
  proceeds = 50,
): Record<string, unknown>[] => [
  openLate(),
  closePayload("evt-close", CLOSED_AS_OF),
  trimPayload("evt-trim", asOf, quantity, proceeds),
];

describe("ADR-017 — a PositionTrimmed dated STRICTLY BEFORE its target's close", () => {
  it("is admitted, where the date-blind guard refused it", () => {
    const result = ingestBatch(closeThenTrim(BACKDATED_AS_OF));

    expect(result.rejection).toBeNull();
    expect(result.committed.map((event) => event.id)).toEqual([
      "evt-open-late",
      "evt-close",
      "evt-trim",
    ]);
  });

  it("and the book then reports the fifty the fund actually made, not zero", () => {
    // The ADR's own worked case, in the book's own numbers. The trim removes half the
    // basis on 06-08, so the 06-10 close books 100 against the 50 that remained.
    // REFUSED, the trim never enters the log and the close books 100 against the full
    // 100 — one row, at full size, realized 0 on a position that made 50.
    const folded = foldEvents(genesis(), ingestBatch(closeThenTrim(BACKDATED_AS_OF)).committed);
    const rows = (folded.closedPositions ?? []).filter((row) => row.positionId === "btc-late");

    expect(rows.map((row) => row.closedAsOf)).toEqual([BACKDATED_AS_OF, CLOSED_AS_OF]);
    expect(rows[1]).toMatchObject({ costBasisUsd: 50, proceedsUsd: 100, realizedPnlUsd: 50 });
    expect(rows.reduce((sum, row) => sum + (row.realizedPnlUsd ?? 0), 0)).toBe(50);

    // The counterfactual, joined rather than asserted beside: what the refusal booked.
    const refused = foldEvents(genesis(), [accepted(openLate()), accepted(closePayload("c", CLOSED_AS_OF))]);
    const refusedRows = (refused.closedPositions ?? []).filter((row) => row.positionId === "btc-late");
    expect(refusedRows).toHaveLength(1);
    expect(refusedRows[0]).toMatchObject({ costBasisUsd: 100, realizedPnlUsd: 0 });
  });
});

// THE LOAD-BEARING TEST OF THIS SLICE. The settlement-magnitude gate is guarded on
// `if (held && last !== undefined)`, and `held` comes from `positionLots` — the fold's
// SURVIVORS, which a retired position is not among. A naive relaxation therefore admits
// a backdated trim with NO proceeds sanity check and says nothing about it: no error, no
// warning, no failing test anywhere else in the suite. This is the only thing standing
// between that hole and the durable log.
describe("ADR-017 — the settlement-magnitude gate still fires on a backdated trim", () => {
  it("rejects absurd proceeds on a trim dated behind the close", () => {
    const result = ingestBatch(closeThenTrim(BACKDATED_AS_OF, 0.5, 5000));

    expect(result.rejection?.path).toBe("settlement.proceeds");
    expect(result.rejection?.message).toContain("PositionTrimmed proceeds 5000");
    expect(result.rejection?.message).toContain("settlement sanity threshold");
    expect(result.committed).toEqual([]);
  });

  it("computes the expectation from the lots the position held AS OF that date", () => {
    // Not merely "it was rejected": the expected figure must be 0.5 × the last close of
    // 100 = 50.00, which is only computable if the as-of world restored `held`. A gate
    // reading the survivors map would have had no quantity and no instrument to name.
    const result = ingestBatch(closeThenTrim(BACKDATED_AS_OF, 0.5, 5000));

    expect(result.rejection?.message).toContain("expected 50.00");
    expect(result.rejection?.message).toContain("0.5 × last close 100");
    expect(result.rejection?.message).toContain("btc-usd");
  });

  it("and treats a backdated trim exactly as it treats an ordinary one", () => {
    // Same absurd proceeds, same instrument, same size — only the close's presence
    // differs. The two messages must be the same sentence, or the gate has two minds.
    const backdated = ingestBatch(closeThenTrim(BACKDATED_AS_OF, 0.5, 5000)).rejection;
    const ordinary = ingestBatch([openLate(), trimPayload("evt-trim", BACKDATED_AS_OF, 0.5, 5000)])
      .rejection;

    expect(ordinary?.path).toBe("settlement.proceeds");
    expect(backdated?.message).toBe(ordinary?.message);
  });

  it("still admits proceeds that are merely close to the expectation", () => {
    // The gate firing must not become a gate refusing everything: a plausible fill goes
    // through, so the test above is evidence about the THRESHOLD and not about `held`
    // being permanently absent.
    expect(ingestBatch(closeThenTrim(BACKDATED_AS_OF, 0.5, 52)).rejection).toBeNull();
  });
});

// THE OTHER CONSEQUENCE OF READING THE SURVIVORS MAP: the sufficiency gate would see
// `available = 0` for a retired position and refuse every backdated trim with a message
// that describes a position holding nothing — misleading about the fund's own history.
// Judged as of the trim's date, the lots are real and the gate answers about them.
describe("ADR-017 — the position-lot-sufficiency gate judges the lots as of the date", () => {
  it("refuses a backdated trim larger than the position ever held, naming the real size", () => {
    const result = ingestBatch(closeThenTrim(BACKDATED_AS_OF, 5, 500));

    expect(result.rejection?.path).toBe("removals");
    expect(result.rejection?.message).toContain("removes 5");
    expect(result.rejection?.message).toContain("which holds only 1");
    expect(result.rejection?.message).not.toContain("holds only 0");
  });

  it("still refuses a backdated trim that would empty the position — a trim is not a close", () => {
    const result = ingestBatch(closeThenTrim(BACKDATED_AS_OF, 1, 100));

    expect(result.rejection?.path).toBe("removals");
    expect(result.rejection?.message).toContain("full retirement");
  });
});

// THE BOUNDARY IS `>=`, MATCHING THE SEAL RULE'S OWN STRICTNESS AT `crossref.ts:819`.
// The two rules meet on the close date itself and must not disagree there: the seal rule
// ACCEPTS a verb dated EQUAL to a close (trim-then-close on one day is ordinary, and the
// fold's (asOf, THEN LOG INDEX) order applies the earlier-logged verb first), so this
// direction — where the close is already in the log — must REFUSE equality.
describe("ADR-017 — the trim boundary", () => {
  it("refuses a trim dated ON the close date", () => {
    const result = ingestBatch(closeThenTrim(CLOSED_AS_OF));

    expect(result.rejection?.path).toBe("positionId");
    expect(result.rejection?.message).toContain("PositionTrimmed");
    expect(result.rejection?.message).toContain("already closed");
    expect(result.committed).toEqual([]);
  });

  it("still refuses one dated after it", () => {
    const result = ingestBatch(closeThenTrim("2026-06-11"));

    expect(result.rejection?.path).toBe("positionId");
    expect(result.rejection?.message).toContain("already closed");
    expect(result.committed).toEqual([]);
  });

  it("admits the day before and refuses the day of — the same batch, one day apart", () => {
    expect(ingestBatch(closeThenTrim("2026-06-09")).rejection).toBeNull();
    expect(ingestBatch(closeThenTrim(CLOSED_AS_OF)).rejection).not.toBeNull();
  });
});

// BOTH HALVES OF THE INVARIANT, ASSERTED TOGETHER. Neither sentence is complete without
// the other, and relaxing this direction must not quiet the other one.
describe("ADR-017 — the pair reads in both directions, for the trim too", () => {
  it("a close may not be dated behind an already-accepted trim", () => {
    const result = ingestBatch([
      openLate(),
      trimPayload("evt-trim", "2026-06-18", 0.5, 50),
      closePayload("evt-close", CLOSED_AS_OF, 50),
    ]);

    expect(result.rejection?.path).toBe("positionId");
    expect(result.rejection?.message).toContain("has already been accepted for it");
    expect(result.committed).toEqual([]);
  });

  it("and a trim may not be dated on or after an already-accepted close", () => {
    expect(ingestBatch(closeThenTrim(CLOSED_AS_OF)).rejection?.message).toContain("already closed");
  });
});
