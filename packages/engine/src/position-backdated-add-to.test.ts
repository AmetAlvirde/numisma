// ADR-017, THE ADD-TO HALF. "A close is the position's last dated event" — one
// sentence the gate enforces from two directions, and until this file only one of them
// compared dates. `requirePositionUntouchedAfter` (the seal rule) already refuses a
// close dated behind an accepted verb; the other direction asked
// `closedPositionIds.has(id)`, a membership test with no date in it, and so refused a
// correctly-dated verb along with the genuinely-late ones.
//
// SCOPE, DELIBERATELY NARROW. Exactly two of the four `closedPositionIds` call sites
// move under ADR-017, and this is the FIRST of them. `crossReferenceAddedTo` never
// reads `positionLots` — it checks the funding Reserve's per-tier debit sufficiency and
// nothing about the position's holdings — so the add-to half needs only the comparison,
// while the trim half additionally needs the world AS OF the trim's own date. That
// asymmetry is why this lands alone. `PositionClosed` and `InvalidationMarked` keep the
// flat, date-insensitive refusal, and their pins are below: at those two sites the
// refusal is not over-strict, because a backdated verb could not fold correctly either.
//
// Fixtures mirror `position-seal.test.ts` (same genesis seed, same `openLate`, same
// `ingestBatch` harness) so the two files describe the same rule from its two ends.
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

const addToPayload = (id: string, asOf: string): Record<string, unknown> => ({
  id,
  asOf,
  type: "PositionAddedTo",
  positionId: "btc-late",
  lot: { quantity: 1, cost: 100, tier: "c1" },
  funding: { reserveId: "pulse-cash", amount: 100 },
});

const closePayload = (id: string, asOf: string, proceeds = 100): Record<string, unknown> => ({
  id,
  asOf,
  type: "PositionClosed",
  positionId: "btc-late",
  settlement: { reserveId: "pulse-cash", proceeds },
});

const invalidatePayload = (id: string, asOf: string): Record<string, unknown> => ({
  id,
  asOf,
  type: "InvalidationMarked",
  positionId: "btc-late",
  price: 80,
  direction: "below",
});

const trimPayload = (id: string, asOf: string): Record<string, unknown> => ({
  id,
  asOf,
  type: "PositionTrimmed",
  positionId: "btc-late",
  removals: [{ quantity: 0.5, tier: "c1" }],
  settlement: { reserveId: "pulse-cash", proceeds: 50 },
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

/** `[Opened 06-05, Closed 06-10, PositionAddedTo <asOf>]` — the close arrives FIRST,
 * which is the arrival order the date-blind guard could not judge. */
const closeThenAdd = (asOf: string): Record<string, unknown>[] => [
  openLate(),
  closePayload("evt-close", CLOSED_AS_OF),
  addToPayload("evt-add", asOf),
];

describe("ADR-017 — a PositionAddedTo dated STRICTLY BEFORE its target's close", () => {
  it("is admitted, where the date-blind guard refused it", () => {
    const result = ingestBatch(closeThenAdd("2026-06-08"));

    expect(result.rejection).toBeNull();
    expect(result.committed.map((event) => event.id)).toEqual([
      "evt-open-late",
      "evt-close",
      "evt-add",
    ]);
  });

  it("and the fold really does place it ahead of the close, at the size it implies", () => {
    // The point of admitting it: the closed book must report the position the fund
    // actually held. The add lands 06-08 on lots the 06-10 close then consumes, so the
    // single closed row carries BOTH lots — cost basis 200, not the 100 the refusal
    // would have booked.
    const folded = foldEvents(genesis(), ingestBatch(closeThenAdd("2026-06-08")).committed).data;
    const rows = (folded.closedPositions ?? []).filter((row) => row.positionId === "btc-late");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ closedAsOf: CLOSED_AS_OF, costBasisUsd: 200 });
  });
});

// THE BOUNDARY IS `>=`, AND IT DELIBERATELY DISAGREES WITH THE SEAL RULE ON EQUALITY.
// `requirePositionUntouchedAfter` ACCEPTS a close dated equal to an already-accepted
// verb — it returns success on `asOf >= latest.asOf` and rejects only on strict `<`,
// pinned by `case 1 — accepts a same-day trim-then-close` in `position-seal.test.ts`.
// `crossReferenceAddedTo` REFUSES an add dated equal to an already-accepted close.
// Opposite answers on one date, and both are right, because at equality the LOG INDEX
// decides and not the date: `foldEvents` orders by (asOf, THEN LOG INDEX), so an
// add logged BEFORE a same-dated close folds ahead of it, and one logged AFTER lands
// on a position the close has already consumed. Each site takes the reading that
// matches what the fold will actually do. The batch's verdict therefore DOES depend on
// which of the pair the log received first — the fold's own tie-break showing through
// the gate, not a flaw to design away. ADR-017, "The boundary is `>=`".
describe("ADR-017 — the boundary", () => {
  it("refuses an add-to dated ON the close date", () => {
    const result = ingestBatch(closeThenAdd(CLOSED_AS_OF));

    expect(result.rejection?.path).toBe("positionId");
    expect(result.rejection?.message).toContain("PositionAddedTo");
    expect(result.rejection?.message).toContain("already closed");
    expect(result.committed).toEqual([]);
  });

  it("still refuses one dated after it", () => {
    const result = ingestBatch(closeThenAdd("2026-06-11"));

    expect(result.rejection?.path).toBe("positionId");
    expect(result.rejection?.message).toContain("already closed");
    expect(result.committed).toEqual([]);
  });

  it("admits the day before and refuses the day of — the same batch, one day apart", () => {
    // The pair, side by side: nothing else in these two batches differs.
    expect(ingestBatch(closeThenAdd("2026-06-09")).rejection).toBeNull();
    expect(ingestBatch(closeThenAdd(CLOSED_AS_OF)).rejection).not.toBeNull();
  });
});

