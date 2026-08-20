/**
 * THE PICK-LIST'S RULES, ASSERTED DIRECTLY (#286) — the second prompted declaration at
 * import, and the one that must never make the operator read or type a UUID.
 *
 * IT TAKES THE PROMPT CHANNEL, NOT THE IO BAG, exactly as `declareFunding` does and for
 * the reason that module's header records: `ask` is the only thing it reads, and the
 * compiler holds that rather than a stub whose other members throw on touch.
 *
 * WHAT THESE ASSERTIONS EXIST TO KILL — each mutation applied to the real source and this
 * file re-run (fix reverted, red for the named reason, fix restored):
 *
 *   - `M-N` treat a blank batch answer as a REFUSAL → "one Enter accepts the whole batch"
 *   - `M-O` prompt even with no ladder in force     → "asks nothing at all when no ladder…"
 *   - `M-P` render the planId in a prompt           → "never shows the operator a plan id"
 *   - `M-Q` drop the `0) none` choice / ignore it   → "an override can decline the join…"
 *   - `M-R` accept an out-of-range or unreadable pick as the default
 *                                                   → "re-asks rather than guessing…"
 *   - `M-S` write a pick for an order with no proposal on the batch path
 *                                                   → "an order with no proposal is written
 *                                                      with no pick"
 *   - `M-T` drop the spoken-for check, so one rung is proposed to every order sharing its
 *           price → both "a rung is proposed to at most one order" tests, the first with
 *           two orders carrying the same pick and the second re-proposing a rung already
 *           declared on file
 *   - `M-U` report an AMBIGUOUS price as "no rung declared at this price" again
 *                                                   → "distinguishes an AMBIGUOUS price
 *                                                      from a price no rung declares"
 *
 * Every ladder, price and id here is SYNTHESIZED: invented round figures and a counted,
 * obviously-fake UUID that is stable across runs.
 */
import type { BitgetOpenOrder, InForceLadder, RungPick } from "@numisma/engine";
import { describe, expect, it } from "vitest";
import { declareRungPicks } from "./import-orders-rung-picks.js";
import { UNANSWERED, type Answer } from "./prompt-channel.js";

const PLAN_A = "00000000-0000-4000-8000-00000000000a";
const PLAN_B = "00000000-0000-4000-8000-00000000000b";

const LADDERS: InForceLadder[] = [
  {
    planId: PLAN_A,
    positionId: "pos-a",
    effectiveAt: "2026-08-01",
    rungs: [
      { id: "rung-1", priceUsd: 1000, sizeUsd: 250 },
      { id: "rung-2", priceUsd: 900, sizeUsd: 250 },
    ],
  },
];

function order(overrides: Partial<BitgetOpenOrder> = {}): BitgetOpenOrder {
  return {
    id: "order-1",
    observedAt: "2026-08-07T10:00:00",
    currency: "USD",
    symbol: "BTCUSDT",
    side: "buy",
    price: 1000,
    quantity: 0.5,
    filledQuantity: 0,
    totalQuantity: 0.5,
    timeInForce: "gtc",
    orderType: "limit",
    triggerPrice: null,
    ...overrides,
  };
}

/** An `ask` that replays a script and records what it was asked; an unscripted prompt throws. */
function scriptedAsk(answers: readonly Answer[]): {
  ask: (question: string) => Promise<Answer>;
  asked: string[];
} {
  const asked: string[] = [];
  const remaining = [...answers];
  return {
    asked,
    ask: async (question: string): Promise<Answer> => {
      asked.push(question);
      const next = remaining.shift();
      if (next === undefined) {
        throw new Error(`unscripted prompt: ${question}`);
      }
      return next;
    },
  };
}

