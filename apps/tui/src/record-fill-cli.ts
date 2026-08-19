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
import {
  appendOrders,
  appendReconciliation,
  loadOrders,
  loadPlans,
  resolveOrdersPath,
  resolvePlansPath,
  resolveReconciliationsPath,
} from "@numisma/preferences";
import {
  assertLogFullyLoaded,
  loadEventLog,
  loadFoldedReview,
  loadGenesis,
  readOptional,
  resolveEventStorePaths,
  unattendedFoldVerdict,
} from "@numisma/event-store";
import { restoreLogImage, writeLogImage } from "./event-store.js";
import { createPromptChannel } from "./prompt-channel.js";
import { recordFill } from "./record-fill.js";

const paths = resolveEventStorePaths();
/**
 * THE PROMPT CHANNEL (#370, symptom 2). This shell built its interface HERE, at module
 * scope, which is the pre-#346 shape: `createInterface` eagerly consumes stdin, so a piped
 * run ended the stream before the first question was put and `ask` rejected with
 * `ERR_USE_AFTER_CLOSE` — `readline was closed`, a readline internal printed verbatim to
 * the operator by the outer catch below. The channel builds lazily and, on a stdin that is
 * no terminal, names the missing terminal in this shell's own voice and returns "".
 *
 * `""` IS HONEST HERE ONLY BECAUSE OF THE ORDER `recordFill` ASKS IN, and that is a
 * dependency rather than a property of the empty string. The reachable interview is
 * NINETEEN `ask` sites, not the nine `record-fill.ts` holds literally: it hands `io.ask`
 * onward to `authorLadderTarget` (`record-fill-ladder-target.ts`, eight more) and to
 * `resolveFunding` (`record-fill-funding.ts`, two more), and a delegated question is no
 * less reachable for being put from another file. They read `""` three ways:
 *
 *   - `record-fill.ts`'s "Which rung filled?" — the FIRST question the flow reaches —
 *     matches no rung and refuses as `unknown-rung`. This is the refusal that makes the
 *     empty answer safe, and nothing has been written when it fires. TEN more stop the
 *     act on a blank: the fill timestamp, a touched rung's observed quantity and the
 *     instrument id each reject one, as do `authorLadderTarget`'s five decision fields
 *     (together, as `incomplete-decision`) and `resolveFunding`'s capital tier; a blank
 *     position id abandons.
 *   - SIX are silent ratifications, and they are the hazard. "Filled quantity [n]" takes
 *     the remaining quantity; the per-rung book question takes its `[r]` default and
 *     records that rung as resting untouched; "Also record N confirmed cancellation(s)?"
 *     records NONE and lets the act continue; "Tempo [n]" takes the reserve's; "Cash
 *     debited [n]" takes the proposed figure; and `authorLadderTarget`'s "Append this lot
 *     to '<id>'? [Y/n]" — a gate phrased so that SILENCE MEANS YES — attaches the lot to
 *     an existing Position. That last one is the only thing standing between an
 *     unattended run and a lot landing in a Position nobody named.
 *   - only TWO "[y/N]" confirmations read `""` as NO and abandon: "Confirm these derived
 *     verdicts?" and "Write BOTH?".
 *
 * Only the first is ever reached without a terminal. Reorder the interview — ask the book
 * observation before the rung pick, or make the rung question skippable — and this same
 * `""` ratifies a quantity nobody stated and the run WRITES, unattended, with nobody
 * having answered anything. If that ordering moves, this must become a refusal the domain
 * cannot mistake for consent (a sentinel the questions reject, not a blank), and it must
 * move in the same commit. `record-fill.test.ts` pins the ordering itself — one question
 * asked, and it is the rung pick — so the move is loud rather than silent.
 *
 * CTRL-D IS A SECOND DOOR INTO THOSE SIX RATIFICATIONS, AND IT IS NOT A REORDER. The
 * prompt channel resolves `""` for an ABANDONED question and for every question after it,
 * because the abort closes the interface (#370, clause 4 of `prompt-channel.ts`). So the
 * sentence "only the first is ever reached" is true of the NO-TERMINAL path only. Press
 * Ctrl-D anywhere in this nineteen-question interview and the run races through whatever
 * is left of it, ratifying the six — the remaining quantity, the per-rung book default,
 * no cancellations, the reserve's tempo, the proposed cash figure, and the lot appended
 * to an existing Position.
 *
 * WHAT STOPS THIS ACT WRITING ANYWAY IS ITS FINAL GATE, and that was verified rather than
 * assumed: every writer of the act sits BEHIND `Write BOTH? [y/N]` (`record-fill.ts:900`),
 * on which `isAffirmative("")` is false, so an abandoned run reaches that gate and
 * ABANDONS — `writeLogImage` and `appendOrders` are inside the two-file act just past it,
 * and the advisory trail's `appendReconciliation` is reached only through
 * `reconcileRecordedFill`, called once after the act is already durable. Nothing writes
 * ahead of the gate. `Confirm these derived verdicts? [y/N]` sits earlier and abandons on
 * a blank as well, so most abandoned runs stop before even reaching the final one.
 *
 * THAT IS A PROPERTY OF THIS SHELL, NOT OF THE CHANNEL, and it is why this act needs no
 * equivalent of the import shell's `interview-abandoned` refusal — the import flow has no
 * terminal gate at all, so it takes the channel's abandonment latch and refuses at its
 * write door instead. If a writer here is ever moved AHEAD of `Write BOTH?`, or that gate
 * is ever rephrased so that silence means yes, this argument dies with it and this act
 * must take the latch too.
 */
