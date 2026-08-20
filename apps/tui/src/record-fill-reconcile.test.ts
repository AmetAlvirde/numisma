// `S1` + `S1a` + `S3` — THE ADVISORY RECONCILE AND THE BEST-EFFORT TRAIL APPEND (#336).
//
// The one binding constraint underneath every case here: **a plans problem must never
// refuse a real observed fill, never fail one, and never roll one back** (`D1`). Every
// test below therefore asserts the fill LANDED — the outcome, both files, the exit path —
// alongside whatever the trail did.
//
// Locked here:
//   - a tier mismatch reached BOTH of its two real routes (a derived tier from a reserve
//     the plan never declared, and a tier the operator typed at the untiered-reserve
//     prompt), and the fill lands on both;
//   - one line per fill, CLEAN OR WARNED (`D7`) — the clean case has its own test,
//     because a mismatch-only implementation passes every warned test;
//   - `declared.status: "pending"` on a `PositionOpened` fill, which is what pins the
//     PRE-fill existing-position set;
//   - `isIsoCalendarDate` cleared BEFORE the selector (`S1a`), asserted by a SPY on
//     `pickPlanAsOf` rather than inferred from the absence of a crash;
//   - every trail failure — a throwing plans read, a load-failed sidecar, an
//     unrenderable `positionId`, a throwing append — degrading to a loud warn while the
//     act's outcome stays byte-for-byte what it is without this slice;
//   - the append sitting AFTER the act is durable and OUTSIDE the rollback, in both
//     directions: a throwing append leaves the log and the sidecar at their post-act
//     state with no rollback, and a failing orders append writes NO trail line at all.
//
// EVERY FIXTURE IS AUTHORED. Invented instrument, round decade prices, round balances,
// synthetic ids. No real price, quantity, balance, rung or plan appears here.
import { describe, expect, it, vi } from "vitest";
import {
  foldEvents,
  parseFundReview,
  parseOrderRecord,
  serializeOrderRecord,
  type CapitalTier,
  type FundReviewData,
  type LoadedPlans,
  type OrderRecord,
  type PlanRecord,
  type PortfolioEvent,
  type ReconciliationRecord,
} from "@numisma/engine";
import type { OrdersLoad } from "@numisma/preferences";
import { UNANSWERED } from "./prompt-channel.js";

// The spy `S1a` is asserted with. It wraps the REAL selector and delegates to it, so
// every other test in this file exercises production behaviour unchanged; the only thing
// it adds is a count, which is the one fact "the selector is never called" needs.
const { pickPlanAsOfCalls } = vi.hoisted(() => ({ pickPlanAsOfCalls: [] as unknown[][] }));
vi.mock("@numisma/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@numisma/engine")>();
  return {
    ...actual,
    pickPlanAsOf: (...args: Parameters<typeof actual.pickPlanAsOf>) => {
      pickPlanAsOfCalls.push(args);
      return actual.pickPlanAsOf(...args);
    },
  };
});

const { reconcileRecordedFill, recordFill } = await import("./record-fill.js");
type RecordFillIo = import("./record-fill.js").RecordFillIo;
type RecordFillOutcome = import("./record-fill.js").RecordFillOutcome;

const ORDERS_PATH = "/synthetic/orders.jsonl";
const EVENTS_PATH = "/synthetic/events.jsonl";
const PLANS_PATH = "/synthetic/plans.jsonl";
const TRAIL_PATH = "/synthetic/reconciliations.jsonl";
/** THE TELLING — injected, so no test reads the wall clock. Explicit offset, per `F1`. */
const TOLD_AT = "2026-01-05T18:07:00-06:00";

const TIERED_RESERVE = "reserve-tiered-synthetic";
const UNTIERED_RESERVE = "reserve-untiered-synthetic";

/**
 * A synthetic fund with TWO reserves, which is what makes both routes to a wrong tier
 * reachable: one reserve holds a single tier and DERIVES it, the other holds no lots at
 * all and so reaches the prompt the operator can mistype (`record-fill-funding.ts:140`).
 */
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
        id: TIERED_RESERVE,
        portfolioId: "portfolio-synthetic",
        tempo: "Capital",
        executionMode: "live",
        accountId: "account-synthetic",
        currency: "USD",
        amount: 10000,
        lots: [{ quantity: 10000, tier: "c1" }],
      },
      {
        id: UNTIERED_RESERVE,
        portfolioId: "portfolio-synthetic",
        tempo: "Capital",
        executionMode: "live",
        accountId: "account-synthetic",
        currency: "USD",
        amount: 10000,
        // NO `lots` key at all — an empty array is refused by the parser, and it is the
        // ABSENCE that makes `deriveFundingTier` return `untiered` and reach the prompt.
      },
    ],
    positions: [],
  });
  if (parsed.kind !== "ok") {
    throw new Error(`synthetic genesis is invalid: ${JSON.stringify(parsed)}`);
  }
  return parsed.value;
}

