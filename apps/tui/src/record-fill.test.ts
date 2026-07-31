// Spec testing decision 10 / `O2` — THE FILL ACT IS ALL-OR-NOTHING, plus the two deltas
// the increment's real success signal is made of.
//
// Locked here:
//   - a failure at the SECOND write (the sidecar) rolls the FIRST (the log) back, so
//     neither the `orderFilled` line nor the Position event is on disk;
//   - a failure at the FIRST write leaves neither, trivially, and is asserted anyway
//     because "the other direction" is exactly the assumption that rots;
//   - every refusal BEFORE the writes leaves both files byte-identical;
//   - after a confirmed fill, committed drops by EXACTLY that rung (the DELTA, `O6`) and
//     the funding reserve is debited by EXACTLY the funding amount and no more;
//   - the first fill on a ladder OPENS the Position with five authored decision fields and
//     no plan behind it; a subsequent fill APPENDS to that same Position;
//   - the torn-act detector finds the named crash window in both directions.
//
// EVERY FIXTURE IS A SYNTHETIC LADDER (`O7`). Invented instrument, round decade prices,
// round balances. No real price, quantity, balance, rung or Tempo percentage appears here.
import { describe, expect, it } from "vitest";
import {
  buildCompositionReport,
  committedRungs,
  foldEvents,
  parseFundReview,
  pickRestingOrdersAsOf,
  reconcileFillActs,
  serializeOrderRecord,
  parseOrderRecord,
  type FundReviewData,
  type OrderRecord,
  type PortfolioEvent,
} from "@numisma/engine";
import type { OrdersLoad } from "@numisma/preferences";
import { recordFill, type RecordFillIo, type RecordFillOutcome } from "./record-fill.js";

const ORDERS_PATH = "/synthetic/orders.jsonl";
const EVENTS_PATH = "/synthetic/events.jsonl";

/** A synthetic fund: one portfolio, one account, one instrument, one tiered reserve. */
function genesisSeed(): FundReviewData {
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
    reserves: [
      {
        id: "reserve-synthetic",
        portfolioId: "portfolio-synthetic",
        tempo: "Capital",
        executionMode: "live",
        accountId: "account-synthetic",
        currency: "USD",
        amount: 10000,
        lots: [{ quantity: 10000, tier: "c1" }],
      },
    ],
    positions: [],
  });
  if (parsed.kind !== "ok") {
    throw new Error(`synthetic genesis is invalid: ${JSON.stringify(parsed)}`);
  }
  return parsed.value;
}

/** A descending synthetic ladder of three rungs, all against the one reserve. */
function ladderRecords(): OrderRecord[] {
  return [400, 300, 200].map((price) => ({
    id: `rung-${price}`,
    observedAt: "2026-01-02T09:00:00",
    kind: "orderPlaced" as const,
    currency: "USD" as const,
    symbol: "TEST/USD",
    side: "buy" as const,
    price,
    quantity: 10,
    fundingReserveId: "reserve-synthetic",
  }));
}

/** An in-memory pair of files plus a switch for failing one named write. */
class Harness {
  ordersImage: string;
  logImage: string | undefined;
  failWrite: "log" | "orders" | "orders-and-rollback" | undefined;
  readonly out: string[] = [];
  readonly err: string[] = [];
  private readonly answers: string[];

  constructor(options: {
    records?: OrderRecord[];
    events?: PortfolioEvent[];
    answers: string[];
    failWrite?: "log" | "orders" | "orders-and-rollback";
  }) {
    this.ordersImage = (options.records ?? ladderRecords())
      .map((record) => `${serializeOrderRecord(record)}\n`)
      .join("");
    const events = options.events ?? [];
    this.logImage =
      events.length === 0
        ? undefined
        : events.map((event) => `${JSON.stringify({ schemaVersion: 2, ...event })}\n`).join("");
    this.answers = [...options.answers];
    this.failWrite = options.failWrite;
  }

