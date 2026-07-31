/**
 * Node-runnable entry point for the fill act:
 *
 *   pnpm orders:fill
 *
 * WIRING ONLY — it binds the real filesystem, the real data dir, the real genesis + log
 * and a real readline prompt to `recordFill`, which holds the flow, every refusal, the
 * write ordering and the rollback. Keeping the wiring in its own module is what lets the
 * test import the flow with no side effects: importing this file runs the act.
 */
import { createInterface } from "node:readline/promises";
import { appendOrders, loadOrders, resolveOrdersPath } from "@numisma/preferences";
import {
  loadEventLog,
  loadFoldedReview,
  loadGenesis,
  readOptional,
  resolveEventStorePaths,
} from "@numisma/event-store";
import { restoreLogImage, writeLogImage } from "./event-store.js";
import { recordFill } from "./record-fill.js";

const paths = resolveEventStorePaths();
const rl = createInterface({ input: process.stdin, output: process.stdout });
try {
  const outcome = await recordFill({
    ordersPath: resolveOrdersPath(),
    eventsPath: paths.log,
    loadOrders,
    appendOrders,
    readLogImage: () => readOptional(paths.log),
    writeLogImage: (contents) => writeLogImage(paths.log, contents),
    restoreLogImage: (prior) => restoreLogImage(paths.log, prior),
    loadGenesis: () => loadGenesis(paths.genesis),
    loadLogEvents: async () => (await loadEventLog(paths.log)).events,
    loadFolded: () => loadFoldedReview(paths),
    ask: (question) => rl.question(question),
    out: (message) => process.stdout.write(message),
    err: (message) => process.stderr.write(`${message}\n`),
  });
  if (outcome.status !== "recorded") {
    process.exitCode = 1;
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  rl.close();
}
