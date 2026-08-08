/**
 * Event-sourcing spine — cross-ref.
 *
 * The SECOND ingest gate (after `./parse.ts`): validate a structurally-sound event
 * against the known world — the {@link EventReference} built from the immutable
 * genesis seed plus everything the durable log has already introduced. Rejects an
 * open colliding with or citing unknown ids, a close/mark for an unknown id, a
 * cross-currency Transfer, an insufficient debit, and a mark/settlement deviating
 * beyond its magnitude threshold. Pure validation LOGIC (ADR-001).
 *
 * ONE WORLD-STATE (ADR-015). The gate does not maintain its own model of the world:
 * {@link buildEventReference} PROJECTS `foldEvents(genesis, acceptedSoFar)` into the
 * narrow view the guards read. Until 2026-08-08 this file carried a second
 * implementation of the fold's transitions — an incrementally-advanced shadow — and
 * the two encodings drifted (audit MUST FIX 1: the fold consumed a position on close,
 * the shadow did not, so a re-authored second close passed the gate and then vanished
 * at fold, corrupting NAV under `warnings: []`). Deriving from the fold makes that
 * whole divergence class UNREPRESENTABLE rather than guarded. See ADR-015 and ADR-003.
 */
import type { CapitalTier, Currency, FundReviewData, PositionLot } from "../contracts.js";
import type {
  DepositEvent,
  EventError,
  EventParseResult,
  InvalidationMarkedEvent,
  PortfolioEvent,
  PositionAddedToEvent,
  PositionClosedEvent,
  PositionOpenedEvent,
  PositionTrimmedEvent,
  PriceMarkedEvent,
  ReserveOpenedEvent,
  TransferEvent,
  WithdrawEvent,
} from "./types.js";
import { eventError } from "./types.js";
import { foldEvents, reserveDeltasForOpen } from "./fold.js";

/**
 * The deviation past which a `PriceMarked` is treated as an implausible fat-finger
 * / currency-unit mistake (e.g. an MXN-denominated price entered as USD) rather
 * than a real move, and rejected at ingest. Relative: `|new / lastClose - 1|`. A
 * tunable constant, NOT itself ADR-worthy (ADR-003 records the decision to guard
 * magnitude at ingest; this is the dial). 0.5 = ±50% from the instrument's last
 * known close — wide enough to pass any plausible weekly move, narrow enough to
 * catch a ~20× FX-unit slip.
 */
export const PRICE_MARK_MAGNITUDE_THRESHOLD = 0.5;

/**
 * The deviation past which a close's `settlement.proceeds` is treated as an
 * implausible entry (order-of-magnitude typo, sign/unit slip) rather than a real
 * fill, and rejected at ingest. The proceeds analog of
 * {@link PRICE_MARK_MAGNITUDE_THRESHOLD}: relative to expected ≈ closed quantity ×
 * the instrument's last close. Reuses the same ±50% dial for now (an AAR open
 * question — real fills vs mark may want a wider band); kept a SEPARATE constant so
 * the two can diverge without a code change to either guard.
 */
export const SETTLEMENT_MAGNITUDE_THRESHOLD = 0.5;

/**
 * One Reserve as the cross-reference gate sees it: the FOLDED balance the sufficiency
 * gate checks debits against, plus the two facts that make the Reserve itself
 * checkable — the currency it is denominated in, and the date it was born.
 *
 * `amount`/`tiers` are read straight off `foldEvents(...).reserves`, so "what the gate
 * thinks this Reserve holds" and "what the fold will produce" are the same number by
 * construction (ADR-015), not by two encodings agreeing.
 */
export interface ReserveView {
  amount: number;
  tiers: Map<CapitalTier, number> | null;
  currency: Currency;
  /** `genesis.review.asOf` for a seeded Reserve; the `ReserveOpened`'s `asOf` otherwise. */
  bornAsOf: string;
}

/**
 * The latest position-targeting event the log has accepted for one position: WHEN it
 * landed, and WHICH VERB it was. Both halves are load-bearing in the rejection message
 * {@link requirePositionUntouchedAfter} composes — the date shows the ordering a close
 * would have destroyed, the verb tells the operator what would have been buried, which
 * is the difference between "something is wrong with this date" and "your trim on the
 * 18th would vanish". Kept as ONE record rather than two parallel maps so the two halves
 * cannot disagree about which event they describe.
 */
export interface PositionTouch {
  asOf: string;
  type: PortfolioEvent["type"];
}

/**
 * The known world an event is cross-referenced against: every id the genesis seed
 * and the durable log have introduced, plus the last known close per instrument
 * for the magnitude guard. A READ-ONLY PROJECTION of `foldEvents(genesis,
 * acceptedSoFar)`, built by {@link buildEventReference} — never advanced in place.
 * To judge an event against a batch that has already accepted others, rebuild it
 * from genesis plus the accepted prefix; that is what makes "an event opened earlier
 * in the same inbox can be cited by a later one" true without a second encoding of
 * the fold's transitions (ADR-015). Per ADR-001 the TUI owns loading genesis and the
 * log off disk; this engine code owns the validation logic that consumes them.
 */
