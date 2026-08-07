/**
 * THE DECLARATION PROMPT'S RULES, ASSERTED DIRECTLY — the reason the cluster left
 * `import-orders.ts` (#223).
 *
 * EVERY ASSERTION HERE NAMES A MUTATION THAT SURVIVED THE WHOLE 1298-TEST SUITE. Eight
 * were applied to the real source and re-run against every test in the repo, not just
 * `import-orders.test.ts`; seven lived. They are named `M1`–`M8` below, beside the
 * assertion that now kills each:
 *
 *   - `M1` whitelist → any-non-empty        → "declines on every answer that is not y/yes"
 *   - `M2` drop the `"yes"` spelling        → the `"yes"` / `"YES"` / `" yes "` cases
 *   - `M3` drop `.trim().toLowerCase()`     → the `"Y"` / `"YES"` / `" yes "` cases
 *   - `M4` drop the `answer !== batch` guard → "an answer equal to the batch is NOT an override"
 *   - `M5` drop `.trim()` on the batch      → "trims the batch answer"
 *   - `M6` drop `describe(order)`           → the exact per-order prompt string
 *   - `M7` drop the `[batch]` default hint  → the exact per-order prompt string
 *   - `M8` gut `describe()` to a constant   → the five field-by-field prompt assertions
 *
 * `M8` is the one worth stating plainly: `describe` could be replaced by the constant
 * `"an order"` and all 1298 tests stayed green. The function that shows the operator WHICH
 * RUNG they are about to re-fund was held by nothing.
 *
 * THIS IS NOT A PURE FUNCTION and the apparatus below is honest about it: `declareFunding`
 * awaits the operator, so it takes a scripted-answer stub. What it cannot be handed is an
 * export file, a sidecar, a temp dir, a frozen clock or a fund review — the parameter is
 * the ASK CHANNEL, one function, so "this reads nothing but the prompt channel" is a
 * compile-time fact rather than a trap this file has to lay and hope something springs.
 */
import type { BitgetOpenOrder } from "@numisma/engine";
import { describe, expect, it } from "vitest";
import { declareFunding } from "./import-orders-funding-declaration.js";

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

/**
 * An `ask` that replays a script and records what it was asked. An UNSCRIPTED prompt
 * throws rather than returning a blank, so a mutation that asks one question too many
 * fails loudly instead of being read as an empty answer.
 */
function scriptedAsk(answers: readonly string[]): {
  ask: (question: string) => Promise<string>;
  asked: string[];
} {
  const asked: string[] = [];
  const remaining = [...answers];
  return {
    asked,
    ask: async (question: string) => {
      asked.push(question);
      const next = remaining.shift();
      if (next === undefined) {
        throw new Error(`unscripted prompt: ${question}`);
      }
      return next;
    },
  };
}

const BATCH_QUESTION = "Funding reserve for this batch: ";
const OVERRIDE_QUESTION = "Override the funding reserve for any individual order? [y/N] ";

describe("the batch answer", () => {
  it("is the declared reserve, and a declined override pass leaves no overrides", async () => {
    const { ask, asked } = scriptedAsk(["reserve-a", "n"]);
    expect(await declareFunding(ask, [order()])).toEqual({
      fundingReserveId: "reserve-a",
      overrides: {},
    });
    // The two questions, in this order, and NO per-order pass.
    expect(asked).toEqual([BATCH_QUESTION, OVERRIDE_QUESTION]);
  });

  it("is TRIMMED — surrounding whitespace is not part of the reserve id (`M5`)", async () => {
    const { ask } = scriptedAsk(["  reserve-a  ", "n"]);
    expect(await declareFunding(ask, [order()])).toEqual({
      fundingReserveId: "reserve-a",
      overrides: {},
    });
  });

  it("declares nothing when blank, and does not go on to ask about overrides", async () => {
    const { ask, asked } = scriptedAsk([""]);
    expect(await declareFunding(ask, [order()])).toBeUndefined();
    expect(asked).toEqual([BATCH_QUESTION]);
  });

  it("declares nothing when it is only whitespace", async () => {
    const { ask, asked } = scriptedAsk(["   "]);
    expect(await declareFunding(ask, [order()])).toBeUndefined();
    expect(asked).toEqual([BATCH_QUESTION]);
  });
});

/**
 * The override question is a yes/no, and the whitelist is the rule — `M1`, `M2` and `M3`
 * all live here. Each case is read off the OBSERVABLE consequence: an affirmative answer
 * opens the per-order pass, so the prompt count is what says whether the answer was read
 * as yes.
 */
