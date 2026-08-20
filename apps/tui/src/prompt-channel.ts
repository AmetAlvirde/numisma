/**
 * THE PROMPT CHANNEL — the one place a shell's readline lifecycle and its no-terminal
 * refusal live, shared by `import-orders-cli.ts` and `record-fill-cli.ts`.
 *
 * It exists because the shape #346 gave the import shell was right and was NOT shared:
 * `record-fill-cli.ts` still built its interface at module scope, so a piped run printed
 * `readline was closed` — a readline internal, verbatim, to the operator (#370, symptom 2).
 * Two shells needing the identical decisions is a real seam rather than a hypothetical
 * one, so the mechanism moved here and the shells kept their wiring.
 *
 * The decisions, all of which were previously duplicated or missing:
 *
 *   1. THE INTERFACE IS BUILT AT THE FIRST QUESTION, NEVER AT STARTUP. `createInterface`
 *      eagerly consumes stdin, so constructing it up front ends a piped stream before any
 *      question is put and the first `ask` rejects with `ERR_USE_AFTER_CLOSE`. Memoized,
 *      so one interview shares one interface, and a run that never asks never builds one.
 *   2. ON A STDIN THAT IS NO TERMINAL, THE CHANNEL SAYS SO AND RESOLVES {@link UNANSWERED}.
 *      It does not throw: throwing unwinds through the shell's outer catch and ends the run
 *      there, which makes the domain's own refusal for an unanswered interview unreachable.
 *      A question nobody could be asked has no answer, and `UNANSWERED` is how the channel
 *      says exactly that; the domain then refuses in its own voice. Two sentences, two
 *      layers: the shell names WHY there is no answer, the flow names WHAT IT DID about it.
 *   3. THE NOTICE IS WRITTEN ONCE PER RUN, not once per question. The operator learns
 *      there is no terminal from the first unanswerable question; repeating it buries the
 *      flow's refusal under copies of the shell's. NEITHER SHELL OBSERVES THE DIFFERENCE
 *      END-TO-END: both refuse at their first question, so both spawns see exactly one
 *      notice whether the guard exists or not, and counting it there would prove nothing.
 *      It is pinned where it is visible instead — `prompt-channel.test.ts` drives this
 *      channel through an interview of many questions and counts one notice. Worth holding
 *      because the interviews on the far side of those first refusals are long:
 *      `recordFill` reaches nineteen `ask` sites once the ones it delegates to
 *      `authorLadderTarget` and `resolveFunding` are counted, and the import shell's rung
 *      walk can put one question per rung.
 *   4. A QUESTION THAT REJECTS RESOLVES {@link UNANSWERED} TOO (#370, symptom 1). At a REAL
 *      terminal `isTTY` is true, so clause 2's guard never fires; Ctrl-D then makes
 *      `rl.question()` reject, and that rejection used to unwind through each shell's
 *      outer catch, which prints `error.message` — putting Node's own wording, "Aborted
 *      with Ctrl+D" (measured: `AbortError`, code `ABORT_ERR`), on the operator's screen
 *      and ending the run there. So the domain's refusal, the message the operator
 *      actually needs, was never reached. Clause 2's reasoning applies unchanged: a
 *      question with no answer resolves the value that MEANS no answer, and the domain
 *      refuses in its own voice. This clause is only the second door into the same
 *      decision, and #388 collapsed the two meanings into one: "never able to answer" and
 *      "abandoned mid-interview" are the same fact to every question downstream.
 *
 *      WHY THE CATCH IS WIDE AND NOT NARROWED TO THE ABORT. `.catch(() => UNANSWERED)`
 *      swallows every rejection, which is deliberate. Two rejections were measured and
 *      BOTH mean the same thing: `ABORT_ERR` (Ctrl-D) and `ERR_USE_AFTER_CLOSE` /
 *      "readline was closed", which is what every question AFTER the Ctrl-D gets, because
 *      the abort closes the interface. Narrowing to `ABORT_ERR` would therefore fix the
 *      first question and hand the operator the readline internal on the second — the
 *      exact string clause 1 exists to keep off the screen. And the generalisation holds
 *      past what was measured: whatever makes a question reject, no answer arrived, and
 *      the domain must be allowed to say so. A rejected question is a missing ANSWER,
 *      never a run that cannot continue — the shells' outer catch is for the domain's
 *      failures, not for the prompt's.
 *
 * WHAT AN UNANSWERED QUESTION MEANS IS NO LONGER AN ORDERING DEPENDENCY (#388). This
 * channel used to resolve `""`, and `""` is an ANSWER: a refusal at one question, "take
 * the default" at another, and outright consent at a third — so the safety of both
 * abandonment paths rested on the FIRST question a run reached unanswerable being one that
 * refuses. That sentence was true of the no-terminal path and false of Ctrl-D, which lands
 * wherever the operator presses it. `UNANSWERED` removes the dependency rather than
 * surviving it: no operator can type a symbol, so no question can mistake it for consent,
 * and each question refuses the moment it is handed one. Reorder either interview and
 * nothing about that changes.
 *
 * THE SENTINEL IS A SYMBOL AND NOT A MAGIC STRING, DELIBERATELY. A reserved string flows
 * through `isAffirmative("\0abandoned")` and is silently ratified — the same defect one
 * layer down, with an invariant humans must remember forever. `Answer` makes every call
 * site a TYPE ERROR instead: `.trim()` does not exist on `string | symbol`, and a helper
 * typed `(answer: string)` will not take one, so the compiler enumerated all 24 sites once
 * and enforces them from here on. It is not a discriminated record either
 * (`{answered:true,text} | {answered:false}`): that buys no extra safety and breaks every
 * test harness, because a fake `ask` typed `Promise<string>` stays assignable to
 * `Promise<Answer>` under a union and does not under a record.
 *
 * THE ABANDONMENT LATCH IS THE SECOND DOOR NOW, NOT THE GUARANTEE. Before the sentinel,
 * a mid-interview Ctrl-D in `orders:import` was measured reaching `import-orders.ts`'s
 * `appendOrders` with `planId`/`rungId` joins nobody declared, and the only thing standing
 * between the widened `""` and a durable write was this channel latching the abandonment
 * (`aborted` below) so the flow could refuse at its write door. The questions refuse for
 * themselves now, so the refusal lands ON the abandoned question and the latch can no
 * longer be the thing that saves a run. It is kept anyway, one increment longer, so a
 * regression in the new per-question refusals meets a guarantee that is still proven
 * rather than a gap; removing it is its own change.
 *
 * EVERYTHING IS INJECTED — `isTTY` as a value, the interface as a factory, the error sink
 * as a function — so the channel is testable with no terminal, no process and no spawn.
 * That is the whole reason the pty question #370 opens with does not have to be answered:
 * the thing under test is this channel, not Node's terminal handling. The cost is stated
 * plainly in `prompt-channel.test.ts` — the suite pins what this channel does with a
 * rejecting `question()`, and does NOT cover a real terminal delivering a real Ctrl-D.
 */

