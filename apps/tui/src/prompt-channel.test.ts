/**
 * THE PROMPT CHANNEL'S OWN CONTRACT — the three decisions two shells share, tested with
 * no terminal, no process and no spawn.
 *
 * WHY THIS SUITE EXISTS RATHER THAN A PTY HARNESS. #370 opens by saying both of its
 * symptoms are "only honestly fixable behind a pty", and that a fix landed without one
 * "would ship with an assertion that cannot fail". That is true of symptom 1 (Ctrl-D at a
 * real terminal) and NOT of symptom 2, which is what this suite closes: an eagerly
 * constructed interface against a stdin that is no terminal rejects with
 * `ERR_USE_AFTER_CLOSE` — measured, and reproducible from an ordinary spawn, because a
 * spawn's stdin is exactly the pipe that provokes it.
 *
 * The `script -q /dev/null` harness the issue proposes was tried and REJECTED ON
 * MEASUREMENT before this shape was chosen. With piped stdin it delivers Ctrl-D to the pty
 * before the child has started, so `printf '\004'`, `printf '\n'` and a real answer all
 * produce the identical `AbortError` — it cannot express the blank-line-versus-Ctrl-D
 * contrast the issue's own argument rests on, and an assertion built on it would pass for
 * the wrong reason. (It also needs a platform branch: macOS takes
 * `script -q /dev/null cmd args`, util-linux takes `script -qc "cmd args" /dev/null`, and
 * CI is ubuntu while development is darwin.)
 *
 * So the channel takes `isTTY` as a VALUE and the interface as a FACTORY, and the thing
 * under test here is the channel rather than Node's terminal handling.
 *
 * WHAT THE SYMPTOM 1 CASES BELOW DO AND DO NOT COVER. Symptom 1 is Ctrl-D at a REAL
 * terminal, where `isTTY` is true, the guard does not fire, and `rl.question()` rejects.
 * The channel's answer to that rejection is pinned here — and ONLY the channel's answer.
 * There is no pty, no spawn and no child process anywhere in this file: nothing below
 * presses Ctrl-D, and nothing below is end-to-end coverage of a terminal delivering one.
 * What is pinned is: given a `question()` that rejects with the shape Node really
 * produces, this channel resolves with `""`.
 *
 * THAT SHAPE WAS MEASURED, NOT ASSUMED — node v24.14.0, `node:readline/promises` over an
 * in-process `PassThrough` pair with `terminal: true`, a pending `question()`, and a raw
 * `\x04` byte written to the input:
 *
 *     name "AbortError", code "ABORT_ERR", message "Aborted with Ctrl+D"
 *
 * That message is the string #370 reports the operator seeing, printed by the shell's
 * outer catch. The same measurement recorded the OTHER rejection a caller can provoke: a
 * question put after the interface has closed rejects with code `ERR_USE_AFTER_CLOSE`,
 * message "readline was closed" — the readline internal symptom 2 removed from the
 * operator's screen. Both are reproduced by the authored fakes below. (It also recorded a
 * non-rejection: plain stream EOF and `rl.close()` leave a pending `question()` unsettled
 * forever rather than rejecting. Nothing here depends on that, but it is why a bare
 * `.catch()` is the whole fix and no timeout is part of it.)
 *
 * Every fake is authored. Nothing here touches `process`, stdin, or a real readline.
 */
import { describe, expect, it } from "vitest";
import { createPromptChannel, type PromptInterface } from "./prompt-channel.js";

const NOTICE = "No terminal on stdin: authored notice.";

/** A readline stand-in that records what it was asked and answers from a script. */
function fakeInterface(answers: string[]): PromptInterface & {
  asked: string[];
  closed: number;
} {
  const asked: string[] = [];
  const state = { closed: 0 };
  return {
    asked,
    get closed() {
      return state.closed;
    },
    question: async (query: string) => {
      asked.push(query);
      return answers.shift() ?? "";
    },
    close: () => {
      state.closed += 1;
    },
  };
}

/**
 * Node's Ctrl-D rejection, reproduced from the measurement in this file's header rather
 * than from the docs: an `AbortError` carrying `ABORT_ERR` and Node's own wording. This
 * is the error that reached the operator through the shells' outer catch in #370.
 */
