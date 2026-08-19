/**
 * Engine domain contracts: the domain types, read models, parse-result and
 * warning unions, and the assurance vocabulary (`validationSeverityByCode`).
 *
 * This module is the leaf of the engine's internal dependency graph — it holds
 * shapes only, no behavior — so parse, compose, price-journey, and format can
 * all depend on it without cycles. The public type surface is the curated set
 * re-exported through `index.ts`. `NamedRecord` and `CapitalRecordBase` are
 * exported here only so the sibling modules can reference them; they are
 * deliberately not re-exported through `index.ts` and remain internal to the
 * package.
 */

export type Currency = "USD" | "MXN";
export type ExecutionMode = "live" | "paper" | "back-test" | "forward-test";
export type Direction = "long" | "short";
/**
 * The fund's CLOSED capital-tier vocabulary, declared ONCE as a value and narrowed
 * into the type below.
 *
 * A value rather than a bare union because `CapitalTier` is erased at runtime and
 * every sidecar loader has to test an untrusted string from a file against it. Both
 * `plans.jsonl` and `reconciliations.jsonl` did that against their own private copies
 * of this list, which is exactly the wrong shape for it: adding a tier is an ADR-002
 * amendment — a fund-structure change, not a forward-compatibility event — and an
 * amendment applied to one copy would make the other treat every line naming the new
 * tier as CORRUPT, diagnosing "torn write" at a file that is perfectly intact.
 *
 * The type is derived from the value rather than restated beside it, so the two
 * cannot disagree even here.
 */
export const CAPITAL_TIERS = ["c1", "c2", "c3"] as const;

export type CapitalTier = (typeof CAPITAL_TIERS)[number];

/**
 * A Lot is the shared genealogy unit: it preserves Capital Tier attribution on a
 * slice of held capital. It is the base for both record kinds — a Reserve (cash)
 * Lot is the degenerate `(quantity, tier)` where value == face, no entry FX and
 * Price P&L == 0; a Position Lot ({@link PositionLot}) adds cost and entry FX.
 */
export interface Lot {
  quantity: number;
  tier: CapitalTier;
}

/**
 * A Position Lot adds the cost basis a Position needs to {@link Lot}, binding
 * `(quantity, cost, tier, entryFx)` together so per-tier P&L stays correct even
 * when two tiers of the same instrument were acquired at different costs.
 * Carrying `cost` here (not on the base) keeps it a compile-time guarantee on the
 * Position path, with no optional-cost runtime guard.
 */
export interface PositionLot extends Lot {
  cost: number;
  /** MXN-per-USD rate at acquisition; cost basis converts at this rate. */
  entryFx?: number;
}

export interface FundReviewData {
  fund: {
    id: string;
    name: string;
    baseCurrency: "USD";
  };
  review: {
    asOf: string;
    usdMxn: number;
  };
  portfolios: NamedRecord[];
  accounts: Array<NamedRecord & { platform: string; currency: Currency }>;
  instruments: Array<NamedRecord & { symbol: string; currency: Currency }>;
  reserves: ReserveRecord[];
  positions: PositionRecord[];
  /** Periodic per-instrument price snapshots; the spine of the price journey. */
  closes?: Close[];
  /**
   * The closed book: finished trades the
   * fold keeps instead of deleting, each carrying its realized Trading P&L. Absent
   * on a genesis seed and on a fold with no closes yet — the blotter renders nothing
   * when empty, so this is additive to the read model (amends ADR-003: the fold now
   * emits a third output beyond open positions + reserves).
   */
  closedPositions?: ClosedPositionRecord[];
}

