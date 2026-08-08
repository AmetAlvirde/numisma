/**
 * THE LADDER'S POSITION, AUTHORED — the first half of the interview `record-fill.ts` used
 * to hold inline (#audit-14).
 *
 * WHY IT LEFT. `record-fill.ts`'s header describes a DURABILITY PROTOCOL: two files, one
 * act, validation up front, log-then-sidecar, rollback, and a named crash window. None of
 * that is what this code does. This resolves a ladder to a Position and, when there is no
 * Position yet, interviews the operator for the decision context the venue has never heard
 * of (`T6`). It changes when the authoring questions change; the protocol changes when the
 * durability argument changes. Two reasons, two files.
 *
 * IT TAKES THE PROMPT CHANNELS, NOT THE IO BAG — the same narrowing `declareFunding`
 * (`import-orders-funding-declaration.ts:64`) made, and for the same two reasons: taking
 * `RecordFillIo` would import the type BACK from the module this left, and "reads nothing
 * but `ask` and `out`" could then only be held at runtime by a stub whose other members
 * throw. Narrowed, the compiler holds it and the stub is two closures.
 *
 * THE `out` CHANNEL IS NOT DECORATION. The "First fill on this ladder" line is the only
 * thing that tells the operator WHY the next five prompts appeared, and it must be
 * interleaved with them in the transcript — so it cannot be hoisted to the caller, which
 * does not yet know which branch this takes. That is the one member beyond `ask`.
 *
 * WHAT DELIBERATELY STAYED IN THE CALLER. `io.loadFolded()`, the reserve lookup
 * (`unknown-reserve`) and the conditional instrument-id ask (`unknown-instrument`) all run
 * BEFORE this: the fold and the funding reserve are read once and used by BOTH halves of
 * the interview, and the instrument ask is conditional on a fold lookup the caller already
 * performed. Pulling them in would either duplicate the lookups or make this function's
 * two rejection arms four.
 *
 * REJECTIONS ARE RETURNED, NOT PRINTED. Every arm carries the reason token and the exact
 * message `record-fill.ts` fed `reject(io, …)` before the split, and the caller feeds them
 * to the same function — so the operator's bytes are unchanged. The reason union is
 * declared narrowly HERE rather than imported from `RecordFillRejection`, which keeps the
 * back-edge out; it is assignable to the wider token set at the call site.
 */
import {
  resolveLadderPosition,
  type LadderTarget,
  type PositionDecision,
  type PositionRecord,
  type ReserveRecord,
} from "@numisma/engine";

export type LadderTargetOutcome =
  | { status: "authored"; target: LadderTarget }
  /** The operator declined a confirmation gate. The caller has written nothing. */
  | { status: "abandoned"; message: string }
  | {
      status: "rejected";
      reason: "ambiguous-ladder-position" | "incomplete-decision";
      message: string;
    };

function isNegative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "n" || normalized === "no";
}

/** The five authored decision fields. All required; a blank one abandons the act. */
async function askDecision(
  ask: (question: string) => Promise<string>,
): Promise<PositionDecision | undefined> {
  const entryThesis = (await ask("  Entry thesis: ")).trim();
  const invalidationCondition = (await ask("  Invalidation condition: ")).trim();
  const riskBudget = (await ask("  Risk budget: ")).trim();
  const plannedHoldingHorizon = (await ask("  Planned holding horizon: ")).trim();
  const strategy = (await ask("  Strategy: ")).trim();
  if (
    !entryThesis ||
    !invalidationCondition ||
    !riskBudget ||
    !plannedHoldingHorizon ||
    !strategy
  ) {
    return undefined;
  }
  return { entryThesis, invalidationCondition, riskBudget, plannedHoldingHorizon, strategy };
}

/**
 * Resolve the ladder's Position — first fill OPENS, every fill after APPENDS.
 *
 * `positions` is the WHOLE fold's open book, not a pre-filtered set: the ambiguity verdict
 * is exactly "more than one open Position on this (account, instrument)", so the filtering
 * is `resolveLadderPosition`'s to do and a caller that narrowed first could only narrow the
 * ambiguity away.
 */
export async function authorLadderTarget(
  ask: (question: string) => Promise<string>,
  out: (message: string) => void,
  positions: readonly PositionRecord[],
  reserve: ReserveRecord,
  instrumentId: string,
): Promise<LadderTargetOutcome> {
  const ladder = resolveLadderPosition(positions, {
    accountId: reserve.accountId,
    instrumentId,
  });
  if (ladder.status === "ambiguous") {
    return {
      status: "rejected",
      reason: "ambiguous-ladder-position",
      message:
        `${ladder.positionIds.join(" and ")} are both open on ${instrumentId} in ` +
        `${reserve.accountId}; "one Position per ladder" is already violated, and guessing ` +
        `which decision this lot belongs to would put it in the wrong one`,
    };
  }

  if (ladder.status === "one") {
    if (isNegative(await ask(`Append this lot to '${ladder.positionId}'? [Y/n]: `))) {
      return { status: "abandoned", message: "the ladder's existing Position was declined" };
    }
    return { status: "authored", target: { mode: "add", positionId: ladder.positionId } };
  }

  // FIRST FILL, WITH NO PLAN BEHIND IT — `T6`, and this path is permanent. The venue has
  // never heard of a Tempo, so the decision context is authored here, at the moment of
  // the fill, and nowhere else.
  out("First fill on this ladder — opening the Position.\n");
  const positionId = (await ask("  Position id: ")).trim();
  if (!positionId) {
    return { status: "abandoned", message: "no position id was given" };
  }
  const tempoAnswer = (await ask(`  Tempo [${reserve.tempo}]: `)).trim();
  const decision = await askDecision(ask);
  if (!decision) {
    return {
      status: "rejected",
      reason: "incomplete-decision",
      message:
        "all five decision fields are required to open a Position; none of them has a default",
    };
  }
  return {
    status: "authored",
    target: {
      mode: "open",
      position: {
        id: positionId,
        portfolioId: reserve.portfolioId,
        tempo: tempoAnswer === "" ? reserve.tempo : tempoAnswer,
        executionMode: reserve.executionMode,
        accountId: reserve.accountId,
        instrumentId,
        direction: "long",
        currency: reserve.currency,
      },
      decision,
    },
  };
}
