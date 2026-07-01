// PROTOTYPE (mvi 2026-06-30-cash-settlement). Scenario-level behavior locks for the
// cash leg, split out of cash-settlement.test.ts to keep both files navigable: the
// durable-log migration/versioning contract, the real-shaped mixed-tier close, the
// deliberate un-marked-instrument gate-skip, and the cross-ref shadow equivalence
// guard. The core per-verb legs + seam + ingest gates live in cash-settlement.test.ts.
import {
  applyEventToReference,
  buildEventReference,
  crossReferenceEvent,
  EVENT_SCHEMA_VERSION,
  foldEvents,
  migrateLegacyEvent,
  parseEvent,
  reserveDeltasForClose,
  type FundReviewData,
  type PortfolioEvent,
} from "./index.js";
import {
  DECISION,
  genesis,
  realShapedGenesis,
  reserveById,
  tierQty,
} from "./cash-settlement.fixtures.js";
import { describe, expect, it } from "vitest";

// T1 (M1 / ADR-003 amendment): the durable-log migration/versioning contract. A
// legacy (pre-cash-leg / v1) open/close must fail loud with a defined migration
// path — never a silent quarantine that skews the fold — and the one-shot
// `migrateLegacyEvent` grafts an operator-supplied cash leg through the same v2 gate.
describe("durable-log versioning — a legacy open/close fails loud with a migration path", () => {
  /** A v1-shape close: a real record written before the cash leg existed. */
  const legacyClose = {
    id: "legacy-close-alt",
    asOf: "2026-06-03",
    type: "PositionClosed",
    positionId: "alt-pos",
  };
  /** A v1-shape open: no funding leg. */
  const legacyOpen = {
    id: "legacy-open-btc",
    asOf: "2026-06-02",
    type: "PositionOpened",
    position: {
      id: "btc-pos",
      portfolioId: "core",
      tempo: "Liquid",
      executionMode: "live",
      accountId: "venue",
      instrumentId: "btc-usd",
      direction: "long",
      currency: "USD",
      lots: [{ quantity: 1, cost: 200, tier: "c1" }],
    },
    decision: DECISION,
  };

  it("parseEvent rejects a legacy close (no settlement) and points at the migration", () => {
    const result = parseEvent(legacyClose);
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("settlement");
      expect(result.message).toMatch(/migrate/i);
    }
  });

  it("parseEvent rejects a legacy open (no funding) and points at the migration", () => {
    const result = parseEvent(legacyOpen);
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("funding");
      expect(result.message).toMatch(/migrate/i);
    }
  });

  it("parseEvent refuses a record tagged newer than this build supports", () => {
    const future = { ...legacyClose, schemaVersion: EVENT_SCHEMA_VERSION + 1, settlement: { reserveId: "tiered", proceeds: 360 } };
    const result = parseEvent(future);
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("schemaVersion");
      expect(result.message).toMatch(/newer than this build/i);
    }
  });

  it("accepts a current-version record carrying the schemaVersion marker", () => {
    const v2 = { ...legacyClose, schemaVersion: EVENT_SCHEMA_VERSION, settlement: { reserveId: "tiered", proceeds: 360 } };
    expect(parseEvent(v2).kind).toBe("ok");
  });

  it("migrateLegacyEvent grafts a supplied settlement onto a legacy close → a valid v2 event", () => {
    // alt-pos: qty 20 × last close (genesis markPrice) 40 → expected ≈ 800; 600 is
    // within the ±50% settlement-magnitude band, so the cross-ref gate accepts it.
    const result = migrateLegacyEvent(legacyClose, { settlement: { reserveId: "tiered", proceeds: 600 } });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.value.type === "PositionClosed") {
      expect(result.value.settlement).toEqual({ reserveId: "tiered", proceeds: 600 });
      // The migrated event then passes the same cross-ref gate every event faces.
      const reference = buildEventReference(genesis());
      expect(crossReferenceEvent(result.value, reference).kind).toBe("ok");
    }
  });

  it("migrateLegacyEvent grafts a supplied funding onto a legacy open → a valid v2 event", () => {
    const result = migrateLegacyEvent(legacyOpen, { funding: { reserveId: "tiered", amount: 200 } });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok" && result.value.type === "PositionOpened") {
      expect(result.value.funding).toEqual({ reserveId: "tiered", amount: 200 });
    }
  });

  it("migrateLegacyEvent rejects a leg that does not match the record's verb", () => {
    const result = migrateLegacyEvent(legacyClose, { funding: { reserveId: "tiered", amount: 200 } });
    expect(result.kind).toBe("event-error");
  });
});

