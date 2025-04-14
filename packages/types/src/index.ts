/**
 * index.ts - Comprehensive domain model for the Numisma financial platform
 *
 * This file defines the core data structures that power the entire application,
 * from individual positions and orders to comprehensive portfolio valuations and
 * performance reporting.
 *
 * The domain model is designed to be technology-agnostic while providing precise
 * TypeScript definitions that ensure type safety throughout the application.
 */

// Import types from base.ts for use within this file
import {
  AssetType,
  AssetLocationType,
  PositionLifecycle,
  CapitalTier,
  OrderStatus,
  OrderType,
  OrderPurpose,
  ForeignKey,
  PreTrackingStatus,
  OneToOne,
  OneToMany,
  ManyToMany,
  CascadeBehavior,
  RelationOptions,
  ValidationResult,
  ValidationError,
  ValidationRule,
  ValidationContext,
  PaginationParams,
  PaginatedResult,
  FilterParams,
  QueryParams,
  OperationResult,
  BatchOperationResult,
  isForeignKey,
  isCascadeBehavior,
  isRelationOptions,
  isPaginationParams,
  isFilterParams,
  isQueryParams,
  isOperationResult,
  isBatchOperationResult,
} from "./base";

// Re-export all types from base.ts
export * from "./base";

// ===================================================================
// CORE DOMAIN PRIMITIVES
// ===================================================================

/**
 * Represents either a Date object, string date, or the special "genesis" value.
 * "genesis" indicates the position existed before the user started tracking it.
 * This is a crucial concept that accommodates users migrating existing portfolios
 * with incomplete historical data.
 */
export type DateOrGenesis = Date | string | "genesis";

/**
 * Wallet temperature classification
 * - hot: Connected to the internet, typically on exchanges or hot wallets
 * - cold: Offline storage (hardware wallets, paper wallets, etc.)
 */
export enum WalletType {
  HOT = "hot",
  COLD = "cold",
}

/**
 * Current state of a position
 * - active: Position currently has allocated capital
 * - closed: Position has been fully exited
 * - partial: Position has been partially closed (some profits taken)
 */
export enum PositionStatus {
  ACTIVE = "active",
  CLOSED = "closed",
  PARTIAL = "partial",
}

/**
 * Unit for order size specification
 * - percentage: Size as percentage of total position (0.01-1.0)
 * - base: Size in base currency units (e.g., BTC in BTC/USDT)
 * - quote: Size in quote currency units (e.g., USDT in BTC/USDT)
 * - fiat: Size in specified fiat currency (e.g., USD)
 */
export enum SizeUnit {
  PERCENTAGE = "percentage",
  BASE = "base",
  QUOTE = "quote",
  FIAT = "fiat",
}

/**
 * Direction of a trade
 * - long: Betting the price will go up
 * - short: Betting the price will go down
 */
export enum TradeSide {
  LONG = "long",
  SHORT = "short",
}

/**
 * Types of financial metrics for reporting
 */
export enum MetricType {
  TOTAL_VALUE = "total_value",
  PROFIT_LOSS = "profit_loss",
  PERCENTAGE_RETURN = "percentage_return",
  ROI = "roi",
  REALIZED_PL = "realized_pl",
  UNREALIZED_PL = "unrealized_pl",
  DRAWDOWN = "drawdown",
  VOLATILITY = "volatility",
}

/**
 * Time frame for a trade following standard charting notation:
 * M = month, W = week, D = day, H = hour, m = minute
 */
export enum TimeFrame {
  ONE_MINUTE = "1m",
  FIVE_MINUTES = "5m",
  FIFTEEN_MINUTES = "15m",
  THIRTY_MINUTES = "30m",
  ONE_HOUR = "1H",
  FOUR_HOURS = "4H",
  ONE_DAY = "1D",
  THREE_DAYS = "3D",
  ONE_WEEK = "1W",
  ONE_MONTH = "1M",
}

// ===================================================================
// POSITION MANAGEMENT
// ===================================================================

/**
 * Position - The central entity in the portfolio system
 *
 * A position represents a specific investment (long or short) in a crypto asset.
 * Positions are container objects that aggregate orders, stop losses, take profits,
 * and metadata like the trading thesis and journal entries.
 *
 * @example
 * {
 *   id: "pos_123",
 *   name: "BTC Long March 2025",
 *   riskLevel: 7,
 *   portfolio: "Main Portfolio",
 *   walletType: "hot",
 *   seedCapitalTier: "C1",
 *   strategy: "Bull market accumulation",
 *   asset: { ... },
 *   positionDetails: { ... }
 * }
 */
export interface Position {
  /** Unique identifier for the position */
  id: string;

  /** Human-readable name for the position */
  name: string;

  /**
   * Risk level on a scale from 1-10
   * Lower values (1-3): Conservative positions
   * Medium values (4-7): Balanced risk/reward
   * Higher values (8-10): Speculative positions
   */
  riskLevel: number;

  /** Portfolio this position belongs to (allows grouping) */
  portfolioId: ForeignKey<Portfolio>;

  /**
   * Indicates if position is on an exchange (hot) or cold storage
   * Affects liquidity and security considerations
   */
  walletType: WalletType;

  /**
   * Tracks the origin of the capital used
   * C1: Fresh capital from external sources
   * C2+: Realized profits from previous trades
   * This enables compound growth tracking
   */
  capitalTier: CapitalTier;

  /** Trading strategy classification (e.g., "Buy the dip", "altseason") */
  strategy: string;