export interface EventReference {
  positionIds: Set<string>;
  reserveIds: Set<string>;
  portfolioIds: Set<string>;
  /**
   * Every genesis account id → the currency that account is denominated in.
   *
   * Widened from a bare id `Set` for `ReserveOpened`: a Reserve whose currency
   * disagrees with its account is EXCLUDED by canonical normalization
   * (`compose/canonical.ts`, `currency-mismatch`), so admitting one at ingest would
   * mint a Reserve that silently never appears in the read model. Existence checks
   * read `.has()` on this map exactly as they read the old Set, so the widening is
   * source-compatible for every other verb.
   */
  accountCurrencies: Map<string, Currency>;
  instrumentIds: Set<string>;
  /**
   * The genesis review's own date — the instant the whole known world begins.
   *
   * Read by {@link crossReferenceReserveOpened} to reject a Reserve born BEFORE the
   * seed it is born into: the container-side twin of a movement dated before its
   * Reserve. Added for `ReserveOpened`, the first verb whose events can predate a
   * record they depend on; the `accountCurrencies` widening is the precedent that says
   * widening this type is cheap here (all consumption is in-repo and narrow).
   */
  genesisAsOf: string;
  /**
   * Position ids the log has retired via a `PositionClosed`. A closed id stays in
   * {@link positionIds} (it existed, and close-and-reopen mints a fresh id rather
   * than reusing the retired one), but is additionally flagged here so the ingest
   * gate can reject every verb that targets a retired position — a post-close
   * `InvalidationMarked` (a level on a retired position can never fold, since breach
   * is derived per OPEN position), a trim, an add-to, and a SECOND close. Each would
   * be silently dropped at fold, which is exactly the drift this ledger eliminates.
   * See {@link crossReferenceInvalidation} / {@link crossReferenceClose} and ADR-003
   * (fail-loud-at-ingest).
   *
   * Derived from the fold's own CLOSED BOOK — the full-close rows of
   * `foldEvents(...).closedPositions` — so "retired" means exactly what the fold
   * means by it. A partial (trim) row is excluded: a trim always leaves the position
   * open, and the fold keeps it in `positions`.
   */
  closedPositionIds: Set<string>;
  /**
   * Every known position id → the date it came into existence: `genesis.review.asOf`
   * for a genesis-held position, the `PositionOpened`'s own `asOf` for a log-born
   * one. What makes "does this position exist" answerable AS OF A DATE; see
   * {@link requirePositionBornBy}. The position-side twin of
   * {@link ReserveView.bornAsOf}.
   *
   * "Genesis-held" is decided by MEMBERSHIP IN THE SEED, not by the folded record's
   * `openedAsOf` being absent — nothing validates that field on a hand-written seed,
   * and trusting it let a genesis position claim a birth date before the world's.
   *
   * INVARIANT: its key set is exactly {@link positionIds} — every known id is
   * datable, INCLUDING a retired one. `requirePositionBornBy` answers existence off
   * `positionBornAsOf.get(id) === undefined`, so a known-but-undatable id would be
   * reported as a dangling reference and the operator would be told the wrong thing
   * about a position that plainly did exist.
   */
  positionBornAsOf: Map<string, string>;
  /**
   * Every position id the LOG has touched → the latest `asOf` among the
   * position-targeting events accepted so far. The death-side twin of
   * {@link positionBornAsOf}: birth is the EARLIEST bound on a verb's date, this is
   * the LATEST bound on a close's — a close dated before it would seal behind an
   * event already durably accepted, which the fold's (`asOf`, then log) ordering then
   * drops silently.
   *
   * Covers all five position-targeting verbs — `PositionOpened`, `PositionClosed`,
   * `PositionTrimmed`, `PositionAddedTo`, `InvalidationMarked`. `PriceMarked` targets
   * an INSTRUMENT, not a position, and is not scanned. `PositionOpened` is counted
   * even though `requirePositionBornBy` independently refuses a verb dated before
   * birth: it costs one branch, and it makes the map's meaning unconditional — the
   * latest date at which this position was touched — rather than a set with a
   * carve-out.
   *
   * INVARIANT: its key set is a SUBSET of {@link positionIds}, NOT equal to it —
   * unlike `positionBornAsOf`, whose key set is exactly `positionIds`. A genesis-held
   * position no log event has ever touched has NO entry, and that absence is the
   * meaningful answer ("nothing to seal behind"), not a gap wanting a fallback.
   */
  positionLastVerbAsOf: Map<string, PositionTouch>;
  /** Latest known close per instrument: the magnitude guard's comparison point. */
  lastClose: Map<string, { price: number; asOf: string }>;
  /**
   * Folded Reserve balances the cross-ref sufficiency gate checks a debit
   * against (a withdraw/transfer/open-funding can't exceed available, per Tier).
   * `tiers` is null for an untiered Reserve — only its `amount` is checked. Read off
   * `foldEvents(...).reserves`, so a deposit earlier in the inbox funds a later
   * withdraw because the FOLD says it does. `currency` is the Reserve's own
   * denomination, read by the same-currency Transfer guard (a cross-currency move is
   * FX, not a Transfer).
   *
   * `bornAsOf` is the date the Reserve came into existence — `genesis.review.asOf`
   * for a seeded Reserve, the `ReserveOpened`'s own `asOf` for a log-born one. It is
   * what makes "does this Reserve exist" answerable AS OF A DATE; see
   * {@link requireReserveBornBy}.
   */
  reserveBalances: Map<string, ReserveView>;
  /**
   * OPEN position lots the settlement-magnitude gate reads to compute a close's
   * expected proceeds (quantity × last close) and the Tier mix proceeds inherit.
   * Mirrors `lastClose` existing solely to feed the PriceMarked guard.
   *
   * The fold's surviving `positions`, and only those: a retired id is caught by
   * {@link closedPositionIds} before either magnitude gate reaches this map, so the
   * lots of a closed position are never needed and are not carried.
   */
  positionLots: Map<string, { instrumentId: string; lots: PositionLot[] }>;
}

/**
 * Build the cross-reference world: fold the immutable genesis seed plus the events
 * already accepted, then PROJECT that folded book into the narrow view the guards
 * read. Pure.
 *
 * THE ONE WORLD-STATE (ADR-015). Everything below is a read of
 * `foldEvents(genesis, priorEvents)` — reserve balances and their Tier mixes, which
 * positions are open, which are retired, each open position's running lots, and the
 * last known close per instrument. The gate therefore cannot be wrong about the world
 * the fold will produce; it is looking at that world. The only facts NOT on the folded
 * output are `genesisAsOf` (the fold restamps `review.asOf` to the latest event), each
 * Reserve's `bornAsOf`, WHICH position ids the seed itself held (the fold clones a
 * genesis position verbatim, so it cannot tell a seeded one from a logged one on the
 * record alone), and each position's LATEST accepted verb date (`InvalidationLevel` and
 * `PositionLot` carry no `asOf`, so the folded book cannot answer it) — all read off the
 * inputs directly.
 *
 * COST, and the standing budget. This is O(log length) per call — measured on a
 * MARK-HEAVY synthetic log (the durable log is 98.5% `PriceMarked`, and the original
 * fixture-shaped benchmark missed a quadratic term because of it; ADR-015 records both
 * the mistake and the corrected table). 2026-08-08, Node 24: a bare fold is 0.7 ms at
 * L=388, 1.7 ms at L=5k, 19 ms at L=50k. A batch walk rebuilds once per accepted event,
 * so the price-feed's 13-mark batch costs 14 folds — ≈3 ms at today's L, 26 ms at L=5k,
 * 284 ms at L=50k. Re-measure, on a mark-heavy log, if a future gate rule needs the
 * `compose/*` pipeline per event rather than the bare fold, or if L approaches 100k.
 */