function abortedWithCtrlD(): Error {
  const error: Error & { code?: string } = new Error("Aborted with Ctrl+D");
  error.name = "AbortError";
  error.code = "ABORT_ERR";
  return error;
}

/** The other measured rejection: any question put after the interface has closed. */
function usedAfterClose(): Error {
  const error: Error & { code?: string } = new Error("readline was closed");
  error.code = "ERR_USE_AFTER_CLOSE";
  return error;
}

/**
 * A readline stand-in that behaves the way the measured one does once Ctrl-D lands: the
 * question in flight rejects with the abort, and every question after it rejects with
 * `ERR_USE_AFTER_CLOSE`, because the interface is closed from that moment on. `close()`
 * still counts, because the shell calls it in its `finally` either way.
 */
function ctrlDInterface(): PromptInterface & { asked: string[]; closed: number } {
  const asked: string[] = [];
  const state = { closed: 0 };
  return {
    asked,
    get closed() {
      return state.closed;
    },
    question: async (query: string) => {
      asked.push(query);
      throw asked.length === 1 ? abortedWithCtrlD() : usedAfterClose();
    },
    close: () => {
      state.closed += 1;
    },
  };
}

/** The channel plus the two things a caller can observe about how it was built. */
function channelOn(
  isTTY: boolean,
  answers: string[] = [],
  rl: PromptInterface & { asked: string[]; closed: number } = fakeInterface(answers),
) {
  const errors: string[] = [];
  let built = 0;
  const channel = createPromptChannel({
    isTTY,
    createInterface: () => {
      built += 1;
      return rl;
    },
    err: (message) => errors.push(message),
    noTerminalNotice: NOTICE,
  });
  return {
    channel,
    errors,
    rl,
    get built() {
      return built;
    },
  };
}

describe("the prompt channel builds its interface at the first question, never at startup", () => {
  // THE REGRESSION ITSELF (#370, symptom 2). `record-fill-cli.ts` called `createInterface`
  // at module scope; `createInterface` eagerly consumes stdin, so on a pipe the stream had
  // ended before the first question was put and `ask` rejected with `ERR_USE_AFTER_CLOSE`
  // — `readline was closed`, printed verbatim to the operator. Constructing the channel
  // must therefore build NOTHING.
  it("builds no interface when the channel is merely constructed", () => {
    const harness = channelOn(true);

    expect(harness.built).toBe(0);
  });

  it("builds ONE on the first question and reuses it for the rest of the interview", async () => {
    const harness = channelOn(true, ["first", "second", "third"]);

    expect(await harness.channel.ask("a? ")).toBe("first");
    expect(await harness.channel.ask("b? ")).toBe("second");
    expect(await harness.channel.ask("c? ")).toBe("third");

    // One interface across three questions — an interview, not three of them.
    expect(harness.built).toBe(1);
    expect(harness.rl.asked).toEqual(["a? ", "b? ", "c? "]);
  });

  it("closes the interface it built", () => {
    const harness = channelOn(true, ["only"]);

    return harness.channel.ask("a? ").then(() => {
      harness.channel.close();
      expect(harness.rl.closed).toBe(1);
    });
  });

  // The other half of lazy construction, and the reason `close()` is `rl?.close()`: a run
  // that never prompted must not build an interface on the way out just to close it, which
  // would consume stdin for no reason at all.
  it("closes NOTHING when no question was ever put", () => {
    const harness = channelOn(true);

    harness.channel.close();

    expect(harness.built).toBe(0);
    expect(harness.rl.closed).toBe(0);
  });
});