/** A descending synthetic ladder of three rungs against one named reserve. */
function ladderRecords(fundingReserveId: string): OrderRecord[] {
  // The ids are NAMES, not prices: the fill's `BaseEvent.id` is derived from the rung id,
  // so an id spelling out a figure would put one onto the trail line through the back door.
  return [
    { id: "rung-top", price: 400 },
    { id: "rung-middle", price: 300 },
    { id: "rung-bottom", price: 200 },
  ].map(({ id, price }) => ({
    id,
    observedAt: "2026-01-02T09:00:00",
    kind: "orderPlaced" as const,
    currency: "USD" as const,
    symbol: "TEST/USD",
    side: "buy" as const,
    price,
    quantity: 10,
    fundingReserveId,
  }));
}

/** A synthetic ladder plan for one position, declaring exactly the tiers named. */
function ladderPlan(positionId: string, tierOrder: CapitalTier[]): PlanRecord {
  return {
    kind: "dcaLadder",
    positionId,
    effectiveAt: "2026-01-01",
    // Authored, and deliberately holding no digit run that any figure in this file also
    // spells — so the no-figures assertion below tests the trail rather than a collision.
    id: "9f1c2b64-1111-4111-8111-de5061111111",
    tierOrder,
    // Authored rungs, never copied onto a trail line — `declared` excludes them by rule.
    rungs: [{ id: "r1", priceUsd: 400, sizeUsd: 4000 }],
  };
}

/** The explicit terminator — `D3`'s second mismatch kind. */
function terminator(positionId: string): PlanRecord {
  return { kind: "noPlan", positionId, effectiveAt: "2026-01-01", reason: "synthetic" };
}

function loadedPlans(records: PlanRecord[]): LoadedPlans {
  return {
    load: { status: "loaded", sourcePath: PLANS_PATH },
    plans: records.map((record, index) => ({ ...record, line: index + 1 })),
    skipped: [],
  };
}

function unreadablePlans(): LoadedPlans {
  return {
    load: { status: "load-failed", sourcePath: PLANS_PATH, message: "synthetic read failure" },
    plans: [],
    skipped: [],
  };
}

interface HarnessOptions {
  answers: string[];
  fundingReserveId?: string;
  /** What the plans read returns — or a thrown error, which the fill must survive. */
  plans?: LoadedPlans | "throws";
  failWrite?: "orders";
  failAppendReconciliation?: boolean;
}

/** An in-memory pair of durable files, an in-memory trail, and one injectable clock. */
class Harness {
  ordersImage: string;
  logImage: string | undefined;
  readonly out: string[] = [];
  readonly err: string[] = [];
  /** Every trail line this run appended, in order — `D7` is counted here. */
  readonly appended: ReconciliationRecord[] = [];
  private readonly answers: string[];
  private readonly options: HarnessOptions;

  constructor(options: HarnessOptions) {
    this.options = options;
    this.ordersImage = ladderRecords(options.fundingReserveId ?? TIERED_RESERVE)
      .map((record) => `${serializeOrderRecord(record)}\n`)
      .join("");
    this.logImage = undefined;
    this.answers = [...options.answers];
  }