  /** Current lifecycle state of the position */
  lifecycle: PositionLifecycle;

  /** Detailed trading thesis with reasoning and exit conditions */
  thesis?: Thesis;

  /** Trading journal entries for subjective notes and learnings */
  journal?: JournalEntry[];

  /** The crypto asset being traded */
  asset: Asset;

  /**
   * Core position execution details
   * Contains orders, stop losses, take profits, etc.
   */
  positionDetails: PositionDetails;

  /** Tags for categorization and filtering */
  tags?: string[];

  /** User who created/owns this position */
  userId: string;

  /** When the position was created in the system */
  dateCreated: Date;

  /** When the position was last updated */
  dateUpdated: Date;

  /** Current market valuation of the position (if active) */
  currentValue?: number;

  /** Position visibility setting */
  isHidden?: boolean;

  /** Whether position alerts are enabled */
  alertsEnabled?: boolean;

  /** Pre-tracking status for positions that existed before system tracking */
  preTrackingStatus: PreTrackingStatus;
}

/**
 * Trading thesis documenting the reasoning and plan for a position
 *
 * The thesis enforces disciplined trading by requiring the trader
 * to document their thinking, including when they would be wrong.
 */
export interface Thesis {
  /** Primary rationale for entering the position */
  reasoning: string;

  /** Conditions that would invalidate the thesis (stop loss criteria) */
  invalidation?: string;

  /** Target outcome that would represent thesis success (take profit criteria) */
  fulfillment?: string;

  /** Additional context or considerations */
  notes?: string;

  /** Key chart patterns or indicators supporting the thesis */
  technicalAnalysis?: string;

  /** Fundamental factors supporting the thesis */
  fundamentalAnalysis?: string;

  /** Expected time horizon for the thesis to play out */
  timeHorizon?: string;

  /** Expected risk-to-reward ratio (e.g., "3:1") */
  riskRewardRatio?: string;
}

/**
 * Journal entry for documenting thoughts and attachments related to a position
 *
 * Allows traders to track subjective aspects and learning over time.
 */
export interface JournalEntry {
  /** Unique identifier for the journal entry */
  id: string;

  /** Reference to the position this entry belongs to */
  positionId: string;

  /** The actual journal content/thought */
  thought: string;

  /** Optional file attachments (charts, screenshots, etc.) */
  attachments?: string[];

  /** When the journal entry was created */
  timestamp: DateOrGenesis;

  /** User who created the journal entry */
  userId: string;

  /** Tags for organization and filtering */
  tags?: string[];

  /** Market sentiment at time of entry (bullish, bearish, neutral) */
  sentiment?: "bullish" | "bearish" | "neutral";

  /** Whether this entry contains a significant lesson/insight */
  isKeyLearning?: boolean;
}

/**
 * Details about the crypto asset being traded
 *
 * Captures both the asset itself and its location information.
 */
export interface Asset {
  /** Unique identifier for the asset */
  id: string;

  /** Full name of the cryptocurrency */
  name: string;

  /** Trading symbol/ticker (e.g., "BTC", "ETH") */
  ticker: string;

  /** Asset type (e.g., "crypto", "stock", "forex", "commodity") */
  assetType: AssetType;

  /** Description of the asset */
  description?: string;

  /** Where the asset is held */
  locationType: AssetLocationType;

  /** Which exchange platform, if on an exchange */
  exchange?: string;

  /**
   * Specific wallet or account within the location
   * For exchanges: "spot", "margin", "futures", etc.
   * For cold storage: wallet identifier
   */
  wallet: string;

  /** Blockchain network for the asset */
  network?: string;

  /** Contract address for tokens */
  contractAddress?: string;

  /** Optional custom asset icon */
  iconUrl?: string;

  /** Category of the asset (layer1, defi, gaming, etc.) */
  category?: string;

  /** Current market data */
  marketData?: {
    /** Current price in quote currency */
    currentPrice?: number;

    /** 24h price change percentage */
    priceChangePercentage24h?: number;

    /** Current market cap */
    marketCap?: number;

    /** 24h trading volume */
    volume24h?: number;

    /** Time of last price update */
    lastUpdated?: Date;
  };
}

/**
 * Represents a trading market between two assets
 */
export interface Market {
  id: string;
  baseAsset: Asset;
  quoteAsset: Asset;
  pairNotation: string; // e.g., "BTC/USDT"
  exchange?: string;
  isTradable?: boolean;
}

/**
 * Core details about position execution
 *
 * Contains orders, stop losses, take profits, and status information.
 * This is the operational heart of a position.
 */
export interface PositionDetails {
  /** Current status of the position (active, closed, or partial) */
  status: PositionStatus;

  /** Direction of the position (long or short) */
  side: TradeSide;

  /** Time frame for the trade */
  timeFrame: TimeFrame;

  /** When the position was opened */
  dateOpened?: Date | null;

  /** When the position was closed (if applicable) */
  dateClosed?: Date | null;

  /** List of execution orders for this position */
  orders: Order[];

  /** List of stop loss orders to protect capital */
  stopLoss?: StopLossOrder[];

  /** List of take profit orders to capture gains */
  takeProfit?: TakeProfitOrder[];

  /** Current average entry price (calculated) */
  averageEntryPrice?: number;

  /** Current average exit price (for closed positions) */
  averageExitPrice?: number;

  /** Total position size in base currency */
  totalSize?: number;

