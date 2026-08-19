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
 * under test here is the channel rather than Node's terminal handling. Symptom 1 remains
 * open in #370 and gets its own decision; nothing below claims to cover it.
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

/** The channel plus the two things a caller can observe about how it was built. */
function channelOn(isTTY: boolean, answers: string[] = []) {
  const errors: string[] = [];
  let built = 0;
  const rl = fakeInterface(answers);
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

    expect(harness.errors).toEqual([NOTICE]);
    expect(harness.errors.join("")).not.toContain("readline");
  });

  // CLAUSE 3, AND OBSERVABLE HERE FOR THE FIRST TIME. The import shell puts exactly one
  // question before refusing, so its once-per-run guard was real and unpinnable; `recordFill`
  // has nine `ask` sites, so the difference between one notice and nine is the difference
  // between a legible refusal and a wall of the shell shouting over the flow.
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
