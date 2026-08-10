/**
 * `orders:cancel` — the missing PRODUCER of `orderCancelled`, over a REAL temp
 * `orders.jsonl`.
 *
 * The shape of every assertion here follows the direction of risk. Cancelling FREES
 * encumbrance, so it moves available UP — the money-costing direction if the operator's
 * assertion is wrong. So every refusal case asserts that the file is BYTE-IDENTICAL
 * afterwards (not merely that the outcome said "rejected"), and the happy path asserts
 * the DELTA — committed falls by exactly this rung's own encumbrance — never a resting
 * state, which a fixture could satisfy by accident.
 *
 * EVERY FIXTURE IS A SYNTHETIC LADDER (`O7`). Invented pair, round prices, round sizes.
 * The real ladder's figures live only in the private notes vault; nothing here is a
 * figure, and every assertion is about a PROPERTY.
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { appendOrders, loadOrders, resolveOrdersPath } from "@numisma/preferences";
import {
  committedByReserve,
  formatObservedAt,
  pickRestingOrdersAsOf,
  serializeOrderRecord,
  type OrderPlacedRecord,
  type OrderRecord,
} from "@numisma/engine";
import { afterEach, describe, expect, it } from "vitest";
import { cancelOrder, type OrderCancelIo } from "./cancel-order.js";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

const RESERVE = "reserve-synthetic";
/** Round, obviously-fake numbers. Two identical rungs at different prices. */
const RUNG_QUANTITY = 2;

function placed(id: string, observedAt: string, price: number): OrderPlacedRecord {
  return {
    id,
    observedAt,
    kind: "orderPlaced",
    currency: "USD",
    symbol: "XYZ/USD",
    side: "buy",
    price,
    quantity: RUNG_QUANTITY,
    fundingReserveId: RESERVE,
  };
}

const RUNG_A = placed("rung-a", "2026-01-01T10:00:00", 100);
const RUNG_B = placed("rung-b", "2026-01-01T10:00:01", 200);
/** What retiring `rung-a` must free: `price × remaining`, and nothing else. */
const RUNG_A_ENCUMBRANCE = 100 * RUNG_QUANTITY;

/** A fixed instant, so "stamp it now" is asserted rather than tolerated. */
const NOW = new Date(2026, 1, 3, 14, 30, 15);

interface Harness {
  io: OrderCancelIo;
  ordersPath: string;
  errors: string[];
  outputs: string[];
  /** The file's exact bytes, or `undefined` when it does not exist. */
  image: () => Promise<string | undefined>;
}

async function harness(seed: OrderRecord[] = [RUNG_A, RUNG_B]): Promise<Harness> {
  const dir = await mkdtemp(resolve(tmpdir(), "numisma-orders-cancel-"));
  createdDirs.push(dir);
  const ordersPath = resolveOrdersPath(resolve(dir, "data"));
  await mkdir(dirname(ordersPath), { recursive: true });
  if (seed.length > 0) {
    await appendOrders(ordersPath, seed);
  }

  const errors: string[] = [];
  const outputs: string[] = [];
  return {
    ordersPath,
    errors,
    outputs,
    image: async () => {
      try {
        return await readFile(ordersPath, "utf8");
      } catch {
        return undefined;
      }
    },
    io: {
      ordersPath,
      loadOrders: (path) => loadOrders(path, { warn: () => {} }),
      appendOrders,
      now: () => NOW,
      out: (message) => outputs.push(message),
      err: (message) => errors.push(message),
    },
  };
}

/** The resting book and the committed-per-reserve fold, as every consumer sees them. */
async function book(ordersPath: string) {
  const load = await loadOrders(ordersPath, { warn: () => {} });
  if (load.status !== "loaded") throw new Error(`expected a loaded sidecar, got ${load.status}`);
  const resting = pickRestingOrdersAsOf(load.records);
  return { resting, committed: committedByReserve(resting).get(RESERVE) ?? 0 };
}

describe("orders:cancel retires ONE resting rung — the DELTA, not the state", () => {
  it("takes the rung out of the resting book and drops committed by exactly its own encumbrance", async () => {
    const h = await harness();
    const before = await book(h.ordersPath);

    const outcome = await cancelOrder({ orderId: "rung-a", observedAt: "2026-01-02T09:00:00", io: h.io });

    expect(outcome.status).toBe("cancelled");
    const after = await book(h.ordersPath);
    // The DELTA is the assertion. A resting-state assertion could be satisfied by a
    // fixture that never encumbered anything; only the difference proves this rung's
    // claim — and no other rung's — was released.
    expect(before.committed - after.committed).toBe(RUNG_A_ENCUMBRANCE);
    expect(outcome.status === "cancelled" && outcome.freed).toBe(RUNG_A_ENCUMBRANCE);
    expect(after.resting.map((order) => order.placed.id)).toEqual(["rung-b"]);
  });

  it("appends ONE canonical line, carrying currency from the rung's own orderPlaced", async () => {
    const h = await harness();
    const before = await h.image();

    await cancelOrder({ orderId: "rung-a", observedAt: "2026-01-02T09:00:00", io: h.io });

    const after = (await h.image()) ?? "";
    expect(after.startsWith(before ?? "")).toBe(true); // genuinely APPEND-only
    const added = after.slice((before ?? "").length).trim().split("\n");
    expect(added).toHaveLength(1);
    expect(added[0]).toBe(
      serializeOrderRecord({
        id: "rung-a",
        observedAt: "2026-01-02T09:00:00",
        kind: "orderCancelled",
        currency: RUNG_A.currency,
      }),
    );
  });

  it("stamps NOW, in the file's own shape, when no observedAt is given", async () => {
    const h = await harness();
    await cancelOrder({ orderId: "rung-a", io: h.io });

    const load = await loadOrders(h.ordersPath, { warn: () => {} });
    if (load.status !== "loaded") throw new Error("expected a loaded sidecar");
    const cancelled = load.records.find((record) => record.kind === "orderCancelled");
    // Formatted through the SAME helper `records.ts` exports, so the producer and the
    // reader cannot disagree about the shape — and it round-trips, which is the proof
    // that the loader accepted it rather than skipping it as malformed.
    expect(cancelled?.observedAt).toBe(formatObservedAt(NOW));
  });

  it("reports the freed encumbrance and the reserve it came off", async () => {
    const h = await harness();
    await cancelOrder({ orderId: "rung-a", io: h.io });
    const said = h.outputs.join("");
    expect(said).toContain("rung-a");
    expect(said).toContain(String(RUNG_A_ENCUMBRANCE));
    expect(said).toContain(RESERVE);
    expect(said).toContain("no longer encumbered");
  });
});