  get io(): RecordFillIo {
    return {
      ordersPath: ORDERS_PATH,
      eventsPath: EVENTS_PATH,
      plansPath: PLANS_PATH,
      reconciliationsPath: TRAIL_PATH,
      loadOrders: async (): Promise<OrdersLoad> => ({
        status: "loaded",
        path: ORDERS_PATH,
        records: this.orderRecords(),
        skips: [],
      }),
      appendOrders: async (_path, records) => {
        if (this.options.failWrite === "orders") {
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
        this.logImage = contents;
      },
      restoreLogImage: async (prior) => {
        this.rolledBack = true;
        this.logImage = prior;
      },
      loadGenesis: async () => genesisSeed(),
      loadLogEvents: async () => this.logEvents(),
      // `.data` per PRD #323: `loadFolded` now hands the act the fund data alone, the
      // fold's discard envelope having been reported by the shell before the interview.
      loadFolded: async () => foldEvents(genesisSeed(), this.logEvents()).data,
      loadPlans: async () => {
        if (this.options.plans === "throws") {
          throw new Error("synthetic plans read failure");
        }
        return this.options.plans ?? loadedPlans([]);
      },
      appendReconciliation: async (_path, record) => {
        if (this.options.failAppendReconciliation) {
          throw new Error("synthetic trail append failure");
        }
        this.appended.push(record);
      },
      toldAt: () => TOLD_AT,
      // An exhausted script answers `UNANSWERED` — what the real channel gives when there
      // is nobody to ask — rather than `""`, which would take the next default (#388).
      ask: async () => this.answers.shift() ?? UNANSWERED,
      out: (message) => this.out.push(message),
      err: (message) => this.err.push(message),
    };
  }

  /** Set by `restoreLogImage` — the one witness that the ROLLBACK ran. */
  rolledBack = false;

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
}

/**
 * The full answer sequence for opening a ladder Position on the TOP rung, against a
 * reserve whose tier is DERIVED. Order mirrors the prompts in `recordFill`.
 */
function openTopRungAnswers(positionId = "position-synthetic"): string[] {
  return [
    "rung-top", // which rung filled
    "2026-01-05T12:00:00", // fill timestamp
    "", // filled quantity — the whole remaining claim
    "r", // rung-middle still resting untouched
    "r", // rung-bottom still resting untouched
    "y", // confirm the derived verdicts
    positionId, // position id (the first fill OPENS)
    "", // tempo — accept the funding reserve's
    "synthetic entry thesis",
    "synthetic invalidation condition",
    "synthetic risk budget",
    "synthetic horizon",
    "synthetic strategy",
    "", // cash debited — accept price x quantity
    "y", // write BOTH
  ];
}

/** The same sequence against the UNTIERED reserve, where the operator TYPES the tier. */
function untieredAnswers(typedTier: string, positionId = "position-synthetic"): string[] {
  const answers = openTopRungAnswers(positionId);
  // The tier prompt sits between `Cash debited` and `Write BOTH?`.
  answers.splice(answers.length - 1, 0, typedTier);
  return answers;
}

function expectRecorded(outcome: RecordFillOutcome) {
  if (outcome.status !== "recorded") {
    throw new Error(`expected a recorded act, got ${JSON.stringify(outcome)}`);
  }
  return outcome;
}

/** The ONE trail line this run wrote — `D7`'s "one line per fill", counted. */
function onlyLine(harness: Harness): ReconciliationRecord {
  expect(harness.appended).toHaveLength(1);
  const [record] = harness.appended;
  if (!record) throw new Error("expected exactly one trail record");
  return record;
}

describe("the reconcile is ADVISORY — the fill lands on every plans condition (`D1`)", () => {
  it("warns and records a tier the plan never declared, drawn from the reserve", async () => {
    // The reserve holds `c1` and derives it; the plan declares `c2` only. This is the
    // first of the two real routes to a wrong tier: funding from a reserve the plan
    // never declared.
    const harness = new Harness({
      answers: openTopRungAnswers(),
      plans: loadedPlans([ladderPlan("position-synthetic", ["c2"])]),
    });

    const outcome = expectRecorded(await recordFill(harness.io));

    // THE FILL LANDED, and its own exit path is untouched.
    expect(outcome.act.event.type).toBe("PositionOpened");
    expect(harness.logImage).toContain("PositionOpened");
    expect(harness.ordersImage).toContain("orderFilled");
    expect(harness.rolledBack).toBe(false);

    // The warning is loud, and names the mismatch without quoting a figure.
    expect(harness.err.join("\n")).toContain("PLAN MISMATCH");
    expect(harness.err.join("\n")).toContain("position-synthetic");

    const line = onlyLine(harness);
    expect(line.mismatches).toEqual(["tierNotInPlan"]);
    expect(line.lotTier).toBe("c1");
    expect(line.eventId).toBe(outcome.act.event.id);
    expect(line.fillKind).toBe("PositionOpened");
    expect(line.asOf).toBe("2026-01-05");
    expect(line.toldAt).toBe(TOLD_AT);
    if (line.declared.status !== "pending") {
      throw new Error(`expected a pending declaration, got ${line.declared.status}`);
    }
    expect(line.declared.tierOrder).toEqual(["c2"]);
  });

  it("warns and records a tier the operator MISTYPED at the untiered prompt", async () => {
    // The second route, and the one the derivation cannot catch: the reserve holds no
    // lots, so `record-fill-funding.ts` asks, and the answer is a tier the plan does not
    // declare. Nothing about the reserve is wrong here — only the typing.
    const harness = new Harness({
      answers: untieredAnswers("c3"),
      fundingReserveId: UNTIERED_RESERVE,
      plans: loadedPlans([ladderPlan("position-synthetic", ["c1", "c2"])]),
    });

    const outcome = expectRecorded(await recordFill(harness.io));

    expect(outcome.act.event.type).toBe("PositionOpened");
    expect(harness.logImage).toContain("PositionOpened");
    expect(harness.ordersImage).toContain("orderFilled");

    const line = onlyLine(harness);
    expect(line.lotTier).toBe("c3");
    expect(line.mismatches).toEqual(["tierNotInPlan"]);
    if (line.declared.status !== "pending") {
      throw new Error(`expected a pending declaration, got ${line.declared.status}`);
    }
    expect(line.declared.tierOrder).toEqual(["c1", "c2"]);
  });

  it("writes a line for a CLEAN fill too, and prints no warning (`D7`)", async () => {
    // A mismatch-only implementation passes every test above and fails this one, which
    // is exactly why it exists: absence of a line has to MEAN something.
    const harness = new Harness({
      answers: openTopRungAnswers(),
      plans: loadedPlans([ladderPlan("position-synthetic", ["c1", "c2"])]),
    });

    expectRecorded(await recordFill(harness.io));

    const line = onlyLine(harness);
    expect(line.mismatches).toEqual([]);
    expect(line.lotTier).toBe("c1");
    expect(harness.err).toEqual([]);
  });

  it("records `pending` on the fill that OPENS the position — the PRE-fill set", async () => {
    // The position does not exist when the reconcile is handed its inputs, because the
    // set comes from the fold as it stood BEFORE this act. Passing the post-fill set
    // would make this `active`, so this assertion is what pins the ordering.
    const harness = new Harness({
      answers: openTopRungAnswers(),
      plans: loadedPlans([ladderPlan("position-synthetic", ["c1"])]),
    });

    expectRecorded(await recordFill(harness.io));

    const line = onlyLine(harness);
    expect(line.declared.status).toBe("pending");
    expect(line.fillKind).toBe("PositionOpened");
  });

  it("warns and records `noPlanInForce` for a `noPlan` terminator", async () => {
    const harness = new Harness({
      answers: openTopRungAnswers(),
      plans: loadedPlans([terminator("position-synthetic")]),
    });

    expectRecorded(await recordFill(harness.io));

    const line = onlyLine(harness);
    expect(line.mismatches).toEqual(["noPlanInForce"]);
    expect(line.declared).toEqual({ status: "ended", effectiveAt: "2026-01-01" });
    expect(harness.err.join("\n")).toContain("PLAN MISMATCH");
  });

  it("warns and records `noPlanInForce` when the sidecar names no plan at all", async () => {
    const harness = new Harness({
      answers: openTopRungAnswers(),
      plans: loadedPlans([ladderPlan("some-other-position", ["c1"])]),
    });

    expectRecorded(await recordFill(harness.io));

    const line = onlyLine(harness);
    expect(line.mismatches).toEqual(["noPlanInForce"]);
    expect(line.declared).toEqual({ status: "none" });
  });

  it("records INDETERMINATE, never clean, when `plans.jsonl` is unreadable", async () => {
    const harness = new Harness({
      answers: openTopRungAnswers(),
      plans: unreadablePlans(),
    });

    expectRecorded(await recordFill(harness.io));

    const line = onlyLine(harness);
    // Empty `mismatches` and NOT clean — the two fields carry the verdict together.
    expect(line.mismatches).toEqual([]);
    expect(line.declared).toEqual({ status: "unreadable" });
    expect(harness.err.join("\n")).toContain("could not be read");
  });

  it("survives a plans read that THROWS — the fill is recorded, the line is unreadable", async () => {
    const harness = new Harness({ answers: openTopRungAnswers(), plans: "throws" });

    expectRecorded(await recordFill(harness.io));

    expect(harness.logImage).toContain("PositionOpened");
    expect(harness.ordersImage).toContain("orderFilled");
    expect(onlyLine(harness).declared).toEqual({ status: "unreadable" });
  });
});

describe("the trail append is AFTER the act and OUTSIDE the rollback (`D6`)", () => {
  it("leaves the act untouched when the trail append throws — no rollback, still recorded", async () => {
    const harness = new Harness({
      answers: openTopRungAnswers(),
      plans: loadedPlans([ladderPlan("position-synthetic", ["c1"])]),
      failAppendReconciliation: true,
    });

    const outcome = await recordFill(harness.io);

    expect(outcome.status).toBe("recorded");
    // Both halves of the act are exactly where the act left them.
    expect(harness.logImage).toContain("PositionOpened");
    expect(harness.ordersImage).toContain("orderFilled");
    // And the rollback — the act's own repair — never ran.
    expect(harness.rolledBack).toBe(false);
    expect(harness.appended).toEqual([]);
    expect(harness.err.join("\n")).toContain("TRAIL NOT RECORDED");
  });

  it("writes NO trail line at all when the ORDERS append fails and the log rolls back", async () => {
    const harness = new Harness({
      answers: openTopRungAnswers(),
      plans: loadedPlans([ladderPlan("position-synthetic", ["c2"])]),
      failWrite: "orders",
    });

    const outcome = await recordFill(harness.io);

    expect(outcome.status).toBe("rejected");
    if (outcome.status !== "rejected") throw new Error("expected a rejection");
    expect(outcome.reason).toBe("write-failed");
    expect(harness.rolledBack).toBe(true);
    expect(harness.logImage).toBeUndefined();
    // A telling for a fill that is not on disk would be the worse defect.
    expect(harness.appended).toEqual([]);
  });

  it("warns rather than appending when `positionId` is not renderable", async () => {
    // The id is operator-typed, and it travels onto the plans report page. The serializer
    // REFUSES one that could forge a row; the fill path checks first so it never catches.
    const harness = new Harness({
      answers: openTopRungAnswers("p".repeat(65)),
      plans: loadedPlans([]),
    });

    const outcome = await recordFill(harness.io);

    expect(outcome.status).toBe("recorded");
    expect(harness.appended).toEqual([]);
    expect(harness.err.join("\n")).toContain("TRAIL NOT RECORDED");
  });
});

describe("`S1a` — the calendar guard is cleared BEFORE the selector, never by catching", () => {
  it("never calls `pickPlanAsOf` on a lax `asOf`, and records it as unreadable", async () => {
    // `isObservedAtStamp` already round-trips the date half, so this arm is unreachable
    // through the prompts — it is a TYPE-LEVEL gap (`BaseEvent.asOf` is plain `string`),
    // which is why the reconcile is driven directly here.
    pickPlanAsOfCalls.length = 0;
    const appended: ReconciliationRecord[] = [];
    const err: string[] = [];

    await reconcileRecordedFill(
      {
        plansPath: PLANS_PATH,
        reconciliationsPath: TRAIL_PATH,
        loadPlans: async () => loadedPlans([ladderPlan("position-synthetic", ["c1"])]),
        appendReconciliation: async (_path, record) => {
          appended.push(record);
        },
        toldAt: () => TOLD_AT,
        err: (message) => err.push(message),
      },
      {
        positionId: "position-synthetic",
        eventId: "evt-synthetic-0001",
        fillKind: "PositionOpened",
        asOf: "2026-02-30", // shape-valid, calendar-invalid: it SORTS as February
        lotTier: "c1",
        existingPositionIds: new Set<string>(),
      },
    );

    expect(pickPlanAsOfCalls).toEqual([]);
    expect(appended).toHaveLength(1);
    expect(appended[0]?.declared).toEqual({ status: "unreadable" });
    expect(appended[0]?.mismatches).toEqual([]);
  });

  it("DOES call the selector on a strict `asOf` — the guard is not a blanket refusal", async () => {
    pickPlanAsOfCalls.length = 0;
    const appended: ReconciliationRecord[] = [];

    await reconcileRecordedFill(
      {
        plansPath: PLANS_PATH,
        reconciliationsPath: TRAIL_PATH,
        loadPlans: async () => loadedPlans([ladderPlan("position-synthetic", ["c1"])]),
        appendReconciliation: async (_path, record) => {
          appended.push(record);
        },
        toldAt: () => TOLD_AT,
        err: () => undefined,
      },
      {
        positionId: "position-synthetic",
        eventId: "evt-synthetic-0002",
        fillKind: "PositionAddedTo",
        asOf: "2026-01-31",
        lotTier: "c1",
        existingPositionIds: new Set(["position-synthetic"]),
      },
    );

    expect(pickPlanAsOfCalls).toHaveLength(1);
    expect(appended[0]?.declared.status).toBe("active");
    expect(appended[0]?.mismatches).toEqual([]);
  });
});

describe("a DEAD error sink still returns normally — the fill is already durable", () => {
  /**
   * The scenario: `pnpm record-fill 2>&1 | head`. The operator closes the pager after
   * the confirmation, so `process.stderr.write` starts throwing EPIPE. The fill is on
   * disk already. If the reconcile's last-resort warn re-enters the dead sink and lets
   * that throw escape, `recordFill` never returns and the CLI exits 1 for a fill that
   * fully landed — which is exactly the outcome `D1` exists to make unreachable.
   */
  const deadSink = () => {
    throw new Error("EPIPE: broken pipe, write");
  };

  it("returns rather than rejecting when `err` throws on a WARNED fill", async () => {
    // The mismatch warn is the first `io.err`, and it throws; the catch then reaches
    // for the same sink to say so.
    await expect(
      reconcileRecordedFill(
        {
          plansPath: PLANS_PATH,
          reconciliationsPath: TRAIL_PATH,
          loadPlans: async () => loadedPlans([]),
          appendReconciliation: async () => undefined,
          toldAt: () => TOLD_AT,
          err: deadSink,
        },
        {
          positionId: "position-synthetic",
          eventId: "evt-synthetic-0003",
          fillKind: "PositionOpened",
          asOf: "2026-01-31",
          lotTier: "c1",
          existingPositionIds: new Set<string>(),
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("returns when `err` throws on the unrenderable-positionId path too", async () => {
    // That path calls the warn DIRECTLY rather than through the catch, so a guard
    // placed only in the catch handler would leave this one throwing.
    await expect(
      reconcileRecordedFill(
        {
          plansPath: PLANS_PATH,
          reconciliationsPath: TRAIL_PATH,
          loadPlans: async () => loadedPlans([]),
          appendReconciliation: async () => undefined,
          toldAt: () => TOLD_AT,
          err: deadSink,
        },
        {
          positionId: "position\nsynthetic",
          eventId: "evt-synthetic-0004",
          fillKind: "PositionOpened",
          asOf: "2026-01-31",
          lotTier: "c1",
          existingPositionIds: new Set<string>(),
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("returns when `err` throws and the APPEND throws as well", async () => {
    await expect(
      reconcileRecordedFill(
        {
          plansPath: PLANS_PATH,
          reconciliationsPath: TRAIL_PATH,
          loadPlans: async () => loadedPlans([ladderPlan("position-synthetic", ["c1"])]),
          appendReconciliation: async () => {
            throw new Error("the volume is full");
          },
          toldAt: () => TOLD_AT,
          err: deadSink,
        },
        {
          positionId: "position-synthetic",
          eventId: "evt-synthetic-0005",
          fillKind: "PositionAddedTo",
          asOf: "2026-01-31",
          lotTier: "c1",
          existingPositionIds: new Set(["position-synthetic"]),
        },
      ),
    ).resolves.toBeUndefined();
  });
});

describe("the trail carries NO figures, on the line or in the warning", () => {
  it("keeps every price, size and balance out of the record and the stderr warn", async () => {
    const harness = new Harness({
      answers: openTopRungAnswers(),
      plans: loadedPlans([ladderPlan("position-synthetic", ["c2"])]),
    });

    expectRecorded(await recordFill(harness.io));

    const line = onlyLine(harness);
    // Exactly the eight declared fields — no rungs, no lot cost, no funding amount.
    expect(Object.keys(line).sort()).toEqual([
      "asOf",
      "declared",
      "eventId",
      "fillKind",
      "lotTier",
      "mismatches",
      "positionId",
      "toldAt",
    ]);
    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain("400"); // the rung's price, and its rung id
    expect(serialized).not.toContain("4000"); // the cash debited
    expect(harness.err.join("\n")).not.toContain("400");
    expect(harness.err.join("\n")).not.toContain("4000");
  });
});
