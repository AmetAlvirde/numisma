/**
 * `S8` — THE FILL ACT: ONE ACT ACROSS TWO FILES, and the honest account of what that can
 * and cannot mean.
 *
 * When a rung fills, this flow writes BOTH halves of the truth:
 *
 *   - the `orderFilled` line into `orders.jsonl` — the claim left the book, and
 *   - the `PositionOpened` (first fill on the ladder) or `PositionAddedTo` (every fill
 *     after) with its funding leg into `events.jsonl` — the fund actually bought something.
 *
 * An `orderFilled` line with no lot, or a lot with the order still resting, is this
 * increment's own silent-drift hazard, so the act must fail loud with NEITHER written.
 *
 * TWO FILES CANNOT BE RENAMED ATOMICALLY, AND THIS FILE DOES NOT PRETEND OTHERWISE. What
 * it does instead, in order:
 *
 *   1. ALL VALIDATION UP FRONT. Both records are fully built and fully verified —
 *      `parseEvent`, `crossReferenceEvent` against genesis + the whole prior log, the
 *      monotonicity verdict, the operator's explicit confirmation — BEFORE either write.
 *      Every refusal before step 2 has written nothing at all.
 *   2. THE LOG FIRST, THE SIDECAR SECOND. Both writers build a full next image and
 *      rename, so each write is individually atomic.
 *   3. ROLLBACK. If the sidecar append fails, the log is restored to the image captured
 *      before the first write — another rename, over a complete prior file.
 *
 * THE RESIDUAL CRASH WINDOW, NAMED. A hard kill (SIGKILL, power loss) BETWEEN the two
 * renames leaves exactly one state: the log holds the `PositionOpened`/`PositionAddedTo`
 * and `orders.jsonl` still shows the rung RESTING. Nothing else is reachable — the
 * sidecar's own write is one rename, so it either happened or did not.
 *
 * That direction is deliberate, and it was chosen over the reverse for three reasons:
 *
 *   - IT ERRS CONSERVATIVE. The cash is debited and the lot is held, while the rung still
 *     counts as committed. Available reads LOW. The opposite order would leave an
 *     `orderFilled` line with no lot, which frees the rung's encumbrance while no cash
 *     moved — available reads HIGH, and overstating free capital is the error direction
 *     that costs money and the exact defect this increment exists to remove.
 *   - IT IS ALREADY LOUD. The rung is counted against a reserve that has already been
 *     debited, so `slack = balance − committed` shrinks by the fill. If the ladder was
 *     close to fully committed, the next import trips `O1`'s over-commitment reject.
 *   - IT IS DETECTABLE EXACTLY. `reconcileFillActs` (engine) finds it with no field on
 *     either record: both halves of an act share a derived id, so a lot whose
 *     `orderFilled` line is missing is arithmetic, not a guess.
 *
 * WHAT THE OPERATOR DOES ABOUT IT. This flow runs `reconcileFillActs` FIRST and REFUSES
 * to record anything while a torn act is outstanding, so the window can never be
 * compounded. The remedy is to append the missing `orderFilled` line for the named
 * `(orderId, observedAt)` — the same hand-authored path every event in this log has always
 * landed by — after which the reconciliation is clean and the flow proceeds. The log half
 * is deliberately NOT rewritten: it is the durable record of fact and it is correct; it is
 * the speculative sidecar that is behind.
 *
 * THE RECONCILIATION TRAIL IS NOT PART OF THE ACT, AND THE ARGUMENT ABOVE IS UNCHANGED BY
 * IT (`D6`, #336). After the two writes above are durable, this flow compares the fill it
 * just recorded against the plan `plans.jsonl` declares for that position and appends one
 * line to `data/reconciliations.jsonl` saying what the operator was told. That read is
 * ADVISORY: it cannot refuse a fill, fail one, roll one back, or change this flow's exit
 * code, because a plan is a declaration of intent and not an authorization. Every failure
 * of it degrades to a loud stderr warn and returns.
 *
 * Both halves of that placement are load-bearing. Writing the trail INSIDE the act would
 * let a plans-adjacent problem refuse a real observed fill; writing it BEFORE would record
 * a telling for a fill that validation then rejects. So it is last, outside the `try` that
 * rolls the log back, and the residual crash window named above is untouched — a kill
 * between the act and the trail costs one advisory line, which a reader reports as UNKNOWN
 * rather than as clean.
 */
import {
  bookedFills,
  buildEventReference,
  buildFillAct,
  classifyReconciliation,
  committedRungs,
  crossReferenceEvent,
  isIsoCalendarDate,
  isObservedAtStamp,
  isRenderableRecordId,
  OBSERVED_AT_RULE,
  parseEvent,
  pickPlanAsOf,
  pickRestingOrdersAsOf,
  proposeFillVerdicts,
  reconcileAgainstPlan,
  reconcileFillActs,
  scopeBookForFill,
  type BookObservation,
  type CapitalTier,
  type CommittedRung,
  type FillAct,
  type FundReviewData,
  type LadderTarget,
  type LoadedPlans,
  type ObservedRungState,
  type OrderRecord,
  type PlanLookup,
  type PortfolioEvent,
  type ProposedVerdict,
  type ReconciliationFillKind,
  type ReconciliationRecord,
} from "@numisma/engine";
import { formatFoldDiscards } from "@numisma/event-store";
import type { OrdersLoad } from "@numisma/preferences";
import { nextLogImage, serializeEvent } from "./event-store.js";
import { UNANSWERED, type Answer } from "./prompt-channel.js";
import { resolveFunding } from "./record-fill-funding.js";
import { authorLadderTarget } from "./record-fill-ladder-target.js";
import { renderSkipMessage } from "./skip-message.js";

