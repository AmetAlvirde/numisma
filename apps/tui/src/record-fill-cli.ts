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
 * no terminal, names the missing terminal in this shell's own voice and hands the flow
 * `UNANSWERED` — a symbol no operator can type — for every question it could not put.
 *
 * THIS SITE USED TO ENUMERATE WHAT `""` MEANT TO EACH OF THIS ACT'S QUESTIONS, AND TO
 * ARGUE THAT THE ORDER `recordFill` ASKS IN MADE IT SAFE. The enumeration is obsolete
 * (#388) and the argument is retired with it. What survives, because it is still true and
 * still worth knowing: THE REACHABLE INTERVIEW IS NINETEEN `ask` SITES, not the nine
 * `record-fill.ts` holds literally. It hands `io.ask` onward to `authorLadderTarget`
 * (`record-fill-ladder-target.ts`, eight more) and to `resolveFunding`
 * (`record-fill-funding.ts`, two more), and a delegated question is no less reachable for
 * being put from another file. Every one of the nineteen refuses the sentinel:
 *
 *   - ELEVEN keep the refusal a blank already earned, in the same words — the rung pick
 *     (`unknown-rung`, and it is the first question this act reaches, so it is the one a
 *     piped run refuses at), the fill timestamp, a touched rung's observed quantity, the
 *     instrument id, `authorLadderTarget`'s five decision fields (together, as
 *     `incomplete-decision`) and `resolveFunding`'s capital tier; a blank position id
 *     abandons, and so does an unanswered one.
 *   - THE OTHER EIGHT ARE THE CHANGE, and they are the ones that used to read a blank as
 *     an answer. "Filled quantity [n]" took the rung's whole remainder; the per-rung book
 *     question took its `[r]` default and claimed that rung was resting untouched; "Also
 *     record N confirmed cancellation(s)?" recorded none and let the act continue;
 *     "Tempo [n]" took the reserve's; "Cash debited [n]" took the proposed figure; the two
 *     "[y/N]" confirmations declined; and `authorLadderTarget`'s "Append this lot to
 *     '<id>'? [Y/n]" — phrased so that SILENCE MEANS YES — attached the lot to an existing
 *     Position. All eight now abandon the act, naming the question nobody answered.
 *
 * WHAT USED TO STOP THIS ACT WRITING WAS ITS FINAL GATE, AND THAT WAS A PROPERTY OF THE
 * PHRASING. Every writer of the act sits behind `Write BOTH? [y/N]`
 * (`record-fill.ts`), on which `isAffirmative("")` is false, so an abandoned run reached
 * that gate and abandoned — after ratifying six defaults on the way, in front of an
 * operator who had already walked away. So no abandoned fill act ever reached a durable
 * write, `Append this lot? [Y/n]` included: that gate's `[Y/n]` phrasing pointed the other
 * way, but it is four questions upstream of the door, so the lot was attached in memory and
 * the act still refused. What was wrong was resting the whole act's safety on ONE gate's
 * wording. The refusal lives at each question now, so neither the ordering of this interview
 * nor the phrasing of its gates is load-bearing, and this act still needs no abandonment
 * latch of its own.
 *
 * `record-fill.test.ts` pins it: the happy-path script with exactly one answer replaced by
 * the sentinel abandons at THAT question, with both files byte-identical, and the count of
 * questions put says it stopped there rather than racing to the door.
 *
 * THE EXIT CODE IS THE SECOND HALF OF THE ANSWER, NEVER THE WHOLE OF IT. This shell maps
 * any non-`recorded` outcome to 1 and prints nothing itself; the words are `recordFill`'s
 * to write, and it writes them to `io.err` for `rejected` AND `abandoned` alike. An
 * abandoned act that reached only this line would leave the operator a dropped prompt and
 * a status, with no way to tell whether the fill landed.
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
