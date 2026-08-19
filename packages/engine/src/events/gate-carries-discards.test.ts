// THE GATE CARRIES, THE WALK LIFTS (PRD #323 slice C, seam C; ADR-020, the Discard
// Channel — report, never refuse).
//
// `buildEventReference` FOLDS `priorEvents` to build the world-state it judges each
// candidate against, so a fold that drops an event silently is a blind spot INSIDE the
// ingest gate — not a display defect the gate compensates for. This suite pins the two
// halves of the fix and the one thing that must NOT move:
//
//   1. the reference CARRIES the fold's discards (`EventReference.skipped`);
//   2. no `crossReference*` rule ACTS on them — every verdict is a pure function of
//      what it read before. Acting would be catastrophic (spec R2): one damaged
//      historical event would brick all future ingest, permanently;
//   3. `walkPendingInbox` lifts the union onto its result, DEDUPED on
//      (`eventId`, `reason`) — the walk re-folds once per accepted event (ADR-015), so
//      a 13-event batch is 14 folds and one dropped prior yields 14 identical skips.
//
// Every fixture below is AUTHORED. Nothing is seeded from the durable log or from any
// tool output; the numbers are round so each expectation can be hand-computed.
import { describe, expect, it } from "vitest";
import type { FundReviewData } from "../contracts.js";
import { buildEventReference, crossReferenceEvent } from "./crossref.js";
import { walkPendingInbox } from "./ingest-walk.js";
import type { PortfolioEvent } from "./types.js";

const GENESIS_AS_OF = "2026-06-01";

/** One funded USD reserve, two instruments, one seeded open position. */
function genesis(): FundReviewData {
  return {
    fund: { id: "fund-1", name: "Accumulus", baseCurrency: "USD" },
    review: { asOf: GENESIS_AS_OF, usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "bitget-usd", name: "Bitget", platform: "BITGET", currency: "USD" }],
    instruments: [
      { id: "btc-usd", name: "Bitcoin", symbol: "BTC", currency: "USD" },
      { id: "eth-usd", name: "Ether", symbol: "ETH", currency: "USD" },
    ],
    reserves: [
      {
        id: "pulse-cash",
        portfolioId: "core",
        tempo: "Pulse",
        executionMode: "live",
        accountId: "bitget-usd",
        currency: "USD",
        amount: 10000,
        lots: [{ quantity: 10000, tier: "c1" }],
      },
    ],
    positions: [
      {
        id: "btc-core",
        portfolioId: "core",
        tempo: "Pulse",
        executionMode: "live",
        accountId: "bitget-usd",
        instrumentId: "btc-usd",
        direction: "long",
        markPrice: 100,
        currency: "USD",
        lots: [{ quantity: 4, cost: 100, tier: "c1", entryFx: 20 }],
      },
    ],
  };
}

const DECISION = {
  entryThesis: "authored fixture",
  invalidationCondition: "authored fixture",
  riskBudget: "authored fixture",
  plannedHoldingHorizon: "authored fixture",
  strategy: "authored-strategy",
};

/**
 * A prior the fold READS AND DROPS: a close whose target the world has no record of.
 * Nothing about the world moves — which is exactly why the drop was invisible.
 */
function droppedPrior(): PortfolioEvent {
  return {
    id: "evt-ghost-close",
    asOf: "2026-06-02",
    type: "PositionClosed",
    positionId: "ghost-position",
    settlement: { reserveId: "pulse-cash", proceeds: 300 },
  };
}

/** A prior the fold APPLIES in full, so both worlds below hold the same real history. */
function appliedPrior(): PortfolioEvent {
  return {
    id: "evt-mark-btc",
    asOf: "2026-06-03",
    type: "PriceMarked",
    instrumentId: "btc-usd",
    price: 110,
  };
}

/**
 * One candidate per verb the gate dispatches on — the accept and reject sides both
 * represented, so the parity claim below covers verdicts that turn on the world and
 * verdicts that turn on the candidate alone.
 */