  /** Total position cost in quote currency */
  totalCost?: number;

  /** Total realized profit/loss (if any) */
  realizedProfitLoss?: number;

  /** Whether the position uses leverage */
  isLeveraged?: boolean;

  /** Leverage multiplier if applicable */
  leverage?: number;

  /** Current unrealized profit/loss */
  unrealizedProfitLoss?: number;

  /** Percentage return (realized + unrealized) */
  currentReturn?: number;

  /** Target exit price based on take profit orders */
  targetPrice?: number;

  /** Stop loss price based on stop loss orders */
  stopPrice?: number;

  /** Risk-to-reward ratio based on entries, targets, and stops */
  riskRewardRatio?: number;
}

/**
 * Represents a single order (entry or exit) for a position
 */
export interface Order {
  /** Unique identifier for the order */
  id: string;

  /** Reference to the position this order belongs to */
  positionId: ForeignKey<Position>;

  /** When the order was opened/executed */
  dateOpen?: Date | null;

  /** Executed price, if filled */
  averagePrice?: number;

  /** Total cost in quote currency */
  totalCost?: number;

  /** Current status of the order */
  status: OrderStatus;

  /** Execution mechanism for the order */
  type: OrderType;

  /** Purpose of the order */
  purpose: OrderPurpose;

  /** Transaction fee paid to the exchange */
  fee?: number;

  /** Currency unit for the fee */
  feeUnit?: string;

  /** Amount of base currency acquired/sold */
  filled?: number;

  /** Unit for the filled amount */
  unit?: SizeUnit;

  /** Price level that triggers the order */
  trigger?: number;

  /** Estimated cost for orders not yet executed */
  estimatedCost?: number;

  /** Order identifier on the exchange */
  exchangeOrderId?: string;

  /** Whether the order was placed manually or via automation */
  isAutomated?: boolean;

  /** Whether the order is visible on the order book */
  isHidden?: boolean;

  /** Parent order ID if this is a child order */
  parentOrderId?: string;

  /** Notes about this specific order */
  notes?: string;
}

/**
 * Stop loss order for risk management
 *
 * Extends the basic Order with size information specific to risk management.
 */
export interface StopLossOrder extends Order {
  /** How the size is denominated (percentage, base, or quote) */
  unit: SizeUnit;

  /**
   * Size of the stop loss
   * For percentage: 0.01-1.0 (1% to 100% of position)
   * For base/quote: Specific amount in that currency
   */
  size: number;

  /** Whether this is a trailing stop */
  isTrailing?: boolean;

  /** For trailing stops, the distance to follow */
  trailingDistance?: number;

  /** For trailing stops, the unit of the distance */
  trailingUnit?: "percentage" | "absolute";

  /** Maximum acceptable slippage */
  maxSlippage?: number;

  /** Associated protection strategy */
  strategy?: "breakeven" | "partial" | "full" | "tiered";
}

/**
 * Take profit order for capturing gains
 *
 * Extends the basic Order with size information specific to profit taking.
 */
export interface TakeProfitOrder extends Order {
  /** How the size is denominated (percentage, base, or quote) */
  unit: SizeUnit;

  /**
   * Size of the take profit
   * For percentage: 0.01-1.0 (1% to 100% of position)
   * For base/quote: Specific amount in that currency
   */
  size: number;

  /** Target percentage gain for this take profit level */
  targetPercentage?: number;

  /** Maximum acceptable slippage */
  maxSlippage?: number;

  /** Take profit tier (e.g., first target, second target) */
  tier?: number;

  /** Whether to move stop loss after this take profit hits */
  moveStopToBreakeven?: boolean;
}

// ===================================================================
// PORTFOLIO MANAGEMENT
// ===================================================================

/**
 * Portfolio - A collection of positions with metadata
 *
 * Portfolios provide flexible grouping of positions based on different
 * criteria such as time horizon, risk profile, or strategic purpose.
 */
export interface Portfolio {
  /** Unique identifier for the portfolio */
  id: string;

  /** Human-readable name for the portfolio */
  name: string;

  /** Optional description of the portfolio's purpose or strategy */
  description?: string;

  /** When the portfolio was created */
  dateCreated: DateOrGenesis;

  /** Status of the portfolio */
  status: "active" | "archived" | "deleted";

  /** IDs of positions included in this portfolio */
  positionIds: string[];

  /** User who owns this portfolio */
  userId: string;

  /** Optional tags for flexible categorization */
  tags?: string[];

  /** Additional notes or context */
  notes?: string;

  /** Base currency for portfolio valuation */
  baseCurrency: string;

  /** Risk profile classification */
  riskProfile?: "conservative" | "moderate" | "aggressive" | "custom";

  /** Target allocation percentages by asset */
  targetAllocations?: {
    /** Asset ticker */
    asset: string;

    /** Target percentage (0-100) */
    percentage: number;
  }[];

  /** Current total value */
  currentValue?: number;

  /** Initial investment amount */
  initialInvestment?: number;

  /** Current profit/loss */
  profitLoss?: number;

  /** Current return percentage */
  returnPercentage?: number;

  /** Portfolio visibility setting */
  isPublic?: boolean;

  /** Metadata for UI display purposes */
  displayMetadata?: {
    /** Custom color for portfolio visualization */
    color?: string;

    /** Display order when showing multiple portfolios */
    sortOrder?: number;

    /** Whether this portfolio is pinned in the UI */
    isPinned?: boolean;

    /** Custom icon */
    icon?: string;

    /** Custom portfolio image/banner */
    headerImage?: string;
  };
}