describe("every refusal writes NOTHING — the file is byte-identical afterwards", () => {
  /** Run one rejection case and assert the bytes did not move. */
  async function refuses(
    options: { orderId: string; observedAt?: string },
    reason: string,
    seed?: OrderRecord[],
  ) {
    const h = await harness(seed);
    const before = await h.image();

    const outcome = await cancelOrder({ ...options, io: h.io });

    expect(outcome.status).toBe("rejected");
    expect(outcome.status === "rejected" && outcome.reason).toBe(reason);
    expect(await h.image()).toEqual(before);
    // LOUD: a refusal must never read as a quiet no-op.
    expect(h.errors.join("")).toContain("REFUSED");
    expect(h.errors.join("")).toContain("Nothing was written");
    expect(h.outputs).toEqual([]);
    return h;
  }

  it("refuses an id the sidecar has never heard of", async () => {
    await refuses({ orderId: "rung-that-does-not-exist" }, "unknown-order");
  });

  it("refuses an empty id rather than guessing which rung was meant", async () => {
    await refuses({ orderId: "   " }, "no-order-id");
  });

  it("refuses a rung that is already cancelled — there is no claim left to retire", async () => {
    const cancelled: OrderRecord = {
      id: "rung-a",
      observedAt: "2026-01-02T09:00:00",
      kind: "orderCancelled",
      currency: "USD",
    };
    // Without this the second cancellation would be inert but still permanent, and the
    // operator would have no signal that their model of the book was wrong.
    await refuses({ orderId: "rung-a" }, "not-resting", [RUNG_A, RUNG_B, cancelled]);
  });

  it("refuses a rung already fully filled", async () => {
    const filled: OrderRecord = {
      id: "rung-a",
      observedAt: "2026-01-02T09:00:00",
      kind: "orderFilled",
      currency: "USD",
      filledQuantity: RUNG_QUANTITY,
    };
    await refuses({ orderId: "rung-a" }, "not-resting", [RUNG_A, RUNG_B, filled]);
  });

  it("refuses a malformed observedAt before writing, not after", async () => {
    await refuses({ orderId: "rung-a", observedAt: "2026-01-02" }, "bad-timestamp");
  });

  // THE SENTENCE, NOT ONLY THE REASON CODE. `2026-02-30T09:30:00` is the shape this shell
  // used to name as the whole rule, so the old message quoted the operator a string and told
  // them it broke a rule it satisfies — while the impossible date went unmentioned. The
  // clause is asserted as a substring: red if it is dropped, quiet under rewording.
  it("tells the operator WHICH rule an impossible date broke, not just the shape", async () => {
    const h = await refuses(
      { orderId: "rung-a", observedAt: "2026-02-30T09:30:00" },
      "bad-timestamp",
    );
    expect(h.errors.join("")).toContain("a real calendar date and time");
  });

  it("refuses a stamp that predates the placement, which would be inert", async () => {
    // The selector replays in `observedAt` order, so a cancellation stamped before its
    // placement is consumed first and the rung keeps resting: a permanent line asserting
    // nothing at all.
    await refuses({ orderId: "rung-a", observedAt: "2025-12-31T09:00:00" }, "before-placement");
  });

  it("refuses over a sidecar with unreadable lines rather than resolving a partial book", async () => {
    const h = await harness();
    await writeFile(h.ordersPath, `${await readFile(h.ordersPath, "utf8")}{ not json\n`, "utf8");
    const before = await h.image();

    const outcome = await cancelOrder({ orderId: "rung-a", io: h.io });

    expect(outcome.status === "rejected" && outcome.reason).toBe("unreadable-sidecar-lines");
    expect(await h.image()).toEqual(before);
  });

  it("refuses over an UNREADABLE sidecar — never treating it as an empty book", async () => {
    const h = await harness();
    const outcome = await cancelOrder({
      orderId: "rung-a",
      io: { ...h.io, loadOrders: async (path) => ({ status: "unreadable", path, message: "denied" }) },
    });
    expect(outcome.status === "rejected" && outcome.reason).toBe("unreadable-sidecar");
  });

  it("refuses against an ABSENT sidecar, and creates no file by trying", async () => {
    const h = await harness([]);
    const outcome = await cancelOrder({ orderId: "rung-a", io: h.io });
    expect(outcome.status === "rejected" && outcome.reason).toBe("unknown-order");
    expect(await h.image()).toBeUndefined();
  });
});
