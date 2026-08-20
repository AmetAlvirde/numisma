/**
 * THE FOUR SHELLS, ASSERTED TOGETHER (#181).
 *
 * `renderSkipMessage` is unit-tested next door. This file exists because the defect it
 * closes was never in one shell's wording — it was that FOUR shells each carried their
 * own, and all four flattened `unknown-kind` into "unreadable". Testing one shell and
 * eyeballing the other three is the exact reading that let the divergence live, so every
 * shell that refuses on a skip is driven here, through its real entry point, and asserted
 * on both halves of the claim:
 *
 *   - it STILL REFUSES, with the same rejection token as before — nothing here renders a
 *     committed figure that was previously withheld; and
 *   - it says the line came from a NEWER BUILD, and does not call the file unreadable.
 *
 * A fifth shell added later that hand-writes its own sentence will not be caught by a
 * compiler, so a reviewer meeting this table is the guard. `SHELLS` is the checklist.
 *
 * EVERY FIXTURE IS SYNTHETIC (`O7`): invented pair, round prices, round sizes.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  BITGET_OPEN_ORDERS_HEADER,
  parseFundReview,
  type FundReviewData,
  type OrderRecord,
  type PortfolioEvent,
} from "@numisma/engine";
import type { OrderSkip, OrdersLoad } from "@numisma/preferences";
import { afterEach, describe, expect, it } from "vitest";
import { loadAvailableCapital } from "./available-capital.js";
import { cancelOrder } from "./cancel-order.js";
import { importBitgetOpenOrders } from "./import-orders.js";
import { recordFill } from "./record-fill.js";
import { UNANSWERED } from "./prompt-channel.js";

const ORDERS_PATH = "/synthetic/orders.jsonl";
const EVENTS_PATH = "/synthetic/events.jsonl";
const RESERVE = "reserve-capital";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(createdDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  createdDirs.length = 0;
});

/** A line whose `kind` this build does not know — the whole point of the slice. */
const UNKNOWN_KIND: OrderSkip = {
  line: 4,
  problem: "unknown-kind",
  message: 'unknown kind "orderRepriced"',
};

/** A line that really is broken, kept beside it so the two never collapse. */
const MALFORMED: OrderSkip = {
  line: 2,
  problem: "malformed",
  message: "id must be a non-empty string",
};

const RUNG: OrderRecord = {
  id: "rung-0",
  observedAt: "2026-01-02T10:00:00",
  kind: "orderPlaced",
  currency: "USD",
  symbol: "XYZ/USDT",
  side: "buy",
  price: 100,
  quantity: 2,
  fundingReserveId: RESERVE,
};

function syntheticFund(): FundReviewData {
  const parsed = parseFundReview({
    fund: { id: "synthetic-fund", name: "Synthetic Fund", baseCurrency: "USD" },
    review: { asOf: "2026-01-31", usdMxn: 20 },
    portfolios: [{ id: "core", name: "Core" }],
    accounts: [{ id: "venue-usd", name: "Synthetic Venue", platform: "BITGET", currency: "USD" }],
    instruments: [{ id: "test-usd", name: "Test Asset", symbol: "XYZ", currency: "USD" }],
    reserves: [
      {
        id: RESERVE,
        portfolioId: "core",
        tempo: "Capital",
        executionMode: "live",
        accountId: "venue-usd",
        currency: "USD",
        amount: 1000,
      },
    ],
    positions: [],
  });
  if (parsed.kind !== "ok") throw new Error("synthetic fixture must parse");
  return parsed.value;
}

function loadedWith(skips: OrderSkip[]): OrdersLoad {
  return { status: "loaded", path: ORDERS_PATH, records: [RUNG], skips };
}

/** A one-rung synthetic export, so the import reaches the sidecar load at all. */
function syntheticExport(): string {
  const fields: Record<string, string> = {
    timestamp: "2020-01-01 10:00:00",
    pair: "XYZ/USDT",
    time_in_force: "GTC",
    order_type: "Limit",
    side: "Buy",
    price: "1000",
    quantity: "0.1",
    trigger_price: "-- / --",
    order_value: "0",
    filled_quantity: "0",
    total_quantity: "0.1",
    filled_percent: "0.00%",
    status: "Unfilled",
    action: "Cancel",
  };
  const row = BITGET_OPEN_ORDERS_HEADER.map((column) => fields[column] ?? "").join(",");
  return [BITGET_OPEN_ORDERS_HEADER.join(","), row, ""].join("\n");
}

/** What a shell told the operator, and the token it refused under. */
interface Refusal {
  reason: string;
  message: string;
}

/**
 * One shell, reduced to the only thing this file cares about: hand it a skip list, get
 * back the refusal. Every entry drives the shell's REAL exported entry point — a stub
 * that reimplements the refusal would assert nothing.
 */
interface Shell {
  name: string;
  /** The rejection token this shell has always used; asserted unchanged. */
  reason: string;
  refuse: (skips: OrderSkip[]) => Promise<Refusal>;
}