describe("on a stdin that is no terminal the channel says so and returns an empty answer", () => {
  it("never touches readline at all", async () => {
    const harness = channelOn(false);

    await harness.channel.ask("a? ");

    // Not "built one and got an error from it" — never built one. This is what keeps the
    // readline internal off the operator's screen rather than catching it after the fact.
    expect(harness.built).toBe(0);
    expect(harness.rl.asked).toEqual([]);
  });

  it("RESOLVES with '' rather than throwing", async () => {
    const harness = channelOn(false);

    // Throwing would unwind through the shell's outer catch and end the run there, which
    // makes the domain's own refusal for an unanswered interview unreachable. The empty
    // answer is the one answer a run with no terminal can honestly give.
    await expect(harness.channel.ask("a? ")).resolves.toBe("");
  });

  it("writes the shell's own sentence, not readline's", async () => {
    const harness = channelOn(false);

    await harness.channel.ask("a? ");

    // The array's full contents, so the shell's sentence is the ONLY thing on this
    // channel — no readline internal alongside it, and nothing else either.
    expect(harness.errors).toEqual([NOTICE]);
  });

  // CLAUSE 3, AND THIS IS THE ONLY PLACE IT IS OBSERVABLE. Both shells refuse at their
  // first question, so an end-to-end run sees one notice whether the guard exists or not
  // and can only smoke-test it. Here the questions are forced, so deleting the
  // `toldThereIsNoTerminal` flag turns this case red and nothing else does. What it buys:
  // `recordFill` reaches nineteen `ask` sites once its delegated interviews are counted,
  // and the difference between one notice and nineteen is the difference between a legible
  // refusal and a wall of the shell shouting over the flow.
  it("writes the notice ONCE across an interview of many questions", async () => {
    const harness = channelOn(false);

    for (let index = 0; index < 9; index += 1) {
      expect(await harness.channel.ask(`q${index}? `)).toBe("");
    }

    expect(harness.errors).toEqual([NOTICE]);
  });

  it("closes nothing, because nothing was opened", async () => {
    const harness = channelOn(false);

    await harness.channel.ask("a? ");
    harness.channel.close();

    expect(harness.rl.closed).toBe(0);
  });
});

describe("on a terminal where the question is aborted the channel ends the ANSWER, not the run", () => {
  // #370, SYMPTOM 1. At a real terminal `isTTY` is true, so the no-terminal guard never
  // fires; Ctrl-D makes `rl.question()` reject, and before this decision that rejection
  // unwound through the shell's outer catch — `import-orders-cli.ts` and
  // `record-fill-cli.ts` both print `error.message` there — putting Node's own wording,
  // "Aborted with Ctrl+D", on the operator's screen and ending the run. The consequence
  // the issue names: the domain's refusal, `REFUSED — no funding reserve was declared for
  // this batch`, was never reached. Resolving with `""` is the same answer the
  // no-terminal path gives, and it lets the domain refuse in its own voice.
  it("RESOLVES with '' when the question rejects with Node's measured Ctrl-D abort", async () => {
    const harness = channelOn(true, [], ctrlDInterface());

    await expect(harness.channel.ask("funding reserve? ")).resolves.toBe("");

    // It really did reach readline — this is the terminal path, not the guard.
    expect(harness.built).toBe(1);
    expect(harness.rl.asked).toEqual(["funding reserve? "]);
  });

  // Ctrl-D closes the interface, so the interview does not stop at the aborted question:
  // whatever the flow asks next reaches a closed readline and rejects with
  // `ERR_USE_AFTER_CLOSE` — the readline internal #370's symptom 2 took off the
  // operator's screen. It must not come back through this door. Every later question
  // answers `""` too, which is what carries a nineteen-question interview all the way to
  // the domain's refusal instead of ending it at the first one.
  it("keeps answering '' for the rest of the interview once the interface is closed", async () => {
    const harness = channelOn(true, [], ctrlDInterface());

    expect(await harness.channel.ask("first? ")).toBe("");
    expect(await harness.channel.ask("second? ")).toBe("");
    expect(await harness.channel.ask("third? ")).toBe("");

    expect(harness.rl.asked).toEqual(["first? ", "second? ", "third? "]);
    // Still one interface. An abort is not a reason to build another one.
    expect(harness.built).toBe(1);
  });

  // Nothing is written to the error sink: the abort is not the shell's news to report.
  // The domain's refusal is the message the operator gets, and it arrives on its own.
  it("says nothing of its own about the abort", async () => {
    const harness = channelOn(true, [], ctrlDInterface());

    await harness.channel.ask("a? ");

    expect(harness.errors).toEqual([]);
  });

  // The shells close in a `finally`, so `close()` runs on this path too. It was built,
  // so it closes — once, and without throwing, even though readline is already closed.
  it("still closes the interface it built", async () => {
    const harness = channelOn(true, [], ctrlDInterface());

    await harness.channel.ask("a? ");
    harness.channel.close();

    expect(harness.rl.closed).toBe(1);
  });
});