/** Everything this act touches that is not a pure function, in one injectable bag. */
export interface RecordFillIo {
  ordersPath: string;
  eventsPath: string;
  loadOrders: (path: string) => Promise<OrdersLoad>;
  appendOrders: (path: string, records: OrderRecord[]) => Promise<void>;
  /** The durable log's current bytes, or `undefined` when it does not exist yet. */
  readLogImage: () => Promise<string | undefined>;
  /** Write a full next image of the log (temp + rename). */
  writeLogImage: (contents: string) => Promise<void>;
  /** Put the log back to a prior image — `undefined` means it did not exist. */
  restoreLogImage: (prior: string | undefined) => Promise<void>;
  loadGenesis: () => Promise<FundReviewData>;
  loadLogEvents: () => Promise<PortfolioEvent[]>;
  /** The FOLDED book: where the ladder's Position and the funding tier are read from. */
  loadFolded: () => Promise<FundReviewData>;
  /**
   * `plans.jsonl` — READ ONLY, and only AFTER the act (`D1`, `D6`). It is named on the
   * bag rather than resolved inside the flow for the reason every other path here is:
   * a test drives an unreadable sidecar without touching a disk.
   */
  plansPath: string;
  loadPlans: (path: string) => Promise<LoadedPlans>;
  /** `data/reconciliations.jsonl` — the trail. Appended best-effort, outside the act. */
  reconciliationsPath: string;
  appendReconciliation: (path: string, record: ReconciliationRecord) => Promise<void>;
  /**
   * THE TELLING (`D4`) — when the operator was shown the reconciliation, as an instant
   * with an EXPLICIT OFFSET. Injected rather than read from the wall clock so a test can
   * pin it, and deliberately distinct from the fill's own `asOf`: a back-dated fill's
   * telling is not the fill's date.
   */
  toldAt: () => string;
  /**
   * Ask the operator one question. Resolves what they typed, or `UNANSWERED` when there
   * was no terminal to ask or the question was abandoned — see `prompt-channel.ts`.
   *
   * EVERY QUESTION OF THIS ACT REFUSES THE SENTINEL, including the ones it delegates to
   * `authorLadderTarget` and `resolveFunding`, which take this same function. The ones
   * that already refused a blank keep their reason token (`unknown-rung`, `bad-timestamp`,
   * `bad-quantity`, `unknown-instrument`, `ambiguous-tier`, `incomplete-decision`); the
   * ones that took a DEFAULT abandon, which is this act's existing word for "nothing was
   * written and nobody said to write it".
   */
  ask: (question: string) => Promise<Answer>;
  out: (message: string) => void;
  err: (message: string) => void;
}

export type RecordFillRejection =
  | "unreadable-sidecar"
  | "unreadable-sidecar-lines"
  | "torn-fill-act"
  | "no-resting-rung"
  | "unknown-rung"
  | "bad-timestamp"
  | "bad-quantity"
  /**
   * The requested quantity fits what the rung REPORTS as still resting, and still exceeds
   * what it may BOOK: total booked fills would pass the placed quantity (#181). Separated
   * from `bad-quantity` for the same reason `unknown-order` is separated from `not-resting`
   * in `cancel-order.ts` — the quantity is not the operator's mistake here, the sidecar's
   * latest observation is, and the two want different next moves. Reachable only on a rung
   * a backwards observation resurrected.
   */
  | "exceeds-booked-fills"
  | "impossible-verdict"
  | "verdict-contradicts-operator"
  /**
   * LITERAL, and deliberately not the engine's `unfundable-reserve` (#180). The lookup
   * below goes straight at `folded.reserves`, so this fires only when the fold really does
   * not have the id. The engine's token is a claim about ADMISSION — a reserve that exists
   * and is plainly visible can still be unfundable. Two questions, two names; do not unify
   * them.
   */
  | "unknown-reserve"
  | "unknown-instrument"
  | "ambiguous-ladder-position"
  | "ambiguous-tier"
  /**
   * The operator overrode `Cash debited` UPWARD by more than the funding reserve has
   * available (`D1`, #177). Only the excess over `price × quantity` is weighed: the fill's
   * own arithmetic is available-neutral, so the default answer and every downward
   * correction pass this guard by construction.
   */
  | "uncovered-override"
  | "incomplete-decision"
  | "duplicate-fill-act"
  | "invalid-event"
  | "rejected-event"
  | "write-failed"
  | "rollback-failed";

export type RecordFillOutcome =
  | {
      status: "recorded";
      act: FillAct;
      /** Ids of rungs whose CONFIRMED `cancelled` verdict was written in the same append. */
      alsoCancelled: string[];
    }
  /** The operator declined at a confirmation gate. Nothing was written, by design. */
  | { status: "abandoned"; message: string }
  | { status: "rejected"; reason: RecordFillRejection; message: string };

function reject(
  io: RecordFillIo,
  reason: RecordFillRejection,
  message: string,
): RecordFillOutcome {
  io.err(
    `REFUSED — ${message}\nNothing was written to ${io.eventsPath} or ${io.ordersPath}.`,
  );
  return { status: "rejected", reason, message };
}

/**
 * The outcome an unanswered question earns where the answer had a DEFAULT or was a gate.
 *
 * `abandoned`, not `rejected`, and that is this act's own vocabulary rather than a new
 * one: nothing was written, nobody declined anything, and the operator's next move is to
 * record the fill again. The MESSAGE names the question — the half a reason token carries
 * badly — which is why nine per-question tokens would have bought nothing.
 *
 * `isAffirmative` KEEPS ITS `string` PARAMETER and every caller narrows before it. Widening
 * the helper so `isAffirmative(UNANSWERED)` returned false would compile and would answer
 * NO to `Write BOTH?` — right by luck at that gate, and wrong at `Append this lot?`, whose
 * `[Y/n]` phrasing makes silence mean yes. A helper that decides what silence means is the
 * defect #388 removes, one layer down.
 */
function abandon(question: string): RecordFillOutcome {
  return {
    status: "abandoned",
    message:
      `nobody answered ${question} — the terminal was abandoned (Ctrl-D), or there was ` +
      `none to conduct this interview on`,
  };
}

/**
 * An answer as text, with {@link UNANSWERED} read as the empty string.
 *
 * ONLY FOR QUESTIONS THAT ALREADY REFUSE A BLANK. At those — the rung pick, the fill
 * timestamp, a touched rung's observed quantity, the instrument id — "nobody typed
 * anything" and "nobody could be asked" earn the same refusal in the same words, and
 * collapsing them here is what keeps those refusals exactly where they were. Reaching for
 * this at a question with a DEFAULT would hand the default to a keystroke nobody made,
 * which is the whole defect #388 removes; those questions check the sentinel themselves
 * and {@link abandon}.
 */