export function buildEventReference(
  genesis: FundReviewData,
  priorEvents: readonly PortfolioEvent[] = [],
): EventReference {
  const folded = foldEvents(genesis, [...priorEvents]);
  const genesisAsOf = genesis.review.asOf;

  // A Reserve's birth date is the one fact the folded record does not carry: a seeded
  // Reserve exists from the instant the world does, a log-born one from its
  // `ReserveOpened`'s own `asOf`. Read off the inputs, not re-derived by a transition.
  const bornAsOf = new Map<string, string>(
    genesis.reserves.map((reserve) => [reserve.id, genesisAsOf]),
  );
  for (const event of priorEvents) {
    if (event.type === "ReserveOpened") {
      bornAsOf.set(event.reserve.id, event.asOf);
    }
  }

  // The latest verb date per position is the other fact the folded record does not
  // carry, and for a sharper reason than the Reserve's: `InvalidationLevel` and
  // `PositionLot` carry no `asOf` at all, so a fold-only projection would see the trim
  // (a partial row's `closedAsOf`) and miss the invalidation and the add-to entirely.
  // Not a shadow of the fold either — birth is a fact about the WORLD, which the fold
  // owns and carries, whereas "what have I already accepted for this id" is a fact
  // about the LOG, which the fold never claimed to answer. Max, not last-write-wins:
  // the events arrive in LOG order, which is not date order.
  const positionLastVerbAsOf = new Map<string, PositionTouch>();
  const touchPosition = (positionId: string, event: PortfolioEvent): void => {
    const latest = positionLastVerbAsOf.get(positionId);
    if (latest === undefined || event.asOf > latest.asOf) {
      positionLastVerbAsOf.set(positionId, { asOf: event.asOf, type: event.type });
    }
  };
  for (const event of priorEvents) {
    switch (event.type) {
      // The open keys off the position it MINTS; every other verb names an id it found.
      case "PositionOpened":
        touchPosition(event.position.id, event);
        break;
      case "PositionClosed":
      case "PositionTrimmed":
      case "PositionAddedTo":
      case "InvalidationMarked":
        touchPosition(event.positionId, event);
        break;
      // Everything else — `PriceMarked` above all — targets an instrument or a
      // Reserve, never a position. Marking a price must not date a position: the feed
      // marks daily, so scanning it would seal every position holding that instrument
      // behind today for a reason having nothing to do with the position.
      default:
        break;
    }
  }

  // Known position ids are the fold's SURVIVORS plus everything in its closed book —
  // a retired id stays known (it existed; close-and-reopen mints a fresh id), and the
  // full-close rows are precisely the retired set. A partial row is a trim, whose
  // position is still open above.
  const positionIds = new Set(folded.positions.map((position) => position.id));
  const closedPositionIds = new Set<string>();
  for (const row of folded.closedPositions ?? []) {
    positionIds.add(row.positionId);
    if (!row.partial) {
      closedPositionIds.add(row.positionId);
    }
  }

  // Each known position's BIRTH DATE. A LOG-BORN position's is read off the folded
  // book and only off it: unlike a Reserve's, that date IS carried by the folded
  // record, so there is no reason to rescan `priorEvents` for it — and a second
  // derivation path for a fact the fold already carries would re-acquire exactly the
  // divergence class ADR-015 deleted the shadow to remove. The function's one rule
  // holds: read the fold where the fold carries the fact, read the inputs only where it
  // does not. A GENESIS-HELD position is the "does not" case — it is born with the
  // world by definition, which is a fact about the SEED, not a date the fold derives.
  //
  // `?? genesisAsOf` stays LOAD-BEARING behind the seeding, not defensive. `openedAsOf`
  // is optional on both record types and the fold sets it only at `PositionOpened`,
  // carrying it through the close — so a position the fold knows but cannot date is
  // one that existed before the log, and it gets the same answer
  // `reserveBalances.bornAsOf` gives a seeded Reserve.
  //
  // GENESIS IDS ARE SEEDED FIRST, and the not-already-present precedence below then
  // makes them UN-OVERRIDABLE. A genesis-held position is born with the world by
  // definition, and `?? genesisAsOf` alone trusted a field nothing enforces: the
  // contract says `openedAsOf` is absent for a genesis-held position, but
  // `parseFundReview` passes the seed through as `value as FundReviewData` and
  // `foldEvents` `structuredClone`s each genesis position verbatim, so a seed carrying
  // an explicit `openedAsOf: "2025-03-01"` reached the map intact. Two things then went
  // wrong at once: `InvalidationMarked` — the only position verb with no reserve leg,
  // hence the only one `requireReserveBornBy` does not independently catch — was
  // accepted before the genesis review, so the two gates disagreed about where the
  // world begins; and `held` below went false, sending the operator to "open the
  // position earlier" for a position that has no `PositionOpened` to redate, which is
  // precisely what the two-branch remedy exists to prevent. Log-born positions are
  // untouched: their ids are not in the seed.
  //
  // Then survivors, then closed-book rows, each only for ids not already present: a
  // PARTIAL (trim) row shares its id with a still-OPEN position, and the open row is
  // the authority. The three passes cover exactly `positionIds` — the key-set
  // invariant `requirePositionBornBy` relies on to answer existence — because a genesis
  // position always leaves the fold either surviving in `positions` or carrying a
  // full-close row in `closedPositions`, never neither. Pinned by the invariant tests,
  // including one that fully closes a genesis-held position.
  const positionBornAsOf = new Map<string, string>(
    genesis.positions.map((position) => [position.id, genesisAsOf]),
  );
  for (const position of folded.positions) {
    if (!positionBornAsOf.has(position.id)) {
      positionBornAsOf.set(position.id, position.openedAsOf ?? genesisAsOf);
    }
  }
  for (const row of folded.closedPositions ?? []) {
    // INERT TODAY, AND KEPT ON PURPOSE. `buildClosedPosition` copies `openedAsOf` off
    // the very `PositionRecord` the surviving row came from, so a partial row's date is
    // always byte-equal to the open row's and last-write-wins would produce an
    // identical map through every path the fold can currently produce. This guard is
    // here so that a future change to how closed rows carry `openedAsOf` — a
    // re-derivation, a normalization, a trim that stamps its own date — cannot silently
    // restate a still-open position's birth date, which would move the gate's answer
    // for every later verb aimed at it. Do not delete it as redundant without first
    // making that coupling explicit somewhere else.
    if (!positionBornAsOf.has(row.positionId)) {
      positionBornAsOf.set(row.positionId, row.openedAsOf ?? genesisAsOf);
    }
  }

  // Latest close per instrument, from the fold's own `closes[]`: the genesis-provided
  // closes, the t0 `markPrice` anchors the fold seeds, every `PriceMarked`, and any
  // entry/blend cost baseline the fold minted. Later-or-equal `asOf` wins, so a mark
  // that lands on the day of an existing anchor supersedes it — the same tie-break the
  // fold itself applies when it overwrites a same-day close.
  const lastClose = new Map<string, { price: number; asOf: string }>();
  for (const close of folded.closes ?? []) {
    const current = lastClose.get(close.instrumentId);
    if (!current || close.asOf >= current.asOf) {
      lastClose.set(close.instrumentId, { price: close.price, asOf: close.asOf });
    }
  }

  const reserveBalances = new Map<string, ReserveView>();
  for (const reserve of folded.reserves) {
    // `lots: undefined` is an untiered Reserve (amount is the whole truth); `lots: []`
    // is a tiered-but-empty one, born by `ReserveOpened` — an empty Map, NOT null, so
    // the first credit gives it real Tiers. `applyReserveDelta` draws the same line.
    let tiers: Map<CapitalTier, number> | null = null;
    if (reserve.lots) {
      tiers = new Map();
      for (const lot of reserve.lots) {
        tiers.set(lot.tier, (tiers.get(lot.tier) ?? 0) + lot.quantity);
      }
    }
    reserveBalances.set(reserve.id, {
      amount: reserve.amount,
      tiers,
      currency: reserve.currency,
      bornAsOf: bornAsOf.get(reserve.id) ?? genesisAsOf,
    });
  }

  return {
    positionIds,
    reserveIds: new Set(folded.reserves.map((reserve) => reserve.id)),
    portfolioIds: new Set(folded.portfolios.map((portfolio) => portfolio.id)),
    accountCurrencies: new Map(folded.accounts.map((account) => [account.id, account.currency])),
    instrumentIds: new Set(folded.instruments.map((instrument) => instrument.id)),
    genesisAsOf,
    closedPositionIds,
    positionBornAsOf,
    positionLastVerbAsOf,
    lastClose,
    reserveBalances,
    positionLots: new Map(
      folded.positions.map((position) => [
        position.id,
        { instrumentId: position.instrumentId, lots: position.lots },
      ]),
    ),
  };
}