  get io(): RecordFillIo {
    return {
      ordersPath: ORDERS_PATH,
      eventsPath: EVENTS_PATH,
      loadOrders: async (): Promise<OrdersLoad> => ({
        status: "loaded",
        path: ORDERS_PATH,
        records: this.orderRecords(),
        skips: [],
      }),
      appendOrders: async (_path, records) => {
        if (this.failWrite === "orders" || this.failWrite === "orders-and-rollback") {
          throw new Error("synthetic sidecar write failure");
        }
        const prefix =
          this.ordersImage.length > 0 && !this.ordersImage.endsWith("\n") ? "\n" : "";
        this.ordersImage = `${this.ordersImage}${prefix}${records
          .map((record) => serializeOrderRecord(record))
          .join("\n")}\n`;
      },
      readLogImage: async () => this.logImage,
      writeLogImage: async (contents) => {
        if (this.failWrite === "log") {
          throw new Error("synthetic log write failure");
        }
        this.logImage = contents;
      },
      restoreLogImage: async (prior) => {
        if (this.failWrite === "orders-and-rollback") {
          throw new Error("synthetic rollback failure");
        }
        this.logImage = prior;
      },
      loadGenesis: async () => genesisSeed(),
      loadLogEvents: async () => this.logEvents(),
      loadFolded: async () => foldEvents(genesisSeed(), this.logEvents()),
      ask: async () => this.answers.shift() ?? "",
      out: (message) => this.out.push(message),
      err: (message) => this.err.push(message),
    };
  }

  orderRecords(): OrderRecord[] {
    const records: OrderRecord[] = [];
    for (const line of this.ordersImage.split("\n")) {
      if (!line.trim()) continue;
      const parsed = parseOrderRecord(JSON.parse(line));
      if (parsed.status !== "ok") throw new Error(`bad synthetic order line: ${line}`);
      records.push(parsed.record);
    }
    return records;
  }

  logEvents(): PortfolioEvent[] {
    if (this.logImage === undefined) return [];
    return this.logImage
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const { schemaVersion: _schemaVersion, ...event } = JSON.parse(line) as Record<
          string,
          unknown
        >;
        return event as unknown as PortfolioEvent;
      });
  }

  committedFor(reserveId: string): number {
    return committedRungs(pickRestingOrdersAsOf(this.orderRecords()))
      .filter((rung) => rung.fundingReserveId === reserveId)
      .reduce((total, rung) => total + rung.committed, 0);
  }

  reserveAmount(reserveId: string): number {
    const folded = foldEvents(genesisSeed(), this.logEvents());
    return folded.reserves.find((reserve) => reserve.id === reserveId)?.amount ?? 0;
  }

  navUsd(): number {
    const folded = foldEvents(genesisSeed(), this.logEvents());
    return buildCompositionReport(folded).totals.fundValueUsd;
  }
}

/**
 * The full happy-path answer sequence for opening the ladder's Position on the TOP rung.
 * Order mirrors the prompts in `recordFill`.
 */
function openTopRungAnswers(): string[] {
  return [
    "rung-400", // which rung filled
    "2026-01-05T12:00:00", // fill timestamp
    "", // filled quantity — defaults to the whole remaining claim
    "r", // rung-300 still resting untouched
    "r", // rung-200 still resting untouched
    "y", // confirm the derived verdicts
    "position-synthetic", // position id (first fill opens)
    "", // tempo — accept the funding reserve's
    "synthetic entry thesis", // the five authored decision fields
    "synthetic invalidation condition",
    "synthetic risk budget",
    "synthetic horizon",
    "synthetic strategy",
    "", // cash debited — accept price x quantity
    "y", // write BOTH
  ];
}

