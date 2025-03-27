/**
 * state-persistence.ts - Service for persisting state to IndexedDB
 */

import { db } from "./indexeddb-adapter";
import type { Portfolio, Position, Asset, Order } from "@/types/numisma-types";

interface PortfolioPosition {
  portfolioId: string;
  positionId: string;
  addedAt: string;
  addedBy: string;
  isHidden: boolean;
  displayOrder: number;
}

interface HistoricalValuation {
  id: string;
  portfolioId: string;
  timestamp: string;
  totalValue: number;
  valueCurrency: string;
  initialInvestment: number;
  profitLoss: number;
  percentageReturn: number;
  positionValuations: Array<{
    id: string;
    positionId: string;
    value: number;
    marketPrice: number;
    quantity: number;
    costBasis: number;
    profitLoss: number;
    percentageReturn: number;
  }>;
  isRetroactive: boolean;
  marketContext?: {
    btcPrice: number;
    ethPrice: number;
    totalMarketCap: number;
    fearGreedIndex: number;
  };
}

export class StatePersistenceService {
  /**
   * Load all portfolio data for a user
   */
  async loadUserData(userId: string): Promise<{
    portfolios: Portfolio[];
    positions: Position[];
    assets: Asset[];
    orders: Order[];
    portfolioPositions: PortfolioPosition[];
    historicalValuations: HistoricalValuation[];
  }> {
    try {
      const [
        portfolios,
        positions,
        assets,
        orders,
        portfolioPositions,
        historicalValuations,
      ] = await Promise.all([
        db.query("portfolios", "userId", userId),
        db.query("positions", "userId", userId),
        db.getAll("assets"),
        db.query("orders", "userId", userId),
        db.query("portfolioPositions", "portfolioId", userId),
        db.query("historicalValuations", "portfolioId", userId),
      ]);

      return {
        portfolios,
        positions,
        assets,
        orders,
        portfolioPositions,
        historicalValuations,
      };
    } catch (error) {
      console.error("Failed to load user data:", error);
      throw error;
    }
  }

  /**
   * Save a portfolio and its associated data
   */
  async savePortfolio(portfolio: Portfolio): Promise<void> {
    try {
      // Ensure all required properties are present
      const portfolioToSave = {
        ...portfolio,
        positionIds: portfolio.positionIds || [],
        displayMetadata: portfolio.displayMetadata || {},
        tags: portfolio.tags || [],
        status: portfolio.status || "active",
        baseCurrency: portfolio.baseCurrency || "USD",
        currentValue: portfolio.currentValue || 0,
        initialInvestment: portfolio.initialInvestment || 0,
        profitLoss: portfolio.profitLoss || 0,
        returnPercentage: portfolio.returnPercentage || 0,
        isPublic: portfolio.isPublic || false,
      };

      await db.update("portfolios", portfolioToSave);
    } catch (error) {
      console.error("Failed to save portfolio:", error);
      throw error;
    }
  }

  /**
   * Save a position and its associated data
   */
  async savePosition(position: Position): Promise<void> {
    try {
      await db.update("positions", position);
    } catch (error) {
      console.error("Failed to save position:", error);
      throw error;
    }
  }

  /**
   * Save an asset
   */
  async saveAsset(asset: Asset): Promise<void> {
    try {
      await db.update("assets", asset);
    } catch (error) {
      console.error("Failed to save asset:", error);
      throw error;
    }
  }

  /**
   * Save an order
   */
  async saveOrder(order: Order): Promise<void> {
    try {
      await db.update("orders", order);
    } catch (error) {
      console.error("Failed to save order:", error);
      throw error;
    }
  }

  /**
   * Delete a portfolio and its associated data
   */
  async deletePortfolio(portfolioId: string): Promise<void> {
    try {
      // Get all positions in the portfolio
      const positions = await db.query("positions", "portfolio", portfolioId);

      // Delete all orders for these positions
      await Promise.all(
        positions.map(position =>
          db
            .query("orders", "positionId", position.id)
            .then(orders =>
              Promise.all(orders.map(order => db.delete("orders", order.id)))
            )
        )
      );

      // Delete all positions
      await Promise.all(
        positions.map(position => db.delete("positions", position.id))
      );

      // Delete portfolio positions
      await db.delete("portfolioPositions", portfolioId);

      // Delete historical valuations
      await db.delete("historicalValuations", portfolioId);

      // Finally delete the portfolio
      await db.delete("portfolios", portfolioId);
    } catch (error) {
      console.error("Failed to delete portfolio:", error);
      throw error;
    }
  }

