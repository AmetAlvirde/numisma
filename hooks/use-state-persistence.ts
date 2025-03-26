/**
 * use-state-persistence.ts - Hook for automatic state persistence
 */

import { useEffect, useCallback } from "react";
import { statePersistence } from "@/services/database/state-persistence";
import type { Portfolio, Position, Asset, Order } from "@/types/numisma-types";

interface UseStatePersistenceProps {
  userId: string;
  portfolios: Portfolio[];
  positions: Position[];
  assets: Asset[];
  orders: Order[];
  onError?: (error: Error) => void;
}

export function useStatePersistence({
  userId,
  portfolios,
  positions,
  assets,
  orders,
  onError,
}: UseStatePersistenceProps) {
  // Save portfolios when they change
  useEffect(() => {
    const savePortfolios = async () => {
      try {
        await Promise.all(
          portfolios.map(portfolio => statePersistence.savePortfolio(portfolio))
        );
      } catch (error) {
        console.error("Failed to persist portfolios:", error);
        onError?.(error as Error);
      }
    };

    savePortfolios();
  }, [portfolios, userId, onError]);

  // Save positions when they change
  useEffect(() => {
    const savePositions = async () => {
      try {
        await Promise.all(
          positions.map(position => statePersistence.savePosition(position))
        );
      } catch (error) {
        console.error("Failed to persist positions:", error);
        onError?.(error as Error);
      }
    };

    savePositions();
  }, [positions, userId, onError]);

  // Save assets when they change
  useEffect(() => {
    const saveAssets = async () => {
      try {
        await Promise.all(
          assets.map(asset => statePersistence.saveAsset(asset))
        );
      } catch (error) {
        console.error("Failed to persist assets:", error);
        onError?.(error as Error);
      }
    };

    saveAssets();
  }, [assets, onError]);

  // Save orders when they change
  useEffect(() => {
    const saveOrders = async () => {
      try {
        await Promise.all(
          orders.map(order => statePersistence.saveOrder(order))
        );
      } catch (error) {
        console.error("Failed to persist orders:", error);
        onError?.(error as Error);
      }
    };

    saveOrders();
  }, [orders, onError]);

  // Load initial data
  const loadData = useCallback(async () => {
    try {
      const data = await statePersistence.loadUserData(userId);
      return data;
    } catch (error) {
      console.error("Failed to load user data:", error);
      onError?.(error as Error);
      return null;
    }
  }, [userId, onError]);

  // Export data
  const exportData = useCallback(async () => {
    try {
      return await statePersistence.exportUserData(userId);
    } catch (error) {
      console.error("Failed to export user data:", error);
      onError?.(error as Error);
      return null;
    }
  }, [userId, onError]);

  // Import data
  const importData = useCallback(
    async (jsonData: string) => {
      try {
        await statePersistence.importUserData(jsonData);
      } catch (error) {
        console.error("Failed to import user data:", error);
        onError?.(error as Error);
      }
    },
    [onError]
  );

  // Delete portfolio
  const deletePortfolio = useCallback(
    async (portfolioId: string) => {
      try {
        await statePersistence.deletePortfolio(portfolioId);
      } catch (error) {
        console.error("Failed to delete portfolio:", error);
        onError?.(error as Error);
      }
    },
    [onError]
  );

  // Delete position
  const deletePosition = useCallback(
    async (positionId: string) => {
      try {
        await statePersistence.deletePosition(positionId);
      } catch (error) {
        console.error("Failed to delete position:", error);
        onError?.(error as Error);
      }
    },
    [onError]
  );

  // Delete order
  const deleteOrder = useCallback(
    async (orderId: string) => {
      try {
        await statePersistence.deleteOrder(orderId);
      } catch (error) {
        console.error("Failed to delete order:", error);
        onError?.(error as Error);
      }
    },
    [onError]
  );

  return {
    loadData,
    exportData,
    importData,
    deletePortfolio,
    deletePosition,
    deleteOrder,
  };
}