/**
 * Why the fold could not apply an event. A CLOSED VOCABULARY — widening it is a spec
 * change, not a build decision; it was widened once, deliberately, to three (#329).
 *
 * EVERY MEMBER MEANS THE SAME THING ABOUT WHAT THE FOLD DID: it read the event and
 * APPLIED NOTHING AT ALL. A member names WHAT WAS MISSING, never how much of the event
 * survived the miss — there is no partial application anywhere in this vocabulary, so
 * a new member inherits total discard rather than choosing it (#371). That uniformity
 * is load-bearing and was not always true: `reserve-absent` used to let four arms carry
 * on — a close booked its row and retired the position, a trim booked a partial row and
 * mutated lots, an open registered a position, an add grew one, and a Transfer debited
 * its source — each against a reserve that never moved. The difference lived only in
 * the shape of the call sites, so the next reason code would have picked a behaviour by
 * whichever site its author happened to read first. A closed vocabulary whose members
 * disagree about what membership MEANS has lost the property that made closing it worth
 * doing.
 *
 * The fixed prose in `SKIP_DETAIL` depends on this: each member's notice ends by saying
 * nothing moved, and that sentence has to be true at every site that can raise it.
 *
 * `position-absent`: the verb named a position the fold has no record of (never opened
 * in this window, or already retired).
 *
 * `reserve-absent`: a cash leg named a reserve the fold has no record of.
 *
 * `provenance-absent`: a cash leg derived from position lots had NO LOTS to derive
 * from, so there is no cost-basis provenance for the leg to inherit. THIS IS NOT
 * `reserve-absent` AND THE TWO MUST NEVER BE CONFLATED: here the reserve exists and was
 * found — what is missing is the attribution the leg would have carried into it.
 * Reporting a reserve miss that never happened would make the notice lie.
 */
export type FoldSkipReason = "position-absent" | "reserve-absent" | "provenance-absent";

/**
 * One event the fold read and then dropped — the Discard Channel's record (PRD #323,
 * implementing #293). The locator is `eventId` + `index`, NOT a line number: the
 * durable log is append-only, so the id is globally unique and greppable in
 * `events.jsonl` and the report is a standing fact rather than an errand.
 *
 * `verb` is its OWN FIELD and is never interpolated into `detail`, and `detail` is
 * FIXED PROSE — it never quotes event content and never carries a fund figure. Both
 * hold because these records surface on channels a human reads daily; content in the
 * prose would leak position and cash detail onto surfaces that must stay stable.
 */
export interface SkippedFoldEvent {
  /** `BaseEvent.id` — globally unique, greppable in the durable log. */
  eventId: string;
  /** 0-based position in the events array handed to `foldEvents`. */
  index: number;
  /** The event's type. Its own field, never interpolated into `detail`. */
  verb: string;
  reason: FoldSkipReason;
  /** Fixed prose. Never quotes event content; never contains a fund figure. */
  detail: string;
}

/**
 * The fold's return envelope: what it built, plus what it dropped building it.
 *
 * A SIBLING TYPE, NOT A FIELD ON {@link FundReviewData} (PRD #323 R1). `FundReviewData`
 * is also the genesis seed's ON-DISK shape — `loadGenesis` parses one — so a `skipped[]`
 * there would be a field a seed file could declare, on an immutable artifact that by
 * definition discarded nothing. `EventLogLoad = {events, quarantined}` is the in-file
 * precedent one layer up.
 *
 * `data` is exactly what the fold has always returned, bit-identical for every input.
 * `skipped` is empty on a complete log.
 */
export interface FoldedReview {
  data: FundReviewData;
  skipped: SkippedFoldEvent[];
}

/** Per-Tier slice of a closed trade's
 * realized P&L: proceeds credited to this Tier minus its share of the cost basis. */
export interface RealizedTierAttribution {
  tier: CapitalTier;
  costBasisUsd: number;
  proceedsUsd: number;
  realizedPnlUsd: number;
}

/**
 * One finished trade on the closed book —
 * the blotter row the fold computes at `PositionClosed` instead of dropping the
 * position. Realized Trading P&L = `proceedsUsd − costBasisUsd` (one blended number;
 * FX gain/loss is baked in per ADR-002's FX-P&L deferral). Tagged with the closed
 * position's tempo / strategy / instrument and its open + close dates so the blotter
 * can roll realized up by Tempo and by Tier. `strategy`/`openedAsOf` are absent for
 * a genesis-held position closed after genesis (it has no logged open).
 */