// T4 (D2) + T5: lock proportional proceeds-tiering + loss-absorption on a
// real-shaped mixed-tier close, and lock the fee-residual-folded-into-the-split
// semantics as intended. gram-bitget-pulse cost basis: c1 2000×0.04 = 80,
// c2 1000×0.04 = 40 → total 120, weights 2/3 c1 and 1/3 c2. It settles into the
// three-tier pulse-bitget-usdt Reserve, so the per-Tier credit is observable
// (unlike an untiered USDT reserve that only moves `amount`).
describe("cash leg — mixed-tier close on a real-shaped fixture (T4)", () => {
  it("splits proceeds proportionally across the closed Tier mix; loss falls per Tier; aggregate exact", () => {
    // Proceeds 108 (net of fees) < basis 120 → a realized loss of 12. Split by the
    // 2/3 : 1/3 cost-basis weights: c1 gets 72 (lost 8), c2 gets 36 (lost 4). c3 is
    // not in the position, so it is untouched — coherent lineage, no laundering.
    const close: PortfolioEvent = {
      id: "close-gram",
      asOf: "2026-06-27",
      type: "PositionClosed",
      positionId: "gram-bitget-pulse",
      settlement: { reserveId: "pulse-bitget-usdt", proceeds: 108 },
    };

    // It is a genuinely ingestable event: the settlement-magnitude gate accepts it
    // (3000 units × last close 0.04 → expected 120; 108 is −10%, inside ±50%).
    const reference = buildEventReference(realShapedGenesis());
    expect(crossReferenceEvent(close, reference).kind).toBe("ok");

    const data = foldEvents(realShapedGenesis(), [close]);
    const reserve = reserveById(data, "pulse-bitget-usdt");

    // Aggregate exact: authoritative `amount` moves by exactly the proceeds.
    expect(reserve.amount).toBeCloseTo(1108, 6); // 1000 + 108

    // Per-Tier coherent: each risked Tier is credited its proportional share, and
    // the sum of the Tier credits equals the proceeds exactly (no drift).
    expect(tierQty(reserve, "c1")).toBeCloseTo(772, 6); // 700 + 72
    expect(tierQty(reserve, "c2")).toBeCloseTo(236, 6); // 200 + 36
    expect(tierQty(reserve, "c3")).toBeCloseTo(100, 6); // untouched — not in the position
    const creditedToTiers =
      tierQty(reserve, "c1") - 700 + (tierQty(reserve, "c2") - 200) + (tierQty(reserve, "c3") - 100);
    expect(creditedToTiers).toBeCloseTo(108, 6);

    // Loss-absorption: the 12 loss is borne per Tier in proportion to what each
    // risked (c1 lost 8 of its 80 basis, c2 lost 4 of its 40) — not dumped on one.
    expect(80 - (tierQty(reserve, "c1") - 700)).toBeCloseTo(8, 6);
    expect(40 - (tierQty(reserve, "c2") - 200)).toBeCloseTo(4, 6);

    expect(data.positions.some((position) => position.id === "gram-bitget-pulse")).toBe(false);
    // Untouched holdings survive the fold unchanged (real-shaped structure intact).
    expect(data.positions.some((position) => position.id === "render-bitget-pulse")).toBe(true);
    expect(data.positions.some((position) => position.id === "btc-xtb-wealth")).toBe(true);
  });

  it("folds the fee-residual into the proportional split rather than a separate line (T5)", () => {
    // Fee-residual semantics: fees are netted INTO `proceeds` before the split, so
    // the fee shrinks each Tier's credit in proportion — it is never carved out as
    // its own reserve line/Tier. Contrast the same close at gross (120) vs net
    // (108) proceeds: the 12 fee is absorbed as 8 on c1 and 4 on c2 (the 2/3 : 1/3
    // weights), and NO extra Tier appears.
    const gramLots = [
      { quantity: 2000, cost: 0.04, tier: "c1" as const },
      { quantity: 1000, cost: 0.04, tier: "c2" as const },
    ];
    const grossDeltas = reserveDeltasForClose(gramLots, 120); // no fee
    const netDeltas = reserveDeltasForClose(gramLots, 108); // 12 fee netted in

    const byTier = (deltas: { tier: string; amount: number }[], tier: string) =>
      deltas.find((delta) => delta.tier === tier)?.amount ?? 0;

    // The fee is spread across exactly the position's Tiers, by the same weights.
    expect(byTier(grossDeltas, "c1") - byTier(netDeltas, "c1")).toBeCloseTo(8, 6);
    expect(byTier(grossDeltas, "c2") - byTier(netDeltas, "c2")).toBeCloseTo(4, 6);

    // No separate "fee" line: the split carries only the Tiers the position risked.
    expect(netDeltas.map((delta) => delta.tier).sort()).toEqual(["c1", "c2"]);

    // And on the folded Reserve, the fee mints no extra lot — c3 stays exactly as
    // it was; the residual lives entirely inside the c1/c2 proportional credits.
    const close: PortfolioEvent = {
      id: "close-gram-net",
      asOf: "2026-06-27",
      type: "PositionClosed",
      positionId: "gram-bitget-pulse",
      settlement: { reserveId: "pulse-bitget-usdt", proceeds: 108 },
    };
    const reserve = reserveById(foldEvents(realShapedGenesis(), [close]), "pulse-bitget-usdt");
    expect(reserve.lots?.map((lot) => lot.tier).sort()).toEqual(["c1", "c2", "c3"]);
    expect(tierQty(reserve, "c3")).toBeCloseTo(100, 6);
  });
});

