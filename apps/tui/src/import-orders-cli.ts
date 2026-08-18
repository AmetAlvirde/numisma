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
import {
  loadFoldedReview,
  resolveEventStorePaths,
  unattendedFoldVerdict,
} from "@numisma/event-store";
import { importBitgetOpenOrders } from "./import-orders.js";

const csvPath = process.argv[2];
if (!csvPath) {
  process.stderr.write("usage: pnpm orders:import <path/to/open-orders-export.csv>\n");
  process.exitCode = 1;
} else {
  // THE PROMPT IS BUILT AT THE FIRST QUESTION, NEVER AT STARTUP (#346). `createInterface`
  // eagerly consumes stdin, so constructing it here — which is where it used to live —
  // ended a piped stream before any question was put, and the first `ask` rejected with
  // `readline was closed`: a readline internal, printed verbatim to the operator by the
  // outer catch below. Memoized, so the several questions of one interview share one
  // interface, and a run that never asks never builds one.
  let rl: ReturnType<typeof createInterface> | undefined;
  let toldThereIsNoTerminal = false;

  /**
   * The prompt channel — and, on a stdin that is no terminal, the place that says so.
   *
   * IT RETURNS RATHER THAN THROWS, DELIBERATELY. Throwing here would unwind through the
   * outer catch and end the run in the shell, which would leave `no-reserve-declared`
   * (`import-orders.ts:588`) unreachable forever — the flow's own refusal for a batch
   * nobody funded, reached only when `declareFunding` gets an empty batch answer. Returning
   * "" hands the domain the one answer a run with no terminal can honestly give, and the
   * domain then refuses in its own voice. Two sentences, one story: the shell names WHY
   * there is no answer, the flow names WHAT IT DID about it.
   *
   * The notice is written once per run rather than once per question: the operator learns
   * there is no terminal from the first unanswerable question, and repeating it would bury
   * the flow's refusal under copies of the shell's. UNTESTED, AND UNTESTABLE FROM A SPAWN —
   * said out loud so nobody reads the `toldThereIsNoTerminal` flag as pinned behaviour. A
   * no-terminal run puts exactly ONE question (`import-orders.ts:586` asks the batch
   * question, gets "", and `:588` refuses), so writing the notice unconditionally leaves
   * every case in `import-orders-cli.test.ts` green. The flag is kept because it is correct
   * and costs a boolean, and because the shape of the interview is not fixed: the rung walk
   * on the far side of the funding wall can put thirty questions, and the day any of them
   * becomes reachable without a terminal, the difference between one notice and thirty is
   * the difference between a legible refusal and a wall of the shell shouting over the flow.
   */
  const ask = (question: string): Promise<string> => {
    if (!process.stdin.isTTY) {
      if (!toldThereIsNoTerminal) {
        toldThereIsNoTerminal = true;
        process.stderr.write(
          "No terminal on stdin: this import is an interview — it asks which reserve funds " +
            "the batch — and there is nowhere to conduct it, so every question goes " +
            "unanswered. Run it from a terminal.\n",
        );
      }
      // `""` IS HONEST AT EXACTLY ONE CALL SITE, AND THAT IS AN ORDERING DEPENDENCY, not a
      // property of the empty string. Read as an answer, `""` means different things to the
      // three questions this flow can put:
      //
      //   - `import-orders-funding-declaration.ts:68` (the batch question) reads it as NO
      //     RESERVE DECLARED, so `declareFunding` returns undefined and the flow refuses at
      //     `import-orders.ts:588`. This is the refusal that makes the empty answer safe.
      //   - `import-orders-rung-picks.ts:161` reads it as ACCEPT EVERY PROPOSED RUNG.
      //   - `import-orders-rung-picks.ts:183` reads it as TAKE THE DEFAULT.
      //   - `import-orders-funding-declaration.ts:74` reads it as NO PER-RUNG OVERRIDES.
      //
      // The last three are ratifications. A no-terminal run never reaches them ONLY because
      // funding is asked FIRST and refuses the whole batch before any rung question is put.
      // Reorder the interview — ask rung picks before funding, or make the funding question
      // skippable — and this same `return ""` silently ratifies every default and the run
      // WRITES, unattended, with nobody having answered anything. If that ordering ever
      // moves, this return must become a refusal that the domain cannot mistake for consent
      // (a sentinel the questions reject, not a blank), and it must move in the same commit.
      return Promise.resolve("");
    }
    rl ??= createInterface({ input: process.stdin, output: process.stdout });
    return rl.question(question);
  };

  try {
    // THE FOLD IS TAKEN, AND ITS DISCARD SUMMARY RENDERED, BEFORE THE IMPORT BEGINS —
    // the same placement and the same argument as `record-fill-cli.ts`. `fundReview()`
    // is reached partway through the flow, at the funding-coverage check; the marker
    // belongs on the near side of the operator's decision, not inside it. Counted rather
    // than enumerated (PRD #323 R7), and it never refuses: `pnpm report` is where the
    // per-event answer lives, and the line names it.
    const folded = await loadFoldedReview(resolveEventStorePaths());
    for (const line of unattendedFoldVerdict(folded).messages) {
      process.stderr.write(`${line}\n`);
    }
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
        // The fold read above, whose discards the operator was told about before the
        // import started. It goes over WHOLE — this used to map `data.reserves` into
        // `{ id, amount }` pairs here, three lines that quietly gave the `O1` guard a
        // different reserve set than the rendered report reads and stripped the currency
        // it needed to refuse a cross-currency rung (#172). Admission is the engine's
        // policy, not this wiring's.
        fundReview: async () => folded.data,
        // THE PLANS SIDECAR, READ-ONLY (#286): the import proposes a rung against the
        // ladders in force and never writes a plan line. `loadPlans` is TOTAL — it reports
        // an unreadable file rather than throwing — and the flow decides what an
        // unreadable one costs, which is the proposal and nothing else.
        plansPath: resolvePlansPath(),
        loadPlans,
        ask,
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
      // not after. THAT TRIGGER HAS NOT FIRED: #346 made a piped run REFUSE at the first
      // question rather than answer it, which is the opposite of automating the import —
      // the operator is still the only channel, and this 0 still means what it said.
      // (#183 DECIDED this and is closed; the accepted cost and that re-trigger
      // are recorded in ADR-014, `a skipped export row: not persisted, because it could
      // never be retired`, under `context/adr/`.)
      process.exitCode = 0;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  } finally {
    // ONLY IF ONE WAS EVER BUILT. `?.` is the whole point of the lazy construction above:
    // a run that never prompted must not construct an interface here just to close it,
    // which would consume stdin on the way out for no reason at all.
    rl?.close();
  }
}
