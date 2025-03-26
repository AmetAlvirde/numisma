/**
 * use-state-persistence.test.ts - Tests for state persistence hook
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useStatePersistence } from "../use-state-persistence";
import { statePersistence } from "@/services/database/state-persistence";
import type {
  Portfolio,
  Position,
  Asset,
  Order,
  OrderType,
  OrderStatus,
} from "@/types/numisma-types";

// Mock the state persistence service
vi.mock("@/services/database/state-persistence", () => ({
  statePersistence: {
    loadUserData: vi.fn(),
    savePortfolio: vi.fn(),
    savePosition: vi.fn(),
    saveAsset: vi.fn(),
    saveOrder: vi.fn(),
    deletePortfolio: vi.fn(),
    deletePosition: vi.fn(),
    deleteOrder: vi.fn(),
    exportUserData: vi.fn(),
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

describe("useStatePersistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should save portfolios when they change", async () => {
    const { result } = renderHook(() =>
      useStatePersistence({
        userId: "test-user",
        portfolios: [mockPortfolio],
        positions: [],
        assets: [],
        orders: [],
      })
    );

    // Wait for the effect to run
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(statePersistence.savePortfolio).toHaveBeenCalledWith(mockPortfolio);
  });

  it("should save positions when they change", async () => {
    const { result } = renderHook(() =>
      useStatePersistence({
        userId: "test-user",
        portfolios: [],
        positions: [mockPosition],
        assets: [],
        orders: [],
      })
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(statePersistence.savePosition).toHaveBeenCalledWith(mockPosition);
  });

  it("should save assets when they change", async () => {
    const { result } = renderHook(() =>
      useStatePersistence({
        userId: "test-user",
        portfolios: [],
        positions: [],
        assets: [mockAsset],
        orders: [],
      })
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(statePersistence.saveAsset).toHaveBeenCalledWith(mockAsset);
  });

  it("should save orders when they change", async () => {
    const { result } = renderHook(() =>
      useStatePersistence({
        userId: "test-user",
        portfolios: [],
        positions: [],
        assets: [],
        orders: [mockOrder],
      })
    );

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(statePersistence.saveOrder).toHaveBeenCalledWith(mockOrder);
  });

  it("should load user data", async () => {
    const mockData = {
      portfolios: [mockPortfolio],
      positions: [mockPosition],
      assets: [mockAsset],
      orders: [mockOrder],
    };

    vi.mocked(statePersistence.loadUserData).mockResolvedValue(mockData);

    const { result } = renderHook(() =>
      useStatePersistence({
        userId: "test-user",
        portfolios: [],
        positions: [],
        assets: [],
        orders: [],
      })
    );

    const data = await act(async () => {
      return await result.current.loadData();
    });

    expect(data).toEqual(mockData);
    expect(statePersistence.loadUserData).toHaveBeenCalledWith("test-user");
  });

  it("should export user data", async () => {
    const mockJsonData = JSON.stringify({
      portfolios: [mockPortfolio],
      positions: [mockPosition],
      assets: [mockAsset],
      orders: [mockOrder],
    });

    vi.mocked(statePersistence.exportUserData).mockResolvedValue(mockJsonData);

    const { result } = renderHook(() =>
      useStatePersistence({
        userId: "test-user",
        portfolios: [],
        positions: [],
        assets: [],
        orders: [],
      })
    );

    const data = await act(async () => {
      return await result.current.exportData();
    });

    expect(data).toBe(mockJsonData);
    expect(statePersistence.exportUserData).toHaveBeenCalledWith("test-user");
  });

  it("should import user data", async () => {
    const mockJsonData = JSON.stringify({
      portfolios: [mockPortfolio],
      positions: [mockPosition],
      assets: [mockAsset],
      orders: [mockOrder],
    });

    const { result } = renderHook(() =>
      useStatePersistence({
        userId: "test-user",
        portfolios: [],
        positions: [],
        assets: [],
        orders: [],
      })
    );

    await act(async () => {
      await result.current.importData(mockJsonData);
    });

    expect(statePersistence.importUserData).toHaveBeenCalledWith(mockJsonData);
  });

  it("should delete portfolio", async () => {
    const { result } = renderHook(() =>
      useStatePersistence({
        userId: "test-user",
        portfolios: [],
        positions: [],
        assets: [],
        orders: [],
      })
    );

    await act(async () => {
      await result.current.deletePortfolio(mockPortfolio.id);
    });

    expect(statePersistence.deletePortfolio).toHaveBeenCalledWith(
      mockPortfolio.id
    );
  });

  it("should delete position", async () => {
    const { result } = renderHook(() =>
      useStatePersistence({
        userId: "test-user",
        portfolios: [],
        positions: [],
        assets: [],
        orders: [],
      })
    );

    await act(async () => {
      await result.current.deletePosition(mockPosition.id);
    });

    expect(statePersistence.deletePosition).toHaveBeenCalledWith(
      mockPosition.id
    );
  });

  it("should delete order", async () => {
    const { result } = renderHook(() =>
      useStatePersistence({
        userId: "test-user",
        portfolios: [],
        positions: [],
        assets: [],
        orders: [],
      })
    );

    await act(async () => {
      await result.current.deleteOrder(mockOrder.id);
    });

    expect(statePersistence.deleteOrder).toHaveBeenCalledWith(mockOrder.id);
  });

  it("should handle errors", async () => {
    const mockError = new Error("Test error");
    const onError = vi.fn();

    vi.mocked(statePersistence.loadUserData).mockRejectedValue(mockError);

    const { result } = renderHook(() =>
      useStatePersistence({
        userId: "test-user",
        portfolios: [],
        positions: [],
        assets: [],
        orders: [],
        onError,
      })
    );

    await act(async () => {
      await result.current.loadData();
    });

    expect(onError).toHaveBeenCalledWith(mockError);
  });
});