// ===================================================================
// TIME-BASED VALUATION & REPORTING
// ===================================================================

/**
 * TimeFrameUnit - The unit of time for a valuation period
 */
export type TimeFrameUnit =
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "genesis"
  | "custom";

/**
 * TimeFrameGranularity - The granularity level of source data for a valuation
 */
export type TimeFrameGranularity =
  | "intraday"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "genesis";

/**
 * AggregationMethod - How values are aggregated when rolling up from smaller to larger timeframes
 */
export type AggregationMethod =
  | "close"
  | "open"
  | "high"
  | "low"
  | "average"
  | "weighted"
  | "custom";

/**
 * ReportType - Classification of financial report by time period
 */
export type ReportType =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "custom";

/**
 * ReportSourceGranularity - Data granularity used as source for a report
 */
export type ReportSourceGranularity =
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly";

/**
 * TemporalMetadata - Comprehensive time period classification for a valuation
 */
export interface TemporalMetadata {
  /** Year of the valuation (e.g., 2024) */
  year: number;

  /** Quarter of the year (1-4) */
  quarter?: number;

  /** Month of the year (1-12) */
  month?: number;

  /** Week of the year (1-53) */
  week?: number;

  /** Day of the month (1-31) */
  day?: number;

  /** Day of the year (1-366) */
  dayOfYear?: number;

  /** ISO week number */
  isoWeek?: number;

  /** ISO week year (may differ from calendar year at year boundaries) */
  isoWeekYear?: number;

  /** Formatted period identifier (e.g., "2024-W12", "2024-Q1", "2024-03-15") */
  periodKey: string;

  /** Human-readable period name (e.g., "March 2024", "Q1 2024", "Week 12, 2024") */
  periodName: string;

  /** Type of time frame this valuation represents */
  timeFrameUnit: TimeFrameUnit;

  /** Start date of this time period */
  periodStart: Date;

  /** End date of this time period */
  periodEnd: Date;

  /** Whether this marks the end of a specific timeframe (e.g., quarter-end) */
  isTimeframeBoundary: boolean;
}

/**
 * AggregationMetadata - Information about how a valuation was derived
 */
export interface AggregationMetadata {
  /** Whether this valuation is derived from other valuations */
  isAggregated: boolean;

  /** Method used for aggregation */
  aggregationMethod: AggregationMethod;

  /** Source granularity used for this valuation */
  sourceGranularity: TimeFrameGranularity;

  /** Target granularity of this valuation */
  targetGranularity: TimeFrameGranularity;

  /** IDs of source valuations used to derive this aggregated valuation */
  sourceValuationIds?: string[];

  /** Number of source valuations */
  sourceCount?: number;

  /** Coverage percentage (e.g., if some daily data is missing from a monthly aggregate) */
  coveragePercentage?: number;

  /** Whether any missing data was estimated/interpolated */
  hasEstimatedData?: boolean;
}

/**
 * TimeSeriesMetadata - Grouping and sequence information for related valuations
 */
export interface TimeSeriesMetadata {
  /** ID for the time series this valuation belongs to */
  timeSeriesId: string;

  /** Human-readable name for the time series */
  timeSeriesName: string;

  /** Position in the sequence (e.g., week 3 of 52) */
  sequenceNumber: number;

  /** Total items in this series */
  totalInSeries: number;

  /** Whether this is the first item in the series */
  isFirst: boolean;

  /** Whether this is the last item in the series */
  isLast: boolean;

  /** ID of the previous valuation in this series */
  previousInSeriesId?: string;

  /** ID of the next valuation in this series */
  nextInSeriesId?: string;

  /** Parent time series ID (e.g., the quarterly series that contains this monthly series) */
  parentTimeSeriesId?: string;

  /** Child time series ID (e.g., the weekly series contained within this monthly valuation) */
  childTimeSeriesId?: string;
}

/**
 * PerformanceComparison - Standard structure for period-to-period comparisons
 */
export interface PerformanceComparison {
  /** Absolute value change */
  valueChange: number;

  /** Percentage change */
  percentageChange: number;

  /** Annualized percentage change (for comparing periods of different lengths) */
  annualizedChange?: number;

  /** Reference valuation ID used for comparison */
  referenceValuationId?: string;

  /** Time elapsed between comparisons */
  timeElapsed?: string;
}

/**
 * ReferenceComparisons - Standard comparison points for valuations
 */
export interface ReferenceComparisons {
  /** Comparison to previous period of the same type */
  previousPeriod?: PerformanceComparison;

  /** Comparison to the period at the start of the current year */
  yearStart?: PerformanceComparison;

  /** Comparison to the period at the start of the current quarter */
  quarterStart?: PerformanceComparison;

  /** Comparison to the period at the start of the current month */
  monthStart?: PerformanceComparison;

  /** Comparison to genesis (initial) valuation */
  genesis?: PerformanceComparison;

  /** Comparison to same period in previous year */
  yearOverYear?: PerformanceComparison;

  /** Comparison to same period in previous quarter */
  quarterOverQuarter?: PerformanceComparison;

  /** Comparison to same period in previous month */
  monthOverMonth?: PerformanceComparison;

  /** Custom comparison points with descriptive keys */
  custom?: Record<string, PerformanceComparison>;
}

/**
 * PositionValuation - Value and performance data for a position at a specific time
 *
 * Captures the essential financial metrics for a position at the time of valuation.
 */