/**
 * The picks, unwrapped — every case below drives a pass that COMPLETES.
 *
 * `declareRungPicks` returns an outcome rather than a bare map since #388, because a pass
 * that was abandoned mid-interview has no picks to report and used to be indistinguishable
 * from a pass that picked nothing. The abandonment arm is asserted directly in its own
 * describe at the bottom; everywhere else the wrapper keeps the assertion on the picks,
 * which is what those cases are about, and turns an unexpected abandonment into a loud
 * failure rather than a silently empty map.
 */
async function picksFrom(
  ...args: Parameters<typeof declareRungPicks>
): Promise<Record<string, RungPick>> {
  const outcome = await declareRungPicks(...args);
  if (outcome.status !== "picked") {
    throw new Error(`the pass abandoned at: ${outcome.question}`);
  }
  return outcome.picks;
}

describe("the batch pass — the happy path is one Enter", () => {
  it("one Enter accepts the whole batch of proposals", async () => {
    const { ask, asked } = scriptedAsk([""]);
    const picks = await picksFrom(ask, [order()], LADDERS);
    expect(picks).toEqual({ "order-1": { planId: PLAN_A, rungId: "rung-1" } });
    // ONE question, and only one: a batch the operator accepts costs a single keystroke.
    expect(asked).toHaveLength(1);
  });

  it("shows every order beside the rung its price matched, before asking", async () => {
    const { ask, asked } = scriptedAsk([""]);
    await picksFrom(
      ask,
      [order(), order({ id: "order-2", price: 900 }), order({ id: "order-3", price: 850 })],
      LADDERS,
    );
    const question = asked[0] ?? "";
    expect(question).toContain("BTCUSDT buy 0.5 @ 1000 (2026-08-07T10:00:00)");
    expect(question).toContain("pos-a 2026-08-01 · rung at 1000 (size 250)");
    expect(question).toContain("pos-a 2026-08-01 · rung at 900 (size 250)");
    // The unmatched rung says so rather than being silently dropped from the list.
    expect(question).toContain("no rung declared at this price");
    expect(question.endsWith("Accept all? [Y/n] ")).toBe(true);
  });

  it("an order with no proposal is written with no pick — the legacy path, not an error", async () => {
    const { ask } = scriptedAsk([""]);
    const picks = await picksFrom(ask, [order({ id: "order-x", price: 850 })], LADDERS);
    expect(picks).toEqual({});
  });

  it("asks nothing at all when no ladder is in force", async () => {
    const { ask, asked } = scriptedAsk([]);
    expect(await picksFrom(ask, [order()], [])).toEqual({});
    expect(asked).toEqual([]);
  });

  it("never shows the operator a plan id — not in the batch pass, not in an override", async () => {
    const { ask, asked } = scriptedAsk(["n", ""]);
    await picksFrom(ask, [order()], LADDERS);
    expect(asked).not.toHaveLength(0);
    for (const question of asked) {
      expect(question).not.toContain(PLAN_A);
      expect(question.toLowerCase()).not.toContain("planid");
    }
  });
});

/**
 * ONE RUNG STANDS FOR ONE ORDER. The proposal pass used to call `proposeRungByPrice` per
 * order with no notion of a rung already spoken for, so two orders at one price both got
 * the same pick and one Enter wrote the same declared join onto two durable lines — the
 * second of which then joins to nothing at all, silently.
 */
describe("a rung is proposed to at most one order", () => {
  it("does not propose one rung to two orders at the same price", async () => {
    const { ask, asked } = scriptedAsk([""]);
    const picks = await picksFrom(
      ask,
      [order(), order({ id: "order-2", price: 1000 })],
      LADDERS,
    );

    expect(picks).toEqual({ "order-1": { planId: PLAN_A, rungId: "rung-1" } });
    // And the second order is TOLD why, rather than silently losing its proposal.
    expect(asked[0]).toContain("already proposed to another order in this batch");
  });

  it("does not re-propose a rung an order already on file has declared", async () => {
    // Across imports, not just within one: the pick-list used to read no order book at
    // all, so a rung declared by a line on disk was proposed again to a re-placed order.
    const { ask, asked } = scriptedAsk([""]);
    const picks = await picksFrom(ask, [order()], LADDERS, [
      { planId: PLAN_A, rungId: "rung-1" },
    ]);

    expect(picks).toEqual({});
    expect(asked[0]).toContain("already declared by an order on file");
  });
});

