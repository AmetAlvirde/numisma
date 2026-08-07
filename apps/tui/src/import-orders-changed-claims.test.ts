/**
 * THE CHANGED-CLAIM CLASSIFIER, ASSERTED DIRECTLY — the reason it left `import-orders.ts`.
 *
 * Every case below was reachable before only by driving a whole import: an export file, a
 * sidecar, an injected clock, a prompt answered, a funding guard satisfied. The
 * classifier is a pure function of three arrays, so it is tested as one.
 *
 * THE FIRST TEST IS THE POINT OF THE EXTRACTION. `amended` and `backwards` are NOT
 * disjoint predicates — PR #211's review found the docstring's disjointness proof false on
 * exactly that — and until now the only thing holding the branch ordering in place was a
 * comment saying so. A comment does not fail. That test does.
 */
import type { BitgetOpenOrder, ChangedClaim, RestingOrder } from "@numisma/engine";
import { describe, expect, it } from "vitest";
import {
  partitionChangedClaims,
  weighRemainders,
} from "./import-orders-changed-claims.js";

const PLACED_QUANTITY = 10;

/** A row of the export, carrying only what the classifier reads off it. */
function row(id: string, filledQuantity: number, quantity = PLACED_QUANTITY): BitgetOpenOrder {
  return {
    id,
    observedAt: "2026-08-07T10:00:00",
    currency: "USD",
    symbol: "BTCUSDT",
    side: "buy",
    price: 100,
    quantity,
    filledQuantity,
    totalQuantity: quantity,
    timeInForce: "GTC",
    orderType: "limit",
    triggerPrice: null,
  };
}

/**
 * What the FILE still counts as resting for this rung — `quantity − consumed`, folded by
 * `pickRestingOrdersAsOf` over the whole stream. Passed as the remainder directly, because
 * that is the one figure the classifier reads.
 */
function resting(id: string, remainingQuantity: number, quantity = PLACED_QUANTITY): RestingOrder {
  return {
    placed: {
      id,
      observedAt: "2026-08-07T10:00:00",
      kind: "orderPlaced",
      currency: "USD",
      symbol: "BTCUSDT",
      side: "buy",
      price: 100,
      quantity,
      fundingReserveId: "cash-core",
    },
    remainingQuantity,
  };
}

/** A restatement difference: what the file last OBSERVED against what the export shows. */
function filledDifference(known: number, observed: number): ChangedClaim["differences"][number] {
  return { field: "observedFilledQuantity", known, observed };
}

function claim(id: string, ...differences: ChangedClaim["differences"]): ChangedClaim {
  return { id, differences };
}

describe("partitionChangedClaims — the branch ordering", () => {
  it("ROUTES AN OVERLAPPING CLAIM TO `backwards` — REORDERING THE BRANCHES BREAKS THIS", () => {
    // THE CASE THE DOCSTRING'S OLD DISJOINTNESS PROOF GOT WRONG (PR #211 review), and the
    // one test in this file whose failure means a live rung can be destroyed.
    //
    // Placed 10, the file's latest observation 6, the export showing 4. BOTH predicates
    // are true here:
    //
    //   - `backwards` fires on `export figure < latest observation` — 4 < 6;
    //   - `amended`'s remainder test reduces to `export figure < consumed` — the file
    //     counts 4 resting against the venue's 6, so `onFile < atVenue` holds too.
    //
    // `[0, consumed)` CONTAINS `[0, latestObserved)`, so the predicates are a superset
    // relation and not a partition. Only the `continue` after the `backwards` push
    // separates them. Move the fill test below the remainder test and this claim lands in
    // `amended`, where the operator is told to CANCEL THE RUNG AT THE VENUE over what is
    // almost always the wrong CSV — the exact harm #208's split exists to remove.
    const result = partitionChangedClaims(
      [claim("rung-1", filledDifference(6, 4))],
      [resting("rung-1", 4)],
      [row("rung-1", 4)],
    );

    const remainders = weighRemainders("rung-1", [resting("rung-1", 4)], [row("rung-1", 4)]);
    // The overlap, stated as an assertion rather than as a claim in a comment: the
    // `amended` branch's own test is satisfied by this very claim.
    expect(remainders).toEqual({ onFile: 4, atVenue: 6 });
    expect(remainders!.onFile < remainders!.atVenue).toBe(true);

    expect(result.backwards).toEqual([{ id: "rung-1", known: 6, observed: 4 }]);
    expect(result.amended).toEqual([]);
  });
});