function expectRecorded(outcome: RecordFillOutcome) {
  if (outcome.status !== "recorded") {
    throw new Error(`expected a recorded act, got ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

describe("the fill act is ALL-OR-NOTHING across both files", () => {
  it("rolls the LOG back when the SIDECAR write fails — neither half lands", async () => {
    const harness = new Harness({ answers: openTopRungAnswers(), failWrite: "orders" });
    const ordersBefore = harness.ordersImage;
    const logBefore = harness.logImage;

    const outcome = await recordFill(harness.io);

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected a rejection");
    expect(outcome.reason).toBe("write-failed");
    // The log was written FIRST and must be restored byte-for-byte to its prior image.
    expect(harness.logImage).toBe(logBefore);
    expect(harness.ordersImage).toBe(ordersBefore);
    // And no half-act is discoverable on either side.
    expect(reconcileFillActs(harness.logEvents(), harness.orderRecords())).toEqual([]);
  });

  it("leaves both files untouched when the LOG write fails — the other direction", async () => {
    const harness = new Harness({ answers: openTopRungAnswers(), failWrite: "log" });
    const ordersBefore = harness.ordersImage;
    const logBefore = harness.logImage;

    const outcome = await recordFill(harness.io);

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected a rejection");
    expect(outcome.reason).toBe("write-failed");
    expect(harness.logImage).toBe(logBefore);
    expect(harness.ordersImage).toBe(ordersBefore);
  });

  it("names the unrepairable state loudly when the ROLLBACK itself fails", async () => {
    const harness = new Harness({ answers: openTopRungAnswers(), failWrite: "orders-and-rollback" });
    const outcome = await recordFill(harness.io);
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected a rejection");
    expect(outcome.reason).toBe("rollback-failed");
    // It does NOT claim an atomicity it has not got: the message says exactly what is on
    // disk and what the operator must do.
    expect(outcome.message).toContain("still resting");
    expect(outcome.message).toContain("by hand");
  });

  it("writes NOTHING when the operator declines the final confirmation", async () => {
    const answers = openTopRungAnswers();
    answers[answers.length - 1] = "n";
    const harness = new Harness({ answers });
    const ordersBefore = harness.ordersImage;
    const logBefore = harness.logImage;

    const outcome = await recordFill(harness.io);

    expect(outcome.status).toBe("abandoned");
    expect(harness.logImage).toBe(logBefore);
    expect(harness.ordersImage).toBe(ordersBefore);
  });

  it("writes NOTHING when the derived verdicts are not confirmed (`O3`)", async () => {
    const answers = openTopRungAnswers();
    answers[5] = "n"; // decline the verdict confirmation
    const harness = new Harness({ answers });
    const ordersBefore = harness.ordersImage;
    const logBefore = harness.logImage;

    const outcome = await recordFill(harness.io);

    expect(outcome.status).toBe("abandoned");
    expect(harness.logImage).toBe(logBefore);
    expect(harness.ordersImage).toBe(ordersBefore);
  });
});

describe("a confirmed fill: the two deltas", () => {
  it("drops committed by EXACTLY that rung and debits the reserve by EXACTLY the funding", async () => {
    const harness = new Harness({ answers: openTopRungAnswers() });
    const committedBefore = harness.committedFor("reserve-synthetic");
    const reserveBefore = harness.reserveAmount("reserve-synthetic");
    const navBefore = harness.navUsd();

    const outcome = expectRecorded(await recordFill(harness.io));
    const funding = outcome.act.event.funding.amount;

    // `O6` — the DELTA, not the state. The rung's own encumbrance was 400 x 10.
    expect(committedBefore - harness.committedFor("reserve-synthetic")).toBe(400 * 10);
    // The cash leg moves the reserve by exactly the funding amount and no more.
    expect(reserveBefore - harness.reserveAmount("reserve-synthetic")).toBe(funding);
    expect(funding).toBe(400 * 10);
    // ...and NAV is CONSERVED: the cash became an asset marked at what was paid for it.
    // A fill moves capital between shapes; it does not create or destroy any.
    expect(harness.navUsd()).toBeCloseTo(navBefore, 9);
  });

  it("leaves the other rungs' encumbrance untouched", async () => {
    const harness = new Harness({ answers: openTopRungAnswers() });
    await recordFill(harness.io);
    const remaining = committedRungs(pickRestingOrdersAsOf(harness.orderRecords()));
    expect(remaining.map((rung) => rung.orderId)).toEqual(["rung-300", "rung-200"]);
  });

  it("agrees across the two files — no torn act after a clean write", async () => {
    const harness = new Harness({ answers: openTopRungAnswers() });
    await recordFill(harness.io);
    expect(reconcileFillActs(harness.logEvents(), harness.orderRecords())).toEqual([]);
  });
});

describe("one Position per ladder — first fill OPENS, every fill after APPENDS", () => {
  it("opens the Position with the five authored decision fields and NO plan behind it", async () => {
    const harness = new Harness({ answers: openTopRungAnswers() });
    const outcome = expectRecorded(await recordFill(harness.io));
    expect(outcome.act.event.type).toBe("PositionOpened");
    if (outcome.act.event.type !== "PositionOpened") throw new Error("expected an open");
    expect(outcome.act.event.decision).toEqual({
      entryThesis: "synthetic entry thesis",
      invalidationCondition: "synthetic invalidation condition",
      riskBudget: "synthetic risk budget",
      plannedHoldingHorizon: "synthetic horizon",
      strategy: "synthetic strategy",
    });
    // The lot's tier was READ from the funding reserve, never re-decided here.
    expect(outcome.act.event.position.lots[0]?.tier).toBe("c1");
  });

  it("appends the SECOND fill to that same Position with its own funding leg", async () => {
    const first = new Harness({ answers: openTopRungAnswers() });
    expectRecorded(await recordFill(first.io));

    const second = new Harness({
      records: first.orderRecords(),
      events: first.logEvents(),
      answers: [
        "rung-300",
        "2026-01-06T12:00:00",
        "",
        "r", // rung-200 still resting untouched below
        "y", // confirm the verdicts
        "", // append to the ladder's existing Position (default yes)
        "", // cash debited — accept price x quantity
        "y", // write BOTH
      ],
    });
    const outcome = expectRecorded(await recordFill(second.io));

    expect(outcome.act.event.type).toBe("PositionAddedTo");
    if (outcome.act.event.type !== "PositionAddedTo") throw new Error("expected an add");
    expect(outcome.act.event.positionId).toBe("position-synthetic");
    expect(outcome.act.event.funding.amount).toBe(300 * 10);
    // Still ONE Position on the ladder — a Position is one decision.
    const folded = foldEvents(genesisSeed(), second.logEvents());
    expect(folded.positions.map((position) => position.id)).toEqual(["position-synthetic"]);
  });
});

describe("monotonicity refuses BEFORE any write", () => {
  it("refuses a fill the operator's own described book derives as CANCELLED", async () => {
    // The operator claims the BOTTOM rung filled while saying the two above still rest
    // untouched. A fill there would have had to trade through them.
    const harness = new Harness({
      answers: [
        "rung-200",
        "2026-01-05T12:00:00",
        "",
        "r", // rung-400 untouched
        "r", // rung-300 untouched
        "y",
        "y",
      ],
    });
    const ordersBefore = harness.ordersImage;
    const logBefore = harness.logImage;

    const outcome = await recordFill(harness.io);

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected a rejection");
    expect(outcome.reason).toBe("verdict-contradicts-operator");
    expect(harness.logImage).toBe(logBefore);
    expect(harness.ordersImage).toBe(ordersBefore);
  });

  it("refuses an IMPOSSIBLE book loudly, writing nothing", async () => {
    // rung-200 is reported TOUCHED while rung-400 and rung-300 rest untouched above it.
    // That is not a gap — the venue is stating the price reached the lower rung.
    const harness = new Harness({
      answers: [
        "rung-400",
        "2026-01-05T12:00:00",
        "5", // a partial on the top rung, so it stays on the book
        "r", // rung-300 untouched
        "t", // rung-200 touched
        "3", //   filled_quantity observed
        "y",
      ],
    });
    const ordersBefore = harness.ordersImage;

    const outcome = await recordFill(harness.io);

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected a rejection");
    expect(outcome.reason).toBe("impossible-verdict");
    expect(harness.ordersImage).toBe(ordersBefore);
    expect(harness.logImage).toBeUndefined();
  });
});

describe("the named crash window is DETECTABLE", () => {
  it("finds a lot whose orderFilled line never landed", async () => {
    const harness = new Harness({ answers: openTopRungAnswers(), failWrite: "orders" });
    await recordFill(harness.io);
    // Simulate the hard kill the rollback exists to avoid: the log write landed, the
    // sidecar write did not, and no rollback ran.
    const torn = reconcileFillActs(
      [
        {
          id: "fill:rung-400@2026-01-05T12:00:00",
          asOf: "2026-01-05",
          type: "PositionAddedTo",
          positionId: "position-synthetic",
          lot: { quantity: 10, cost: 400, tier: "c1" },
          funding: { reserveId: "reserve-synthetic", amount: 4000 },
        },
      ],
      harness.orderRecords(),
    );
    expect(torn).toEqual([
      {
        kind: "lot-without-fill",
        orderId: "rung-400",
        observedAt: "2026-01-05T12:00:00",
        eventId: "fill:rung-400@2026-01-05T12:00:00",
      },
    ]);
  });

  it("finds an orderFilled line whose lot never landed — the reverse direction", () => {
    const torn = reconcileFillActs(
      [],
      [
        ...ladderRecords(),
        {
          id: "rung-400",
          observedAt: "2026-01-05T12:00:00",
          kind: "orderFilled",
          currency: "USD",
          filledQuantity: 10,
        },
      ],
    );
    expect(torn).toEqual([
      {
        kind: "fill-without-lot",
        orderId: "rung-400",
        observedAt: "2026-01-05T12:00:00",
        eventId: "fill:rung-400@2026-01-05T12:00:00",
      },
    ]);
  });

  it("refuses to record a new fill while a torn act is outstanding", async () => {
    const harness = new Harness({
      answers: openTopRungAnswers(),
      records: [
        ...ladderRecords(),
        {
          id: "rung-400",
          observedAt: "2026-01-05T12:00:00",
          kind: "orderFilled",
          currency: "USD",
          filledQuantity: 10,
        },
      ],
    });
    const outcome = await recordFill(harness.io);
    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected a rejection");
    expect(outcome.reason).toBe("torn-fill-act");
  });
});