/**
 * THE ANSWER THAT IS NOT ONE — resolved by both abandonment paths, and by nothing else.
 *
 * A symbol because no operator can type one and no `Answer` can be confused for one. See
 * the module header for why this is not a reserved string and not a record.
 */
export const UNANSWERED = Symbol("unanswered");

/**
 * What a question resolves: what the operator typed, or {@link UNANSWERED}.
 *
 * The union is what forces the discipline. Every consumer must narrow before it can treat
 * the value as text, and `string` is still assignable to it — so a test fake that only
 * ever answers can stay a `Promise<string>` function.
 */
export type Answer = string | typeof UNANSWERED;

/**
 * The readline surface this channel uses — structural, so a test can hand it a fake.
 *
 * IT RESOLVES A `string`, NEVER AN {@link Answer}. This is readline's own contract, and the
 * sentinel is the CHANNEL's word about a question, not the terminal's: what readline does
 * when there is no answer is reject, and turning that into `UNANSWERED` is clause 4's job
 * one layer up.
 */
export interface PromptInterface {
  question(query: string): Promise<string>;
  close(): void;
}

export interface PromptChannelIo {
  /**
   * Whether stdin is a terminal — a VALUE, read by the shell from `process.stdin.isTTY`
   * and passed in, never read here. A channel that reached for `process` would be
   * untestable for exactly the case it exists to handle.
   */
  isTTY: boolean;
  /** Builds the readline interface. Called at most once, and only on a terminal. */
  createInterface: () => PromptInterface;
  /** Where the no-terminal notice goes. The caller owns the trailing newline. */
  err: (message: string) => void;
  /**
   * The sentence written once when there is no terminal. Per-shell, because it names
   * WHICH interview cannot be conducted, and that is the half of the message that tells
   * the operator what they were about to be asked.
   */
  noTerminalNotice: string;
}