export interface PositionValuation {
  /** Unique identifier for this position valuation */
  id: string;

  /** Reference to the original position */
  positionId: string;

  /** Value of the position at valuation time */
  value: number;

  /** Market price of the asset at valuation time */
  marketPrice: number;

  /** Asset holding amount (in base currency) */
  quantity: number;

  /** Initial cost basis of the position */
  costBasis: number;

  /** Absolute profit/loss at this time */
  profitLoss: number;

  /** Percentage return at this time */
  percentageReturn: number;

  /** Reference comparisons, same structure as in PortfolioValuation */
  referenceComparisons?: ReferenceComparisons;

  /** Aggregation metadata if this is derived from other position valuations */
  aggregationMetadata?: AggregationMetadata;

  /** Position's contribution to total portfolio (percentage) */
  portfolioWeight?: number;

  /** Realized profit/loss to date */
  realizedProfitLoss?: number;

  /** Unrealized profit/loss at valuation time */
  unrealizedProfitLoss?: number;

  /** Internal rate of return (IRR) */
  irr?: number;

  /** Day-over-day percentage change */
  dailyChange?: number;

  /** Whether position was open at this valuation time */
  isOpen: boolean;

  /** Tags associated with this position at valuation time */
  tags?: string[];
}

/**
 * PortfolioValuation - A time-based record of a portfolio's state and performance
 *
 * Captures the value, composition, and performance metrics of a portfolio
 * at a specific point in time, enabling historical analysis and comparison.
 */
export interface PortfolioValuation {
  /** Unique identifier for the valuation record */
  id: string;

  /** Reference to the portfolio this valuation represents */
  portfolioId: string;

  /** When the valuation was taken/calculated */
  timestamp: Date;

  /** Comprehensive temporal classification */
  temporalMetadata: TemporalMetadata;

  /** Aggregation information */
  aggregationMetadata: AggregationMetadata;

  /** Time series grouping information */
  timeSeriesMetadata?: TimeSeriesMetadata;

  /** Total portfolio value at this time */
  totalValue: number;

  /** Currency of the total value (e.g., USD, USDT) */
  valueCurrency: string;

  /** Initial investment amount (cost basis of all positions) */
  initialInvestment: number;

  /** Absolute profit/loss at this time */
  profitLoss: number;

  /** Percentage return at this time */
  percentageReturn: number;

  /** Position valuations in the portfolio at this time */
  positionValuations: PositionValuation[];

  /** Standard reference point comparisons */
  referenceComparisons?: ReferenceComparisons;

  /** Whether this valuation was created retroactively */
  isRetroactive: boolean;

  /** Total realized profit/loss at this time */
  realizedProfitLoss?: number;

  /** Total unrealized profit/loss at this time */
  unrealizedProfitLoss?: number;

  /** Return metrics */
  returnMetrics?: {
    /** Daily return */
    daily?: number;
    /** Weekly return */
    weekly?: number;
    /** Monthly return */
    monthly?: number;
    /** Quarterly return */
    quarterly?: number;
    /** Yearly return */
    yearly?: number;
    /** Since inception return */
    inception?: number;
  };

  /** Risk metrics */
  riskMetrics?: {
    /** Standard deviation of returns */
    volatility?: number;
    /** Maximum drawdown */
    maxDrawdown?: number;
    /** Sharpe ratio */
    sharpeRatio?: number;
    /** Sortino ratio */
    sortinoRatio?: number;
    /** Calmar ratio */
    calmarRatio?: number;
  };

  /** Position count at this time */
  positionCount?: number;

  /** Asset allocation breakdown */
  assetAllocation?: {
    /** Asset ticker */
    asset: string;
    /** Value in portfolio currency */
    value: number;
    /** Percentage of portfolio */
    percentage: number;
  }[];

  /** Additional market context */
  marketContext?: {
    /** Bitcoin price at this time */
    btcPrice?: number;

    /** Ethereum price at this time */
    ethPrice?: number;

    /** Total crypto market cap at this time */
    totalMarketCap?: number;

    /** Fear & Greed Index value */
    fearGreedIndex?: number;

    /** Bitcoin dominance percentage */
    btcDominance?: number;

    /** DXY (USD Index) value */
    dxy?: number;

    /** S&P 500 value */
    sp500?: number;
  };

  /** Additional notes or context */
  notes?: string;
}

/**
 * PerformanceReport - Standard structure for time-based performance reports
 *
 * This structure ties together multiple portfolio valuations into a cohesive
 * report with summary metrics and comparative analysis.
 */
export interface PerformanceReport {
  /** Unique identifier for the report */
  id: string;

  /** Reference to the portfolio this report is for */
  portfolioId: string;

  /** Type of report */
  reportType: ReportType;

  /** Granularity of source data */
  sourceGranularity: ReportSourceGranularity;

  /** Period covered by the report */
  period: {
    /** Start date of the report period */
    startDate: Date;

    /** End date of the report period */
    endDate: Date;

    /** Human-readable period name (e.g., "Q1 2024", "March 2024") */
    periodName: string;
  };

  /** Timestamp when the report was generated */
  generatedAt: Date;

