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
 *   2. ON A STDIN THAT IS NO TERMINAL, THE CHANNEL SAYS SO AND RETURNS "". It does not
 *      throw: throwing unwinds through the shell's outer catch and ends the run there,
 *      which makes the domain's own refusal for an unanswered interview unreachable. The
 *      empty answer is the one answer a run with no terminal can honestly give, and the
 *      domain then refuses in its own voice. Two sentences, two layers: the shell names
 *      WHY there is no answer, the flow names WHAT IT DID about it.
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
 *   4. A QUESTION THAT REJECTS RESOLVES WITH "" TOO (#370, symptom 1). At a REAL terminal
 *      `isTTY` is true, so clause 2's guard never fires; Ctrl-D then makes
 *      `rl.question()` reject, and that rejection used to unwind through each shell's
 *      outer catch, which prints `error.message` — putting Node's own wording, "Aborted
 *      with Ctrl+D" (measured: `AbortError`, code `ABORT_ERR`), on the operator's screen
 *      and ending the run there. So the domain's refusal, the message the operator
 *      actually needs, was never reached. Clause 2's reasoning applies unchanged: a
 *      question with no answer has one honest answer, `""`, and the domain refuses in its
 *      own voice. This clause is only the second door into the same decision.
 *
 *      WHY THE CATCH IS WIDE AND NOT NARROWED TO THE ABORT. `.catch(() => "")` swallows
 *      every rejection, which is deliberate. Two rejections were measured and BOTH mean
 *      the same thing: `ABORT_ERR` (Ctrl-D) and `ERR_USE_AFTER_CLOSE` / "readline was
 *      closed", which is what every question AFTER the Ctrl-D gets, because the abort
 *      closes the interface. Narrowing to `ABORT_ERR` would therefore fix the first
 *      question and hand the operator the readline internal on the second — the exact
 *      string clause 1 exists to keep off the screen. And the generalisation holds past
 *      what was measured: whatever makes a question reject, no answer arrived, and the
 *      domain must be allowed to say so. A rejected question is a missing ANSWER, never a
 *      run that cannot continue — the shells' outer catch is for the domain's failures,
 *      not for the prompt's.
 *
 * WHAT `""` MEANS IS THE CALLER'S PROBLEM, AND IT IS AN ORDERING DEPENDENCY. Read as an
 * answer, `""` means different things to different questions — a refusal at one, "take the
 * default" at another. It is safe only while the FIRST question a run reaches unanswerable
 * is one that refuses on it. That dependency now governs BOTH paths, and clause 4 WIDENS
 * IT. Clause 2 only ever reaches the FIRST question — a no-terminal run is refused there
 * and never gets further, which is why each shell's construction site can argue safety
 * from the ordering alone. Clause 4 lands wherever the operator presses Ctrl-D, which is
 * any question in the interview and every question after it. Both shells enumerate their
 * questions and both name the ones that read `""` as a silent ratification rather than a
 * refusal — six of `record-fill`'s nineteen, three of the import shell's. Those are now
 * reachable by Ctrl-D, and the sentence "only the first is ever reached" is true of the
 * no-terminal path only. This is the accepted residual of #370: it buys the domain's
 * refusal at the first question, which is where Ctrl-D is actually pressed, at the price
 * of a mid-interview Ctrl-D ratifying a default. The durable fix is the one both
 * construction sites already name — a sentinel the questions reject rather than a blank —
 * and it belongs to whichever increment makes an unanswered question distinguishable from
 * an empty one. Each shell states the dependency at its own site and each pins it, because
 * neither this module nor the other shell can see it.
 *
 * EVERYTHING IS INJECTED — `isTTY` as a value, the interface as a factory, the error sink
 * as a function — so the channel is testable with no terminal, no process and no spawn.
 * That is the whole reason the pty question #370 opens with does not have to be answered:
 * the thing under test is this channel, not Node's terminal handling. The cost is stated
 * plainly in `prompt-channel.test.ts` — the suite pins what this channel does with a
 * rejecting `question()`, and does NOT cover a real terminal delivering a real Ctrl-D.
 */

/** The readline surface this channel uses — structural, so a test can hand it a fake. */
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
  ask: (question: string) => Promise<string>;
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

  return {
    ask: (question: string): Promise<string> => {
      if (!io.isTTY) {
        if (!toldThereIsNoTerminal) {
          toldThereIsNoTerminal = true;
          io.err(io.noTerminalNotice);
        }
        return Promise.resolve("");
      }
      rl ??= io.createInterface();
      // CLAUSE 4. A rejected question is an ANSWER that did not arrive, not a run that
      // cannot continue. See the module docstring for why the catch is this wide.
      return rl.question(question).catch(() => "");
    },
    close: (): void => {
      rl?.close();
    },
  };
}
