/**
 * types.d.ts - Core domain types for the crypto portfolio system
 *
 * This file defines the central data model for the entire application.
 * The core entity is Position, which represents any investment a user makes.
 */

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
export type WalletType = "hot" | "cold";

/**
 * Current state of a position
 * - active: Position currently has allocated capital
 * - closed: Position has been fully exited
 *
 * @future May expand to include "partial" for partially closed positions
 */
export type PositionStatus = "active" | "closed";

/**
 * Status of an individual order
 * - submitted: Order created but not yet executed
 * - filled: Order has been executed on the exchange/market
 * - cancelled: Order was cancelled before execution
 */
export type OrderStatus = "submitted" | "filled" | "cancelled";

/**
 * Type of order execution mechanism
 * - trigger: Executes when price reaches a specific level
 * - market: Executes immediately at current market price
 * - limit: Executes only at specified price or better
 */
export type OrderType = "trigger" | "market" | "limit";

/**
 * Unit for order size specification
 * - percentage: Size as percentage of total position (0.01-1.0)
 * - base: Size in base currency units (e.g., BTC in BTC/USDT)
 * - quote: Size in quote currency units (e.g., USDT in BTC/USDT)
 */
export type SizeUnit = "percentage" | "base" | "quote";

/**
 * Position - The central entity in the portfolio system
 *
 * A position represents a specific investment (long or short) in a crypto asset.
 * Positions are container objects that aggregate orders, stop losses, take profits,
 * and metadata like the trading thesis and journal entries.
 *
 * @example
 * {
 *   id: "123",
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
  portfolio: string;

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
  seedCapitalTier: string;

  /** Trading strategy classification (e.g., "Buy the dip", "altseason") */
  strategy: string;

  /** Detailed trading thesis with reasoning and exit conditions */
  thesis?: Thesis;

  /** Trading journal entries for subjective notes and learnings */
  journal?: JournalEntry[];

  /** The crypto asset being traded */
  asset: Asset;

  /**
   * Core position execution details
   * Previously named "position" which was confusing (position inside position)
   * Contains orders, stop losses, take profits, etc.
   */
  positionDetails: PositionDetails;
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
  fullfilment?: string;

  /** Additional context or considerations */
  notes?: string;
}

/**
 * Journal entry for documenting thoughts and attachments related to a position
 *
 * Allows traders to track subjective aspects and learning over time.
 */
export interface JournalEntry {
  /** Unique identifier for the journal entry */
  id: string;

  /** The actual journal content/thought */
  thought: string;

  /** Optional file attachments (charts, screenshots, etc.) */
  attachments?: string[];

  /** When the journal entry was created */
  timestamp?: DateOrGenesis;
}

/**
 * Details about the crypto asset being traded
 *
 * Captures both the asset itself and its location information.
 */
export interface Asset {
  /** Full name of the cryptocurrency */
  name: string;

  /** Trading symbol/ticker (e.g., "BTC", "ETH") */
  ticker: string;

  /**
   * Trading pair in BASE/QUOTE format
   * The base is the asset being bought/sold
   * The quote is what it's priced in (typically USDT or USD)
   */
  pair: string;

  /** Where the asset is held (exchange or cold storage) */
  location: "exchange" | "ColdStorage";

  /** Which exchange platform, if on an exchange */
  exchange?: string;

  /**
   * Specific wallet or account within the location
   * For exchanges: "spot", "margin", "futures", etc.
   * For cold storage: wallet identifier
   */
  wallet: string;
}

/**
 * Core details about position execution
 *
 * Contains orders, stop losses, take profits, and status information.
 * This is the operational heart of a position.
 */
export interface PositionDetails {
  /** Current status of the position (active or closed) */
  status: PositionStatus;

  /** Direction of the position (buy=long, sell=short) */
  side: "buy" | "sell";

  /**
   * Time frame for the trade (e.g., "1D", "4H", "1W")
   * Follows standard charting notation:
   * M = month, W = week, D = day, H = hour
   */
  fractal: string;

  /**
   * Fee paid to move assets (e.g., between wallets)
   * Can be "genesis" if from before tracking started
   */
  transactionFee?: number | string | "genesis";

  /** When the position was opened */
  dateOpened?: DateOrGenesis;

  /** When the position was closed (if applicable) */
  dateClosed?: DateOrGenesis;

  /** List of execution orders for this position */
  orders: Order[];

  /** List of stop loss orders to protect capital */
  stopLoss?: StopLossOrder[];

  /** List of take profit orders to capture gains */
  takeProfit?: TakeProfitOrder[];
}

/**
 * Represents a single order (entry or exit) for a position
 *
 * Orders track the specific executions that compose a position,
 * including both planned and executed transactions.
 */
export interface Order {
  /** Unique identifier for the order */
  id: string;

  /**
   * When the order was opened/executed
   * Can be "genesis" if from before tracking started
   */
  dateOpen?: DateOrGenesis;

  /** Executed price, if filled */
  averagePrice?: number;

  /** Total cost in quote currency (e.g., USD or USDT) */
  totalCost?: number;

  /** Current status of the order */
  status: OrderStatus;

  /** Execution mechanism for the order */
  type: OrderType;

  /**
   * Transaction fee paid to the exchange
   * Can be "genesis" if from before tracking started
   */
  fee?: number | "genesis";

  /** Currency unit for the fee (typically base or quote currency) */
  feeUnit?: string;

  /** Amount of base currency acquired/sold */
  filled?: number;

  /** Unit for the filled amount (base or quote) */
  unit?: SizeUnit;

  /**
   * Price level that triggers the order
   * Used for limit orders and trigger orders
   */
  trigger?: number;

  /** Estimated cost for orders not yet executed */
  estimatedCost?: number;
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
}

/**
 * Enhanced Portfolio and Valuation Types for Numisma
 *
 * This file defines the enhanced types needed to support comprehensive
 * time-based reporting and performance tracking in the Numisma platform.
 */

import { DateOrGenesis, Position } from "./index";

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
  status: "active" | "archived";

  /** IDs of positions included in this portfolio */
  positionIds: string[];

  /** User who owns this portfolio */
  userId: string;

  /** Optional tags for flexible categorization */
  tags?: string[];

  /** Additional notes or context */
  notes?: string;

  /** Metadata for UI display purposes */
  displayMetadata?: {
    /** Custom color for portfolio visualization */
    color?: string;

    /** Display order when showing multiple portfolios */
    sortOrder?: number;

    /** Whether this portfolio is pinned in the UI */
    isPinned?: boolean;
  };
}

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
  };

  /** Additional notes or context */
  notes?: string;
}

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
  };

  /** Individual valuations that make up this report */
  valuations: PortfolioValuation[];

  /** Array of time series IDs included in this report */
  timeSeriesIds: string[];

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
}

/**
 * Example usage pattern for the 10 required report types:
 *
 * 1. Weekly reports based on daily close valuations:
 * {
 *   reportType: "weekly",
 *   sourceGranularity: "daily",
 *   valuations: [
 *     {
 *       temporalMetadata: { timeFrameUnit: "week", ... },
 *       aggregationMetadata: {
 *         sourceGranularity: "daily",
 *         targetGranularity: "weekly",
 *         ...
 *       }
 *     }
 *   ]
 * }
 *
 * 2. Monthly reports based on daily close valuations:
 * {
 *   reportType: "monthly",
 *   sourceGranularity: "daily",
 *   ...
 * }
 *
 * 3. Monthly reports based on weekly close valuations:
 * {
 *   reportType: "monthly",
 *   sourceGranularity: "weekly",
 *   ...
 * }
 *
 * And so on for the remaining report types.
 */
