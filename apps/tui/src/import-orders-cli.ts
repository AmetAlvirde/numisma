/**
 * Node-runnable entry point for the open-orders import:
 *
 *   pnpm orders:import <path/to/open-orders-export.csv>
 *
 * This file is WIRING ONLY — it binds the real filesystem, the real data dir, the real
 * fold and a real readline prompt to `importBitgetOpenOrders`, which holds the flow and
 * every refusal. Keeping the wiring in its own module is what lets the test import the
 * flow with no side effects: importing this file runs the import.
 */
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { appendOrders, loadOrders, resolveOrdersPath } from "@numisma/preferences";
import { loadFoldedReview, resolveEventStorePaths } from "@numisma/event-store";
import { importBitgetOpenOrders } from "./import-orders.js";

const csvPath = process.argv[2];
if (!csvPath) {
  process.stderr.write("usage: pnpm orders:import <path/to/open-orders-export.csv>\n");
  process.exitCode = 1;
} else {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const outcome = await importBitgetOpenOrders({
      csvPath,
      io: {
        readExport: (path) => readFile(path, "utf8"),
        ordersPath: resolveOrdersPath(),
        loadOrders,
        appendOrders,
        reserveBalances: async () => {
          const data = await loadFoldedReview(resolveEventStorePaths());
          return data.reserves.map((reserve) => ({ id: reserve.id, amount: reserve.amount }));
        },
        ask: (question) => rl.question(question),
        out: (message) => process.stdout.write(message),
        err: (message) => process.stderr.write(`${message}\n`),
      },
    });
    if (outcome.status === "rejected") {
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}
