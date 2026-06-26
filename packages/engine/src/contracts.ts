/**
 * Engine domain contracts: the domain types, read models, parse-result and
 * warning unions, and the assurance vocabulary (`validationSeverityByCode`).
 *
 * This module is the leaf of the engine's internal dependency graph — it holds
 * shapes only, no behavior — so parse, compose, price-journey, and format can
 * all depend on it without cycles. The public type surface is unchanged: these
 * names are re-exported through `fund-composition.ts` and `index.ts` exactly as
 * before. `NamedRecord` and `CapitalRecordBase` are exported here only so the
 * sibling modules can reference them; they are deliberately not re-exported
 * through the public barrel and remain internal to the package.
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

export interface CompositionReport {
  totals: {
    baseCurrency: "USD";
    fundValueUsd: number;
    usdMxn: number;
  };
  dashboard: DashboardModel;
  priceJourneys: PriceJourney[];
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