describe("the prompt says WHICH silence it is reporting", () => {
  it("distinguishes an AMBIGUOUS price from a price no rung declares", async () => {
    // `proposeRungByPrice` answers `undefined` to both, correctly — but reporting an
    // ambiguity as "no rung declared at this price" tells the operator there is nothing
    // to override in the one case where they most need to.
    const twoAt1000: InForceLadder[] = [
      ...LADDERS,
      {
        planId: PLAN_B,
        positionId: "pos-b",
        effectiveAt: "2026-07-01",
        rungs: [{ id: "rung-1", priceUsd: 1000, sizeUsd: 500 }],
      },
    ];
    const { ask, asked } = scriptedAsk([""]);
    await picksFrom(ask, [order(), order({ id: "order-2", price: 850 })], twoAt1000);

    expect(asked[0]).toContain("2 ladders declare a rung at this price");
    expect(asked[0]).toContain("no rung declared at this price");
  });
});

describe("the override pass — any rung of any in-force ladder, or none", () => {
  const TWO_LADDERS: InForceLadder[] = [
    ...LADDERS,
    {
      planId: PLAN_B,
      positionId: "pos-b",
      effectiveAt: "2026-07-01",
      rungs: [{ id: "rung-1", priceUsd: 800, sizeUsd: 500 }],
    },
  ];

  it("declining the batch offers every rung of every ladder, numbered", async () => {
    const { ask, asked } = scriptedAsk(["n", "3"]);
    const picks = await picksFrom(ask, [order()], TWO_LADDERS);
    const question = asked[1] ?? "";
    expect(question).toContain("1) pos-a 2026-08-01 · rung at 1000 (size 250)");
    expect(question).toContain("2) pos-a 2026-08-01 · rung at 900 (size 250)");
    expect(question).toContain("3) pos-b 2026-07-01 · rung at 800 (size 500)");
    // A rung of ANOTHER ladder is pickable, which is the whole reason the id travels with
    // the rung rather than the batch.
    expect(picks).toEqual({ "order-1": { planId: PLAN_B, rungId: "rung-1" } });
  });

  it("a blank line keeps the proposal, so a dissent costs one line and agreement costs none", async () => {
    const { ask, asked } = scriptedAsk(["n", ""]);
    expect(await picksFrom(ask, [order()], LADDERS)).toEqual({
      "order-1": { planId: PLAN_A, rungId: "rung-1" },
    });
    // The default is shown, or a blank line means something the operator cannot see.
    expect(asked[1]).toContain("[1]");
  });

  it("an override can decline the join entirely, and `none` is the default with no proposal", async () => {
    const declined = scriptedAsk(["n", "0"]);
    expect(await picksFrom(declined.ask, [order()], LADDERS)).toEqual({});

    const unproposed = scriptedAsk(["n", ""]);
    expect(
      await picksFrom(unproposed.ask, [order({ price: 850 })], LADDERS),
    ).toEqual({});
    expect(unproposed.asked[1]).toContain("[none]");
  });

  it("accepts a pick whose declared price differs from the order's own price", async () => {
    // ALLOWED, and flagged by the report rather than refused here: the operator is
    // permitted to know something the price match does not.
    const { ask } = scriptedAsk(["n", "2"]);
    expect(await picksFrom(ask, [order({ price: 1000 })], LADDERS)).toEqual({
      "order-1": { planId: PLAN_A, rungId: "rung-2" },
    });
  });

  it("re-asks rather than guessing when the answer is not a choice", async () => {
    const { ask, asked } = scriptedAsk(["n", "banana", "9", "2"]);
    expect(await picksFrom(ask, [order()], LADDERS)).toEqual({
      "order-1": { planId: PLAN_A, rungId: "rung-2" },
    });
    // Four prompts: the batch, then the pick asked three times. A guess here would write
    // a durable join nobody declared.
    expect(asked).toHaveLength(4);
  });

  it("asks once per order, in the batch's own order", async () => {
    const { ask, asked } = scriptedAsk(["n", "", "0"]);
    const picks = await picksFrom(
      ask,
      [order(), order({ id: "order-2", price: 900 })],
      LADDERS,
    );
    expect(picks).toEqual({ "order-1": { planId: PLAN_A, rungId: "rung-1" } });
    expect(asked).toHaveLength(3);
    expect(asked[1]).toContain("BTCUSDT buy 0.5 @ 1000");
    expect(asked[2]).toContain("BTCUSDT buy 0.5 @ 900");
  });

  it("still lets an OVERRIDE take a rung the proposal pass would not offer", async () => {
    // A claim on file is a reason not to INFER a join; it is not a reason to refuse the
    // operator one. Re-placing a rung whose earlier order was cancelled is ordinary, and
    // a permanent block on an append-only claim would make it unreachable forever.
    const { ask } = scriptedAsk(["n", "1"]);
    const picks = await picksFrom(ask, [order()], LADDERS, [
      { planId: PLAN_A, rungId: "rung-1" },
    ]);
    expect(picks).toEqual({ "order-1": { planId: PLAN_A, rungId: "rung-1" } });
  });

  it("takes y/yes as acceptance, in any case and with any surrounding space", async () => {
    for (const answer of ["y", "Y", "yes", " YES "]) {
      const { ask, asked } = scriptedAsk([answer]);
      expect(await picksFrom(ask, [order()], LADDERS)).toEqual({
        "order-1": { planId: PLAN_A, rungId: "rung-1" },
      });
      expect(asked).toHaveLength(1);
    }
  });
});