  /** Summary metrics for the entire report period */
  summary: {
    /** Starting value */
    startValue: number;

    /** Ending value */
    endValue: number;

    /** Absolute change over the period */
    absoluteChange: number;

    /** Percentage change over the period */
    percentageChange: number;

    /** High value during the period */
    highValue: number;

    /** Low value during the period */
    lowValue: number;

    /** Average value during the period */
    averageValue: number;

    /** Volatility measure (e.g., standard deviation of returns) */
    volatility?: number;

    /** Sharpe ratio if applicable */
    sharpeRatio?: number;

    /** Maximum drawdown percentage */
    maxDrawdown?: number;

    /** Best performing day/week/month */
    bestPeriod?: {
      /** Period identifier */
      periodKey: string;
      /** Value at that time */
      value: number;
      /** Percentage change */
      percentageChange: number;
    };

    /** Worst performing day/week/month */
    worstPeriod?: {
      /** Period identifier */
      periodKey: string;
      /** Value at that time */
      value: number;
      /** Percentage change */
      percentageChange: number;
    };

    /** Number of profitable periods */
    profitablePeriods?: number;

    /** Number of unprofitable periods */
    unprofitablePeriods?: number;

    /** Profit factor */
    profitFactor?: number;
  };

  /** Individual valuations that make up this report */
  valuations: PortfolioValuation[];

  /** Array of time series IDs included in this report */
  timeSeriesIds: string[];

  /** Top performing positions */
  topPositions?: {
    /** Position ID */
    positionId: string;
    /** Position name */
    name: string;
    /** Absolute contribution */
    contribution: number;
    /** Percentage return */
    percentageReturn: number;
  }[];

  /** Worst performing positions */
  bottomPositions?: {
    /** Position ID */
    positionId: string;
    /** Position name */
    name: string;
    /** Absolute contribution */
    contribution: number;
    /** Percentage return */
    percentageReturn: number;
  }[];

  /** Optional comparison to benchmark */
  benchmarkComparison?: {
    /** Name of the benchmark (e.g., "Bitcoin", "S&P 500") */
    benchmarkName: string;

    /** Benchmark starting value */
    startValue: number;

    /** Benchmark ending value */
    endValue: number;

    /** Benchmark percentage change */
    percentageChange: number;

    /** Relative performance (portfolio % change - benchmark % change) */
    relativePerformance: number;

    /** Beta coefficient (portfolio correlation to benchmark) */
    beta?: number;

    /** Alpha (excess return over benchmark) */
    alpha?: number;
  };

  /** Whether this report was generated as a scheduled/automated report */
  isScheduled: boolean;

  /** User who requested this report (if manually generated) */
  generatedBy?: string;

  /** Export format details if the report was exported */
  exportDetails?: {
    /** Format of the export (PDF, CSV, etc.) */
    format: string;

    /** When the export was created */
    exportedAt: Date;

    /** URL or path to the exported file */
    location: string;
  };

  /** Report visibility setting */
  isPublic?: boolean;

  /** Tags for organization */
  tags?: string[];

  /** Report template used */
  templateId?: string;
}

// ===================================================================
// USER & SETTINGS TYPES
// ===================================================================

/**
 * User preference settings for the application
 */
export interface UserPreferences {
  /** UI theme preference */
  theme: "light" | "dark" | "system";

  /** Default currency for valuations */
  defaultCurrency: string;

  /** Timezone for time-based displays */
  timezone: string;

  /** Default portfolio to show on login */
  defaultPortfolio?: string;

  /** UI layout preferences */
  layout?: {
    /** Dashboard layout configuration */
    dashboard?: Record<string, any>;

    /** Portfolio view layout */
    portfolioView?: Record<string, any>;

    /** Position detail layout */
    positionDetail?: Record<string, any>;
  };

  /** Default timeframe for charts */
  defaultTimeframe?: TimeFrame;

  /** Notification preferences */
  notifications?: {
    /** Whether email notifications are enabled */
    emailEnabled: boolean;

    /** Whether push notifications are enabled */
    pushEnabled: boolean;

    /** Price alert settings */
    priceAlerts?: boolean;

    /** Position status change notifications */
    positionStatusChanges?: boolean;

    /** Portfolio performance alerts */
    performanceAlerts?: boolean;
  };

  /** Privacy settings */
  privacy?: {
    /** Whether portfolios are public by default */
    defaultPortfolioVisibility: "public" | "private";

    /** Whether to show in leaderboards */
    showInLeaderboards: boolean;
  };

  /** Report generation settings */
  reportSettings?: {
    /** Default report type */
    defaultReportType: ReportType;

    /** Whether to generate reports automatically */
    autoGenerate: boolean;

    /** Report generation frequency */
    frequency?: "daily" | "weekly" | "monthly";
  };
}

/**
 * User profile data
 */
export interface UserProfile {
  /** Unique identifier */
  id: string;

  /** Display name */
  displayName: string;

  /** Email address */
  email: string;

  /** Account creation date */
  createdAt: Date;

  /** Last login date */
  lastLoginAt?: Date;

  /** User preferences */
  preferences: UserPreferences;

  /** Profile picture URL */
  avatarUrl?: string;

  /** Short bio */
  bio?: string;

  /** Social media profiles */
  socialProfiles?: {
    /** Twitter handle */
    twitter?: string;

    /** Discord username */
    discord?: string;

    /** Telegram username */
    telegram?: string;
  };

  /** User tier/subscription level */
  subscriptionTier?: "free" | "basic" | "premium" | "professional";

  /** Whether email is verified */
  isEmailVerified: boolean;

  /** Account status */
  status: "active" | "suspended" | "deactivated";

  /** User badges/achievements */
  badges?: string[];

  /** User roles */
  roles?: string[];

