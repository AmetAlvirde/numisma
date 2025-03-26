/**
 * backup-service.test.ts - Tests for backup service
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { backupService } from "../backup-service";
import { statePersistence } from "../state-persistence";
import type {
  Portfolio,
  Position,
  Asset,
  Order,
  OrderType,
  OrderStatus,
} from "@/types/numisma-types";

// Mock the state persistence service
vi.mock("../state-persistence", () => ({
  statePersistence: {
    loadUserData: vi.fn(),
    importUserData: vi.fn(),
  },
}));

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

describe("BackupService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("createBackup", () => {
    it("should create a valid backup", async () => {
      const mockData = {
        portfolios: [mockPortfolio],
        positions: [mockPosition],
        assets: [mockAsset],
        orders: [mockOrder],
      };

      vi.mocked(statePersistence.loadUserData).mockResolvedValue(mockData);

      const backup = await backupService.createBackup("test-user");

      // Verify backup format
      const decodedBackup = JSON.parse(atob(backup));
      expect(decodedBackup.metadata).toMatchObject({
        version: "1.0.0",
        userId: "test-user",
        dataVersion: "1.0.0",
        portfolioCount: 1,
        positionCount: 1,
        assetCount: 1,
        orderCount: 1,
      });
      expect(decodedBackup.data).toEqual(mockData);
    });

    it("should handle errors during backup creation", async () => {
      const error = new Error("Backup failed");
      vi.mocked(statePersistence.loadUserData).mockRejectedValue(error);

      await expect(backupService.createBackup("test-user")).rejects.toThrow(
        error
      );
    });
  });

  describe("restoreBackup", () => {
    it("should restore data from a valid backup", async () => {
      const mockData = {
        portfolios: [mockPortfolio],
        positions: [mockPosition],
        assets: [mockAsset],
        orders: [mockOrder],
      };

      const backup = btoa(
        JSON.stringify({
          metadata: {
            version: "1.0.0",
            timestamp: new Date().toISOString(),
            userId: "test-user",
            dataVersion: "1.0.0",
            portfolioCount: 1,
            positionCount: 1,
            assetCount: 1,
            orderCount: 1,
          },
          data: mockData,
        })
      );

      await backupService.restoreBackup(backup);

      expect(statePersistence.importUserData).toHaveBeenCalledWith(
        JSON.stringify(mockData)
      );
    });

    it("should reject incompatible backup versions", async () => {
      const backup = btoa(
        JSON.stringify({
          metadata: {
            version: "2.0.0",
            timestamp: new Date().toISOString(),
            userId: "test-user",
            dataVersion: "1.0.0",
            portfolioCount: 1,
            positionCount: 1,
            assetCount: 1,
            orderCount: 1,
          },
          data: {
            portfolios: [],
            positions: [],
            assets: [],
            orders: [],
          },
        })
      );

      await expect(backupService.restoreBackup(backup)).rejects.toThrow(
        "Incompatible backup version"
      );
    });

    it("should reject backups with data count mismatches", async () => {
      const backup = btoa(
        JSON.stringify({
          metadata: {
            version: "1.0.0",
            timestamp: new Date().toISOString(),
            userId: "test-user",
            dataVersion: "1.0.0",
            portfolioCount: 2,
            positionCount: 1,
            assetCount: 1,
            orderCount: 1,
          },
          data: {
            portfolios: [mockPortfolio],
            positions: [mockPosition],
            assets: [mockAsset],
            orders: [mockOrder],
          },
        })
      );

      await expect(backupService.restoreBackup(backup)).rejects.toThrow(
        "Portfolio count mismatch"
      );
    });

    it("should reject backups with invalid references", async () => {
      const backup = btoa(
        JSON.stringify({
          metadata: {
            version: "1.0.0",
            timestamp: new Date().toISOString(),
            userId: "test-user",
            dataVersion: "1.0.0",
            portfolioCount: 1,
            positionCount: 1,
            assetCount: 1,
            orderCount: 1,
          },
          data: {
            portfolios: [mockPortfolio],
            positions: [
              {
                ...mockPosition,
                portfolio: "invalid_portfolio",
              },
            ],
            assets: [mockAsset],
            orders: [mockOrder],
          },
        })
      );

      await expect(backupService.restoreBackup(backup)).rejects.toThrow(
        "Invalid portfolio reference"
      );
    });
  });

  describe("getBackupMetadata", () => {
    it("should return backup metadata", async () => {
      const metadata = {
        version: "1.0.0",
        timestamp: new Date().toISOString(),
        userId: "test-user",
        dataVersion: "1.0.0",
        portfolioCount: 1,
        positionCount: 1,
        assetCount: 1,
        orderCount: 1,
      };

      const backup = btoa(
        JSON.stringify({
          metadata,
          data: {
            portfolios: [],
            positions: [],
            assets: [],
            orders: [],
          },
        })
      );

      const result = await backupService.getBackupMetadata(backup);
      expect(result).toEqual(metadata);
    });

    it("should handle invalid backup data", async () => {
      const backup = "invalid_base64_data";

      await expect(backupService.getBackupMetadata(backup)).rejects.toThrow();
    });
  });
});
