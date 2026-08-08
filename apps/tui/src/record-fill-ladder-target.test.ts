// THE SEAM'S OWN TESTS — the point of the extraction (#audit-14), and the thing the
// fifteen-element positional array could not buy.
//
// WHAT THE END-TO-END SUITES COULD NOT HOLD. Before the split, the only way to reach the
// "open the Position" branch was `openTopRungAnswers()` — fifteen answers by INDEX, mirrored
// across ~30 call sites in two suites, where inserting one prompt silently shifts every
// later answer and fails as a wrong-looking assertion somewhere downstream. Two of those
// fifteen are already conditional, so the array's meaning depends on the fixture's shape.
// Here every answer is keyed BY PROMPT, so a reordered or renamed prompt is a named
// failure at the prompt, and adding a sixth decision field breaks nothing that is not
// about the sixth decision field.
//
// AND THE PROMPT STRINGS ARE ASSERTED, not just the answers. The `[Y/n]` on the append
// gate and the `[reserve.tempo]` default hint in the Tempo prompt are output rules that
// nothing held before: both could be deleted and the whole suite stayed green, because the
// stub answered by position and never read what it was asked.
//
// EVERY FIXTURE IS SYNTHETIC (`O7`). Invented instrument, round decade prices, round
// balances. No real price, quantity, balance, rung or Tempo percentage appears here.
import { describe, expect, it } from "vitest";
import type { PositionRecord, ReserveRecord } from "@numisma/engine";
import { authorLadderTarget } from "./record-fill-ladder-target.js";

function reserve(overrides: Partial<ReserveRecord> = {}): ReserveRecord {
  return {
    id: "reserve-synthetic",
    portfolioId: "portfolio-synthetic",
    tempo: "Capital",
    executionMode: "live",
    accountId: "account-synthetic",
    currency: "USD",
    amount: 10000,
    lots: [{ quantity: 10000, tier: "c1" }],
    ...overrides,
  };
}

function position(id: string, overrides: Partial<PositionRecord> = {}): PositionRecord {
  return {
    id,
    portfolioId: "portfolio-synthetic",
    tempo: "Capital",
    executionMode: "live",
    accountId: "account-synthetic",
    currency: "USD",
    instrumentId: "instrument-synthetic",
    direction: "long",
    markPrice: 400,
    lots: [{ quantity: 10, tier: "c1", cost: 4000 }],
    ...overrides,
  };
}

/**
 * The whole test surface of this module: two closures.
 *
 * Answers are keyed by a SUBSTRING of the prompt, not by index — that is the seam's payoff.
 * An unmatched prompt throws rather than defaulting to `""`, so a prompt this test did not
 * anticipate is a loud failure instead of a silently-blank answer that happens to abandon.
 */
function scripted(answers: Record<string, string>) {
  const asked: string[] = [];
  const printed: string[] = [];
  return {
    asked,
    printed,
    ask: async (question: string): Promise<string> => {
      asked.push(question);
      const hit = Object.entries(answers).find(([key]) => question.includes(key));
      if (!hit) {
        throw new Error(`unscripted prompt: ${JSON.stringify(question)}`);
      }
      return hit[1];
    },
    out: (message: string): void => {
      printed.push(message);
    },
  };
}

const FIVE_FIELDS = {
  "Entry thesis": "synthetic entry thesis",
  "Invalidation condition": "synthetic invalidation condition",
  "Risk budget": "synthetic risk budget",
  "Planned holding horizon": "synthetic horizon",
  Strategy: "synthetic strategy",
};