  /** Whether user is an admin */
  isAdmin?: boolean;
}

// ===================================================================
// ANALYTICS & INSIGHTS
// ===================================================================

/**
 * Trading performance metrics for analysis
 */
export interface TradingMetrics {
  /** Total number of trades */
  totalTrades: number;

  /** Number of winning trades */
  winningTrades: number;

  /** Number of losing trades */
  losingTrades: number;

  /** Win rate percentage */
  winRate: number;

  /** Average profit on winning trades */
  avgWinAmount: number;

  /** Average loss on losing trades */
  avgLossAmount: number;

  /** Average profit/loss across all trades */
  avgProfitLoss: number;

  /** Risk-adjusted return (Sharpe ratio) */
  sharpeRatio?: number;

  /** Maximum consecutive wins */
  maxConsecutiveWins: number;

  /** Maximum consecutive losses */
  maxConsecutiveLosses: number;

  /** Maximum drawdown percentage */
  maxDrawdown: number;

  /** Profit factor (gross profit / gross loss) */
  profitFactor: number;

  /** Expectancy (average amount you can expect to win/lose per trade) */
  expectancy: number;

  /** Average holding time for positions */
  avgHoldingTime?: string;

  /** Standard deviation of returns */
  stdDeviation?: number;

  /** Breakdown by trade type */
  byTradeType?: Record<
    string,
    {
      /** Number of trades of this type */
      count: number;

      /** Win rate for this trade type */
      winRate: number;

      /** Average profit/loss for this type */
      avgProfitLoss: number;
    }
  >;

  /** Breakdown by asset */
  byAsset?: Record<
    string,
    {
      /** Number of trades with this asset */
      count: number;

      /** Win rate for this asset */
      winRate: number;

      /** Average profit/loss for this asset */
      avgProfitLoss: number;
    }
  >;

  /** Performance by time frame */
  byTimeFrame?: Record<
    TimeFrame,
    {
      /** Number of trades with this time frame */
      count: number;

      /** Win rate for this time frame */
      winRate: number;

      /** Average profit/loss for this time frame */
      avgProfitLoss: number;
    }
  >;
}

/**
 * Trading insight generated from position data
 */
export interface TradingInsight {
  /** Unique identifier */
  id: string;

  /** Type of insight */
  type: "pattern" | "recommendation" | "warning" | "analysis";

  /** Short summary of the insight */
  summary: string;

  /** Detailed explanation */
  description: string;

  /** Confidence level (0-1) */
  confidence: number;

  /** When the insight was generated */
  generatedAt: Date;

  /** Related positions */
  relatedPositionIds?: string[];

  /** Related metrics */
  relatedMetrics?: MetricType[];

  /** Suggested actions */
  suggestedActions?: string[];

  /** Historical context or reference */
  historicalContext?: string;

  /** Tags for categorization */
  tags?: string[];

  /** Whether this insight has been viewed by the user */
  isViewed?: boolean;

  /** Whether this insight has been actioned by the user */
  isActioned?: boolean;

  /** Whether this insight has been saved by the user */
  isSaved?: boolean;
}

/**
 * Market analysis data point
 */
export interface MarketData {
  /** Asset ticker */
  asset: string;

  /** Timestamp of this data point */
  timestamp: Date;

  /** Open price */
  open: number;

  /** High price */
  high: number;

  /** Low price */
  low: number;

  /** Close price */
  close: number;

  /** Trading volume */
  volume: number;

  /** Market capitalization */
  marketCap?: number;

  /** 24h price change percentage */
  changePercentage24h?: number;

  /** 7-day price change percentage */
  changePercentage7d?: number;

  /** 30-day price change percentage */
  changePercentage30d?: number;

  /** Trading volume change percentage */
  volumeChangePercentage24h?: number;

  /** All-time high price */
  ath?: number;

  /** Date of all-time high */
  athDate?: Date;

  /** All-time high change percentage */
  athChangePercentage?: number;

  /** All-time low price */
  atl?: number;

  /** Date of all-time low */
  atlDate?: Date;

  /** All-time low change percentage */
  atlChangePercentage?: number;
}

// ===================================================================
// NOTIFICATION & ALERTS
// ===================================================================

/**
 * Type of notification
 */
export type NotificationType =
  | "price_alert"
  | "position_update"
  | "portfolio_alert"
  | "report_generated"
  | "system_notification";

/**
 * Priority level for notifications
 */
export type NotificationPriority = "low" | "medium" | "high" | "critical";

/**
 * System notification
 */
export interface Notification {
  /** Unique identifier */
  id: string;

  /** Type of notification */
  type: NotificationType;

  /** Notification title */
  title: string;

  /** Notification content */
  message: string;

  /** When the notification was created */
  timestamp: Date;

  /** User this notification is for */
  userId: string;

  /** Priority level */
  priority: NotificationPriority;

  /** Whether notification has been viewed */
  isRead: boolean;

  /** Whether notification has been actioned */
  isActioned?: boolean;

  /** Action URL (where clicking should take the user) */
  actionUrl?: string;

  /** Action text (what clicking does) */
  actionText?: string;

  /** Optional icon */
  icon?: string;

  /** Additional structured data related to this notification */
  data?: Record<string, any>;

  /** Related entities (positions, portfolios, etc.) */
  relatedEntityIds?: {
    /** Type of entity */
    type: string;
    /** Entity ID */
    id: string;
  }[];
}

/**
 * Price alert configuration
 */