/**
 * Second ingest gate (after `parseEvent`): validate a structurally-sound
 * event against the known world. Rejects an open whose id collides with an
 * existing position/reserve or that cites an unknown portfolio/account/instrument;
 * a close/mark for an id the seed and log never introduced; and a mark deviating
 * beyond {@link PRICE_MARK_MAGNITUDE_THRESHOLD} from the instrument's last close.
 * Pure: it reads `reference` but never mutates it. On success returns the event
 * unchanged so callers can chain `parseEvent` → `crossReferenceEvent`.
 */
export function crossReferenceEvent(
  event: PortfolioEvent,
  reference: EventReference,
  options?: { magnitudeThreshold?: number; settlementThreshold?: number },
): EventParseResult {
  switch (event.type) {
    case "PositionOpened":
      return crossReferenceOpen(event, reference);
    case "PositionClosed":
      return crossReferenceClose(event, reference, options?.settlementThreshold);
    case "PositionTrimmed":
      return crossReferenceTrim(event, reference, options?.settlementThreshold);
    case "PositionAddedTo":
      return crossReferenceAddedTo(event, reference);
    case "PriceMarked":
      return crossReferenceMark(event, reference, options?.magnitudeThreshold);
    case "Deposit":
      return crossReferenceDeposit(event, reference);
    case "Withdraw":
      return crossReferenceWithdraw(event, reference);
    case "Transfer":
      return crossReferenceTransfer(event, reference);
    case "InvalidationMarked":
      return crossReferenceInvalidation(event, reference);
    case "ReserveOpened":
      return crossReferenceReserveOpened(event, reference);
  }
}

/**
 * A `ReserveOpened` must mint a genuinely new id (colliding with neither an
 * existing Reserve nor an existing Position — capital ids share one namespace),
 * be `live`, cite a portfolio and an account the genesis seed knows, and be
 * denominated in THAT ACCOUNT'S currency.
 *
 * THE EXECUTION-MODE CHECK IS THE SAME REJECT AS THE CURRENCY ONE, ONLY WORSE
 * UNGUARDED. `compose/canonical.ts` drops a non-live Reserve with
 * `excluded.nonLive += 1` and NO warning, where a currency mismatch at least emits
 * one. Measured: `[ReserveOpened(paper), Transfer 400 into it]` against a 1000-unit
 * genesis passed both gates, moved the cash, took NAV to 600, and reported
 * `warnings: []`. This is NEW with this verb — every genesis reserve is `live`, so
 * a non-live Reserve was previously unmintable.
 *
 * THE GATE GOES AT THE MINT, NOT AT THE MOVEMENT. `crossReferenceTransfer` skips
 * `executionMode` too, but once no non-live Reserve can be minted the movement path
 * has nothing left to catch; a redundant gate at every movement site would defend
 * against a state that can no longer exist.
 *
 * The currency check is a HARD REJECT, not a warning, and it is the reason
 * {@link EventReference.accountCurrencies} carries currencies at all. Canonical
 * normalization already excludes a currency-mismatched Reserve with a
 * `currency-mismatch` warning; without this gate the new verb would be the one path
 * that admits such a Reserve into the durable log, where it would fold into a
 * record the read model then silently drops. Rejecting at ingest keeps the tenth
 * verb inside ADR-003's fail-loud posture — the log never holds a Reserve the
 * dashboard cannot show.
 *
 * There is deliberately no balance/NAV check: the event carries no amount and no
 * lots, so NAV-neutrality is structural, not something a rule here could violate.
 * Pure: reads `reference`, never mutates it.
 */