function typedOrNothing(answer: Answer): string {
  return answer === UNANSWERED ? "" : answer.trim();
}

function isAffirmative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

/** The rung list the fill prompt renders from — the same rows `S7` substantiates with. */
function describeRung(index: number, rung: CommittedRung): string {
  return (
    `  [${index}] ${rung.orderId}\n` +
    `      ${rung.symbol} ${rung.side} ${rung.remainingQuantity} @ ${rung.price} ` +
    `= ${rung.committed} ${rung.currency} against ${rung.fundingReserveId}`
  );
}

function describeVerdict(verdict: ProposedVerdict): string {
  const evidence = verdict.evidence.disappeared
    ? "gone from the book"
    : `on the book, filled_quantity ${verdict.evidence.observedFilledQuantity}`;
  return (
    `  ${verdict.orderId} → ${verdict.verdict.toUpperCase()} [derived]\n` +
    `      evidence: ${evidence}; untouched above: ` +
    `${verdict.evidence.untouchedAbove.join(", ") || "none"}; reached above: ` +
    `${verdict.evidence.reachedAbove.join(", ") || "none"}\n` +
    `      ${verdict.rationale}`
  );
}

/**
 * Either the look at the book, or the refusal that a figure in it could not be read.
 *
 * The observation cannot just "do its best": a quantity nobody could parse used to become
 * `0`, which is the encoding for UNTOUCHED and the very input `fill-below-untouched-rung`
 * fires on — so a typo SUPPRESSED the impossible-book detection instead of tripping it
 * (#177). It refuses instead, exactly as the sibling `Filled quantity` prompt does.
 */
type BookObservationResult =
  | { status: "observed"; observation: BookObservation }
  | { status: "bad-quantity"; orderId: string; answer: string }
  /** The `[r]` default is not an observation somebody made. */
  | { status: "abandoned"; question: string };

/**
 * Ask the operator what the venue shows for every OTHER rung of the ladder.
 *
 * This is the evidence monotonicity reasons over, and it is gathered interactively rather
 * than parsed because the fills export is deferred and `T6`'s interactive path is
 * PERMANENT. The default is `resting` — the conservative answer, since claiming a rung
 * was touched is what would license a fill verdict.
 *
 * `rungs` IS ALREADY THE SCOPED SET — `scopeBookForFill`'s `observable` — and this function
 * does no scoping of its own. That is the whole correction of #175: whatever set the
 * questions cover is the set the proposal reasons over, so nothing this function declined
 * to ask about can reach `proposeFillVerdicts` as an ABSENCE. Restating the rule here as a
 * second filter is how the two drifted apart in the first place.
 *
 * EVERY QUANTITY HERE IS CUMULATIVE SINCE PLACEMENT — the one meaning `ObservedRungState.
 * filledQuantity` has (#176). Both producers in this function supply that basis: the
 * prompt names it, and the rung being recorded pushes its running TOTAL rather than this
 * fill's delta. They used to disagree, a few lines apart.
 */
async function observeBook(
  io: RecordFillIo,
  rungs: readonly CommittedRung[],
  filled: CommittedRung,
  filledQuantity: number,
  observedAt: string,
): Promise<BookObservationResult> {
  const present: ObservedRungState[] = [];

  // The rung being recorded needs no question: the operator just answered it. It leaves
  // the book only when the fill exhausts what was still claimed; a partial keeps resting
  // with its remainder, which is condition 2 expressed as state rather than as a rule.
  //
  // What is pushed is the CUMULATIVE total, not `filledQuantity` alone: everything already
  // netted out of the remainder, plus this fill. That is the same number the venue's own
  // column would show, which is the whole point of having one basis (#176).
  if (filledQuantity < filled.remainingQuantity) {
    const cumulative = filled.quantity - filled.remainingQuantity + filledQuantity;
    present.push({ orderId: filled.orderId, filledQuantity: cumulative });
  }

  for (const rung of rungs) {
    // The ONLY rung skipped here is the one being recorded, which the operator has already
    // answered for. Symbol and moment were settled by `scopeBookForFill` before this ran.
    if (rung.orderId === filled.orderId) {
      continue;
    }
    const reply = await io.ask(
      `  ${rung.orderId} — [r]esting untouched / [t]ouched / [g]one? [r]: `,
    );
    // THE `[r]` DEFAULT IS THE CONSERVATIVE ANSWER, WHICH IS NOT THE SAME AS A SAFE ONE.
    // "resting untouched" is a positive claim about the venue that monotonicity reasons
    // over, and an unanswered question makes no claim at all.
    if (reply === UNANSWERED) {
      return { status: "abandoned", question: `what the venue shows for rung '${rung.orderId}'` };
    }
    const answer = reply.trim().toLowerCase();
    if (answer === "g" || answer === "gone") {
      continue; // absent from the observation = disappeared
    }
    if (answer === "t" || answer === "touched") {
      // The BASIS is named in the prompt, because the operator is reading a column and
      // only they can tell which number they are reading. Asking for "filled_quantity"
      // bare is what let a delta and a running total mean the same field (#176).
      const rawQuantity = typedOrNothing(
        await io.ask(
          `      filled_quantity observed — the venue's CUMULATIVE total for this rung ` +
            `since it was placed, not just this session's: `,
        ),
      );
      const quantity = Number(rawQuantity);
      if (rawQuantity === "" || !Number.isFinite(quantity) || quantity <= 0) {
        // THE BOUNDARY IS `<= 0`, NOT MERELY UNPARSEABLE — and a literal `0` is refused
        // for the same reason a typo is, not as an afterthought. `0` is the encoding for
        // UNTOUCHED, which is the opposite of the `[t]ouched` just answered, and it is
        // byte-identical to what the `[r]` answer produces below: this path never needs
        // to emit it. Admitting it also skips `filled-quantity-exceeds-order`
        // (`monotonicity.ts`), since 0 exceeds nothing — the one geometry where the
        // defect is silent rather than loud. Blank refuses too: this prompt advertises
        // no `[default]`, and in this file that is what a bracketless prompt means.
        return { status: "bad-quantity", orderId: rung.orderId, answer: rawQuantity };
      }
      present.push({ orderId: rung.orderId, filledQuantity: quantity });
      continue;
    }
    present.push({ orderId: rung.orderId, filledQuantity: 0 });
  }

  return { status: "observed", observation: { observedAt, present } };
}

