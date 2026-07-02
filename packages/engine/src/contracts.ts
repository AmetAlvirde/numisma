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
export type CapitalTier = "c1" | "c2" | "c3";

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