describe("partitionChangedClaims — the four-way split", () => {
  it("`amended` — a `quantity` difference, the one figure nothing may go stale on", () => {
    const amendment = claim("rung-1", { field: "quantity", known: 10, observed: 12 });
    const result = partitionChangedClaims([amendment], [resting("rung-1", 10)], [row("rung-1", 0, 12)]);
    expect(result.amended).toEqual([amendment]);
    expect(result.backwards).toEqual([]);
    expect(result.descriptors).toEqual([]);
    expect(result.restated).toEqual([]);
  });

  it("`backwards` — the export's filled column below what the file last observed", () => {
    const result = partitionChangedClaims(
      [claim("rung-1", filledDifference(6, 2))],
      [resting("rung-1", 4)],
      [row("rung-1", 2)],
    );
    expect(result.backwards).toEqual([{ id: "rung-1", known: 6, observed: 2 }]);
    expect(result.amended).toEqual([]);
  });

  it("`descriptors` — HOW the rung was placed differs, and no money moved", () => {
    const descriptor = claim("rung-1", { field: "timeInForce", known: "GTC", observed: "IOC" });
    const result = partitionChangedClaims([descriptor], [resting("rung-1", 4)], [row("rung-1", 6)]);
    expect(result.descriptors).toEqual([descriptor]);
    expect(result.amended).toEqual([]);
    expect(result.restated).toEqual([]);
  });

  it("`restated` — the fill moved UP and the file still claims NO LESS than the venue holds", () => {
    // Placed 10, observed 6 on file, the export showing 8. The venue still holds 2; the
    // file counts 4 resting, which is no less — so the restatement is safe to RECORD
    // rather than refuse.
    const result = partitionChangedClaims(
      [claim("rung-1", filledDifference(6, 8))],
      [resting("rung-1", 4)],
      [row("rung-1", 8)],
    );
    expect(result.restated).toEqual([{ id: "rung-1", known: 6, observed: 8 }]);
    expect(result.amended).toEqual([]);
    expect(result.backwards).toEqual([]);
  });

  it("`amended` — the fill moved UP but the fund's OWN bookings overtook it (#199)", () => {
    // The traced case the `resting` parameter exists for: the file holds placed 10 /
    // filled 6, the operator ran the fill flow and accepted the default remainder of 4,
    // retiring the rung — the file now counts ZERO resting — and the venue's export shows
    // filled 8, i.e. 2 units still resting. Calling that already known would leave the
    // file claiming LESS than the venue holds, which is #174's own hazard.
    const overtaken = claim("rung-1", filledDifference(6, 8));
    const result = partitionChangedClaims([overtaken], [], [row("rung-1", 8)]);
    expect(result.amended).toEqual([overtaken]);
    expect(result.restated).toEqual([]);
  });
});

describe("partitionChangedClaims — #205's routing, by hazard", () => {
  it("A `quantity` DIFFERENCE WINS over a descriptor on the same rung", () => {
    // A funding hazard outranks everything, so the rung is refused with today's token and
    // today's message whatever else the export also got wrong about it.
    const mixed = claim(
      "rung-1",
      { field: "quantity", known: 10, observed: 12 },
      { field: "orderType", known: "limit", observed: "market" },
    );
    const result = partitionChangedClaims([mixed], [resting("rung-1", 10)], [row("rung-1", 0, 12)]);
    expect(result.amended).toEqual([mixed]);
    expect(result.descriptors).toEqual([]);
  });

  it("A DESCRIPTOR DIFFERENCE WINS over a fill difference riding along on the same claim", () => {
    // Two things follow from taking it here. The wording the operator gets is accurate for
    // this claim, where `amended`'s cancel-the-rung remedy is not — no descriptor is in
    // `price × quantity`, so no funding hazard can exist. And the mixed claim cannot reach
    // the permissive per-rung skip: it must not be RECORDED beside a safe fill.
    const mixed = claim(
      "rung-1",
      filledDifference(6, 8),
      { field: "triggerPrice", known: 90, observed: 95 },
    );
    const result = partitionChangedClaims([mixed], [resting("rung-1", 4)], [row("rung-1", 8)]);
    expect(result.descriptors).toEqual([mixed]);
    expect(result.restated).toEqual([]);
    expect(result.amended).toEqual([]);
  });
});

describe("weighRemainders", () => {
  it("reads the venue's remainder off the row — `quantity − filledQuantity`", () => {
    expect(weighRemainders("rung-1", [resting("rung-1", 4)], [row("rung-1", 8)])).toEqual({
      onFile: 4,
      atVenue: 2,
    });
  });

  it("READS AN ID ABSENT FROM `resting` AS `0` — the stream already retired the claim", () => {
    // Not a missing case: absent means the rung's fills exhausted it or a cancellation
    // took it, and zero is the honest statement of what the file now counts against it.
    expect(weighRemainders("rung-1", [], [row("rung-1", 8)])).toEqual({ onFile: 0, atVenue: 2 });
  });

  it("returns `undefined` on a missing observed row rather than inventing a `0`", () => {
    // Unreachable for a `ChangedClaim` — every one of them is raised FROM an observed row
    // — and reported rather than defaulted, so a future caller that does not hold that
    // invariant cannot get a silently invented figure out of it.
    expect(weighRemainders("rung-1", [resting("rung-1", 4)], [])).toBeUndefined();
  });

  it("reads a row nothing has filled as claiming its whole size at the venue", () => {
    expect(weighRemainders("rung-1", [resting("rung-1", 10)], [row("rung-1", 0)])).toEqual({
      onFile: 10,
      atVenue: 10,
    });
  });
});