// BOTH HALVES OF THE INVARIANT, ASSERTED TOGETHER. Neither sentence is complete without
// the other, and relaxing this direction must not quiet the other one.
describe("ADR-017 — the pair reads in both directions", () => {
  it("a close may not be dated behind an already-accepted add-to", () => {
    const result = ingestBatch([
      openLate(),
      addToPayload("evt-add", "2026-06-18"),
      closePayload("evt-close", CLOSED_AS_OF, 200),
    ]);

    expect(result.rejection?.path).toBe("positionId");
    expect(result.rejection?.message).toContain("has already been accepted for it");
    expect(result.committed).toEqual([]);
  });

  it("and an add-to may not be dated on or after an already-accepted close", () => {
    expect(ingestBatch(closeThenAdd(CLOSED_AS_OF)).rejection?.message).toContain("already closed");
  });
});

// THE OTHER TWO CALL SITES DO NOT MOVE, AND NEVER WILL — ADR-017 rules both of them
// date-INSENSITIVE on the merits. The third site, `PositionTrimmed`, was pinned here as
// unmoved while it was still ADR-017's second slice; that slice has since landed, so its
// pin now reads the other way up and lives with the rest of the trim rule in
// `position-backdated-trim.test.ts`. What survives here is the boundary this file cares
// about: relaxing BOTH verbs through the shared `closedPositionAsOf` carrier must still
// leave these two flat refusals alone.
describe("ADR-017 — the sites that stay date-blind", () => {
  it("a backdated SECOND close is still refused flat: whichever sorts first retires the id", () => {
    const result = ingestBatch([
      openLate(),
      closePayload("evt-close", CLOSED_AS_OF),
      closePayload("evt-close-again", "2026-06-08"),
    ]);

    expect(result.rejection?.message).toContain("PositionClosed");
    expect(result.rejection?.message).toContain("already closed");
  });

  it("a backdated InvalidationMarked is still refused flat: breach is derived per OPEN position", () => {
    const result = ingestBatch([
      openLate(),
      closePayload("evt-close", CLOSED_AS_OF),
      invalidatePayload("evt-invalidate", "2026-06-08"),
    ]);

    expect(result.rejection?.message).toContain("InvalidationMarked");
    expect(result.rejection?.message).toContain("already closed");
  });

  it("but a backdated PositionTrimmed is now admitted — the second slice landed", () => {
    // The exact batch this block used to pin as refused. Kept because it is the one
    // assertion proving the two relaxations share a carrier and not a copy: the same
    // `closedPositionAsOf` answers "closed as of when" for the add-to above and for the
    // trim here. The trim rule's own boundary, magnitude and fold coverage is in
    // `position-backdated-trim.test.ts`.
    const result = ingestBatch([
      openLate(),
      closePayload("evt-close", CLOSED_AS_OF),
      trimPayload("evt-trim", "2026-06-08"),
    ]);

    expect(result.rejection).toBeNull();
    expect(result.committed.map((event) => event.id)).toEqual([
      "evt-open-late",
      "evt-close",
      "evt-trim",
    ]);
  });
});

// THE CARRIER, structurally. `closedPositionAsOf` is what makes "closed" answerable AS
// OF A DATE, and `closedPositionIds` is derived from its key set rather than built
// alongside it — one derivation, so the two cannot drift apart the way a shadow did.
// Slice 2 reads the same map for `PositionTrimmed`.
describe("EventReference.closedPositionAsOf", () => {
  it("dates each retired position with the close that retired it", () => {
    const reference = buildEventReference(genesis(), [
      accepted(openLate()),
      accepted(closePayload("evt-close", CLOSED_AS_OF)),
    ]);

    expect(reference.closedPositionAsOf.get("btc-late")).toBe(CLOSED_AS_OF);
    expect(reference.closedPositionAsOf.has("btc-core")).toBe(false);
  });

  it("carries exactly the ids `closedPositionIds` carries", () => {
    const reference = buildEventReference(genesis(), [
      accepted(openLate()),
      accepted(closePayload("evt-close", CLOSED_AS_OF)),
    ]);

    expect([...reference.closedPositionAsOf.keys()]).toEqual([...reference.closedPositionIds]);
  });

  it("has no entry for a position only TRIMMED — a trim always leaves it open", () => {
    const reference = buildEventReference(genesis(), [
      accepted(openLate()),
      accepted(trimPayload("evt-trim", "2026-06-08")),
    ]);

    expect(reference.closedPositionAsOf.has("btc-late")).toBe(false);
  });
});