/**
 * The half of {@link RecordFillIo} the advisory reconcile touches — and nothing else.
 *
 * Narrowed the way `resolveFunding` takes `ask` alone: the reconcile can reach no writer
 * of the act, so no future edit of it can reach one either. Nothing in this type can
 * write `events.jsonl`, write `orders.jsonl`, or roll either back.
 */
export type ReconcileTrailIo = Pick<
  RecordFillIo,
  "plansPath" | "loadPlans" | "reconciliationsPath" | "appendReconciliation" | "toldAt" | "err"
>;

/** Everything about the fill THAT ALREADY LANDED which the reconcile reasons over. */
export interface RecordedFillFacts {
  positionId: string;
  /** `BaseEvent.id` — `D7`'s "one line per fill" is one line per event id. */
  eventId: string;
  fillKind: ReconciliationFillKind;
  /**
   * The fill's own date AND the date the selector selects on. Typed `string` rather
   * than `IsoDate` because that is what `BaseEvent.asOf` is — see {@link lookUpPlanForFill}.
   */
  asOf: string;
  /** The observed side of `D3`'s membership test. */
  lotTier: CapitalTier;
  /**
   * THE PRE-FILL born-ness set, and the ordering is the point: a `PositionOpened` fill
   * records the plan as it stood at the moment of the telling — still `pending`. That is
   * the truthful account, because this line IS the record of the loop closing. Handing
   * over the post-fill set would render it `active` and quietly destroy that fact.
   */
  existingPositionIds: ReadonlySet<string>;
}

/** The lookup for a fill whose plan could not be established — never a mismatch, never clean. */
function planUnreadable(): PlanLookup {
  return { status: "unreadable", skipped: [], unattributable: [] };
}

/**
 * `S1a` — THE CALENDAR GUARD, AND WHY IT IS NOT A `try`/`catch`.
 *
 * `pickPlanAsOf` is the one non-total call on this path: its `requireAsOf` guard THROWS
 * when `asOf` is not a strict ISO calendar date, and it throws BY DESIGN — a lax date
 * does not merely look wrong, it SORTS wrong and silently selects a different plan. `D1`
 * forbids a throw here, so the predicate is cleared BEFORE the call and its failure has a
 * specified verdict: `declared: {status: "unreadable"}`, never a mismatch and never clean.
 *
 * `BaseEvent.asOf` is typed plain `string`, not `IsoDate`, so this is a TYPE-LEVEL gap
 * and not merely a defensive one — the compiler will not catch its omission. Catching
 * around the selector instead would be the wrong repair twice over: it would swallow a
 * genuine bug, and it would leave the wrong-plan selection unaddressed.
 *
 * The plans READ is wrapped, and that is a different question. `loadPlans` is total by
 * contract, but this is an INJECTED IO boundary and IO genuinely fails; a throwing reader
 * must not reach the caller, because the fill it belongs to is already on disk.
 */
async function lookUpPlanForFill(
  io: ReconcileTrailIo,
  fill: RecordedFillFacts,
): Promise<PlanLookup> {
  if (!isIsoCalendarDate(fill.asOf)) {
    return planUnreadable();
  }
  let loaded: LoadedPlans;
  try {
    loaded = await io.loadPlans(io.plansPath);
  } catch {
    return planUnreadable();
  }
  return pickPlanAsOf(loaded, fill.positionId, fill.asOf, fill.existingPositionIds);
}

/**
 * `S1` + `S3` — THE ADVISORY RECONCILE AND THE BEST-EFFORT TRAIL APPEND.
 *
 * Called ONCE, after the two-file act is durable and outside its rollback. It returns
 * normally on every path, including every failure: the fill is already on disk, so the
 * only thing a throw here could achieve is to turn a plans problem into a failed act,
 * which is exactly what `D1` exists to make unreachable.
 *
 * `D7` — ONE LINE PER FILL, CLEAN OR WARNED. A clean fill writes a line too. The argument
 * is asymmetric detection: "warned then, clean now" is visible either way, but "clean
 * then, warns now" — a fill consistent with its plan when recorded, which now violates it
 * because the plan was narrowed retroactively — is visible only under `D7`. It is also
 * what makes a MISSING line informative rather than ambiguous.
 *
 * EXPORTED, and the reason is a real seam rather than a testing convenience. The lax-`asOf`
 * arm above is unreachable through this file's prompts — `isObservedAtStamp` already
 * round-trips the date half of the stamp `asOf` is sliced from — so the only way to pin
 * `S1a`'s ordering against the day someone "simplifies" the guard into a `catch` is to
 * drive this function directly.
 *
 * The outer `try` is a LAST RESORT, not `S1a`'s fix. The guard above is the fix; this
 * catches whatever an injected boundary does that its contract said it would not.
 */
