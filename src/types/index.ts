/**
 * Core domain types for the application
 *
 * This file contains the most relevant types used across the application.
 * Keep it focused on core domain types that are shared across multiple layers.
 */

// ============================================================================
// Portfolio Types
// ============================================================================

export interface Portfolio {
  /** Unique identifier for the portfolio */
  id: string;

  /** Human-readable name for the portfolio */
  name: string;

  /** Optional description of the portfolio's purpose or strategy */
  description?: string | null;

  /** User who owns this portfolio */
  userId: string;

  /** Current total value of the portfolio */
  totalValue: number;

  /** Whether this portfolio is pinned in the UI */
  isPinned: boolean;

  /** When the portfolio was created */
  createdAt: Date;

  /** When the portfolio was last updated */
  updatedAt: Date;

  // Computed/derived fields (from getPortfolioById)
  /** Day-over-day change in value (absolute) */
  dayChange?: number;

  /** Day-over-day change in value (percentage) */
  dayChangePercent?: number;

  /** Top holdings symbols (typically top 5) */
  topHoldings?: string[];

  // Optional future enhancements
  /** Status of the portfolio */
  status?: "active" | "archived" | "deleted";

  /** Optional tags for flexible categorization */
  tags?: string[];

  /** Additional notes or context */
  notes?: string;

  /** Base currency for portfolio valuation */
  baseCurrency?: string;

  /** Risk profile classification */
  riskProfile?: "conservative" | "moderate" | "aggressive" | "custom";

  /** Target allocation percentages by asset */
  targetAllocations?: {
    /** Asset ticker */
    asset: string;
    /** Target percentage (0-100) */
    percentage: number;
  }[];

  /** Initial investment amount */
  initialInvestment?: number;

  /** Portfolio visibility setting */
  isPublic?: boolean;

  /** Metadata for UI display purposes */
  displayMetadata?: {
    /** Custom color for portfolio visualization */
    color?: string;
    /** Display order when showing multiple portfolios */
    sortOrder?: number;
    /** Custom icon */
    icon?: string;
    /** Custom portfolio image/banner */
    headerImage?: string;
  };
}

