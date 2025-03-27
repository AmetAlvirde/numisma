/**
 * use-positions.ts - Hook for fetching and managing positions data
 *
 * This hook provides functionality to fetch and manage position data from the portfolio,
 * including loading states and error handling.
 */

import { useState, useEffect } from "react";
import { Position } from "@/types/numisma-types";
import { getPortfolioData } from "@/utilities/db";

interface UsePositionsResult {
  positions: Position[] | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function usePositions(): UsePositionsResult {
  const [positions, setPositions] = useState<Position[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchPositions = async () => {
    try {
      setIsLoading(true);
      setError(null);
      // Fetch portfolio data from IndexedDB
      const data = await getPortfolioData("cycle-portfolio-123");
      console.log("Portfolio data:", data);
      console.log("Positions:", data.positions);

      if (!data.positions || data.positions.length === 0) {
        console.warn("No positions found in portfolio data");
      } else {
        // Log the first position to check its structure
        console.log("First position:", data.positions[0]);
      }

      setPositions(data.positions || []);
    } catch (err) {
      console.error("Error fetching positions:", err);
      setError(
        err instanceof Error ? err : new Error("Unknown error occurred")
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchPositions();
  }, []);

  return {
    positions,
    isLoading,
    error,
    refresh: fetchPositions,
  };
}