function candidates(): PortfolioEvent[] {
  return [
    {
      id: "cand-open",
      asOf: "2026-06-10",
      type: "PositionOpened",
      position: {
        id: "eth-core",
        portfolioId: "core",
        tempo: "Pulse",
        executionMode: "live",
        accountId: "bitget-usd",
        instrumentId: "eth-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 2, cost: 100, tier: "c1", entryFx: 20 }],
      },
      decision: DECISION,
      funding: { reserveId: "pulse-cash", amount: 200 },
    },
    // Collides with the seeded position id — a REJECT that must stay a reject.
    {
      id: "cand-open-collision",
      asOf: "2026-06-10",
      type: "PositionOpened",
      position: {
        id: "btc-core",
        portfolioId: "core",
        tempo: "Pulse",
        executionMode: "live",
        accountId: "bitget-usd",
        instrumentId: "btc-usd",
        direction: "long",
        currency: "USD",
        lots: [{ quantity: 1, cost: 100, tier: "c1", entryFx: 20 }],
      },
      decision: DECISION,
      funding: { reserveId: "pulse-cash", amount: 100 },
    },
    {
      id: "cand-close",
      asOf: "2026-06-10",
      type: "PositionClosed",
      positionId: "btc-core",
      settlement: { reserveId: "pulse-cash", proceeds: 440 },
    },
    // Names the very id the dropped prior named. The gate must refuse it for the
    // reason it always did — the id is unknown — and never because of the drop.
    {
      id: "cand-close-ghost",
      asOf: "2026-06-11",
      type: "PositionClosed",
      positionId: "ghost-position",
      settlement: { reserveId: "pulse-cash", proceeds: 300 },
    },
    {
      id: "cand-trim",
      asOf: "2026-06-10",
      type: "PositionTrimmed",
      positionId: "btc-core",
      removals: [{ tier: "c1", quantity: 1 }],
      settlement: { reserveId: "pulse-cash", proceeds: 110 },
    },
    {
      id: "cand-add",
      asOf: "2026-06-10",
      type: "PositionAddedTo",
      positionId: "btc-core",
      lot: { quantity: 1, cost: 110, tier: "c1", entryFx: 20 },
      funding: { reserveId: "pulse-cash", amount: 110 },
    },
    { id: "cand-mark", asOf: "2026-06-10", type: "PriceMarked", instrumentId: "btc-usd", price: 120 },
    // Fat-finger against the applied prior's close of 110 — a REJECT on both sides.
    { id: "cand-mark-wild", asOf: "2026-06-10", type: "PriceMarked", instrumentId: "btc-usd", price: 900 },
    { id: "cand-deposit", asOf: "2026-06-10", type: "Deposit", reserveId: "pulse-cash", amount: 500, tier: "c1" },
    { id: "cand-withdraw", asOf: "2026-06-10", type: "Withdraw", reserveId: "pulse-cash", amount: 500, tier: "c1" },
    {
      id: "cand-transfer",
      asOf: "2026-06-10",
      type: "Transfer",
      fromReserveId: "pulse-cash",
      toReserveId: "pulse-cash",
      amount: 100,
      tier: "c1",
    },
    {
      id: "cand-inval",
      asOf: "2026-06-10",
      type: "InvalidationMarked",
      positionId: "btc-core",
      price: 80,
      direction: "below",
    },
    {
      id: "cand-reserve-open",
      asOf: "2026-06-10",
      type: "ReserveOpened",
      reserve: {
        id: "swing-cash",
        portfolioId: "core",
        tempo: "Swing",
        executionMode: "live",
        accountId: "bitget-usd",
        currency: "USD",
      },
    },
  ];
}

/** The verdict, flattened to what a caller can act on — kind plus the guard's wording. */
function verdictOf(event: PortfolioEvent, reference: ReturnType<typeof buildEventReference>) {
  const result = crossReferenceEvent(event, reference);
  return result.kind === "ok"
    ? { id: event.id, kind: "ok" }
    : { id: event.id, kind: result.kind, path: result.path, message: result.message };
}