describe("the override question's answer", () => {
  const AFFIRMATIVE = ["y", "yes", "Y", "YES", " yes ", "  Y  ", "Yes"];
  const DECLINING = ["", " ", "n", "no", "N", "NO", "yeah", "yep", "1", "true", "ok", "sure"];

  for (const answer of AFFIRMATIVE) {
    it(`opens the per-order pass on ${JSON.stringify(answer)} (\`M2\`, \`M3\`)`, async () => {
      const { ask, asked } = scriptedAsk(["reserve-a", answer, ""]);
      await declareFunding(ask, [order()]);
      expect(asked).toHaveLength(3);
    });
  }

  for (const answer of DECLINING) {
    it(`declines the per-order pass on ${JSON.stringify(answer)} (\`M1\`)`, async () => {
      const { ask, asked } = scriptedAsk(["reserve-a", answer]);
      expect(await declareFunding(ask, [order()])).toEqual({
        fundingReserveId: "reserve-a",
        overrides: {},
      });
      expect(asked).toEqual([BATCH_QUESTION, OVERRIDE_QUESTION]);
    });
  }
});

describe("the per-order override pass", () => {
  /**
   * THE THREE INTERACTIONS IN ONE PASS (#223 item 3) — an override, a blank fallthrough
   * and an answer equal to the batch, so the guards are exercised together rather than one
   * per fixture. The end-to-end test at `import-orders.test.ts:1743` exercises only the
   * first two, which is exactly why `M4` survived.
   *
   * AND `M4` COULD ONLY EVER BE KILLED HERE, at the map. `buildOrderPlacedRecords` reads
   * `overrides?.[order.id] ?? fundingReserveId`, so a redundant entry writes the identical
   * record and no end-to-end test over the written file can see the difference. This
   * assertion is over the map's MEANING — a key is a dissent — not over an output.
   */
  it("records the dissenting rung only — blank falls through, equal-to-batch is NOT an override (`M4`)", async () => {
    const orders = [
      order({ id: "rung-1" }),
      order({ id: "rung-2" }),
      order({ id: "rung-3" }),
      order({ id: "rung-4" }),
    ];
    const { ask } = scriptedAsk(["reserve-a", "y", "reserve-b", "", "reserve-a", "  reserve-c  "]);

    expect(await declareFunding(ask, orders)).toEqual({
      fundingReserveId: "reserve-a",
      // `rung-2` answered blank and `rung-3` answered the batch back: a redundant override
      // is not an override, and neither appears as a key.
      overrides: { "rung-1": "reserve-b", "rung-4": "reserve-c" },
    });
  });

  it("keys the overrides by `order.id` and asks once per order, in order", async () => {
    const orders = [order({ id: "rung-1" }), order({ id: "rung-2" })];
    const { ask, asked } = scriptedAsk(["reserve-a", "y", "reserve-b", "reserve-c"]);

    const declaration = await declareFunding(ask, orders);
    expect(Object.keys(declaration?.overrides ?? {})).toEqual(["rung-1", "rung-2"]);
    expect(asked).toHaveLength(4);
  });

  it("asks nothing per order when the batch has no orders", async () => {
    const { ask, asked } = scriptedAsk(["reserve-a", "y"]);
    expect(await declareFunding(ask, [])).toEqual({
      fundingReserveId: "reserve-a",
      overrides: {},
    });
    expect(asked).toEqual([BATCH_QUESTION, OVERRIDE_QUESTION]);
  });
});

/**
 * THE PROMPT ITSELF — `M6`, `M7` and `M8`. The operator is being asked to re-fund a
 * SPECIFIC rung, so the prompt must say which rung and what happens if they just press
 * return. Neither was held by anything: the rung's description could be deleted outright,
 * replaced by a constant, or stripped of its default hint, and the suite stayed green.
 */
describe("the per-order prompt", () => {
  async function promptFor(subject: BitgetOpenOrder): Promise<string> {
    const { ask, asked } = scriptedAsk(["reserve-a", "y", ""]);
    await declareFunding(ask, [subject]);
    return asked[2] as string;
  }

  it("renders the rung AND the batch default, exactly (`M6`, `M7`)", async () => {
    expect(await promptFor(order())).toBe(
      "  BTCUSDT buy 0.5 @ 1000 (2026-08-07T10:00:00) [reserve-a]: ",
    );
  });

  it("carries the SYMBOL (`M8`)", async () => {
    expect(await promptFor(order({ symbol: "ETHUSDT" }))).toContain("ETHUSDT");
  });

  it("carries the SIDE (`M8`)", async () => {
    expect(await promptFor(order({ side: "sell" }))).toContain("sell");
  });

  it("carries the QUANTITY (`M8`)", async () => {
    expect(await promptFor(order({ quantity: 0.125 }))).toContain("0.125");
  });

  it("carries the PRICE (`M8`)", async () => {
    expect(await promptFor(order({ price: 64321.5 }))).toContain("64321.5");
  });

  it("carries the `observedAt` STAMP (`M8`)", async () => {
    expect(await promptFor(order({ observedAt: "2031-12-25T23:59:59" }))).toContain(
      "2031-12-25T23:59:59",
    );
  });

  it("carries the BATCH ANSWER as the default hint, not a hard-coded one (`M7`)", async () => {
    const { ask, asked } = scriptedAsk(["reserve-zulu", "y", ""]);
    await declareFunding(ask, [order()]);
    expect(asked[2]).toContain("[reserve-zulu]");
  });
});
