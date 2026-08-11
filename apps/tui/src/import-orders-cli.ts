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
import {
  appendOrders,
  loadOrders,
  loadPlans,
  resolveOrdersPath,
  resolvePlansPath,
} from "@numisma/preferences";
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
        // THE REAL CLOCK, and the only place it is read (#181). An observation line is
        // stamped with the import moment, so the one adapter that runs against a real
        // venue export is the one that supplies a real instant; the test harness supplies
        // a frozen one, which is what makes the same-second case assertable at all.
        now: () => new Date(),
        ordersPath: resolveOrdersPath(),
        loadOrders,
        appendOrders,
        // The folded review goes over WHOLE. This used to map `data.reserves` into
        // `{ id, amount }` pairs here — three lines that quietly gave the `O1` guard a
        // different reserve set than the rendered report reads, and stripped the
        // currency it needed to refuse a cross-currency rung (#172). Admission is the
        // engine's policy, not this wiring's.
        fundReview: () => loadFoldedReview(resolveEventStorePaths()),
        // THE PLANS SIDECAR, READ-ONLY (#286): the import proposes a rung against the
        // ladders in force and never writes a plan line. `loadPlans` is TOTAL — it reports
        // an unreadable file rather than throwing — and the flow decides what an
        // unreadable one costs, which is the proposal and nothing else.
        plansPath: resolvePlansPath(),
        loadPlans,
        ask: (question) => rl.question(question),
        out: (message) => process.stdout.write(message),
        err: (message) => process.stderr.write(`${message}\n`),
      },
    });
    if (outcome.status === "rejected") {
      process.exitCode = 1;
    } else if (outcome.status === "imported-partial") {
      // HANDLED, AND DELIBERATELY 0 (`D3`, #177). NOTHING WAS REFUSED, so exiting 1 would
      // tell a caller the run failed when it did not — replacing one overstatement with
      // another. Not "lines were written", which is what this said until the #200 review
      // and is not true of every member: an export with an unreadable row whose every
      // READABLE rung was already on file appends nothing and still ends here, and it is no
      // more a failure than a re-import that appends nothing. An export of nothing but
      // RESTATED rungs no longer arrives here at all — #210 records the restatement, so it
      // qualifies nothing and the run ends at `imported`; only an unread row reaches this
      // branch now. The flow is interactive, and the operator's lines (one per
      // qualification, each opening on its own gap and naming its own money direction)
      // are the real channel. If this import is ever automated or piped, the exit code
      // becomes the only surface left and this branch must be revisited BEFORE that lands,
      // not after. (#183 DECIDED this and is closed; the accepted cost and that re-trigger
      // are recorded in ADR-014, `a skipped export row: not persisted, because it could
      // never be retired`, under `context/adr/`.)
      process.exitCode = 0;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}
