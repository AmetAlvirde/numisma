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
  assertLogFullyLoaded,
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
    // `loadEventLog` + `assertLogFullyLoaded` is ONE pair, never a lone read — the
    // convention the repo's durable-log readers follow (`event-store.ts`, price-feed's
    // `rejection-check.ts`, the package's own fold and gap-report IO; web's
    // `backfill-core.ts` `enumerateAnchors` reads bare, tolerable only because every
    // anchor it yields is immediately re-read through the asserting fold path).
    // Dropping the assertion here would let `recordFill` reason over a HALF-READ log:
    // `reconcileFillActs` would see a sidecar `orderFilled` whose log half is the
    // quarantined line and refuse with `torn-fill-act`, whose message instructs the
    // operator to hand-author the missing half — compounding the damage — while in the
    // other direction the `duplicate-fill-act` gate weakens and an already-recorded
    // fill can pass. `recordFill` calls this BEFORE its first question, so the refusal
    // lands before the interview rather than at `loadFolded()` thirty answers later.
    loadLogEvents: async () => {
      const load = await loadEventLog(paths.log);
      assertLogFullyLoaded(load, paths.log);
      return load.events;
    },
    // `.data` is the render half of the fold's envelope. This CLI renders the discard
    // summary line before it acts in PRD #323 slice E (R7 — recording a fill over a
    // damaged-history fold is when the marker is worth the most); it is silent for now.
    loadFolded: async () => (await loadFoldedReview(paths)).data,
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