// T3 (D1): the deliberate settlement-magnitude gate-skip. The proceeds gate
// compares against expected = closed quantity × the instrument's last known
// close. When the instrument has no meaningful prior mark (`lastClose` absent, or
// a markPrice-0 sentinel → expected <= 0) there is no baseline, so the gate is
// SKIPPED and any proceeds is accepted. This is a scoped deferral (D1), not an
// oversight: it is only safe while every closeable instrument is guaranteed a
// prior mark. Locked here so the skip can't silently change behavior, and so the
// day that always-marked invariant weakens, this test is where the exposure shows.
describe("cash leg — un-marked-instrument close skips the settlement-magnitude gate (T3/D1)", () => {
  /** genesis() with the alt instrument left un-marked (markPrice 0) — expected
   * proceeds collapses to 0, so the magnitude gate has no baseline to check. */
  function genesisUnmarked(): FundReviewData {
    const base = genesis();
    return {
      ...base,
      positions: base.positions.map((position) => ({ ...position, markPrice: 0 })),
    };
  }

  it("accepts wildly-off proceeds on an un-marked instrument (gate skipped, D1)", () => {
    const reference = buildEventReference(genesisUnmarked());
    // 40× the ~800 a marked close would expect: on a MARKED instrument the gate
    // rejects this (see the fat-finger test above); with no prior mark it sails
    // through, un-sanity-checked. That is the deliberate, scoped gate-skip.
    const wildlyOff: PortfolioEvent = {
      id: "close-unmarked",
      asOf: "2026-06-02",
      type: "PositionClosed",
      positionId: "alt-pos",
      settlement: { reserveId: "tiered", proceeds: 32000 },
    };
    expect(crossReferenceEvent(wildlyOff, reference).kind).toBe("ok");
  });

  it("contrast: the SAME proceeds are rejected once the instrument carries a mark", () => {
    // Same event, same amount — the only difference is the marked genesis. This is
    // what makes the skip explicit: the gate's protection is contingent entirely on
    // the prior mark, exactly the always-marked invariant D1 is scoped to.
    const reference = buildEventReference(genesis());
    const wildlyOff: PortfolioEvent = {
      id: "close-marked",
      asOf: "2026-06-02",
      type: "PositionClosed",
      positionId: "alt-pos",
      settlement: { reserveId: "tiered", proceeds: 32000 },
    };
    const result = crossReferenceEvent(wildlyOff, reference);
    expect(result.kind).toBe("event-error");
    if (result.kind === "event-error") {
      expect(result.path).toBe("settlement.proceeds");
    }
  });
});