describe("the ingest gate carries the fold's discards", () => {
  it("buildEventReference reports the dropped prior and discards nothing", () => {
    const reference = buildEventReference(genesis(), [appliedPrior(), droppedPrior()]);

    expect(reference.skipped).toHaveLength(1);
    expect(reference.skipped[0]).toMatchObject({
      eventId: "evt-ghost-close",
      verb: "PositionClosed",
      reason: "position-absent",
    });
    // The locator is the index into the array the GATE folded, so an operator can find
    // the record without re-deriving the gate's own input ordering.
    expect(reference.skipped[0]?.index).toBe(1);
  });

  it("every rule's verdict is a pure function of what it read before — with and without skips", () => {
    // The two worlds differ in ONE way only: one of them read an event the fold could
    // not apply. A dropped event moves no state by definition, so the real history in
    // both references is identical — and every verdict must be too.
    const clean = buildEventReference(genesis(), [appliedPrior()]);
    const damaged = buildEventReference(genesis(), [appliedPrior(), droppedPrior()]);

    expect(clean.skipped).toEqual([]);
    expect(damaged.skipped).toHaveLength(1);

    for (const candidate of candidates()) {
      expect(verdictOf(candidate, damaged)).toEqual(verdictOf(candidate, clean));
    }

    // And the refusal that names the dropped prior's own id is the ORDINARY unknown-id
    // refusal, not a new one minted off the discard channel: if a rule ever refused ON a
    // prior drop, one damaged historical event would brick all future ingest (spec R2).
    const ghostClose = candidates().find((event) => event.id === "cand-close-ghost");
    const verdict = crossReferenceEvent(ghostClose as PortfolioEvent, damaged);
    expect(verdict.kind).not.toBe("ok");
    expect(verdict.kind === "ok" ? "" : verdict.message).not.toMatch(/drop|discard|skip/i);
  });

  it("the as-of world carries its own fold's discards too", () => {
    // `worldAsOf` rebuilds the whole reference from a prefix (ADR-017), so it is a
    // second fold — and a second chance to swallow the answer.
    const reference = buildEventReference(genesis(), [droppedPrior(), appliedPrior()]);
    expect(reference.worldAsOf("2026-06-02").skipped).toHaveLength(1);
    // Before the dropped prior's own date, the prefix does not contain it at all.
    expect(reference.worldAsOf("2026-06-01").skipped).toEqual([]);
  });
});

describe("walkPendingInbox lifts the fold's discards, deduped", () => {
  it("a 13-event batch is 14 folds and still reports ONE dropped prior, not 14", () => {
    // ADR-015: the walk re-derives the gate's view on every accept, so a batch of 13
    // accepted marks folds the log 14 times (once up front, once per accept) and the
    // same dropped prior is reported by every one of those folds. Un-deduped, an
    // operator would read 14 findings about one event.
    const marks = Array.from({ length: 13 }, (_, index) => ({
      id: `cand-mark-${index}`,
      asOf: `2026-06-${String(10 + index).padStart(2, "0")}`,
      type: "PriceMarked",
      instrumentId: "btc-usd",
      price: 110 + index,
    }));

    const walk = walkPendingInbox(marks, {
      genesis: genesis(),
      priorEvents: [appliedPrior(), droppedPrior()],
    });

    expect(walk.invalid).toBeUndefined();
    expect(walk.rejected).toEqual([]);
    expect(walk.accepted).toHaveLength(13);
    // 13 accepts + the build before the first candidate = 14 folds, each of which saw
    // the drop. The lift is ONE record.
    expect(walk.accepted.length + 1).toBe(14);
    expect(walk.reference.skipped).toHaveLength(1);
    expect(walk.skipped).toHaveLength(1);
    expect(walk.skipped[0]).toMatchObject({
      eventId: "evt-ghost-close",
      verb: "PositionClosed",
      reason: "position-absent",
    });
  });

  it("distinct drops survive the dedup; each fold's repeat of one collapses; a clean log lifts nothing", () => {
    // The key is (`eventId`, `reason`) — the dedup collapses REPEATS of one finding, not
    // findings. THE REPEATS COME FROM RE-FOLDING, not from one event recording twice:
    // since #371 no arm puts two records on a single event within one fold, so the walk's
    // own loop is the only thing that can produce a repeat. This walk accepts one
    // candidate, so it folds twice — the build before the first candidate, then the
    // accept — and BOTH folds see BOTH standing drops. Four records, two findings.
    //
    // The Transfer is still the pointed fixture: it names TWO absent reserves and is one
    // finding however many it names, which is what the both-legs-or-neither arm records.
    // The unrelated ghost close is a genuinely second finding and must survive alongside.
    const transferBothLegsAbsent: PortfolioEvent = {
      id: "evt-ghost-transfer",
      asOf: "2026-06-02",
      type: "Transfer",
      fromReserveId: "ghost-cash",
      toReserveId: "other-ghost-cash",
      amount: 100,
      tier: "c1",
    };
    const walk = walkPendingInbox(
      [
        {
          id: "cand-mark-only",
          asOf: "2026-06-10",
          type: "PriceMarked",
          instrumentId: "btc-usd",
          price: 112,
        },
      ],
      { genesis: genesis(), priorEvents: [transferBothLegsAbsent, droppedPrior()] },
    );
    expect(walk.accepted).toHaveLength(1);
    expect(
      walk.skipped.map((skip) => `${skip.eventId} ${skip.reason}`).sort(),
    ).toEqual(["evt-ghost-close position-absent", "evt-ghost-transfer reserve-absent"]);

    const clean = walkPendingInbox([], { genesis: genesis(), priorEvents: [appliedPrior()] });
    expect(clean.skipped).toEqual([]);
  });
});