const prompt = createPromptChannel({
  isTTY: Boolean(process.stdin.isTTY),
  createInterface: () => createInterface({ input: process.stdin, output: process.stdout }),
  err: (message) => process.stderr.write(`${message}\n`),
  noTerminalNotice:
    "No terminal on stdin: recording a fill is an interview — it asks which rung filled, " +
    "when, and for how much — and there is nowhere to conduct it, so every question goes " +
    "unanswered. Run it from a terminal.",
});
try {
  // THE FOLD IS TAKEN, AND ITS DISCARD SUMMARY RENDERED, BEFORE THE ACT BEGINS.
  //
  // `recordFill` reaches `loadFolded()` at step 5, some thirty answers into the
  // interview. That is where this line would land if the thunk folded lazily — after
  // the operator has committed to the act, which is the wrong side of the decision. The
  // shell's `loadLogEvents` binding below already states this reasoning for the
  // partial-log refusal; this is the same argument for the report beside it. Nothing in
  // the act writes to the durable log before step 5, so folding here reads the same log.
  //
  // THE COUNTED LINE, NOT THE ENUMERATION (PRD #323 R7). This is a prompt-driven
  // interview, and the operator is being told a fact about the fold they are about to
  // act on — recording a fill onto a fold derived from damaged history is when that
  // marker is worth the most. `pnpm report` is where the per-event answer lives, and
  // the line says so. It never refuses and never sets an exit code: the locator points
  // into append-only history, so refusing here would brick every future fill over one
  // damaged historical event (ADR-020, clauses 2 and 5).
  const folded = await loadFoldedReview(paths);
  for (const line of unattendedFoldVerdict(folded).messages) {
    process.stderr.write(`${line}\n`);
  }
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
    // The fold read at the top of this file, whose discards the operator was told about
    // before the interview started. `.data` is unwrapped only here, at the boundary of
    // a flow that renders the fund and does not report on it.
    loadFolded: async () => folded.data,
    plansPath: resolvePlansPath(),
    loadPlans,
    reconciliationsPath: resolveReconciliationsPath(),
    appendReconciliation,
    // UTC, and `Z` is an EXPLICIT offset of zero rather than an absent one — which is
    // the whole of what `toldAt` requires. The fund's own zone is deliberately not used
    // here: `toldAt` is an audit instant and never an ordering key, so rendering it in a
    // named zone would buy nothing and would put a second calendar on this path.
    toldAt: () => new Date().toISOString(),
    ask: prompt.ask,
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
  // ONLY IF ONE WAS EVER BUILT — see `createPromptChannel`. A run that never prompted
  // must not construct an interface here just to close it.
  prompt.close();
}