// Slice #87 (guard against mirror divergence). The cross-ref shadow
// `applyDeltasToBalance` deliberately re-implements the seam's per-Tier delta
// arithmetic so the sufficiency gate sees the balances the fold WILL produce.
// Two encodings of the same math now coexist: the fold mutates a `ReserveRecord`
// (authoritative `amount` + a lots array), the shadow mutates the cross-ref
// balance (`amount` + a Tier→quantity Map). The delta COMPUTATION is already
// shared (`reserveDeltasForOpen/Close` → `TierDelta[]`); the risk is the two
// APPLICATION encodings drifting. This batch equivalence check is the guard —
// fold a representative batch of all six verbs (a mixed-Tier close, an untiered
// amount-only move, and a mid-stream open+close among them) and assert, reserve
// by reserve, that the shadow's running balances equal the folded reserves. It
// fails loud the day one encoding is changed to disagree with the other.
describe("cash leg — the cross-ref shadow tracks the fold exactly (slice #87)", () => {
  const TIERS = ["c1", "c2", "c3"] as const;

  /** A representative batch touching every verb, in ascending-asOf order so the
   * fold's (asOf, then original order) sort is a no-op relative to input order.
   * The shadow applies in input order, so equal ordering keeps the two encodings
   * comparing the same sequence. */
  function batch(): PortfolioEvent[] {
    return [
      { id: "dep-tiered", asOf: "2026-06-02", type: "Deposit", reserveId: "tiered", amount: 250, tier: "c1" },
      {
        id: "open-btc",
        asOf: "2026-06-03",
        type: "PositionOpened",
        position: {
          id: "btc-pos",
          portfolioId: "core",
          tempo: "Liquid",
          executionMode: "live",
          accountId: "venue",
          instrumentId: "btc-usd",
          direction: "long",
          currency: "USD",
          // Mixed Tiers so the open debit splits across c1/c2 (weights 2:1).
          lots: [
            { quantity: 1, cost: 200, tier: "c1" },
            { quantity: 1, cost: 100, tier: "c2" },
          ],
        },
        decision: DECISION,
        funding: { reserveId: "tiered", amount: 300 },
      },
      { id: "wd-tiered", asOf: "2026-06-04", type: "Withdraw", reserveId: "tiered", amount: 100, tier: "c2" },
      {
        id: "xfer-tiered-untiered",
        asOf: "2026-06-05",
        type: "Transfer",
        fromReserveId: "tiered",
        toReserveId: "untiered",
        amount: 150,
        tier: "c1",
      },
      // Mixed-Tier close of a genesis position (proceeds split c1 25% / c2 75%).
      { id: "close-alt", asOf: "2026-06-06", type: "PositionClosed", positionId: "alt-pos", settlement: { reserveId: "tiered", proceeds: 360 } },
      // Untiered credit: moves `amount` only, mints no Tier — the null-tiers path.
      { id: "dep-untiered", asOf: "2026-06-07", type: "Deposit", reserveId: "untiered", amount: 100, tier: "c3" },
      // Close a position opened earlier in the SAME batch (both encodings must
      // have learned btc-pos' lots mid-stream to settle it).
      { id: "close-btc", asOf: "2026-06-08", type: "PositionClosed", positionId: "btc-pos", settlement: { reserveId: "tiered", proceeds: 300 } },
    ];
  }

  it("every folded reserve equals the shadow's running balance, per amount and per Tier", () => {
    const events = batch();

    // The fold's encoding: mutate a `ReserveRecord` (amount + lots array).
    const folded = foldEvents(genesis(), events);

    // The shadow's encoding: advance the cross-ref balances exactly as the
    // sufficiency gate does across a batch (amount + Tier Map).
    const reference = buildEventReference(genesis());
    for (const event of events) {
      applyEventToReference(reference, event);
    }

    // Sanity: the batch actually moved cash, so the guard is not vacuous.
    expect(reserveById(folded, "tiered").amount).not.toBe(1500);

    for (const reserve of folded.reserves) {
      const shadow = reference.reserveBalances.get(reserve.id);
      expect(shadow).toBeDefined();
      if (!shadow) continue;

      // Authoritative `amount` agrees (float tolerance for the proportional splits).
      expect(shadow.amount).toBeCloseTo(reserve.amount, 6);

      if (reserve.lots) {
        // Tiered reserve: the shadow is tiered too, and every Tier's quantity agrees.
        expect(shadow.tiers).not.toBeNull();
        for (const tier of TIERS) {
          expect(shadow.tiers?.get(tier) ?? 0).toBeCloseTo(tierQty(reserve, tier), 6);
        }
      } else {
        // Untiered reserve: the shadow tracks `amount` only (no Tier map) — matching.
        expect(shadow.tiers).toBeNull();
      }
    }

    // The reverse: the shadow holds no reserve the fold dropped (same reserve set).
    expect(reference.reserveBalances.size).toBe(folded.reserves.length);
  });
});
