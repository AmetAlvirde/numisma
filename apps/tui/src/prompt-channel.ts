/**
 * THE PROMPT CHANNEL — the one place a shell's readline lifecycle and its no-terminal
 * refusal live, shared by `import-orders-cli.ts` and `record-fill-cli.ts`.
 *
 * It exists because the shape #346 gave the import shell was right and was NOT shared:
 * `record-fill-cli.ts` still built its interface at module scope, so a piped run printed
 * `readline was closed` — a readline internal, verbatim, to the operator (#370, symptom 2).
 * Two shells needing the identical three decisions is a real seam rather than a
 * hypothetical one, so the mechanism moved here and the shells kept their wiring.
 *
 * The three decisions, all of which were previously duplicated or missing:
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
 *      flow's refusal under copies of the shell's. Unobservable on the import shell, which
 *      puts exactly one question before refusing — but `recordFill` has NINE `ask` sites,
 *      so here it is behaviour rather than a defensive flag, and it is pinned as such.
 *
 * WHAT `""` MEANS IS THE CALLER'S PROBLEM, AND IT IS AN ORDERING DEPENDENCY. Read as an
 * answer, `""` means different things to different questions — a refusal at one, "take the
 * default" at another. It is safe only while the FIRST question a no-terminal run reaches
 * is one that refuses on it. Each shell states that dependency at its own construction
 * site and each pins it, because neither this module nor the other shell can see it.
 *
 * EVERYTHING IS INJECTED — `isTTY` as a value, the interface as a factory, the error sink
 * as a function — so the channel is testable with no terminal, no process and no spawn.
 * That is the whole reason the pty question #370 opens with does not have to be answered
 * to fix symptom 2: the thing under test is this channel, not Node's terminal handling.
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
      return rl.question(question);
    },
    close: (): void => {
      rl?.close();
    },
  };
}