export interface ClosedPositionRecord {
  positionId: string;
  instrumentId: string;
  tempo: string;
  strategy?: string;
  direction: Direction;
  openedAsOf?: string;
  closedAsOf: string;
  costBasisUsd: number;
  proceedsUsd: number;
  realizedPnlUsd: number;
  tierAttribution: RealizedTierAttribution[];
  /**
   * True when this row is a PARTIAL realized result emitted by a `PositionTrimmed`
   * on the removed portion — the surviving position (same `positionId`) stays open
   * with reduced lots. Absent/false for a full `PositionClosed`. Many trims plus a
   * final close thread one lineage id: every partial row carries `partial: true`,
   * the final full close omits it.
   */
  partial?: boolean;
  /**
   * NAV-honesty disclosure on a PARTIAL trim row: the removed units valued at the
   * latest mark
   * (`markValueUsd`) versus the actual fill (`proceedsUsd`), and their signed
   * `deltaUsd`. NAV conservation is a settle-AT-mark property, not an unconditional
   * one: when the fill lands at the mark `deltaUsd ≈ 0` and NAV is conserved; when
   * the fill lands OFF the mark the difference is a real realized gain/loss that
   * legitimately moves NAV, surfaced here rather than hidden behind a false
   * neutrality claim. Present only on partial rows (absent on full closes).
   */
  markVsFill?: {
    markValueUsd: number;
    proceedsUsd: number;
    deltaUsd: number;
  };
}

/** The structured price+direction level a
 * Position's thesis breaks on, folded from the latest `InvalidationMarked`. */
export interface InvalidationLevel {
  price: number;
  direction: "below" | "above";
}

/**
 * Close — an immutable periodic price snapshot for one instrument at one anchor.
 * A series of Closes per instrument yields the weekly valuation history.
 */
export interface Close {
  instrumentId: string;
  asOf: string;
  price: number;
}

export interface NamedRecord {
  id: string;
  name: string;
}

export interface CapitalRecordBase {
  id: string;
  portfolioId: string;
  tempo: string;
  executionMode: ExecutionMode;
  accountId: string;
  currency: Currency;
}

export interface ReserveRecord extends CapitalRecordBase {
  amount: number;
  /**
   * Optional Capital Tier attribution for cash. Absent = untiered = excluded
   * from the tier rollup. `amount` stays the authoritative value.
   */
  lots?: Lot[];
}

export interface PositionRecord extends CapitalRecordBase {
  instrumentId: string;
  direction: Direction;
  markPrice: number;
  /**
   * Lot-grained cost + Capital Tier attribution — the only cost-carrier. A
   * single untiered Position is one `c1` Lot; tiering splits it into more. There
   * is no flat `{ quantity, averageCost }` shorthand.
   */
  lots: PositionLot[];
  /**
   * The date this Position was opened in
   * the log — carried so the closed book can tag open + close dates. Absent for a
   * genesis-held position (opened before the log existed).
   */
  openedAsOf?: string;
  /**
   * The strategy tag from the opening
   * decision, carried through so the closed book can attribute realized P&L per
   * strategy. Absent for a genesis-held position (no logged decision). The full
   * decision is durably logged; the fold surfaces only what the read model needs.
   */
  strategy?: string;
  /**
   * The latest structured invalidation
   * level from `InvalidationMarked`, if any. The dashboard compares it against
   * `markPrice` to flag a breached thesis. Absent until the first mark.
   */
  invalidation?: InvalidationLevel;
}

export interface Ok {
  kind: "ok";
  value: FundReviewData;
}

export interface InvalidJson {
  kind: "invalid-json";
  severity: "blocking";
  message: string;
  detail: string;
}

export interface SchemaError {
  kind: "schema-error";
  severity: "blocking";
  path: string;
  message: string;
}

export interface UnsupportedBaseCurrency {
  kind: "unsupported-base-currency";
  severity: "blocking";
  baseCurrency: unknown;
  message: string;
}

export interface InvalidFxRate {
  kind: "invalid-fx-rate";
  severity: "blocking";
  path: "review.usdMxn";
  value: unknown;
  message: string;
}

