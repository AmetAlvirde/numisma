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
import { createPromptChannel } from "./prompt-channel.js";

const csvPath = process.argv[2];
if (!csvPath) {
  process.stderr.write("usage: pnpm orders:import <path/to/open-orders-export.csv>\n");
  process.exitCode = 1;
} else {
  /**
   * THE PROMPT CHANNEL — lazy interface, no-terminal notice, one-per-run (#346). The
   * mechanism lives in `prompt-channel.ts` now rather than here, because
   * `record-fill-cli.ts` needed the identical three decisions and had none of them
   * (#370). What stays here is the part only this shell can know: what `""` MEANS to
   * the questions this flow puts.
   *
   * `""` IS HONEST AT EXACTLY ONE CALL SITE, AND THAT IS AN ORDERING DEPENDENCY, not a
   * property of the empty string. Read as an answer, `""` means different things to the
   * questions this flow can put:
   *
   *   - `import-orders-funding-declaration.ts`'s batch question reads it as NO RESERVE
   *     DECLARED, so `declareFunding` returns undefined and the flow refuses as
   *     `no-reserve-declared`. This is the refusal that makes the empty answer safe.
   *   - `import-orders-rung-picks.ts` reads it as ACCEPT EVERY PROPOSED RUNG, and, at its
   *     other site, as TAKE THE DEFAULT.
   *   - the funding declaration's second question reads it as NO PER-RUNG OVERRIDES.
   *
   * The last three are ratifications. A no-terminal run never reaches them ONLY because
   * funding is asked FIRST and refuses the whole batch before any rung question is put.
   * Reorder the interview — ask rung picks before funding, or make the funding question
   * skippable — and this same `""` silently ratifies every default and the run WRITES,
   * unattended, with nobody having answered anything. If that ordering ever moves, this
   * must become a refusal that the domain cannot mistake for consent (a sentinel the
   * questions reject, not a blank), and it must move in the same commit.
   *
   * AND THERE IS A SECOND DOOR INTO THOSE THREE RATIFICATIONS THAT IS NOT A REORDER:
   * CTRL-D. The prompt channel resolves `""` for an ABANDONED question too, and for the
   * whole rest of the interview after it, because the abort closes the interface (#370,
   * clause 4 of `prompt-channel.ts`). That is what makes the FIRST question's Ctrl-D come
   * back as `no-reserve-declared` in the domain's own voice instead of readline's
   * `Aborted with Ctrl+D`, and it is the fix #370 asked for. But it also means the three
   * ratifications above are reachable with blanks after ANY question — the ordering
   * argument above covers the no-terminal path only, and the paragraph above predicted
   * exactly this outcome by the one route it did not anticipate.
   *
   * WHAT STOPS THE WRITE ANYWAY, since the sentinel is not built yet: the channel LATCHES
   * the abandonment (`prompt.aborted`), this shell hands that latch to the flow as
   * `promptAbandoned`, and `importBitgetOpenOrders` refuses as `interview-abandoned`
   * before `appendOrders` rather than appending. The guarantee is positional-independent —
   * if the terminal was abandoned, nothing is written — so it does not depend on WHICH
   * question caught the Ctrl-D, and it survives a reorder of this interview even though
   * the sentence above does not. `import-orders.test.ts` pins both halves: the first
   * question still refuses as `no-reserve-declared`, and an interview abandoned after it
   * never reaches `appendOrders`. The sentinel remains owed; it would move the refusal to
   * the abandoned question instead of catching it at the door.
   */
  const prompt = createPromptChannel({
    isTTY: Boolean(process.stdin.isTTY),
    createInterface: () => createInterface({ input: process.stdin, output: process.stdout }),
    err: (message) => process.stderr.write(`${message}\n`),
    noTerminalNotice:
      "No terminal on stdin: this import is an interview — it asks which reserve funds " +
      "the batch — and there is nowhere to conduct it, so every question goes " +
      "unanswered. Run it from a terminal.",
  });
  const ask = prompt.ask;

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
        // THE LATCH, not a value: read at the write door, long after this bag is built.
        promptAbandoned: () => prompt.aborted(),
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
    // ONLY IF ONE WAS EVER BUILT — see `createPromptChannel`. A run that never prompted
    // must not construct an interface here just to close it, which would consume stdin on
    // the way out for no reason at all.
    prompt.close();
  }
}
