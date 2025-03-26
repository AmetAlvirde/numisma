/**
 * state-persistence.test.ts - Tests for state persistence service
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { statePersistence } from "../state-persistence";
import { db } from "../indexeddb-adapter";
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

describe("StatePersistenceService", () => {
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

  describe("Data Loading", () => {
    it("should load all user data", async () => {
      // Add test data
      await db.add("portfolios", mockPortfolio);
      await db.add("positions", mockPosition);
      await db.add("assets", mockAsset);
      await db.add("orders", mockOrder);

      // Load data
      const data = await statePersistence.loadUserData("test-user");

      // Verify data
      expect(data.portfolios).toHaveLength(1);
      expect(data.positions).toHaveLength(1);
      expect(data.assets).toHaveLength(1);
      expect(data.orders).toHaveLength(1);

      expect(data.portfolios[0]).toEqual(mockPortfolio);
      expect(data.positions[0]).toEqual(mockPosition);
      expect(data.assets[0]).toEqual(mockAsset);
      expect(data.orders[0]).toEqual(mockOrder);
    });
  });

  describe("Data Saving", () => {
    it("should save portfolio data", async () => {
      await statePersistence.savePortfolio(mockPortfolio);
      const retrieved = await db.get("portfolios", mockPortfolio.id);
      expect(retrieved).toEqual(mockPortfolio);
    });

    it("should save position data", async () => {
      await statePersistence.savePosition(mockPosition);
      const retrieved = await db.get("positions", mockPosition.id);
      expect(retrieved).toEqual(mockPosition);
    });

    it("should save asset data", async () => {
      await statePersistence.saveAsset(mockAsset);
      const retrieved = await db.get("assets", mockAsset.ticker);
      expect(retrieved).toEqual(mockAsset);
    });

    it("should save order data", async () => {
      await statePersistence.saveOrder(mockOrder);
      const retrieved = await db.get("orders", mockOrder.id);
      expect(retrieved).toEqual(mockOrder);
    });
  });

  describe("Data Deletion", () => {
    it("should delete portfolio and associated data", async () => {
      // Add test data
      await db.add("portfolios", mockPortfolio);
      await db.add("positions", mockPosition);
      await db.add("orders", mockOrder);

      // Delete portfolio
      await statePersistence.deletePortfolio(mockPortfolio.id);

      // Verify deletion
      const portfolio = await db.get("portfolios", mockPortfolio.id);
      const position = await db.get("positions", mockPosition.id);
      const order = await db.get("orders", mockOrder.id);

      expect(portfolio).toBeUndefined();
      expect(position).toBeUndefined();
      expect(order).toBeUndefined();
    });

    it("should delete position and associated orders", async () => {
      // Add test data
      await db.add("positions", mockPosition);
      await db.add("orders", mockOrder);

      // Delete position
      await statePersistence.deletePosition(mockPosition.id);

      // Verify deletion
      const position = await db.get("positions", mockPosition.id);
      const order = await db.get("orders", mockOrder.id);

      expect(position).toBeUndefined();
      expect(order).toBeUndefined();
    });

    it("should delete order", async () => {
      // Add test data
      await db.add("orders", mockOrder);

      // Delete order
      await statePersistence.deleteOrder(mockOrder.id);

      // Verify deletion
      const order = await db.get("orders", mockOrder.id);
      expect(order).toBeUndefined();
    });
  });

  describe("Data Import/Export", () => {
    it("should export and import user data", async () => {
      // Add test data
      await db.add("portfolios", mockPortfolio);
      await db.add("positions", mockPosition);
      await db.add("assets", mockAsset);
      await db.add("orders", mockOrder);

      // Export data
      const jsonData = await statePersistence.exportUserData("test-user");

      // Clear database
      await db.clear("portfolios");
      await db.clear("positions");
      await db.clear("assets");
      await db.clear("orders");

      // Import data
      await statePersistence.importUserData(jsonData);

      // Verify imported data
      const data = await statePersistence.loadUserData("test-user");

      expect(data.portfolios).toHaveLength(1);
      expect(data.positions).toHaveLength(1);
      expect(data.assets).toHaveLength(1);
      expect(data.orders).toHaveLength(1);

      expect(data.portfolios[0]).toEqual(mockPortfolio);
      expect(data.positions[0]).toEqual(mockPosition);
      expect(data.assets[0]).toEqual(mockAsset);
      expect(data.orders[0]).toEqual(mockOrder);
    });
  });
});