  /**
   * Delete a position and its associated data
   */
  async deletePosition(positionId: string): Promise<void> {
    try {
      // Delete all orders for this position
      const orders = await db.query("orders", "positionId", positionId);
      await Promise.all(orders.map(order => db.delete("orders", order.id)));

      // Delete the position
      await db.delete("positions", positionId);
    } catch (error) {
      console.error("Failed to delete position:", error);
      throw error;
    }
  }

  /**
   * Delete an order
   */
  async deleteOrder(orderId: string): Promise<void> {
    try {
      await db.delete("orders", orderId);
    } catch (error) {
      console.error("Failed to delete order:", error);
      throw error;
    }
  }

  /**
   * Export all data for a user as JSON
   */
  async exportUserData(userId: string): Promise<string> {
    try {
      const data = await this.loadUserData(userId);
      return JSON.stringify(data, null, 2);
    } catch (error) {
      console.error("Failed to export user data:", error);
      throw error;
    }
  }

  /**
   * Import data from JSON
   */
  async importUserData(jsonData: string): Promise<void> {
    try {
      console.log("Starting importUserData");
      const data = JSON.parse(jsonData) as {
        portfolios: Portfolio[];
        positions: Position[];
        assets: Asset[];
        orders: Order[];
        portfolioPositions?: PortfolioPosition[];
        historicalValuations?: HistoricalValuation[];
      };
      console.log("Data parsed, starting to save...");
      console.log("Portfolios:", data.portfolios.length);
      console.log("Positions:", data.positions.length);
      console.log("Assets:", data.assets.length);
      console.log("Orders:", data.orders.length);
      console.log("PortfolioPositions:", data.portfolioPositions?.length);
      console.log("HistoricalValuations:", data.historicalValuations?.length);

      // Save all data in parallel with error handling
      const savePromises = [
        ...data.portfolios.map(async (portfolio: Portfolio) => {
          try {
            console.log("Saving portfolio:", portfolio.id);
            await this.savePortfolio(portfolio);
            console.log("Portfolio saved successfully:", portfolio.id);
          } catch (error) {
            console.error("Failed to save portfolio:", portfolio.id, error);
            throw error; // Re-throw to be caught by Promise.allSettled
          }
        }),
        ...data.positions.map(async (position: Position) => {
          try {
            console.log("Saving position:", position.id);
            await db.update("positions", position);
            console.log("Position saved successfully:", position.id);
          } catch (error) {
            console.error("Failed to save position:", position.id, error);
            throw error;
          }
        }),
        ...data.assets.map(async (asset: Asset) => {
          try {
            console.log("Saving asset:", asset.ticker);
            await db.update("assets", asset);
            console.log("Asset saved successfully:", asset.ticker);
          } catch (error) {
            console.error("Failed to save asset:", asset.ticker, error);
            throw error;
          }
        }),
        ...data.orders.map(async (order: Order) => {
          try {
            console.log("Saving order:", order.id);
            await db.update("orders", order);
            console.log("Order saved successfully:", order.id);
          } catch (error) {
            console.error("Failed to save order:", order.id, error);
            throw error;
          }
        }),
        ...(data.portfolioPositions?.map(async (pp: PortfolioPosition) => {
          try {
            console.log(
              "Saving portfolio position:",
              pp.portfolioId,
              pp.positionId
            );
            await db.update("portfolioPositions", pp);
            console.log(
              "Portfolio position saved successfully:",
              pp.portfolioId,
              pp.positionId
            );
          } catch (error) {
            console.error(
              "Failed to save portfolio position:",
              pp.portfolioId,
              pp.positionId,
              error
            );
            throw error;
          }
        }) || []),
        ...(data.historicalValuations?.map(async (hv: HistoricalValuation) => {
          try {
            console.log("Saving historical valuation:", hv.id);
            await db.update("historicalValuations", hv);
            console.log("Historical valuation saved successfully:", hv.id);
          } catch (error) {
            console.error("Failed to save historical valuation:", hv.id, error);
            throw error;
          }
        }) || []),
      ];

      // Use Promise.allSettled to handle all promises and get their results
      const results = await Promise.allSettled(savePromises);

      // Check for any rejected promises
      const rejected = results.filter(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected"
      );

      if (rejected.length > 0) {
        console.error("Some saves failed:", rejected);
        throw new Error(
          `Failed to save some items: ${rejected.map(r => r.reason).join(", ")}`
        );
      }

      console.log("All data saved successfully");
    } catch (error) {
      console.error("Failed to import user data:", error);
      if (error instanceof Error) {
        console.error("Error stack:", error.stack);
      }
      throw error;
    }
  }
}

// Export a singleton instance
export const statePersistence = new StatePersistenceService();
