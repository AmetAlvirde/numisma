/**
 * use-asset-allocation.ts - Hook for calculating and managing asset allocation data
 *
 * This hook aggregates position values by asset and calculates allocation percentages
 * for portfolio visualization.
 */

import { useState, useEffect, useCallback } from "react";
import { getPortfolioData } from "@/utilities/db";
import type {
  Portfolio,
  Position,
  PositionValuation,
} from "@/types/numisma-types";

export interface AssetAllocation {
  /** The asset symbol (e.g., "BTC", "ETH") */
  symbol: string;
  /** The asset name */
  name: string;
  /** Current value of the asset */
  value: number;
  /** Percentage of total portfolio value */
  percentage: number;
  /** Base currency for the value */
  currency: string;
}

interface UseAssetAllocationResult {
  /** Array of asset allocations */
  allocations: AssetAllocation[];
  /** Whether the data is currently loading */
  isLoading: boolean;
  /** Any error that occurred while fetching data */
  error: Error | null;
  /** Function to refresh the allocation data */
  refresh: () => Promise<void>;
}

/**
 * Hook for calculating and managing asset allocation data
 */
export function useAssetAllocation(
  portfolioId: string
): UseAssetAllocationResult {
  const [allocations, setAllocations] = useState<AssetAllocation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAllocations = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Fetch portfolio data from IndexedDB
      const data = await getPortfolioData(portfolioId);
      if (!data.portfolio) {
        throw new Error(`Portfolio with ID ${portfolioId} not found`);
      }

      // Get the latest valuation
      const latestValuation =
        data.historicalValuations[data.historicalValuations.length - 1];
      const totalValue = latestValuation?.totalValue ?? 0;

      // Get positions from portfolioPositions
      const portfolioPositions = data.portfolioPositions || [];

      if (portfolioPositions.length === 0) {
        setAllocations([]);
        return;
      }

      // Aggregate positions by asset
      const assetMap = new Map<string, AssetAllocation>();

      portfolioPositions.forEach(
        (portfolioPosition: { positionId: string }) => {
          const position = data.positions.find(
            p => p.id === portfolioPosition.positionId
          );
          if (!position) return;

          // Get the position's valuation from the latest portfolio valuation
          const positionValuation = latestValuation?.positionValuations.find(
            (pv: PositionValuation) => pv.positionId === position.id
          );
          const currentValue = positionValuation?.value ?? 0;

          const existing = assetMap.get(position.asset.ticker);

          if (existing) {
            existing.value += currentValue;
          } else {
            assetMap.set(position.asset.ticker, {
              symbol: position.asset.ticker,
              name: position.asset.name,
              value: currentValue,
              percentage: 0,
              currency: data.portfolio.baseCurrency ?? "USD",
            });
          }
        }
      );

      // Convert map to array and calculate percentages
      const allocationsArray = Array.from(assetMap.values())
        .map(allocation => ({
          ...allocation,
          percentage:
            totalValue > 0 ? (allocation.value / totalValue) * 100 : 0,
        }))
        // Sort by value (highest to lowest)
        .sort((a, b) => b.value - a.value);

      setAllocations(allocationsArray);
    } catch (err) {
      console.error("Error fetching asset allocations:", err);
      setError(
        err instanceof Error
          ? err
          : new Error("Failed to fetch asset allocation data")
      );
    } finally {
      setIsLoading(false);
    }
  }, [portfolioId]);

  // Fetch allocation data on mount and when portfolioId changes
  useEffect(() => {
    fetchAllocations();
  }, [fetchAllocations]);

  return {
    allocations,
    isLoading,
    error,
    refresh: fetchAllocations,
  };
}
