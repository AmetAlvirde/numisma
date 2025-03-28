/**
 * Base types and enums for the Numisma application
 * These are the foundational types that other types will build upon
 */

// ===================================================================
// CORE ENUMS
// ===================================================================

/**
 * Position lifecycle states
 */
export enum PositionLifecycle {
  PLANNED = "PLANNED",
  ACTIVE = "ACTIVE",
  CLOSED = "CLOSED",
  CANCELLED = "CANCELLED",
}

/**
 * Capital tier classification
 * Tracks the origin of capital used in positions
 */
export enum CapitalTier {
  C1 = "C1", // Fresh capital from external sources
  C2 = "C2", // Realized profits from previous trades
  C3 = "C3", // Compound growth from C2 profits
  C4 = "C4", // Compound growth from C3 profits
  C5 = "C5", // Compound growth from C4 profits
}

/**
 * Asset location types
 */
export enum AssetLocationType {
  EXCHANGE = "EXCHANGE",
  DEX = "DEX",
  COLD_STORAGE = "COLD_STORAGE",
  DEFI = "DEFI",
  STAKING = "STAKING",
  LENDING = "LENDING",
}

/**
 * Order status states
 */
export enum OrderStatus {
  SUBMITTED = "SUBMITTED",
  FILLED = "FILLED",
  CANCELLED = "CANCELLED",
  PARTIALLY_FILLED = "PARTIALLY_FILLED",
  EXPIRED = "EXPIRED",
}

/**
 * Order types
 */
export enum OrderType {
  TRIGGER = "TRIGGER",
  MARKET = "MARKET",
  LIMIT = "LIMIT",
  TRAILING_STOP = "TRAILING_STOP",
  OCO = "OCO",
}

/**
 * Order purpose
 */
export enum OrderPurpose {
  ENTRY = "ENTRY",
  EXIT = "EXIT",
  STOP_LOSS = "STOP_LOSS",
  TAKE_PROFIT = "TAKE_PROFIT",
}

/**
 * Portfolio status
 */
export enum PortfolioStatus {
  ACTIVE = "ACTIVE",
  ARCHIVED = "ARCHIVED",
  DELETED = "DELETED",
}

/**
 * Risk profile classification
 */
export enum RiskProfile {
  CONSERVATIVE = "CONSERVATIVE",
  MODERATE = "MODERATE",
  AGGRESSIVE = "AGGRESSIVE",
  CUSTOM = "CUSTOM",
}

/**
 * Asset types
 */
export enum AssetType {
  CRYPTO = "CRYPTO",
  STOCK = "STOCK",
  FOREX = "FOREX",
  COMMODITY = "COMMODITY",
  STABLECOIN = "STABLECOIN",
  NFT = "NFT",
  TOKEN = "TOKEN",
}

// ===================================================================
// CORE UTILITY TYPES
// ===================================================================

/**
 * Type-safe foreign key type
 */
export type ForeignKey<T> = string & { readonly brand: unique symbol };

/**
 * Cascade behavior options
 */
export enum CascadeBehavior {
  CASCADE = "CASCADE",
  RESTRICT = "RESTRICT",
  SET_NULL = "SET_NULL",
  NO_ACTION = "NO_ACTION",
}

/**
 * Relation options for type-safe relationships
 */
export interface RelationOptions {
  onDelete?: CascadeBehavior;
  onUpdate?: CascadeBehavior;
}

/**
 * Type-safe many-to-many relationship helper
 */
export interface ManyToMany<T> {
  items: T[];
  add: (item: T) => void;
  remove: (item: T) => void;
}

// ===================================================================
// DATE HANDLING
// ===================================================================

/**
 * Pre-tracking status for positions that existed before system tracking
 */
export interface PreTrackingStatus {
  isPreTracking: boolean;
  dateOpened: Date | null;
}

// ===================================================================
// VALIDATION TYPES
// ===================================================================

/**
 * Validation result type
 */
export interface ValidationResult {
  isValid: boolean;
  errors?: string[];
  warnings?: string[];
}

/**
 * Validation options
 */
export interface ValidationOptions {
  strict?: boolean;
  allowPartial?: boolean;
  validateRelations?: boolean;
}