function crossReferenceReserveOpened(
  event: ReserveOpenedEvent,
  reference: EventReference,
): EventParseResult {
  const { reserve } = event;
  // D4 — the birth cannot predate the world it is born into. This is
  // `requireReserveBornBy`'s question asked of the CONTAINER instead of the movement:
  // the genesis seed is the fund at t0, so a Reserve dated before it would sort ahead
  // of the seed at fold and describe a world that did not exist.
  if (event.asOf < reference.genesisAsOf) {
    return eventError(
      "asOf",
      `ReserveOpened is dated ${event.asOf}, before the genesis review at ` +
        `${reference.genesisAsOf}. The seed IS the fund at t0; a Reserve cannot be born ` +
        `before it. Date the event ${reference.genesisAsOf} or later.`,
    );
  }
  if (reference.reserveIds.has(reserve.id)) {
    return eventError(
      "reserve.id",
      `ReserveOpened id '${reserve.id}' collides with an existing reserve id.`,
    );
  }
  if (reference.positionIds.has(reserve.id)) {
    return eventError(
      "reserve.id",
      `ReserveOpened id '${reserve.id}' collides with an existing position id.`,
    );
  }
  if (reserve.executionMode !== "live") {
    return eventError(
      "reserve.executionMode",
      `ReserveOpened opens reserve '${reserve.id}' in ${reserve.executionMode} mode. ` +
        `Canonical normalization DROPS a non-live Reserve outright — counted in ` +
        `excluded.nonLive with NO warning at all, unlike a currency mismatch, which at ` +
        `least warns — so it would be durably logged and then never reach the read ` +
        `model. Cash transferred into it would leave the fund's NAV silently. Open it ` +
        `in live mode.`,
    );
  }
  if (!reference.portfolioIds.has(reserve.portfolioId)) {
    return eventError(
      "reserve.portfolioId",
      `ReserveOpened references portfolio id '${reserve.portfolioId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  const accountCurrency = reference.accountCurrencies.get(reserve.accountId);
  if (accountCurrency === undefined) {
    return eventError(
      "reserve.accountId",
      `ReserveOpened references account id '${reserve.accountId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  if (accountCurrency !== reserve.currency) {
    return eventError(
      "reserve.currency",
      `ReserveOpened opens a ${reserve.currency} reserve '${reserve.id}' on account ` +
        `'${reserve.accountId}', which is denominated in ${accountCurrency}. A ` +
        `currency-mismatched Reserve is excluded by canonical normalization, so it ` +
        `would never reach the read model. Open it in ${accountCurrency}, or open it ` +
        `on an account denominated in ${reserve.currency}.`,
    );
  }
  return { kind: "ok", value: event };
}

/**
 * An `InvalidationMarked` must reference a
 * position the seed or log introduced — marking a level on an unknown id is a
 * dangling reference. Latest-wins revision needs no magnitude guard here (the mark
 * is a thesis level, not a valuation); breach is derived at compose.
 *
 * POST-CLOSE MARK (ADR-003 fail-loud, PRD #90 R4). A mark on an already-closed
 * position is rejected at ingest, not accepted as a silent no-op. The close retired
 * the id (a fresh id is minted on reopen), breach is derived only per OPEN position,
 * so the level could never fold to anything — accepting it would silently drop the
 * mark at fold, the exact drift class this ledger eliminates. Rejecting keeps the
 * 7th verb inside ADR-003's fail-loud-at-ingest posture. The distinct
 * `positionId` message names the closed case so the operator can tell it from a
 * genuine dangling reference.
 */
function crossReferenceInvalidation(
  event: InvalidationMarkedEvent,
  reference: EventReference,
): EventParseResult {
  const bornBy = requirePositionBornBy(reference, event.positionId, event.asOf, "positionId");
  if (bornBy) {
    return { ...bornBy, message: `InvalidationMarked ${bornBy.message}` };
  }
  if (reference.closedPositionIds.has(event.positionId)) {
    return eventError(
      "positionId",
      `InvalidationMarked targets position id '${event.positionId}', which is already ` +
        `closed; a thesis level on a retired position can never be watched. Mark the ` +
        `level before the close, or open a fresh position.`,
    );
  }
  return { kind: "ok", value: event };
}

/** {@link requireReserveBornBy}'s answer: the Reserve, or the reason there isn't one. */
type ReserveLookup =
  | { kind: "ok"; balance: ReserveView }
  | { kind: "event-error"; error: EventError };

/**
 * THE ONE PLACE THAT ANSWERS "DOES THIS RESERVE EXIST AS OF THIS DATE."
 *
 * Every reserve-existence check in this gate routes through here; none asks
 * `reserveBalances.has()`/`.get()` directly. Before `ReserveOpened` the eight sites
 * that asked could each own half the question safely, because every cross-ref-approved
 * reserve id was a genesis reserve present in the fold from t0 — existence was TOTAL.
 * `ReserveOpened` makes it PARTIAL, and the two orderings then disagree: THIS GATE
 * JUDGES IN LOG ORDER, while `foldEvents` applies in (`asOf`, then log) order. ADR-015
 * did not close that gap — it moved the gate's world onto the fold, so the gate now
 * sees the fold's answer, but the WALK still hands it candidates in log order, and a
 * backdated candidate is still judged before the fold has had the chance to skip it.
 *
 * Measured, on `[ReserveOpened asOf 06-15, Transfer asOf 06-10 into it]`: both events
 * passed both gates, the Transfer sorted FIRST at fold, `applyToReserve` silently
 * skipped the destination that did not exist yet, and cash went 1000 → 600 with
 * `warnings: []` while the new Reserve reported a balance of 0. Rejecting here makes
 * the batch fail all-or-nothing and loud, at ingest, per ADR-003.
 *
 * This is the ONLY verb-target for which the date half is asked. The position verbs
 * have the same exposure — a close/trim/add dated before its target's `PositionOpened`
 * hits the fold's `if (closing)` / `if (trimming)` / `if (adding)` skip and never lands
 * — and it is recorded as the open follow-up in ADR-015's third delta class rather than
 * fixed here.
 *
 * Deliberately NOT fixed at the fold. `foldEvents` is the READ path for the TUI, the
 * web push and the daily price-feed job; throwing there would turn an ingest-time
 * defect into a total dashboard outage and re-validate every already-durable log on
 * every read. `applyToReserve`'s silent skip stays, as a named leftover.
 */
function requireReserveBornBy(
  reference: EventReference,
  reserveId: string,
  asOf: string,
  path: string,
): ReserveLookup {
  const balance = reference.reserveBalances.get(reserveId);
  if (!balance) {
    return {
      kind: "event-error",
      error: eventError(
        path,
        `references reserve id '${reserveId}', which neither the genesis seed nor the log contains.`,
      ),
    };
  }
  if (asOf < balance.bornAsOf) {
    // The remedy branches on WHICH KIND of Reserve this is, because one of the two
    // fixes is impossible for a seeded one. A genesis-seeded Reserve is born at
    // `genesis.review.asOf` — it has no `ReserveOpened` to move, so "open the Reserve
    // earlier" would send the operator hunting for an event that does not exist (and
    // nine of the fund's ten reserves are seeded, so that is the COMMON case). Only a
    // log-born Reserve has a birth the operator can actually redate.
    const seeded = balance.bornAsOf === reference.genesisAsOf;
    const remedy = seeded
      ? `Date it on or after the genesis review date, ${balance.bornAsOf}.`
      : `Date it ${balance.bornAsOf} or later, or open the Reserve earlier.`;
    return {
      kind: "event-error",
      error: eventError(
        path,
        `references reserve '${reserveId}' as of ${asOf}, but that Reserve is not born ` +
          `until ${balance.bornAsOf}. The fold applies events in date order, so this one ` +
          `would run BEFORE the Reserve exists and its cash leg would vanish silently. ` +
          remedy,
      ),
    };
  }
  return { kind: "ok", balance };
}

/**
 * THE ONE PLACE THAT ANSWERS "DOES THIS POSITION EXIST AS OF THIS DATE."
 *
 * {@link requireReserveBornBy}'s twin for the CONTAINER the position verbs target, and
 * the follow-up ADR-015 named rather than took (its "third delta class"). The same two
 * orderings disagree here: THIS GATE JUDGES IN LOG ORDER, `foldEvents` applies in
 * (`asOf`, then log) order. A close/trim/add/invalidation dated before its target's
 * `PositionOpened` reaches the fold FIRST, hits `if (closing)` / `if (trimming)` /
 * `if (adding)`, and never lands.
 *
 * Measured, on `[PositionOpened asOf 06-05 btc-pos, PositionClosed asOf 06-03
 * btc-pos]`: both passed both gates and were durably appended, the close sorted first
 * at fold, the cash leg was skipped and NO closed-book row was minted — so
 * {@link EventReference.closedPositionIds} never gained the id, and a SECOND backdated
 * close carrying a fresh event id (log dedup keys on `event.id` alone) then cleared the
 * post-close guard too. Two closes in the log, zero effect on the book, `warnings: []`,
 * and `foldEvents` has no diagnostics channel to say otherwise.
 *
 * IT OWNS BOTH HALVES OF THE QUESTION — unknown id AND not-born-yet — as the reserve
 * helper does, which is why every call site's own `positionIds.has()` check is gone.
 * Existence is answered off `positionBornAsOf.get(id)`; `undefined` means unknown, and
 * that is exactly what the key-set invariant on {@link EventReference.positionBornAsOf}
 * guarantees is never true of a known id.
 *
 * Returns `null` on success and never throws — `checkDebit`'s shape, since unlike the
 * reserve helper there is no resolved view to hand back. No error-code enum: `path` is
 * the machine-readable half, the message the human one. The CALLER prefixes the verb
 * name, matching the reserve call sites, which keeps the unknown-id strings
 * byte-identical to the ones each site composed inline before.
 *
 * ORDERED FIRST at every call site, ahead of the already-closed check. A verb that is
 * both backdated and aimed at a retired position therefore reports "not born until"
 * rather than "already closed": the birth fact holds regardless of retirement, and it
 * mirrors the reserve side where existence and birth are one function's single answer.
 * It also makes an interaction disappear rather than requiring anyone to reason about
 * it — a backdated close used to reach the settlement-magnitude gate carrying the
 * position's FULL lots, comparing proceeds against a quantity it was never going to
 * remove.
 *
 * Deliberately NOT fixed at the fold, for the reason {@link requireReserveBornBy}
 * records: `foldEvents` is the READ path for the TUI, the web push and the daily
 * price-feed job, and throwing there would turn an ingest-time defect into a total
 * dashboard outage.
 */
function requirePositionBornBy(
  reference: EventReference,
  positionId: string,
  asOf: string,
  path: string,
): EventError | null {
  const bornAsOf = reference.positionBornAsOf.get(positionId);
  if (bornAsOf === undefined) {
    return eventError(
      path,
      `references position id '${positionId}', which neither ` +
        `the genesis seed nor the log contains.`,
    );
  }
  if (asOf < bornAsOf) {
    // The remedy branches on WHICH KIND of position this is, because one of the two
    // fixes is impossible for a genesis-held one: it has no `PositionOpened` to move,
    // so "open the position earlier" would send the operator hunting for an event that
    // does not exist. Only a log-born position has a birth the operator can redate.
    const held = bornAsOf === reference.genesisAsOf;
    const remedy = held
      ? `Date it on or after the genesis review date, ${bornAsOf}.`
      : `Date it ${bornAsOf} or later, or open the position earlier.`;
    return eventError(
      path,
      `references position '${positionId}' as of ${asOf}, but that position is not born ` +
        `until ${bornAsOf}. The fold applies events in date order, so this one would run ` +
        `BEFORE the position exists and its leg would vanish silently. ` +
        remedy,
    );
  }
  return null;
}

/**
 * Per-Tier SUFFICIENCY for a debit, and nothing else. Returns null on success.
 * `amount` here is the cash leaving; an untiered reserve is checked against its
 * total balance, a tiered one against the named Tier's available quantity. Fails
 * loud rather than letting a debit drive a balance silently negative.
 *
 * Takes an ALREADY-RESOLVED {@link ReserveView}, not a reserve id: existence —
 * including the as-of-this-date half — is {@link requireReserveBornBy}'s job and
 * only its job, and every caller has already asked it. Re-resolving here duplicated
 * that lookup once per tier delta inside the open/add funding loops, and split one
 * question across two functions. `reserveId` is carried only to name the reserve in
 * the message.
 */
function checkDebit(
  balance: ReserveView,
  reserveId: string,
  tier: CapitalTier,
  amount: number,
  path: string,
): EventError | null {
  const available = balance.tiers ? balance.tiers.get(tier) ?? 0 : balance.amount;
  // Tolerance absorbs float dust from prior proportional splits; a real overdraft
  // is far larger than this.
  if (amount > available + 1e-6) {
    return eventError(
      path,
      `debits ${amount} from reserve '${reserveId}'${
        balance.tiers ? ` tier ${tier}` : ""
      }, which holds only ${available}.`,
    );
  }
  return null;
}

/**
 * Cross-reference a `PositionClosed`. The position id must be KNOWN (genesis seed
 * or log) and not already RETIRED — a close retires the id, the fold silently
 * drops any later close of it, and log dedup keys on event id alone, so this gate
 * is the only thing standing between a re-authored second close and silent NAV
 * drift. The settlement leg is then checked for a live reserve and by the
 * settlement-magnitude gate (Σ quantity × last close). Pure: reads `reference`,
 * never mutates it.
 */
function crossReferenceClose(
  event: PositionClosedEvent,
  reference: EventReference,
  threshold = SETTLEMENT_MAGNITUDE_THRESHOLD,
): EventParseResult {
  const bornBy = requirePositionBornBy(reference, event.positionId, event.asOf, "positionId");
  if (bornBy) {
    return { ...bornBy, message: `PositionClosed ${bornBy.message}` };
  }
  // A close retires the id, so a SECOND close of it can never fold to anything — the
  // fold drops it silently, with no warning. Log dedup keys on event id alone and
  // cannot catch a re-authored close carrying a fresh id, so this check is what stands
  // between it and the log; trim, add-to and the post-close mark consult the same set.
  //
  // Under ADR-015 that set IS the fold's closed book, so this guard now says out loud
  // what the fold would do anyway rather than asserting it independently. It stays
  // explicit for its MESSAGE: falling through to a "position does not exist" reject
  // would tell the operator the wrong thing about a position that plainly did.
  if (reference.closedPositionIds.has(event.positionId)) {
    return eventError(
      "positionId",
      `PositionClosed targets position id '${event.positionId}', which is already closed.`,
    );
  }
  const settlesInto = requireReserveBornBy(
    reference,
    event.settlement.reserveId,
    event.asOf,
    "settlement.reserveId",
  );
  if (settlesInto.kind === "event-error") {
    return { ...settlesInto.error, message: `PositionClosed ${settlesInto.error.message}` };
  }
  // Settlement-magnitude gate: the proceeds analog of the PriceMarked guard.
  // Expected ≈ closed quantity × the instrument's last known close; a gross
  // deviation (order-of-magnitude typo, sign/unit slip) is rejected at ingest.
  const closed = reference.positionLots.get(event.positionId);
  const last = closed ? reference.lastClose.get(closed.instrumentId) : undefined;
  if (closed && last !== undefined) {
    const quantity = closed.lots.reduce((sum, lot) => sum + lot.quantity, 0);
    const expected = quantity * last.price;
    if (expected > 0) {
      const deviation = Math.abs(event.settlement.proceeds / expected - 1);
      if (deviation > threshold) {
        return eventError(
          "settlement.proceeds",
          `PositionClosed proceeds ${event.settlement.proceeds} deviate ` +
            `${(deviation * 100).toFixed(1)}% from expected ${expected.toFixed(2)} ` +
            `(${quantity} × last close ${last.price} for '${closed.instrumentId}'), beyond ` +
            `the ${(threshold * 100).toFixed(0)}% settlement sanity threshold.`,
        );
      }
    }
  }
  return { kind: "ok", value: event };
}

/**
 * Cross-reference a `PositionTrimmed`. The settlement cash leg is a CREDIT (it can
 * never overdraw a
 * Reserve), so the sufficiency concern moves to the POSITION LOTS: for each
 * `{ tier, quantity }` the position's lots in that tier must sum to ≥ quantity, else
 * fail loud (the position-lot-sufficiency gate, parallel to reserve `checkDebit`).
 * The settlement-magnitude gate is reused on the REMOVED subset (Σ removed quantity ×
 * the instrument's last close). Pure: reads `reference`, never mutates it.
 */
function crossReferenceTrim(
  event: PositionTrimmedEvent,
  reference: EventReference,
  threshold = SETTLEMENT_MAGNITUDE_THRESHOLD,
): EventParseResult {
  const bornBy = requirePositionBornBy(reference, event.positionId, event.asOf, "positionId");
  if (bornBy) {
    return { ...bornBy, message: `PositionTrimmed ${bornBy.message}` };
  }
  if (reference.closedPositionIds.has(event.positionId)) {
    return eventError(
      "positionId",
      `PositionTrimmed targets position id '${event.positionId}', which is already closed.`,
    );
  }
  const trimSettlesInto = requireReserveBornBy(
    reference,
    event.settlement.reserveId,
    event.asOf,
    "settlement.reserveId",
  );
  if (trimSettlesInto.kind === "event-error") {
    return { ...trimSettlesInto.error, message: `PositionTrimmed ${trimSettlesInto.error.message}` };
  }
  const held = reference.positionLots.get(event.positionId);
  const availableByTier = new Map<CapitalTier, number>();
  for (const lot of held?.lots ?? []) {
    availableByTier.set(lot.tier, (availableByTier.get(lot.tier) ?? 0) + lot.quantity);
  }
  // Position-lot-sufficiency gate: aggregate the requested removal per tier (a batch
  // may name a tier twice) and reject when it exceeds the tier's available lots.
  const requestedByTier = new Map<CapitalTier, number>();
  for (const removal of event.removals) {
    requestedByTier.set(
      removal.tier,
      (requestedByTier.get(removal.tier) ?? 0) + removal.quantity,
    );
  }
  for (const [tier, requested] of requestedByTier) {
    const available = availableByTier.get(tier) ?? 0;
    if (requested > available + 1e-9) {
      return eventError(
        "removals",
        `PositionTrimmed removes ${requested} from position '${event.positionId}' tier ${tier}, ` +
          `which holds only ${available}.`,
      );
    }
  }
  // Full-retirement REJECT (user-ratified rule): a trim whose removals would empty
  // the position fails loud here — a trim must leave the position OPEN. The trader is
  // pointed at `PositionClosed` instead. Enforced at the gate so the fold never
  // reaches `positions.delete`; the position ALWAYS survives a trim. `totalHeld` and
  // `totalRequested` are computed from the (batch-shrunk) running lots, so the check
  // is exact even after earlier trims in the same batch. Reaching here guarantees the
  // position holds lots (an empty tier would have tripped the sufficiency gate above).
  const totalHeld = [...availableByTier.values()].reduce((sum, quantity) => sum + quantity, 0);
  const totalRequested = [...requestedByTier.values()].reduce((sum, quantity) => sum + quantity, 0);
  if (totalHeld - totalRequested <= 1e-9) {
    return eventError(
      "removals",
      `PositionTrimmed would remove every lot of position '${event.positionId}' ` +
        `(${totalRequested} of ${totalHeld} held) — a full retirement. A trim must leave the ` +
        `position open; use PositionClosed to fully close it.`,
    );
  }
  // Settlement-magnitude gate on the removed subset: expected ≈ Σ removed quantity ×
  // the instrument's last close; a gross deviation is a fat-finger, rejected loud.
  const last = held ? reference.lastClose.get(held.instrumentId) : undefined;
  if (held && last !== undefined) {
    const removedQuantity = event.removals.reduce((sum, removal) => sum + removal.quantity, 0);
    const expected = removedQuantity * last.price;
    if (expected > 0) {
      const deviation = Math.abs(event.settlement.proceeds / expected - 1);
      if (deviation > threshold) {
        return eventError(
          "settlement.proceeds",
          `PositionTrimmed proceeds ${event.settlement.proceeds} deviate ` +
            `${(deviation * 100).toFixed(1)}% from expected ${expected.toFixed(2)} ` +
            `(${removedQuantity} × last close ${last.price} for '${held.instrumentId}'), beyond ` +
            `the ${(threshold * 100).toFixed(0)}% settlement sanity threshold.`,
        );
      }
    }
  }
  return { kind: "ok", value: event };
}

/**
 * Cross-reference a `PositionAddedTo`: the position must exist and be open, and the
 * funding Reserve
 * must exist and hold enough (per tier) to cover the debit — so an add cannot drive
 * a Reserve silently negative. Pure.
 */
function crossReferenceAddedTo(
  event: PositionAddedToEvent,
  reference: EventReference,
): EventParseResult {
  const bornBy = requirePositionBornBy(reference, event.positionId, event.asOf, "positionId");
  if (bornBy) {
    return { ...bornBy, message: `PositionAddedTo ${bornBy.message}` };
  }
  if (reference.closedPositionIds.has(event.positionId)) {
    return eventError(
      "positionId",
      `PositionAddedTo targets position id '${event.positionId}', which is already closed.`,
    );
  }
  const addFundedBy = requireReserveBornBy(
    reference,
    event.funding.reserveId,
    event.asOf,
    "funding.reserveId",
  );
  if (addFundedBy.kind === "event-error") {
    return { ...addFundedBy.error, message: `PositionAddedTo ${addFundedBy.error.message}` };
  }
  for (const delta of reserveDeltasForOpen([event.lot], event.funding.amount)) {
    const error = checkDebit(
      addFundedBy.balance,
      event.funding.reserveId,
      delta.tier,
      -delta.amount,
      "funding.amount",
    );
    if (error) {
      return { ...error, message: `PositionAddedTo ${error.message}` };
    }
  }
  return { kind: "ok", value: event };
}

function crossReferenceDeposit(event: DepositEvent, reference: EventReference): EventParseResult {
  const into = requireReserveBornBy(reference, event.reserveId, event.asOf, "reserveId");
  if (into.kind === "event-error") {
    return { ...into.error, message: `Deposit ${into.error.message}` };
  }
  return { kind: "ok", value: event };
}

function crossReferenceWithdraw(event: WithdrawEvent, reference: EventReference): EventParseResult {
  // EXPLICIT, and load-bearing: `checkDebit` used to be this verb's ONLY existence and
  // birth check, so it is the one call site where dropping the id-based lookup from
  // `checkDebit` would silently delete the gate rather than merely de-duplicate it.
  // Keeps the `"amount"` path this verb has always reported for a bad reserve.
  const outOf = requireReserveBornBy(reference, event.reserveId, event.asOf, "amount");
  if (outOf.kind === "event-error") {
    return { ...outOf.error, message: `Withdraw ${outOf.error.message}` };
  }
  const error = checkDebit(outOf.balance, event.reserveId, event.tier, event.amount, "amount");
  if (error) {
    return { ...error, message: `Withdraw ${error.message}` };
  }
  return { kind: "ok", value: event };
}

function crossReferenceTransfer(event: TransferEvent, reference: EventReference): EventParseResult {
  // BOTH legs must exist AS OF THE TRANSFER'S OWN DATE. The destination is the leg the
  // audit measured: a Transfer dated before the `ReserveOpened` that mints its target
  // passed this gate in log order, then sorted ahead of the birth at fold, where the
  // credit silently evaporated and the debit did not.
  const to = requireReserveBornBy(reference, event.toReserveId, event.asOf, "toReserveId");
  if (to.kind === "event-error") {
    return { ...to.error, message: `Transfer ${to.error.message}` };
  }
  const from = requireReserveBornBy(reference, event.fromReserveId, event.asOf, "fromReserveId");
  if (from.kind === "event-error") {
    return { ...from.error, message: `Transfer ${from.error.message}` };
  }
  // Same-currency invariant (M2): a Transfer moves the raw `amount` reserve-to-reserve
  // with no FX conversion, so a cross-currency move would silently distort NAV — the
  // exact bug class this MVI eliminates. Reject it loud here, before the log. (An FX
  // conversion is modeled as Withdraw + Deposit at the executed rate, not a Transfer.)
  if (from.balance.currency !== to.balance.currency) {
    return eventError(
      "toReserveId",
      `Transfer moves ${from.balance.currency} from reserve '${event.fromReserveId}' into ` +
        `${to.balance.currency} reserve '${event.toReserveId}'; a Transfer must be same-currency. ` +
        `Model an FX conversion as a Withdraw + Deposit at the executed rate.`,
    );
  }
  const error = checkDebit(
    from.balance,
    event.fromReserveId,
    event.tier,
    event.amount,
    "fromReserveId",
  );
  if (error) {
    return { ...error, message: `Transfer ${error.message}` };
  }
  return { kind: "ok", value: event };
}

function crossReferenceOpen(
  event: PositionOpenedEvent,
  reference: EventReference,
): EventParseResult {
  const { position } = event;
  if (reference.positionIds.has(position.id)) {
    return eventError(
      "position.id",
      `PositionOpened id '${position.id}' collides with an existing position id.`,
    );
  }
  if (reference.reserveIds.has(position.id)) {
    return eventError(
      "position.id",
      `PositionOpened id '${position.id}' collides with an existing reserve id.`,
    );
  }
  if (!reference.portfolioIds.has(position.portfolioId)) {
    return eventError(
      "position.portfolioId",
      `PositionOpened references portfolio id '${position.portfolioId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  if (!reference.accountCurrencies.has(position.accountId)) {
    return eventError(
      "position.accountId",
      `PositionOpened references account id '${position.accountId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  if (!reference.instrumentIds.has(position.instrumentId)) {
    return eventError(
      "position.instrumentId",
      `PositionOpened references instrument id '${position.instrumentId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  // Cash leg: the funding reserve must exist and hold enough, per Tier, to cover
  // the debit — so an open cannot drive a reserve silently negative.
  const fundedBy = requireReserveBornBy(
    reference,
    event.funding.reserveId,
    event.asOf,
    "funding.reserveId",
  );
  if (fundedBy.kind === "event-error") {
    return { ...fundedBy.error, message: `PositionOpened ${fundedBy.error.message}` };
  }
  for (const delta of reserveDeltasForOpen(position.lots, event.funding.amount)) {
    const error = checkDebit(
      fundedBy.balance,
      event.funding.reserveId,
      delta.tier,
      -delta.amount,
      "funding.amount",
    );
    if (error) {
      return { ...error, message: `PositionOpened ${error.message}` };
    }
  }
  return { kind: "ok", value: event };
}

function crossReferenceMark(
  event: PriceMarkedEvent,
  reference: EventReference,
  threshold = PRICE_MARK_MAGNITUDE_THRESHOLD,
): EventParseResult {
  if (!reference.instrumentIds.has(event.instrumentId)) {
    return eventError(
      "instrumentId",
      `PriceMarked references instrument id '${event.instrumentId}', which the ` +
        `genesis seed does not contain.`,
    );
  }
  const last = reference.lastClose.get(event.instrumentId);
  if (last !== undefined) {
    const deviation = Math.abs(event.price / last.price - 1);
    if (deviation > threshold) {
      return eventError(
        "price",
        `PriceMarked price ${event.price} deviates ` +
          `${(deviation * 100).toFixed(1)}% from instrument '${event.instrumentId}'` +
          ` last close ${last.price}, beyond the ${(threshold * 100).toFixed(0)}% ` +
          `sanity threshold.`,
      );
    }
  }
  return { kind: "ok", value: event };
}