export interface InvalidAsOf {
  kind: "invalid-as-of";
  severity: "blocking";
  path: "review.asOf";
  value: unknown;
  message: string;
}

export interface DuplicateReferenceId {
  kind: "duplicate-reference-id";
  severity: "blocking";
  recordType: "portfolio" | "account" | "instrument";
  id: string;
  message: string;
}

export interface DuplicateCapitalRecordId {
  kind: "duplicate-capital-record-id";
  severity: "blocking";
  id: string;
  message: string;
}

export type ParseResult =
  | Ok
  | InvalidJson
  | SchemaError
  | UnsupportedBaseCurrency
  | InvalidFxRate
  | InvalidAsOf
  | DuplicateReferenceId
  | DuplicateCapitalRecordId;

export type ValidationSeverity = "blocking" | "warning";

export interface LoadedOutcome {
  status: "loaded";
  sourcePath?: string;
  loadedAt?: string;
}

export interface LoadFailedOutcome {
  status: "load-failed";
  sourcePath?: string;
  loadedAt?: string;
  message: string;
}

export type LoadOutcome = LoadedOutcome | LoadFailedOutcome;

export type WarningCode =
  | "missing-portfolio"
  | "missing-account"
  | "missing-instrument"
  | "unsupported-execution-mode"
  | "unsupported-currency"
  | "unsupported-direction"
  | "currency-mismatch"
  | "invalid-amount"
  | "invalid-position-number"
  | "reserve-lot-sum-mismatch"
  | "invalid-reserve-lot-quantity"
  | "markprice-close-mismatch"
  | "skipped-close"
  | "non-positive-fund-value";

export type ValidationCode =
  | Exclude<ParseResult["kind"], "ok">
  | WarningCode
  | "short-deferred";

export const validationSeverityByCode: Record<ValidationCode, ValidationSeverity> = {
  "invalid-json": "blocking",
  "schema-error": "blocking",
  "unsupported-base-currency": "blocking",
  "invalid-fx-rate": "blocking",
  "invalid-as-of": "blocking",
  "duplicate-reference-id": "blocking",
  "duplicate-capital-record-id": "blocking",
  "missing-portfolio": "warning",
  "missing-account": "warning",
  "missing-instrument": "warning",
  "unsupported-execution-mode": "warning",
  "unsupported-currency": "warning",
  "unsupported-direction": "warning",
  "currency-mismatch": "warning",
  "invalid-amount": "warning",
  "invalid-position-number": "warning",
  "reserve-lot-sum-mismatch": "warning",
  "invalid-reserve-lot-quantity": "warning",
  "markprice-close-mismatch": "warning",
  "skipped-close": "warning",
  "non-positive-fund-value": "warning",
  "short-deferred": "warning",
};

export interface Warning {
  code: WarningCode;
  severity: "warning";
  message: string;
  recordId?: string;
}

export type DashboardRowKind =
  | "portfolio"
  | "tempo"
  | "account"
  | "instrument"
  | "tier";
export type DashboardSectionId =
  | "portfolios"
  | "tempos"
  | "accounts"
  | "instruments"
  | "tiers";

export interface CompositionRow {
  id: string;
  kind: DashboardRowKind;
  label: string;
  usdValue: number;
  percentOfFund: number;
  costBasisUsd?: number;
  unrealizedPnlUsd?: number;
}

export interface DashboardFocus {
  rowId: string;
  kind: DashboardRowKind;
  label: string;
  usdValue: number;
  percentOfFund: number;
}

export interface DashboardSummary {
  fundName: string;
  asOf: string;
  fundValueUsd: number;
  usdMxn: number;
  totalUnrealizedPnlUsd: number;
  largestPortfolio?: DashboardFocus;
  largestTempo?: DashboardFocus;
  largestAccount?: DashboardFocus;
  largestInstrument?: DashboardFocus;
  reserve?: DashboardFocus;
  dataSafety: {
    nonLiveExcluded: number;
    invalidExcluded: number;
    shortDeferredExcluded: number;
    hasWarnings: boolean;
  };
}

