/**
 * indexeddb-adapter.test.ts - Tests for IndexedDB adapter service
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db, DatabaseError } from "../indexeddb-adapter";
import type {
  Portfolio,
  Position,
  Asset,
  Order,
  OrderType,
  OrderStatus,
} from "@/types/numisma-types";

const mockAsset: Asset = {
  name: "Bitcoin",
  ticker: "BTC",
  pair: "BTC/USD",
  locationType: "exchange",
  exchange: "Test Exchange",
  wallet: "test-wallet",
  network: "bitcoin",
  iconUrl: "btc-icon.png",
  category: "cryptocurrency",
  marketData: {
    currentPrice: 50000,
    priceChangePercentage24h: 5,
    marketCap: 1000000000000,
    volume24h: 50000000000,
    lastUpdated: new Date(),
  },
};

const mockPortfolio: Portfolio = {
  id: "port_1",
  name: "Test Portfolio",
  description: "Test portfolio description",
  dateCreated: new Date(),
  currentValue: 100000,
  initialInvestment: 90000,
  profitLoss: 10000,
  returnPercentage: 11.11,
  isPublic: false,
  positionIds: ["pos_1"],
  tags: ["test"],
  status: "active",
  userId: "test-user",
  baseCurrency: "USD",
};

const mockPosition: Position = {
  id: "pos_1",
  name: "BTC Long",
  riskLevel: 7,
  portfolio: "port_1",
  walletType: "hot",
  seedCapitalTier: "C1",
  strategy: "Long-term hold",
  asset: mockAsset,
  positionDetails: {
    status: "active",
    side: "long",
    timeFrame: "1D",
    dateOpened: new Date().toISOString(),
    orders: [],
    averageEntryPrice: 45000,
    totalSize: 1,
    totalCost: 45000,
    isLeveraged: false,
    unrealizedProfitLoss: 5000,
    currentReturn: 11.11,
  },
  tags: ["btc", "long"],
  userId: "test-user",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  currentValue: 50000,
  isHidden: false,
  alertsEnabled: true,
};

const mockOrder: Order = {
  id: "order_1",
  positionId: "pos_1",
  type: "market" as OrderType,
  status: "filled" as OrderStatus,
  direction: "entry",
  dateOpen: new Date().toISOString(),
  averagePrice: 45000,
  totalCost: 45000,
  filled: 1,
  unit: "base",
  notes: "Test order",
};

describe("IndexedDBAdapter", () => {
  beforeEach(async () => {
    // Clear all stores before each test
    await db.clear("portfolios");
    await db.clear("positions");
    await db.clear("assets");
    await db.clear("orders");
  });

  afterEach(async () => {
    await db.close();
  });

  describe("Portfolio Operations", () => {
    it("should add and retrieve a portfolio", async () => {
      await db.add("portfolios", mockPortfolio);
      const retrieved = await db.get("portfolios", mockPortfolio.id);
      expect(retrieved).toEqual(mockPortfolio);
    });

    it("should update a portfolio", async () => {
      await db.add("portfolios", mockPortfolio);
      const updated = { ...mockPortfolio, name: "Updated Portfolio" };
      await db.update("portfolios", updated);
      const retrieved = await db.get("portfolios", mockPortfolio.id);
      expect(retrieved).toEqual(updated);
    });

    it("should delete a portfolio", async () => {
      await db.add("portfolios", mockPortfolio);
      await db.delete("portfolios", mockPortfolio.id);
      const retrieved = await db.get("portfolios", mockPortfolio.id);
      expect(retrieved).toBeUndefined();
    });

    it("should query portfolios by userId", async () => {
      await db.add("portfolios", mockPortfolio);
      const portfolios = await db.query("portfolios", "userId", "test-user");
      expect(portfolios).toHaveLength(1);
      expect(portfolios[0]).toEqual(mockPortfolio);
    });
  });

  describe("Position Operations", () => {
    it("should add and retrieve a position", async () => {
      await db.add("positions", mockPosition);
      const retrieved = await db.get("positions", mockPosition.id);
      expect(retrieved).toEqual(mockPosition);
    });

    it("should update a position", async () => {
      await db.add("positions", mockPosition);
      const updated = { ...mockPosition, name: "Updated Position" };
      await db.update("positions", updated);
      const retrieved = await db.get("positions", mockPosition.id);
      expect(retrieved).toEqual(updated);
    });

    it("should delete a position", async () => {
      await db.add("positions", mockPosition);
      await db.delete("positions", mockPosition.id);
      const retrieved = await db.get("positions", mockPosition.id);
      expect(retrieved).toBeUndefined();
    });

    it("should query positions by portfolio", async () => {
      await db.add("positions", mockPosition);
      const positions = await db.query("positions", "portfolio", "port_1");
      expect(positions).toHaveLength(1);
      expect(positions[0]).toEqual(mockPosition);
    });
  });

  describe("Asset Operations", () => {
    it("should add and retrieve an asset", async () => {
      await db.add("assets", mockAsset);
      const retrieved = await db.get("assets", mockAsset.ticker);
      expect(retrieved).toEqual(mockAsset);
    });

    it("should update an asset", async () => {
      await db.add("assets", mockAsset);
      const updated = {
        ...mockAsset,
        marketData: {
          ...mockAsset.marketData,
          currentPrice: 51000,
        },
      };
      await db.update("assets", updated);
      const retrieved = await db.get("assets", mockAsset.ticker);
      expect(retrieved).toEqual(updated);
    });

    it("should delete an asset", async () => {
      await db.add("assets", mockAsset);
      await db.delete("assets", mockAsset.ticker);
      const retrieved = await db.get("assets", mockAsset.ticker);
      expect(retrieved).toBeUndefined();
    });

    it("should query assets by category", async () => {
      await db.add("assets", mockAsset);
      const assets = await db.query("assets", "category", "cryptocurrency");
      expect(assets).toHaveLength(1);
      expect(assets[0]).toEqual(mockAsset);
    });
  });

  describe("Order Operations", () => {
    it("should add and retrieve an order", async () => {
      await db.add("orders", mockOrder);
      const retrieved = await db.get("orders", mockOrder.id);
      expect(retrieved).toEqual(mockOrder);
    });

    it("should update an order", async () => {
      await db.add("orders", mockOrder);
      const updated = { ...mockOrder, notes: "Updated order" };
      await db.update("orders", updated);
      const retrieved = await db.get("orders", mockOrder.id);
      expect(retrieved).toEqual(updated);
    });

    it("should delete an order", async () => {
      await db.add("orders", mockOrder);
      await db.delete("orders", mockOrder.id);
      const retrieved = await db.get("orders", mockOrder.id);
      expect(retrieved).toBeUndefined();
    });

    it("should query orders by positionId", async () => {
      await db.add("orders", mockOrder);
      const orders = await db.query("orders", "positionId", "pos_1");
      expect(orders).toHaveLength(1);
      expect(orders[0]).toEqual(mockOrder);
    });
  });

  describe("Error Handling", () => {
    it("should handle database initialization errors", async () => {
      // Mock IndexedDB to simulate initialization error
      const originalIndexedDB = global.indexedDB;
      global.indexedDB = undefined as any;

      try {
        await db.get("portfolios", "test");
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
      } finally {
        global.indexedDB = originalIndexedDB;
      }
    });

    it("should handle transaction errors", async () => {
      // Mock IDBDatabase to simulate transaction error
      const originalOpen = indexedDB.open;
      indexedDB.open = function () {
        const request = originalOpen.apply(this, arguments as any);
        request.onerror = () => {
          // Create a new error event
          const errorEvent = new Event("error");
          Object.defineProperty(errorEvent, "target", {
            value: { error: new Error("Transaction error") },
          });
          request.dispatchEvent(errorEvent);
        };
        return request;
      };

      try {
        await db.add("portfolios", mockPortfolio);
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).toBeInstanceOf(DatabaseError);
      } finally {
        indexedDB.open = originalOpen;
      }
    });
  });
});
