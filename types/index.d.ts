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