export interface PromptChannel {
  /**
   * Put one question. Resolves what the operator typed, or {@link UNANSWERED} when there
   * was no terminal to ask (clause 2) or the question was abandoned (clause 4).
   */
  ask: (question: string) => Promise<Answer>;
  /**
   * WHETHER ANY QUESTION IN THIS RUN WAS ABANDONED — a latch, set the first time a
   * `question()` rejects and never cleared. Readable without touching module state,
   * because it is a closure over this channel's own interview and nothing else.
   *
   * IT IS THE SECOND DOOR, NOT THE FIRST. `ask` resolves `UNANSWERED` on the abandoned
   * question and on every question after it, and each question refuses that value where it
   * stands — so the refusal the operator reads names the question they walked away from.
   * The latch adds nothing to that; what it still buys is a flow-level guarantee that does
   * not depend on any one question having been written correctly: if the terminal was
   * abandoned, `import-orders.ts` writes nothing. #388 kept it for exactly one increment
   * longer so a regression in the per-question refusals meets a proven guarantee instead
   * of a gap.
   *
   * THE NO-TERMINAL PATH DOES NOT SET IT. Clause 2 never asks readline anything, so no
   * question was abandoned there — it was unaskable. Both paths resolve the same sentinel,
   * which is the point of #388; only this latch still tells them apart, and only for the
   * benefit of the write-door check.
   */
  aborted: () => boolean;
  /**
   * Closes the interface IF ONE WAS EVER BUILT. The `?.` is the whole point of the lazy
   * construction: a run that never prompted must not build an interface here just to
   * close it, which would consume stdin on the way out for no reason at all.
   */
  close: () => void;
}

export function createPromptChannel(io: PromptChannelIo): PromptChannel {
  let rl: PromptInterface | undefined;
  let toldThereIsNoTerminal = false;
  let aQuestionWasAbandoned = false;

  return {
    aborted: () => aQuestionWasAbandoned,
    ask: (question: string): Promise<Answer> => {
      if (!io.isTTY) {
        if (!toldThereIsNoTerminal) {
          toldThereIsNoTerminal = true;
          io.err(io.noTerminalNotice);
        }
        // CLAUSE 2. There was nowhere to put the question, so there is no answer to give.
        return Promise.resolve(UNANSWERED);
      }
      rl ??= io.createInterface();
      // CLAUSE 4. A rejected question is an ANSWER that did not arrive, not a run that
      // cannot continue. See the module docstring for why the catch is this wide.
      // THE LATCH IS SET HERE AND NOWHERE ELSE — see `PromptChannel.aborted`.
      return rl.question(question).catch((): Answer => {
        aQuestionWasAbandoned = true;
        return UNANSWERED;
      });
    },
    close: (): void => {
      rl?.close();
    },
  };
}