export interface PriceAlert {
  /** Unique identifier */
  id: string;

  /** User who created the alert */
  userId: string;

  /** Asset this alert is for */
  asset: string;

  /** Target price that triggers the alert */
  targetPrice: number;

  /** Direction ("above" or "below") */
  direction: "above" | "below";

  /** Whether this is a percentage change alert */
  isPercentageChange?: boolean;

  /** Percentage change threshold (if applicable) */
  percentageChange?: number;

  /** Whether alert repeats or triggers once */
  repeating: boolean;

  /** Whether alert is currently active */
  isActive: boolean;

  /** When the alert was created */
  createdAt: Date;

  /** When the alert was last triggered (if ever) */
  lastTriggeredAt?: Date;

  /** Alert notification channels */
  channels?: ("email" | "push" | "sms")[];

  /** Custom alert message */
  customMessage?: string;

  /** Whether to also create a journal entry when triggered */
  createJournalEntry?: boolean;

  /** Related position (if any) */
  positionId?: string;
}

// ===================================================================
// API & EXCHANGE INTEGRATION
// ===================================================================

/**
 * Exchange account configuration
 */
export interface ExchangeAccount {
  /** Unique identifier */
  id: string;

  /** User who owns this account */
  userId: string;

  /** Exchange name */
  exchange: string;

  /** Human-readable name for this account */
  label: string;

  /** API key (encrypted) */
  apiKey: string;

  /** API secret (encrypted) */
  apiSecret: string;

  /** Optional API passphrase (for some exchanges) */
  apiPassphrase?: string;

  /** Whether account is currently connected */
  isConnected: boolean;

  /** Last sync timestamp */
  lastSynced?: Date;

  /** Connection status */
  status: "active" | "error" | "disconnected" | "pending";

  /** Error message if status is "error" */
  errorMessage?: string;

  /** Permissions granted to this API key */
  permissions?: {
    /** Can read balances and trades */
    read: boolean;

    /** Can place trades */
    trade: boolean;

    /** Can withdraw funds */
    withdraw: boolean;
  };

  /** Whether to automatically sync data */
  autoSync: boolean;

  /** Sync frequency in minutes */
  syncFrequency?: number;

  /** When the account was added */
  createdAt: Date;

  /** When the account was last updated */
  updatedAt: Date;
}

/**
 * Blockchain wallet tracking
 */
export interface Wallet {
  /** Unique identifier */
  id: string;

  /** User who owns this wallet */
  userId: string;

  /** Wallet address (public key) */
  address: string;

  /** Human-readable label */
  label: string;

  /** Blockchain network */
  network: string;

  /** Wallet type */
  type: "software" | "hardware" | "paper" | "exchange" | "other";

  /** Hardware wallet model (if applicable) */
  hardwareModel?: string;

  /** Whether this is a watch-only wallet */
  isWatchOnly: boolean;

  /** Whether balance is shown in portfolio */
  includeInPortfolio: boolean;

  /** Last known balance */
  lastKnownBalance?: {
    /** Asset ticker */
    asset: string;
    /** Balance amount */
    amount: number;
    /** When balance was last fetched */
    timestamp: Date;
  }[];

  /** When the wallet was added */
  createdAt: Date;

  /** When the wallet was last updated */
  updatedAt: Date;

  /** Additional notes */
  notes?: string;

  /** Tags for organization */
  tags?: string[];
}

/**
 * Represents a storage location for assets
 */
export interface WalletLocation {
  /** Unique identifier */
  id: string;

  /** Human-readable name for this location */
  name: string;

  /** Type of location where assets are stored */
  locationType: AssetLocationType;

  /** Exchange name (if location is an exchange) */
  exchangeName?: string;

  /** Account type within the exchange (if applicable) */
  accountType?: string;

  /** Storage type for cold storage locations */
  storageType?: string;

  /** Storage device name for cold storage */
  storageName?: string;

  /** User who owns this wallet location */
  userId: string;

  /** Optional creation timestamp */
  createdAt?: Date;

  /** Optional update timestamp */
  updatedAt?: Date;
}

// ===================================================================
// CURRENCY & EXCHANGE INTEGRATION
// ===================================================================

/**
 * Currency type classification
 */
export type CurrencyType =
  | "cryptocurrency" // Standard crypto assets (BTC, ETH, etc.)
  | "stablecoin" // Pegged assets (USDT, USDC, DAI, etc.)
  | "fiat"; // Government-issued currencies (USD, EUR, MXN, etc.)

/**
 * Stablecoin peg type
 */
export type StablecoinPegType =
  | "USD" // Pegged to US Dollar
  | "EUR" // Pegged to Euro
  | "GOLD" // Pegged to gold
  | "BTC" // Pegged to Bitcoin
  | "OTHER"; // Other peg types

/**
 * Enhanced currency metadata
 */
export interface CurrencyMetadata {
  /** Currency symbol/ticker */
  ticker: string;

  /** Full name of the currency */
  name: string;

  /** Type of currency */
  type: CurrencyType;

  /** Decimal places for display */
  decimals: number;

  /** Currency symbol for display */
  symbol: string;

  /** Symbol position (prefix or suffix) */
  symbolPosition: "prefix" | "suffix";

  /** For stablecoins, what they're pegged to */
  peggedTo?: StablecoinPegType;

  /** For stablecoins, the target value */
  pegValue?: number;

  /** ISO 4217 code for fiat currencies */
  isoCode?: string;
}
