/**
 * Core domain types for the crypto portfolio system.
 * 
 * This file defines the central data model for the entire application.
 * The core entity is Position, which represents any investment a user makes.
 */

/**
 * Represents either a Date object, string date, or the special "genesis" value.
 * "genesis" indicates the position existed before the user started tracking it.
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
 */
export type PositionStatus = "active" | "closed";

/**
 * Basic Portfolio interface
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
}

// More types will be migrated from index.d.ts