describe("authorLadderTarget — the ladder already has a Position", () => {
  it("appends to it on the default answer, and asks with a [Y/n] default-yes hint", async () => {
    const io = scripted({ "Append this lot": "" });

    const outcome = await authorLadderTarget(
      io.ask,
      io.out,
      [position("position-synthetic")],
      reserve(),
      "instrument-synthetic",
    );

    expect(outcome).toEqual({
      status: "authored",
      target: { mode: "add", positionId: "position-synthetic" },
    });
    // The gate names the Position it would append to — the operator cannot confirm a
    // ladder they were not shown — and `[Y/n]` says a bare Enter appends.
    expect(io.asked).toEqual(["Append this lot to 'position-synthetic'? [Y/n]: "]);
    // The existing-Position branch is SILENT. The "First fill" notice belongs to the other
    // branch and printing it here would tell the operator the opposite of what happened.
    expect(io.printed).toEqual([]);
  });

  it("abandons on an explicit no — and only on a NEGATIVE, not on anything-but-yes", async () => {
    for (const answer of ["n", "N", "no", " NO "]) {
      const io = scripted({ "Append this lot": answer });
      const outcome = await authorLadderTarget(
        io.ask,
        io.out,
        [position("position-synthetic")],
        reserve(),
        "instrument-synthetic",
      );
      expect(outcome).toEqual({
        status: "abandoned",
        message: "the ladder's existing Position was declined",
      });
    }
    // The default is YES, so an unrecognized answer APPENDS rather than abandoning. This is
    // the asymmetry `[Y/n]` advertises, and it is the opposite of every other gate in the
    // fill flow — worth an assertion of its own.
    for (const answer of ["y", "", "maybe", "nope"]) {
      const io = scripted({ "Append this lot": answer });
      const outcome = await authorLadderTarget(
        io.ask,
        io.out,
        [position("position-synthetic")],
        reserve(),
        "instrument-synthetic",
      );
      expect(outcome.status).toBe("authored");
    }
  });

  it("refuses when two Positions are open on the same (account, instrument)", async () => {
    // Nothing is asked: guessing which decision the lot belongs to is the failure, so there
    // is no question that could resolve it.
    const io = scripted({});

    const outcome = await authorLadderTarget(
      io.ask,
      io.out,
      [position("position-a"), position("position-b")],
      reserve(),
      "instrument-synthetic",
    );

    expect(outcome).toEqual({
      status: "rejected",
      reason: "ambiguous-ladder-position",
      message:
        "position-a and position-b are both open on instrument-synthetic in " +
        'account-synthetic; "one Position per ladder" is already violated, and guessing ' +
        "which decision this lot belongs to would put it in the wrong one",
    });
    expect(io.asked).toEqual([]);
  });

  it("scopes the ladder by BOTH account and instrument, so a neighbour is not a match", async () => {
    // A Position on the same instrument in a DIFFERENT account, and one in the same account
    // on a DIFFERENT instrument. Neither is this ladder; two of them are not an ambiguity.
    const io = scripted({ "Position id": "", ...FIVE_FIELDS });

    const outcome = await authorLadderTarget(
      io.ask,
      io.out,
      [
        position("position-elsewhere", { accountId: "account-other" }),
        position("position-other-asset", { instrumentId: "instrument-other" }),
      ],
      reserve(),
      "instrument-synthetic",
    );

    // Falls through to the OPEN branch — there is no Position on this ladder — and
    // abandons on the blank id, which is how we know it never found one to append to.
    expect(outcome).toEqual({ status: "abandoned", message: "no position id was given" });
  });
});

