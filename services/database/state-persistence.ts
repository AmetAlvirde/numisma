/**
 * state-persistence.ts - Service for persisting state to IndexedDB
 */

import { db } from "./indexeddb-adapter";
import type { Portfolio, Position, Asset, Order } from "@/types/numisma-types";

export class StatePersistenceService {
  /**
   * Load all portfolio data for a user
   */
  async loadUserData(userId: string): Promise<{
    portfolios: Portfolio[];
    positions: Position[];
    assets: Asset[];
    orders: Order[];
  }> {
    try {
      const [portfolios, positions, assets, orders] = await Promise.all([
        db.query("portfolios", "userId", userId),
        db.query("positions", "userId", userId),
        db.getAll("assets"),
        db.query("orders", "userId", userId),
      ]);

      return { portfolios, positions, assets, orders };
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
      await db.update("portfolios", portfolio);
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
      const data = JSON.parse(jsonData) as {
        portfolios: Portfolio[];
        positions: Position[];
        assets: Asset[];
        orders: Order[];
      };

      await Promise.all([
        ...data.portfolios.map(portfolio => db.update("portfolios", portfolio)),
        ...data.positions.map(position => db.update("positions", position)),
        ...data.assets.map(asset => db.update("assets", asset)),
        ...data.orders.map(order => db.update("orders", order)),
      ]);
    } catch (error) {
      console.error("Failed to import user data:", error);
      throw error;
    }
  }
}

// Export a singleton instance
export const statePersistence = new StatePersistenceService();