export interface DashboardSection {
  id: DashboardSectionId;
  title: string;
  rows: CompositionRow[];
}

export interface DashboardModel {
  summary: DashboardSummary;
  sections: DashboardSection[];
}

export interface PriceJourneyPoint {
  asOf: string;
  price: number;
}

export interface PriceJourney {
  instrumentId: string;
  label: string;
  currency: Currency;
  points: PriceJourneyPoint[];
  firstPrice: number;
  latestPrice: number;
  changeAbs: number;
  changePct: number;
}

/**
 * One post-fold Reserve balance, rendered so the operator can eyeball it against
 * the real venue. `balance` is the folded NATIVE amount — what the venue itself
 * shows (a USD/USDT or MXN figure), authoritative after every cash leg the fold
 * applied; `usdValue` is that same balance in the Fund's base currency. Lines are
 * emitted in genesis Reserve insertion order and never re-sorted, so the column
 * lines up row-for-row with the operator's list of venues.
 */
export interface ReserveReconciliationLine {
  reserveId: string;
  venueLabel: string;
  currency: Currency;
  balance: number;
  usdValue: number;
}

/** A realized-P&L rollup line — realized
 * summed over one grouping key (a Tempo or a Tier). */
export interface RealizedRollupRow {
  key: string;
  realizedPnlUsd: number;
  costBasisUsd: number;
  proceedsUsd: number;
}

/**
 * The trade blotter: every closed-book row
 * plus realized rolled up by Tempo and by Tier, so "how much has PULSE made since
 * genesis?" is answerable. Descriptive only — the realized total is NOT added to
 * NAV (the profit already sits in a Reserve, credited by the cash leg at close).
 */
export interface ClosedBook {
  rows: ClosedPositionRecord[];
  byTempo: RealizedRollupRow[];
  byTier: RealizedRollupRow[];
  totalRealizedPnlUsd: number;
}

/**
 * One OPEN position's invalidation status:
 * its latest structured level, its latest mark, and whether the mark has breached
 * the level (thesis invalidated). Emitted only for positions that carry a level.
 */
export interface InvalidationWatchRow {
  positionId: string;
  instrumentId: string;
  markPrice: number;
  level: number;
  direction: "below" | "above";
  breached: boolean;
}

export interface CompositionReport {
  totals: {
    baseCurrency: "USD";
    fundValueUsd: number;
    usdMxn: number;
  };
  dashboard: DashboardModel;
  priceJourneys: PriceJourney[];
  /**
   * The closed-book blotter + realized
   * rollups. Empty (`rows: []`) when the fold has no closes — the renderer then
   * emits nothing, keeping the report backward-compatible.
   */
  closedBook: ClosedBook;
  /**
   * Invalidation status per OPEN position
   * that carries a structured level. Empty when none do.
   */
  invalidationWatch: InvalidationWatchRow[];
  /**
   * Post-fold Reserve balances for eyeball-vs-venue checking (PRD #82 C3). Reads
   * the FOLDED reserves — the ones the cash legs mutated — never the stale genesis
   * balances (C2). Insertion order preserved.
   */
  reserveReconciliation: ReserveReconciliationLine[];
  warnings: Warning[];
  excluded: {
    nonLive: number;
    invalid: number;
    shortDeferred: number;
  };
  load: LoadOutcome;
}

export type DetailRecordKind = "reserve" | "position";

export interface DashboardDetailRow {
  recordId: string;
  kind: DetailRecordKind;
  recordLabel: string;
  portfolioLabel: string;
  tempoLabel: string;
  accountLabel: string;
  usdValue: number;
  tierContributions?: TierContribution[];
}

export interface DashboardDetail {
  rowId: string;
  kind: Exclude<DashboardRowKind, "instrument">;
  label: string;
  rows: DashboardDetailRow[];
}

export interface TierContribution {
  tier: CapitalTier;
  usdValue: number;
  costBasisUsd: number;
  unrealizedPnlUsd: number;
}