export async function reconcileRecordedFill(
  io: ReconcileTrailIo,
  fill: RecordedFillFacts,
): Promise<void> {
  try {
    // The id travels into every diagnostic below and onto the plans report page. An id
    // that could forge a row is never interpolated — not even into stderr, which is read
    // by an operator and captured by CI.
    const renderable = isRenderableRecordId(fill.positionId);
    const label = renderable
      ? `'${fill.positionId}'`
      : "the position this fill names (its id is not renderable, so it is withheld here)";

    const lookup = await lookUpPlanForFill(io, fill);
    const reconciliation = reconcileAgainstPlan({ lookup, lotTier: fill.lotTier });
    const record: ReconciliationRecord = {
      positionId: fill.positionId,
      eventId: fill.eventId,
      fillKind: fill.fillKind,
      asOf: fill.asOf,
      toldAt: io.toldAt(),
      lotTier: fill.lotTier,
      declared: reconciliation.declared,
      mismatches: reconciliation.mismatches,
    };

    // WARN AND RECORD — never print-only, and never record-only. The warning is what the
    // operator sees now; the line is what a reader sees later, and neither substitutes
    // for the other.
    const verdict = classifyReconciliation(reconciliation);
    if (verdict === "warned") {
      io.err(
        `PLAN MISMATCH — ${label} disagrees with the plan in force: ` +
          `${reconciliation.mismatches
            .map((mismatch) =>
              mismatch === "tierNotInPlan"
                ? `the lot's capital tier '${fill.lotTier}' is not among the tiers that plan ` +
                  `declares`
                : `no plan is in force for it — the sidecar declares none, or declares an ` +
                  `explicit ending`,
            )
            .join("; ")}. The fill IS recorded and nothing about it changed: a plan is a ` +
          `declaration of intent, not an authorization.`,
      );
    } else if (verdict === "indeterminate") {
      io.err(
        `PLAN NOT CHECKED — ${label} could not be reconciled, because ${io.plansPath} ` +
          `could not be read at the moment of the telling. The fill IS recorded. The trail ` +
          `line records this as INDETERMINATE, which a reader renders UNKNOWN and never clean.`,
      );
    }

    if (!renderable) {
      // Checked rather than caught: `serializeReconciliationRecord` refuses this with a
      // throw, and `isRenderableRecordId` is exported precisely so this path does not
      // have to rely on catching one.
      warnTrail(io, "the position id is not renderable, so no line could be written");
      return;
    }

    await io.appendReconciliation(io.reconciliationsPath, record);
  } catch (error) {
    // Deliberately not "the append failed": this arm also covers a boundary that threw
    // where its contract said it would not, and naming the append would misreport which.
    warnTrail(io, "the reconciliation could not be completed", error);
  }
}

/**
 * The loud stderr warn every trail failure degrades to (`D6`).
 *
 * Loud because the alternative is silence: the fill is already durable and the caller
 * gets no signal, so this line is the only trace that the trail is now missing one. It
 * quotes no line and names no figure — the resolved path and the failure's own message
 * are the whole of what travels.
 *
 * **IT CANNOT THROW, and that is a correctness property rather than defensiveness.**
 * This is the LAST RESORT on a path whose whole contract is "returns normally on every
 * path": {@link reconcileRecordedFill}'s `catch` calls it, and the sink it writes to is
 * often the very thing that threw. `pnpm record-fill 2>&1 | head` with the pager closed
 * makes `err` throw EPIPE, and an unguarded warn there would re-throw out of the catch,
 * out of `recordFill`, and exit the CLI 1 — for a fill already durable on both files.
 * So a dead sink is swallowed: there is nowhere left to say anything, and failing the
 * act to complain about it is the one outcome `D1` forbids outright.
 */
function warnTrail(io: ReconcileTrailIo, what: string, cause?: unknown): void {
  const detail =
    cause === undefined ? "" : `: ${cause instanceof Error ? cause.message : String(cause)}`;
  try {
    io.err(
      `TRAIL NOT RECORDED — ${what}${detail}. The fill is durable and unchanged; only the ` +
        `reconciliation trail line is missing (${io.reconciliationsPath}). A reader that finds ` +
        `no line for this fill reports UNKNOWN, never clean.`,
    );
  } catch {
    // The error sink is gone. There is nowhere left to report that, and reporting it
    // is not worth failing an act that already landed.
  }
}

/**
 * Record ONE fill as one act, or refuse and write nothing.
 *
 * THE ORDERING IS THE CONTRACT: reconcile → read the book → pick the rung → gather the
 * evidence → propose the verdict → confirm → resolve the ladder's Position → author the
 * decision → build BOTH records → validate BOTH → confirm → write log → write sidecar,
 * rolling the log back if the sidecar fails.
 */
export async function recordFill(io: RecordFillIo): Promise<RecordFillOutcome> {
  // ---- 1. the sidecar, and the refusal to reason over a book we cannot fully read ----
  const load = await io.loadOrders(io.ordersPath);
  if (load.status === "unreadable") {
    return reject(io, "unreadable-sidecar", `could not read ${io.ordersPath}: ${load.message}`);
  }
  if (load.status === "loaded" && load.skips.length > 0) {
    // Same refusal, same reason code, same exit — one shared sentence (#181). A fill is
    // still withheld over a partially-read book; the operator is just told which of the
    // two problems they actually have.
    return reject(io, "unreadable-sidecar-lines", renderSkipMessage(io.ordersPath, load.skips));
  }
  const records: OrderRecord[] = load.status === "loaded" ? load.records : [];

  const genesis = await io.loadGenesis();
  const priorEvents = await io.loadLogEvents();

  // ---- 2. a torn act blocks everything, so the crash window can never compound ----
  const torn = reconcileFillActs(priorEvents, records);
  if (torn.length > 0) {
    const detail = torn
      .map(
        (act) =>
          `${act.kind}: rung '${act.orderId}' at ${act.observedAt} (event '${act.eventId}')`,
      )
      .join("; ");
    return reject(
      io,
      "torn-fill-act",
      `a previous fill act is half-landed — ${detail}. This is the named crash window: a ` +
        `hard kill between the two renames. Repair it by hand-authoring the missing half ` +
        `for that (orderId, observedAt) before recording another fill`,
    );
  }

  // ---- 3. the rung list — the same rows the committed figure is substantiated with ----
  const resting = pickRestingOrdersAsOf(records);
  const rungs = committedRungs(resting);
  if (rungs.length === 0) {
    return reject(io, "no-resting-rung", `${io.ordersPath} shows no resting buy rung to fill`);
  }
  io.out(`Resting rungs:\n${rungs.map((rung, index) => describeRung(index, rung)).join("\n")}\n`);

  // THE FIRST QUESTION OF THE ACT, and the one a run with no terminal reaches. It already
  // refused a blank as `unknown-rung`; the sentinel joins that arm word for word, which is
  // what keeps `record-fill-cli.test.ts` — "the missing terminal in the shell's voice, and
  // the refusal in the flow's" — pinning the same two sentences through #388.
  const picked = typedOrNothing(await io.ask("Which rung filled? [index or order id]: "));
  const byIndex = /^\d+$/.test(picked) ? rungs[Number(picked)] : undefined;
  const filled = byIndex ?? rungs.find((rung) => rung.orderId === picked);
  if (!filled) {
    return reject(io, "unknown-rung", `no resting rung matches '${picked}'`);
  }

  // The prompt states the rule in advance and the refusal restates it — both from the one
  // shared phrase (#181), so neither can promise the operator a looser rule than the
  // predicate on the next line enforces.
  const observedAt = typedOrNothing(await io.ask(`Fill timestamp (${OBSERVED_AT_RULE}): `));
  if (!isObservedAtStamp(observedAt)) {
    return reject(
      io,
      "bad-timestamp",
      `'${observedAt}' is not a valid stamp — ${OBSERVED_AT_RULE}`,
    );
  }
  if (observedAt < filled.observedAt) {
    return reject(
      io,
      "bad-timestamp",
      `the fill is stamped ${observedAt}, before the rung was placed (${filled.observedAt})`,
    );
  }

  const quantityReply = await io.ask(`Filled quantity [${filled.remainingQuantity}]: `);
  // A DEFAULT NOBODY TOOK. The bracketed figure is the whole remainder of the rung, so an
  // unanswered question here used to record the largest fill this rung could carry.
  if (quantityReply === UNANSWERED) {
    return abandon(
      `how much of '${filled.orderId}' filled, and ${filled.remainingQuantity} is the ` +
        `rung's whole remainder rather than an answer`,
    );
  }
  const quantityAnswer = quantityReply.trim();
  const filledQuantity =
    quantityAnswer === "" ? filled.remainingQuantity : Number(quantityAnswer);
  if (!Number.isFinite(filledQuantity) || filledQuantity <= 0) {
    return reject(io, "bad-quantity", `'${quantityAnswer}' is not a positive quantity`);
  }

  // THE ADMISSION CEILING (#181) — the gate that lets a lot and a cash leg into
  // `events.jsonl`, and the ONE place policy about it lives.
  //
  //     admissible = min(remainingQuantity, quantity − bookedFills(id))
  //
  // WHY `remainingQuantity` ALONE IS NO LONGER SUFFICIENT. The selector folds ONE
  // `consumed` baseline per rung and an `orderFillObserved` line SETS it, so `consumed` is
  // NOT MONOTONIC: an observation asserting a figure BELOW the baseline takes `remaining`
  // from zero back to positive and a retired rung RESURRECTS. That is deliberate and
  // correct arithmetic — see `select.ts`, invariant 2 — but it means `remainingQuantity` is
  // a REPORT of what is still encumbered, not an AUTHORIZATION to book against it.
  //
  // Traced on a rung placed at 10 with all 10 booked: an observation of 3 makes the fold
  // report 7 still resting, and the old gate would have authorized 7 more units — TOTAL
  // BOOKED FILLS OF 17 AGAINST A PLACED 10, two lots and two cash legs the venue never
  // filled, in a log with NO REVERSAL VERB. The invariant that closes it is not "was this
  // rung ever exhausted" — exhaustion history would push state back into a fold that must
  // stay pure — but the simpler and stronger one: a rung's TOTAL BOOKED FILLS MAY NEVER
  // EXCEED ITS PLACED QUANTITY.
  //
  // ON EVERY ORDINARY STREAM THIS IS A PROVABLE NO-OP. Placement and observation only ever
  // set the baseline at or above what the fund has booked, so `consumed ≥ bookedFills`
  // holds on any stream the import path can produce, therefore
  // `remainingQuantity ≤ quantity − bookedFills` and the `min` never binds. It binds ONLY
  // in the resurrection case, which is why this ships without re-testing every existing
  // fill path: nothing admissible before became inadmissible.
  //
  // NOT A HYPOTHETICAL REACHABILITY. `appendOrders` is typed over the whole record union
  // and constrains no kind, and this flow's OWN torn-act guidance above instructs
  // hand-authoring a missing half. Hand-editing this file is a documented operator
  // procedure. (A validating write seam on `appendOrders` would bound this class at the
  // file rather than at each caller. It is a real want and its own increment.)
  const booked = bookedFills(records, filled.orderId);
  const headroom = filled.quantity - booked;
  const ceiling = Math.min(filled.remainingQuantity, headroom);
  if (filledQuantity > ceiling) {
    // WHICH TERM BOUND DECIDES WHICH REFUSAL. When the remainder binds — every ordinary
    // stream — the operator meets the refusal they always met, unchanged. The second
    // wording is reachable only on a resurrected rung, and it is a different problem
    // needing a different next move, so it says so rather than blaming the quantity.
    return reject(
      io,
      ceiling === filled.remainingQuantity ? "bad-quantity" : "exceeds-booked-fills",
      ceiling === filled.remainingQuantity
        ? `${filledQuantity} exceeds the ${filled.remainingQuantity} still claimed by this rung`
        : `${filledQuantity} exceeds the ${headroom} this rung can still book: it was ` +
          `placed for ${filled.quantity} and ${booked} is already booked as filled against ` +
          `it. ${io.ordersPath} reports ${filled.remainingQuantity} still resting because its ` +
          `latest observation of this rung asserts LESS than the fund has already booked, ` +
          `which resurrects a rung the fund exhausted rather than re-opening one the venue ` +
          `re-opened. Recording against it would put a second lot and a second cash leg in ` +
          `${io.eventsPath} for capital already spent, and that log has no reversal verb. ` +
          `Append a correct orderFillObserved line for '${filled.orderId}' — one at or above ` +
          `${booked} — and record the fill after that`,
    );
  }

  // ---- 4. monotonicity PROPOSES, over the SAME book the questions observed (#175) ----
  //
  // ONE rung set, computed once and used twice: the operator is asked about `observable`,
  // and `sameSymbol` — that plus the rungs placed after this moment — is what reaches the
  // proposal. Handing over the whole `resting` book instead made every rung the questions
  // had skipped arrive as an ABSENCE, and an absence with nothing untouched above it
  // derives FILLED: a second open ladder proposed as a purchase, and a rung placed after
  // the fill answered for and then refused as `unknown-rung`. A later rung now surfaces
  // where it belongs, in `excluded`, named rather than reasoned over.
  const scoped = scopeBookForFill(resting, filled.symbol, observedAt);
  io.out("What does the venue show for the rest of this ladder?\n");
  const observed = await observeBook(
    io,
    committedRungs(scoped.observable),
    filled,
    filledQuantity,
    observedAt,
  );
  if (observed.status === "abandoned") {
    return abandon(observed.question);
  }
  if (observed.status === "bad-quantity") {
    return reject(
      io,
      "bad-quantity",
      `'${observed.answer}' is not a positive filled_quantity for rung '${observed.orderId}'; ` +
        `0 or blank is the encoding for UNTOUCHED, which is the opposite of the 'touched' ` +
        `you just answered`,
    );
  }
  const proposal = proposeFillVerdicts(scoped.sameSymbol, observed.observation);
  if (proposal.status === "impossible") {
    return reject(
      io,
      "impossible-verdict",
      `the observed book is impossible — ${proposal.contradictions
        .map((contradiction) => contradiction.message)
        .join("; ")}`,
    );
  }

  io.out(
    `Proposed verdicts — DERIVED, not observed:\n` +
      `${proposal.verdicts.map(describeVerdict).join("\n")}\n` +
      (proposal.excluded.length > 0
        ? `  (not simultaneously resting, excluded from the reasoning: ${proposal.excluded.join(", ")})\n`
        : ""),
  );

  const ownVerdict = proposal.verdicts.find((verdict) => verdict.orderId === filled.orderId);
  if (ownVerdict && (ownVerdict.verdict === "cancelled" || ownVerdict.verdict === "resting")) {
    // The guard doing its job: the operator says this rung filled, and the book they just
    // described contradicts it. Writing anyway would put a purchase in the log that the
    // evidence says did not happen.
    return reject(
      io,
      "verdict-contradicts-operator",
      `you recorded a fill on '${filled.orderId}', but the book you described derives ` +
        `'${ownVerdict.verdict}' for it — ${ownVerdict.rationale}`,
    );
  }

  // `O3`. Nothing above this line has written anything and nothing below writes without
  // this answer: the inference is never recorded as an observation.
  const confirmed = await io.ask("Confirm these derived verdicts? [y/N]: ");
  if (confirmed === UNANSWERED) {
    return abandon("whether the derived verdicts are right");
  }
  if (!isAffirmative(confirmed)) {
    return { status: "abandoned", message: "the derived verdicts were not confirmed" };
  }

  const cancelled = proposal.verdicts.filter((verdict) => verdict.verdict === "cancelled");
  let alsoCancelled: string[] = [];
  if (cancelled.length > 0) {
    const alsoAnswer = await io.ask(
      `Also record ${cancelled.length} confirmed cancellation(s) in this act? [y/N]: `,
    );
    // A BLANK DECLINES AND LETS THE ACT CONTINUE, which is a decision the operator made
    // about lines that go into an append-only file. An unanswered question is not that
    // decision, and the act does not get to continue on it.
    if (alsoAnswer === UNANSWERED) {
      return abandon(`whether to record ${cancelled.length} confirmed cancellation(s) in this act`);
    }
    if (isAffirmative(alsoAnswer)) {
      alsoCancelled = cancelled.map((verdict) => verdict.orderId);
    }
  }
  const proposedFills = proposal.verdicts.filter(
    (verdict) => verdict.verdict === "filled" && verdict.orderId !== filled.orderId,
  );
  if (proposedFills.length > 0) {
    // Deliberately NOT written here. A fill needs a LOT, and a lot needs its own five
    // authored decision fields and its own funding leg — i.e. its own act. Recording it
    // as a bare `orderFilled` line would manufacture exactly the half-landed state this
    // whole flow exists to make unreachable.
    io.out(
      `NOT written: ${proposedFills.map((verdict) => verdict.orderId).join(", ")} also derive ` +
        `FILLED. Each needs its own fill act — a fill without a lot is the state this act ` +
        `refuses to create.\n`,
    );
  }

  // ---- 5. the ladder's Position: first fill OPENS, every fill after APPENDS ----
  const folded = await io.loadFolded();

  // BORN-NESS, CAPTURED HERE AND USED AFTER THE ACT — the PRE-FILL set the trail's
  // `declared.status` is derived from. Computed at the fold rather than at the reconcile
  // so the ordering is a fact of this file rather than a comment about one: by the time
  // the reconcile runs, the fill has landed and re-folding would answer `active` for a
  // position that was `pending` at the moment the operator was told.
  //
  // Open positions AND closed ones, exactly as `pnpm plans` computes it: a position that
  // has been closed was realized, so omitting the closed book would render a finished
  // trade `pending` forever.
  const existingPositionIds = new Set<string>([
    ...folded.positions.map((position) => position.id),
    ...(folded.closedPositions ?? []).map((closed) => closed.positionId),
  ]);

  const reserve = folded.reserves.find((entry) => entry.id === filled.fundingReserveId);
  if (!reserve) {
    return reject(
      io,
      "unknown-reserve",
      `the rung declares funding reserve '${filled.fundingReserveId}', which the fold does not have`,
    );
  }
  const instrument = folded.instruments.find(
    (entry) => entry.symbol === filled.symbol || filled.symbol.startsWith(`${entry.symbol}/`),
  );
  let instrumentId = instrument?.id;
  if (instrumentId === undefined) {
    // The fold knows no instrument for this symbol, and neither does an unanswered
    // question — same `unknown-instrument` refusal, same words, that a blank has always
    // earned.
    instrumentId = typedOrNothing(await io.ask(`Instrument id for ${filled.symbol}: `));
  }
  if (!instrumentId || !folded.instruments.some((entry) => entry.id === instrumentId)) {
    return reject(
      io,
      "unknown-instrument",
      `no instrument in the fold matches '${filled.symbol}'`,
    );
  }

  // The authoring interview, behind its own seam (#audit-14). Its rejection arms carry the
  // reason token and the message this flow used to build inline, so `reject` still prints
  // the identical bytes; `abandoned` passes straight through, nothing having been written.
  const authored = await authorLadderTarget(
    io.ask,
    io.out,
    folded.positions,
    reserve,
    instrumentId,
  );
  if (authored.status === "rejected") {
    return reject(io, authored.reason, authored.message);
  }
  if (authored.status === "abandoned") {
    return authored;
  }
  const target: LadderTarget = authored.target;

  // ---- 6. the cash leg and the tier that is READ, never re-decided ----
  //
  // Behind its own seam (#audit-14), handed the reserve this flow already resolved. Its
  // rejection arms carry the reason token and the message this flow used to build inline,
  // so `reject` still prints the identical bytes.
  const funding = await resolveFunding(io.ask, folded, resting, reserve, filled, filledQuantity);
  if (funding.status === "abandoned") {
    return funding;
  }
  if (funding.status === "rejected") {
    return reject(io, funding.reason, funding.message);
  }
  const { fundingAmount, tier } = funding;

  // ---- 7. BOTH records, built together and validated together, before any write ----
  const act = buildFillAct({
    rung: filled,
    filledQuantity,
    observedAt,
    fundingAmount,
    tier,
    target,
  });

  if (priorEvents.some((event) => event.id === act.event.id)) {
    return reject(
      io,
      "duplicate-fill-act",
      `the log already holds event '${act.event.id}' — this fill was already recorded`,
    );
  }

  const eventLine = serializeEvent(act.event);
  // Validate the EXACT BYTES that will land, not the in-memory object: a serializer that
  // dropped a field would otherwise pass a gate the file itself would fail.
  const parsed = parseEvent(JSON.parse(eventLine));
  if (parsed.kind !== "ok") {
    return reject(io, "invalid-event", `the fill's event does not parse (${parsed.path}: ${parsed.message})`);
  }
  // THE GATE'S OWN FOLD, AND WHAT IT DROPPED BUILDING THE WORLD IT JUDGES THIS FILL
  // AGAINST (ADR-020; PRD #323 seam C). A fill recorded onto damaged history is exactly
  // when the epistemic marker is worth the most, and this is the enumeration rather than
  // a count because an operator is at the keyboard right now — the locator is what makes
  // it actionable. It NEVER blocks the fill: the log is append-only, so a drop already in
  // it can never be repaired, and refusing here would make one damaged historical event
  // permanently un-recordable-over (R2).
  const reference = buildEventReference(genesis, priorEvents);
  for (const line of formatFoldDiscards(reference)) {
    io.out(`${line}\n`);
  }
  const crossRef = crossReferenceEvent(parsed.value, reference);
  if (crossRef.kind !== "ok") {
    return reject(
      io,
      "rejected-event",
      `the fill's event fails cross-reference (${crossRef.path}: ${crossRef.message})`,
    );
  }

  const ordersToAppend: OrderRecord[] = [
    act.order,
    ...alsoCancelled.map((orderId): OrderRecord => {
      const source = rungs.find((rung) => rung.orderId === orderId);
      return {
        id: orderId,
        observedAt,
        kind: "orderCancelled",
        currency: source?.currency ?? act.order.currency,
      };
    }),
  ];

  io.out(
    `About to write ONE act across TWO files:\n` +
      `  ${io.eventsPath}  ${eventLine}\n` +
      `${ordersToAppend
        .map((record) => `  ${io.ordersPath}  ${JSON.stringify(record)}`)
        .join("\n")}\n`,
  );
  const write = await io.ask("Write BOTH? [y/N]: ");
  if (write === UNANSWERED) {
    return abandon("whether to write both files");
  }
  if (!isAffirmative(write)) {
    return { status: "abandoned", message: "the fill act was not confirmed" };
  }

  // ---- 8. THE WRITE. Log first, sidecar second, roll the log back if the sidecar fails.
  const priorImage = await io.readLogImage();
  try {
    await io.writeLogImage(nextLogImage(priorImage, [parsed.value]));
  } catch (error) {
    // The first rename never happened, so nothing landed anywhere.
    const detail = error instanceof Error ? error.message : String(error);
    return reject(io, "write-failed", `could not write ${io.eventsPath}: ${detail}`);
  }

  try {
    await io.appendOrders(io.ordersPath, ordersToAppend);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    try {
      await io.restoreLogImage(priorImage);
    } catch (rollbackError) {
      // The one state this flow cannot repair itself, so it says so in full rather than
      // reporting a tidy failure over a log that is now ahead of the sidecar.
      const rollbackDetail =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      return reject(
        io,
        "rollback-failed",
        `could not append to ${io.ordersPath} (${detail}) AND could not roll back ` +
          `${io.eventsPath} (${rollbackDetail}). The log now holds event '${act.event.id}' ` +
          `with the rung still resting — the same state the crash window leaves. Append the ` +
          `matching orderFilled line for '${act.order.id}' at ${observedAt} by hand`,
      );
    }
    return reject(
      io,
      "write-failed",
      `could not append to ${io.ordersPath} (${detail}); ${io.eventsPath} was rolled back to ` +
        `its prior image, so NEITHER half of the act is on disk`,
    );
  }

  io.out(
    `Recorded: ${act.order.filledQuantity} of ${act.order.id} filled at ${observedAt}, ` +
      `${act.event.type} '${act.event.id}' written.\n`,
  );

  // ---- 9. THE TRAIL. Advisory, best-effort, and NOT part of the act (`D6`, #336).
  //
  // Everything above this line is unchanged by it. The act is durable, the rollback is
  // closed over, the outcome is already decided, and this call cannot alter any of the
  // three — it returns normally on every path, including every failure.
  //
  // It sits AFTER the `Recorded:` line deliberately. A warning printed before that line
  // reads as a refusal, which is the one impression `D1` most needs this path not to
  // give: the fill happened, it is on disk, and what follows is advice about a plan.
  await reconcileRecordedFill(io, {
    positionId:
      act.event.type === "PositionOpened" ? act.event.position.id : act.event.positionId,
    eventId: act.event.id,
    fillKind: act.event.type,
    asOf: act.event.asOf,
    lotTier: tier,
    existingPositionIds,
  });

  return { status: "recorded", act, alsoCancelled };
}
