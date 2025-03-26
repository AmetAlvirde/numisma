/**
 * use-portfolio-summary.ts - Hook for fetching and managing portfolio summary data
 *
 * This hook provides access to portfolio summary data from IndexedDB,
 * including total value, profit/loss, and ROI metrics.
 */

import { useState, useEffect, useCallback } from "react";
import { db } from "@/services/database/indexeddb-adapter";
import type { Portfolio } from "@/types/numisma-types";

interface PortfolioSummary {
  /** The portfolio ID */
  id: string;
  /** The portfolio name */
  name: string;
  /** The portfolio description */
  description?: string;
  /** Total current value of the portfolio */
  totalValue: number;
  /** Initial investment amount */
  initialInvestment: number;
  /** Current profit/loss */
  profitLoss: number;
  /** Return on investment percentage */
  returnPercentage: number;
  /** Base currency for the portfolio */
  baseCurrency: string;
  /** Number of positions in the portfolio */
  positionCount: number;
  /** Whether the portfolio is public */
  isPublic: boolean;
  /** Portfolio tags */
  tags: string[];
  /** Risk profile classification */
  riskProfile?: "conservative" | "moderate" | "aggressive" | "custom";
  /** Target allocation percentages by asset */
  targetAllocations?: {
    asset: string;
    percentage: number;
  }[];
  /** Display metadata */
  displayMetadata?: {
    color?: string;
    sortOrder?: number;
    isPinned?: boolean;
    icon?: string;
    headerImage?: string;
  };
}

interface UsePortfolioSummaryResult {
  /** The portfolio summary data */
  summary: PortfolioSummary | null;
  /** Whether the data is currently loading */
  isLoading: boolean;
  /** Any error that occurred while fetching data */
  error: Error | null;
  /** Function to refresh the portfolio data */
  refresh: () => Promise<void>;
}

/**
 * Hook for fetching and managing portfolio summary data
 */
export function usePortfolioSummary(
  portfolioId: string
): UsePortfolioSummaryResult {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch portfolio data from IndexedDB
      const portfolio = await db.get("portfolios", portfolioId);
      if (!portfolio) {
        throw new Error(`Portfolio with ID ${portfolioId} not found`);
      }

      // Transform portfolio data into summary format
      const summary: PortfolioSummary = {
        id: portfolio.id,
        name: portfolio.name,
        description: portfolio.description,
        totalValue: portfolio.currentValue ?? 0,
        initialInvestment: portfolio.initialInvestment ?? 0,
        profitLoss: portfolio.profitLoss ?? 0,
        returnPercentage: portfolio.returnPercentage ?? 0,
        baseCurrency: portfolio.baseCurrency,
        positionCount: portfolio.positionIds.length,
        isPublic: portfolio.isPublic ?? false,
        tags: portfolio.tags ?? [],
        riskProfile: portfolio.riskProfile,
        targetAllocations: portfolio.targetAllocations,
        displayMetadata: portfolio.displayMetadata,
      };

      setSummary(summary);
    } catch (err) {
      setError(
        err instanceof Error
          ? err
          : new Error("Failed to fetch portfolio summary")
      );
    } finally {
      setIsLoading(false);
    }
  }, [portfolioId]);

  // Fetch summary data on mount and when portfolioId changes
  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  return {
    summary,
    isLoading,
    error,
    refresh: fetchSummary,
  };
}