describe("authorLadderTarget — first fill on the ladder opens the Position (T6)", () => {
  it("builds the Position from the funding reserve and the five authored fields", async () => {
    const io = scripted({ "Position id": "position-synthetic", Tempo: "", ...FIVE_FIELDS });

    const outcome = await authorLadderTarget(io.ask, io.out, [], reserve(), "instrument-synthetic");

    expect(outcome).toEqual({
      status: "authored",
      target: {
        mode: "open",
        position: {
          id: "position-synthetic",
          // EVERY ONE OF THESE IS READ OFF THE RESERVE, never asked. The lot is born into
          // the portfolio, execution mode, account and currency that funded it; asking
          // would be a second chance to disagree with the Transfer.
          portfolioId: "portfolio-synthetic",
          tempo: "Capital",
          executionMode: "live",
          accountId: "account-synthetic",
          instrumentId: "instrument-synthetic",
          // A fill against a resting BUY rung is always long. There is no short path here.
          direction: "long",
          currency: "USD",
        },
        decision: {
          entryThesis: "synthetic entry thesis",
          invalidationCondition: "synthetic invalidation condition",
          riskBudget: "synthetic risk budget",
          plannedHoldingHorizon: "synthetic horizon",
          strategy: "synthetic strategy",
        },
      },
    });
    // The notice says WHY five prompts just appeared, and it is printed BEFORE them —
    // interleaved into the transcript, which is why it cannot be hoisted to the caller.
    expect(io.printed).toEqual(["First fill on this ladder — opening the Position.\n"]);
  });

  it("offers the reserve's tempo as the default and takes an override", async () => {
    const withDefault = scripted({
      "Position id": "position-synthetic",
      Tempo: "",
      ...FIVE_FIELDS,
    });
    await authorLadderTarget(
      withDefault.ask,
      withDefault.out,
      [],
      reserve({ tempo: "Tempo Synthetic" }),
      "instrument-synthetic",
    );
    // The DEFAULT HINT names the reserve's own tempo. Nothing held this before: the hint
    // could be dropped entirely and every positional test stayed green.
    expect(withDefault.asked).toContain("  Tempo [Tempo Synthetic]: ");

    const overridden = scripted({
      "Position id": "position-synthetic",
      Tempo: "  Tempo Other  ",
      ...FIVE_FIELDS,
    });
    const outcome = await authorLadderTarget(
      overridden.ask,
      overridden.out,
      [],
      reserve({ tempo: "Tempo Synthetic" }),
      "instrument-synthetic",
    );
    expect(outcome.status === "authored" && outcome.target.mode === "open").toBe(true);
    if (outcome.status === "authored" && outcome.target.mode === "open") {
      // Trimmed, and the reserve's value is NOT used once an override is given.
      expect(outcome.target.position.tempo).toBe("Tempo Other");
    }
  });

  it("abandons on a blank position id, before asking for a tempo or any decision field", async () => {
    const io = scripted({ "Position id": "   " });

    const outcome = await authorLadderTarget(io.ask, io.out, [], reserve(), "instrument-synthetic");

    expect(outcome).toEqual({ status: "abandoned", message: "no position id was given" });
    // ORDERING IS THE ASSERTION. The five decision fields are real authoring work, and a
    // flow that collected them and THEN discovered the missing id would have wasted it. The
    // scripted stub throws on any prompt beyond the id, so this holds by construction.
    expect(io.asked).toEqual(["  Position id: "]);
  });

  it("refuses when ANY ONE of the five decision fields is blank — none has a default", async () => {
    for (const missing of Object.keys(FIVE_FIELDS)) {
      const io = scripted({
        "Position id": "position-synthetic",
        Tempo: "",
        ...FIVE_FIELDS,
        [missing]: "   ",
      });

      const outcome = await authorLadderTarget(
        io.ask,
        io.out,
        [],
        reserve(),
        "instrument-synthetic",
      );

      expect(outcome).toEqual({
        status: "rejected",
        reason: "incomplete-decision",
        message:
          "all five decision fields are required to open a Position; none of them has a default",
      });
      // ALL FIVE ARE ASKED BEFORE ANY IS JUDGED. Bailing at the first blank would make the
      // operator re-run the interview to find the second one.
      expect(io.asked).toHaveLength(7);
    }
  });

  it("trims every authored field, so whitespace never lands in the durable decision", async () => {
    const io = scripted({
      "Position id": "  position-synthetic  ",
      Tempo: "",
      "Entry thesis": "  synthetic entry thesis  ",
      "Invalidation condition": "  synthetic invalidation condition  ",
      "Risk budget": "  synthetic risk budget  ",
      "Planned holding horizon": "  synthetic horizon  ",
      Strategy: "  synthetic strategy  ",
    });

    const outcome = await authorLadderTarget(io.ask, io.out, [], reserve(), "instrument-synthetic");

    expect(outcome.status).toBe("authored");
    if (outcome.status === "authored" && outcome.target.mode === "open") {
      expect(outcome.target.position.id).toBe("position-synthetic");
      expect(outcome.target.decision).toEqual({
        entryThesis: "synthetic entry thesis",
        invalidationCondition: "synthetic invalidation condition",
        riskBudget: "synthetic risk budget",
        plannedHoldingHorizon: "synthetic horizon",
        strategy: "synthetic strategy",
      });
    }
  });

  it("asks the five fields in the order the operator reads them", async () => {
    const io = scripted({ "Position id": "position-synthetic", Tempo: "", ...FIVE_FIELDS });

    await authorLadderTarget(io.ask, io.out, [], reserve(), "instrument-synthetic");

    expect(io.asked).toEqual([
      "  Position id: ",
      "  Tempo [Capital]: ",
      "  Entry thesis: ",
      "  Invalidation condition: ",
      "  Risk budget: ",
      "  Planned holding horizon: ",
      "  Strategy: ",
    ]);
  });
});
