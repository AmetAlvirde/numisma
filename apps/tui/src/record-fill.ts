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
 */
import {
  buildEventReference,
  buildFillAct,
  committedRungs,
  composeAvailableCapital,
  crossReferenceEvent,
  deriveFundingTier,
  isObservedAtStamp,
  parseEvent,
  pickRestingOrdersAsOf,
  proposeFillVerdicts,
  reconcileFillActs,
  resolveLadderPosition,
  scopeBookForFill,
  type BookObservation,
  type CapitalTier,
  type CommittedRung,
  type FillAct,
  type FundReviewData,
  type LadderTarget,
  type ObservedRungState,
  type OrderRecord,
  type PortfolioEvent,
  type PositionDecision,
  type ProposedVerdict,
} from "@numisma/engine";
import type { OrdersLoad } from "@numisma/preferences";
import { nextLogImage, serializeEvent } from "./event-store.js";

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
  ask: (question: string) => Promise<string>;
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

function isAffirmative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "y" || normalized === "yes";
}

function isNegative(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === "n" || normalized === "no";
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
  | { status: "bad-quantity"; orderId: string; answer: string };

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
    const answer = (
      await io.ask(`  ${rung.orderId} — [r]esting untouched / [t]ouched / [g]one? [r]: `)
    )
      .trim()
      .toLowerCase();
    if (answer === "g" || answer === "gone") {
      continue; // absent from the observation = disappeared
    }
    if (answer === "t" || answer === "touched") {
      // The BASIS is named in the prompt, because the operator is reading a column and
      // only they can tell which number they are reading. Asking for "filled_quantity"
      // bare is what let a delta and a running total mean the same field (#176).
      const rawQuantity = (
        await io.ask(
          `      filled_quantity observed — the venue's CUMULATIVE total for this rung ` +
            `since it was placed, not just this session's: `,
        )
      ).trim();
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

/** The five authored decision fields. All required; a blank one abandons the act. */
async function askDecision(io: RecordFillIo): Promise<PositionDecision | undefined> {
  const entryThesis = (await io.ask("  Entry thesis: ")).trim();
  const invalidationCondition = (await io.ask("  Invalidation condition: ")).trim();
  const riskBudget = (await io.ask("  Risk budget: ")).trim();
  const plannedHoldingHorizon = (await io.ask("  Planned holding horizon: ")).trim();
  const strategy = (await io.ask("  Strategy: ")).trim();
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
    return reject(
      io,
      "unreadable-sidecar-lines",
      `${io.ordersPath} has ${load.skips.length} line(s) this build cannot read, so the resting ` +
        `book monotonicity would reason over is only partly known`,
    );
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

  const picked = (await io.ask("Which rung filled? [index or order id]: ")).trim();
  const byIndex = /^\d+$/.test(picked) ? rungs[Number(picked)] : undefined;
  const filled = byIndex ?? rungs.find((rung) => rung.orderId === picked);
  if (!filled) {
    return reject(io, "unknown-rung", `no resting rung matches '${picked}'`);
  }

  const observedAt = (await io.ask("Fill timestamp (YYYY-MM-DDTHH:MM:SS): ")).trim();
  if (!isObservedAtStamp(observedAt)) {
    return reject(io, "bad-timestamp", `'${observedAt}' is not a YYYY-MM-DDTHH:MM:SS stamp`);
  }
  if (observedAt < filled.observedAt) {
    return reject(
      io,
      "bad-timestamp",
      `the fill is stamped ${observedAt}, before the rung was placed (${filled.observedAt})`,
    );
  }

  const quantityAnswer = (
    await io.ask(`Filled quantity [${filled.remainingQuantity}]: `)
  ).trim();
  const filledQuantity =
    quantityAnswer === "" ? filled.remainingQuantity : Number(quantityAnswer);
  if (!Number.isFinite(filledQuantity) || filledQuantity <= 0) {
    return reject(io, "bad-quantity", `'${quantityAnswer}' is not a positive quantity`);
  }
  if (filledQuantity > filled.remainingQuantity) {
    return reject(
      io,
      "bad-quantity",
      `${filledQuantity} exceeds the ${filled.remainingQuantity} still claimed by this rung`,
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
  if (!isAffirmative(await io.ask("Confirm these derived verdicts? [y/N]: "))) {
    return { status: "abandoned", message: "the derived verdicts were not confirmed" };
  }

  const cancelled = proposal.verdicts.filter((verdict) => verdict.verdict === "cancelled");
  let alsoCancelled: string[] = [];
  if (cancelled.length > 0) {
    if (
      isAffirmative(
        await io.ask(
          `Also record ${cancelled.length} confirmed cancellation(s) in this act? [y/N]: `,
        ),
      )
    ) {
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
  const instrumentId =
    instrument?.id ?? (await io.ask(`Instrument id for ${filled.symbol}: `)).trim();
  if (!instrumentId || !folded.instruments.some((entry) => entry.id === instrumentId)) {
    return reject(
      io,
      "unknown-instrument",
      `no instrument in the fold matches '${filled.symbol}'`,
    );
  }

  const ladder = resolveLadderPosition(folded.positions, {
    accountId: reserve.accountId,
    instrumentId,
  });
  if (ladder.status === "ambiguous") {
    return reject(
      io,
      "ambiguous-ladder-position",
      `${ladder.positionIds.join(" and ")} are both open on ${instrumentId} in ` +
        `${reserve.accountId}; "one Position per ladder" is already violated, and guessing ` +
        `which decision this lot belongs to would put it in the wrong one`,
    );
  }

  let target: LadderTarget;
  if (ladder.status === "one") {
    if (isNegative(await io.ask(`Append this lot to '${ladder.positionId}'? [Y/n]: `))) {
      return { status: "abandoned", message: "the ladder's existing Position was declined" };
    }
    target = { mode: "add", positionId: ladder.positionId };
  } else {
    // FIRST FILL, WITH NO PLAN BEHIND IT — `T6`, and this path is permanent. The venue has
    // never heard of a Tempo, so the decision context is authored here, at the moment of
    // the fill, and nowhere else.
    io.out("First fill on this ladder — opening the Position.\n");
    const positionId = (await io.ask("  Position id: ")).trim();
    if (!positionId) {
      return { status: "abandoned", message: "no position id was given" };
    }
    const tempoAnswer = (await io.ask(`  Tempo [${reserve.tempo}]: `)).trim();
    const decision = await askDecision(io);
    if (!decision) {
      return reject(
        io,
        "incomplete-decision",
        "all five decision fields are required to open a Position; none of them has a default",
      );
    }
    target = {
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
    };
  }

  // ---- 6. the cash leg and the tier that is READ, never re-decided ----
  const proposedFunding = filled.price * filledQuantity;
  const fundingAnswer = (await io.ask(`Cash debited [${proposedFunding}]: `)).trim();
  const fundingAmount = fundingAnswer === "" ? proposedFunding : Number(fundingAnswer);
  if (!Number.isFinite(fundingAmount) || fundingAmount <= 0) {
    return reject(io, "bad-quantity", `'${fundingAnswer}' is not a positive cash amount`);
  }

  // `D1` (#177) — THE ACT IS EXEMPT; THE OVERRIDE IS GUARDED, and only upward.
  //
  // The arithmetic decides where the guard goes. `available = value − committed`, and this
  // act moves BOTH terms: the `orderFilled` line drops `committed` by `price × quantity`
  // and the cash leg drops `value` by the amount debited. So
  //
  //     Δavailable = price × quantity − cash debited
  //
  // and the DEFAULT answer — `proposedFunding`, the two multiplied — is exactly
  // available-neutral BY CONSTRUCTION. The fill itself therefore cannot break the
  // `available ≥ 0` invariant no matter what shape the book is in, which is why this flow
  // does NOT call `checkFundingCoverage`: that guard weighs the WHOLE book and refuses it
  // if ANY rung anywhere in it is unplaceable (#179), so one stale `fundingReserveId` on
  // an unrelated rung would refuse a fill that really happened at the venue. A fill is an
  // observed fact; the flow does not get to disbelieve it.
  //
  // The override is not an observed fact. It is the operator asserting a figure nothing at
  // the venue vouches for, and it is the ONLY input in this act that can drive a reserve
  // negative. What is weighed is the EXCESS over the neutral figure — never "post-act
  // available ≥ 0", which would brick every fill, neutral ones included, on any book that
  // already sits negative from some other cause. A downward correction FREES availability
  // and never reaches this branch.
  const excess = fundingAmount - proposedFunding;
  if (excess > 0) {
    // The report's own arithmetic, over the report's own admission policy — not a second
    // implementation of `value − committed` that could drift from the rendered figure.
    const capital = composeAvailableCapital(folded, resting);
    const funder = capital.reserves.find((entry) => entry.reserveId === reserve.id);
    if (!funder) {
      return reject(
        io,
        "uncovered-override",
        `you asked to debit ${fundingAmount} against '${reserve.id}' — ${excess} more than the ` +
          `${proposedFunding} this fill accounts for — but the available-capital report does ` +
          `not place that reserve (paper execution mode, an unsupported currency, a dangling ` +
          `account reference), so the excess cannot be weighed against anything. The fill ` +
          `itself is recordable at the default figure`,
      );
    }
    if (excess > funder.available) {
      return reject(
        io,
        "uncovered-override",
        `you asked to debit ${fundingAmount} against '${reserve.id}', ${excess} more than the ` +
          `${proposedFunding} this fill accounts for, and '${reserve.id}' has only ` +
          `${funder.available} available (${funder.value} balance less ${funder.committed} ` +
          `committed). The fill's own arithmetic is available-neutral; only the extra is ` +
          `spending capital that is not there, and a negative available is an IMPOSSIBLE ` +
          `state rather than a warning. Record the fill at ${proposedFunding}, or record the ` +
          `fee or funding difference as its own act`,
      );
    }
  }

  const fundingTier = deriveFundingTier(reserve);
  let tier: CapitalTier;
  if (fundingTier.status === "derived") {
    tier = fundingTier.tier;
  } else if (fundingTier.status === "ambiguous") {
    // `T4` — the tier ordering was applied ONCE, at Transfer time. Asking here would
    // re-decide it, which is the one thing this increment must not do.
    return reject(
      io,
      "ambiguous-tier",
      `'${reserve.id}' holds ${fundingTier.tiers.join(" and ")}; the tier ordering was decided ` +
        `at Transfer time and this act does not get to re-decide it`,
    );
  } else {
    const answer = (await io.ask("  Capital tier for this lot (c1/c2/c3): ")).trim();
    if (answer !== "c1" && answer !== "c2" && answer !== "c3") {
      return reject(io, "ambiguous-tier", `'${answer}' is not a capital tier`);
    }
    tier = answer;
  }

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
  const crossRef = crossReferenceEvent(parsed.value, buildEventReference(genesis, priorEvents));
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
  if (!isAffirmative(await io.ask("Write BOTH? [y/N]: "))) {
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
  return { status: "recorded", act, alsoCancelled };
}