const SHELLS: Shell[] = [
  {
    name: "availableCapital",
    // Not a rejection token — this shell reports `refused` as its status.
    reason: "refused",
    refuse: async (skips) => {
      const section = await loadAvailableCapital(syntheticFund(), {
        ordersPath: ORDERS_PATH,
        loadOrders: async () => loadedWith(skips),
      });
      if (section.status !== "refused") throw new Error(`expected refusal, got ${section.status}`);
      return { reason: section.status, message: section.message };
    },
  },
  {
    name: "cancelOrder",
    reason: "unreadable-sidecar-lines",
    refuse: async (skips) => {
      const outcome = await cancelOrder({
        orderId: RUNG.id,
        io: {
          ordersPath: ORDERS_PATH,
          loadOrders: async () => loadedWith(skips),
          appendOrders: async () => {
            throw new Error("must not write");
          },
          now: () => new Date("2026-02-01T10:00:00Z"),
          out: () => {},
          err: () => {},
        },
      });
      if (outcome.status !== "rejected") throw new Error("expected a rejection");
      return { reason: outcome.reason, message: outcome.message };
    },
  },
  {
    name: "recordFill",
    reason: "unreadable-sidecar-lines",
    refuse: async (skips) => {
      const outcome = await recordFill({
        ordersPath: ORDERS_PATH,
        eventsPath: EVENTS_PATH,
        loadOrders: async () => loadedWith(skips),
        appendOrders: async () => {
          throw new Error("must not write");
        },
        readLogImage: async () => undefined,
        writeLogImage: async () => {
          throw new Error("must not write");
        },
        restoreLogImage: async () => {},
        loadGenesis: async () => syntheticFund(),
        loadLogEvents: async (): Promise<PortfolioEvent[]> => [],
        loadFolded: async () => syntheticFund(),
        // The advisory trail (#336). This refusal lands long before the act, so nothing
        // here may be reached; each binding throws to say so.
        plansPath: "/synthetic/plans.jsonl",
        loadPlans: async () => {
          throw new Error("must not read plans");
        },
        reconciliationsPath: "/synthetic/reconciliations.jsonl",
        appendReconciliation: async () => {
          throw new Error("must not write");
        },
        toldAt: () => "2026-02-01T10:00:00Z",
        // THIS FLOW MUST REFUSE BEFORE IT ASKS ANYTHING, so the honest answer is the one
        // no question can use: `UNANSWERED` (#388).
        ask: async () => UNANSWERED,
        out: () => {},
        err: () => {},
      });
      if (outcome.status !== "rejected") throw new Error("expected a rejection");
      return { reason: outcome.reason, message: outcome.message };
    },
  },
  {
    name: "importBitgetOpenOrders",
    reason: "unreadable-sidecar-lines",
    refuse: async (skips) => {
      const dir = await mkdtemp(resolve(tmpdir(), "numisma-skip-shells-"));
      createdDirs.push(dir);
      const csvPath = join(dir, "open-orders.csv");
      await writeFile(csvPath, syntheticExport(), "utf8");
      const outcome = await importBitgetOpenOrders({
        csvPath,
        io: {
          readExport: async () => syntheticExport(),
          // Frozen, and never reached: this case refuses over an unreadable sidecar long
          // before an observation could be stamped. Supplied because the seam is required,
          // not because the refusal depends on it.
          now: () => new Date("2026-01-01T09:00:00"),
          ordersPath: ORDERS_PATH,
          loadOrders: async () => loadedWith(skips),
          appendOrders: async () => {
            throw new Error("must not write");
          },
          fundReview: async () => syntheticFund(),
          // Never reached either: the refusal lands before any rung is proposed for.
          plansPath: "/nowhere/plans.jsonl",
          loadPlans: async (path) => ({
            load: { status: "loaded", sourcePath: path },
            plans: [],
            skipped: [],
          }),
          // THIS FLOW MUST REFUSE BEFORE IT ASKS ANYTHING, so the honest answer is the one
        // no question can use: `UNANSWERED` (#388).
        ask: async () => UNANSWERED,
          out: () => {},
          err: () => {},
        },
      });
      if (outcome.status !== "rejected") throw new Error("expected a rejection");
      return { reason: outcome.reason, message: outcome.message };
    },
  },
];

describe("every shell that refuses on a skip renders ONE shared message", () => {
  it("covers all four shells — the list itself is the checklist", () => {
    expect(SHELLS.map((shell) => shell.name)).toEqual([
      "availableCapital",
      "cancelOrder",
      "recordFill",
      "importBitgetOpenOrders",
    ]);
  });

  for (const shell of SHELLS) {
    describe(shell.name, () => {
      it("tells the operator an unknown-kind line came from a NEWER BUILD", async () => {
        const refusal = await shell.refuse([UNKNOWN_KIND]);
        expect(refusal.message).toContain("1 line(s) written by a newer build than this one");
        expect(refusal.message).toContain("update this reader");
        // The defect, stated as an assertion: a well-formed line from a newer build must
        // never be reported as an unreadable file. That sends the operator to edit the
        // line instead of updating the build.
        expect(refusal.message).not.toContain("unreadable");
        expect(refusal.message).not.toContain("cannot read");
      });

      it("STILL REFUSES on an unknown-kind skip, under the same token as before", async () => {
        // The refusal stands and this slice is what proves it was right: an older build
        // that read past the observation line would print the stale partial as a
        // committed figure. No shell renders a figure it previously withheld.
        const refusal = await shell.refuse([UNKNOWN_KIND]);
        expect(refusal.reason).toBe(shell.reason);
      });

      it("still refuses a malformed skip, in today's wording", async () => {
        const refusal = await shell.refuse([MALFORMED]);
        expect(refusal.reason).toBe(shell.reason);
        expect(refusal.message).toContain("1 unreadable line(s)");
        expect(refusal.message).not.toContain("newer build");
      });

      it("renders BOTH classes at once, each with its own count", async () => {
        const refusal = await shell.refuse([MALFORMED, UNKNOWN_KIND, { ...UNKNOWN_KIND, line: 9 }]);
        expect(refusal.reason).toBe(shell.reason);
        expect(refusal.message).toContain("1 unreadable line(s)");
        expect(refusal.message).toContain("2 line(s) written by a newer build than this one");
      });
    });
  }
});