/**
 * BOTH QUESTIONS HERE RATIFY, WHICH IS WHY #388 REACHED THEM (#370's second door).
 *
 * `Accept all? [Y/n]` reads a blank as ACCEPT EVERY PROPOSAL — the reason the happy path
 * is one Enter, and the reason an abandoned terminal used to write a declared
 * `planId`/`rungId` join onto every rung of the batch. The per-order prompt reads a blank
 * as KEEP THE PROPOSAL, inside a `for(;;)` that re-asks until the answer is a choice: an
 * unanswered question there would either spin forever or ratify, depending on which branch
 * it fell into. Neither happens now.
 */
describe("a question that was never answered (#388)", () => {
  it("abandons the batch pass rather than accepting every proposal on screen", async () => {
    const { ask, asked } = scriptedAsk([UNANSWERED]);

    const outcome = await declareRungPicks(ask, [order()], LADDERS);

    expect(outcome).toEqual({
      status: "abandoned",
      question: "whether to accept the proposed rung picks",
    });
    // One question, and the override pass was never opened.
    expect(asked).toHaveLength(1);
  });

  it("still accepts every proposal on a real blank — one Enter is unchanged", async () => {
    const { ask } = scriptedAsk([""]);

    expect(await picksFrom(ask, [order()], LADDERS)).toEqual({
      "order-1": { planId: PLAN_A, rungId: "rung-1" },
    });
  });

  it("abandons the override loop rather than keeping the proposal or spinning", async () => {
    const { ask, asked } = scriptedAsk(["n", UNANSWERED]);

    const outcome = await declareRungPicks(ask, [order()], LADDERS);

    expect(outcome.status).toBe("abandoned");
    // The message names the rung — the loop is per order, so "the override pass" would not
    // tell the operator where it stopped.
    expect(outcome.status === "abandoned" && outcome.question).toContain("BTCUSDT");
    // TWO questions: the loop did not re-ask a terminal that cannot answer.
    expect(asked).toHaveLength(2);
  });
});
