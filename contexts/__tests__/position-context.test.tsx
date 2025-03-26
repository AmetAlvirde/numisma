/**
 * position-context.test.tsx - Tests for the position context
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { PositionProvider, usePosition } from "../position-context";
import type {
  Position,
  Order,
  Asset,
  PositionDetails,
} from "@/types/numisma-types";

const mockAsset: Asset = {
  name: "Test Asset",
  ticker: "TEST",
  pair: "TEST/USD",
  locationType: "exchange",
  exchange: "Test Exchange",
  wallet: "test-wallet",
  network: "test-network",
  contractAddress: "test-contract",
  iconUrl: "test-icon.png",
  category: "test-category",
  marketData: {
    currentPrice: 100,
    priceChangePercentage24h: 0,
    marketCap: 1000000,
    volume24h: 100000,
    lastUpdated: new Date(),
  },
};

const mockOrder: Order = {
  id: "test-order",
  positionId: "test-position",
  dateOpen: new Date().toISOString(),
  averagePrice: 100,
  totalCost: 100,
  status: "filled",
  type: "market",
  fee: 0,
  feeUnit: "USD",
  filled: 1,
  unit: "base",
  direction: "entry",
  notes: "Test order",
};

const mockPositionDetails: PositionDetails = {
  status: "active",
  side: "long",
  timeFrame: "1D",
  dateOpened: new Date().toISOString(),
  orders: [mockOrder],
  averageEntryPrice: 100,
  totalSize: 1,
  totalCost: 100,
  isLeveraged: false,
  unrealizedProfitLoss: 0,
  currentReturn: 0,
};

const mockPosition: Position = {
  id: "test-position",
  name: "Test Position",
  riskLevel: 5,
  portfolio: "test-portfolio",
  walletType: "hot",
  seedCapitalTier: "C1",
  strategy: "Test Strategy",
  asset: mockAsset,
  positionDetails: mockPositionDetails,
  tags: ["test"],
  userId: "test-user",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  currentValue: 100,
  isHidden: false,
  alertsEnabled: true,
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <PositionProvider>{children}</PositionProvider>;
}

describe("PositionContext", () => {
  it("should initialize with empty state", () => {
    const { result } = renderHook(() => usePosition(), { wrapper });

    expect(result.current.positions).toEqual([]);
    expect(result.current.selectedPositionId).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should add a position", () => {
    const { result } = renderHook(() => usePosition(), { wrapper });

    act(() => {
      result.current.addPosition(mockPosition);
    });

    expect(result.current.positions).toHaveLength(1);
    expect(result.current.positions[0]).toEqual(mockPosition);
  });

  it("should update a position", () => {
    const { result } = renderHook(() => usePosition(), { wrapper });

    // First add a position
    act(() => {
      result.current.addPosition(mockPosition);
    });

    // Then update it
    const updatedPosition = {
      ...mockPosition,
      name: "Updated Position",
    };

    act(() => {
      result.current.updatePosition(updatedPosition);
    });

    expect(result.current.positions).toHaveLength(1);
    expect(result.current.positions[0].name).toBe("Updated Position");
  });

  it("should delete a position", () => {
    const { result } = renderHook(() => usePosition(), { wrapper });

    // First add a position
    act(() => {
      result.current.addPosition(mockPosition);
    });

    // Then delete it
    act(() => {
      result.current.deletePosition(mockPosition.id);
    });

    expect(result.current.positions).toHaveLength(0);
  });

  it("should select a position", () => {
    const { result } = renderHook(() => usePosition(), { wrapper });

    // First add a position
    act(() => {
      result.current.addPosition(mockPosition);
    });

    // Then select it
    act(() => {
      result.current.selectPosition(mockPosition.id);
    });

    expect(result.current.selectedPositionId).toBe(mockPosition.id);
  });

  it("should add an order to a position", () => {
    const { result } = renderHook(() => usePosition(), { wrapper });

    // First add a position
    act(() => {
      result.current.addPosition(mockPosition);
    });

    // Then add an order
    const newOrder: Order = {
      ...mockOrder,
      id: "new-order",
    };

    act(() => {
      result.current.addOrder(mockPosition.id, newOrder);
    });

    const updatedPosition = result.current.positions.find(
      p => p.id === mockPosition.id
    );
    expect(updatedPosition?.positionDetails.orders).toHaveLength(2);
    expect(updatedPosition?.positionDetails.orders[1]).toEqual(newOrder);
  });

  it("should update an order in a position", () => {
    const { result } = renderHook(() => usePosition(), { wrapper });

    // First add a position
    act(() => {
      result.current.addPosition(mockPosition);
    });

    // Then update an order
    const updatedOrder: Order = {
      ...mockOrder,
      averagePrice: 200,
    };

    act(() => {
      result.current.updateOrder(mockPosition.id, mockOrder.id, updatedOrder);
    });

    const updatedPosition = result.current.positions.find(
      p => p.id === mockPosition.id
    );
    expect(updatedPosition?.positionDetails.orders[0].averagePrice).toBe(200);
  });

  it("should delete an order from a position", () => {
    const { result } = renderHook(() => usePosition(), { wrapper });

    // First add a position
    act(() => {
      result.current.addPosition(mockPosition);
    });

    // Then delete an order
    act(() => {
      result.current.deleteOrder(mockPosition.id, mockOrder.id);
    });

    const updatedPosition = result.current.positions.find(
      p => p.id === mockPosition.id
    );
    expect(updatedPosition?.positionDetails.orders).toHaveLength(0);
  });

  it("should handle loading state", () => {
    const { result } = renderHook(() => usePosition(), { wrapper });

    act(() => {
      result.current.setLoading(true);
    });

    expect(result.current.isLoading).toBe(true);

    act(() => {
      result.current.setLoading(false);
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("should handle error state", () => {
    const { result } = renderHook(() => usePosition(), { wrapper });

    const errorMessage = "Test error message";

    act(() => {
      result.current.setError(errorMessage);
    });

    expect(result.current.error).toBe(errorMessage);

    act(() => {
      result.current.setError(null);
    });

    expect(result.current.error).toBeNull();
  });

  it("should clear selected position when deleting it", () => {
    const { result } = renderHook(() => usePosition(), { wrapper });

    // Add and select a position
    act(() => {
      result.current.addPosition(mockPosition);
      result.current.selectPosition(mockPosition.id);
    });

    // Delete the selected position
    act(() => {
      result.current.deletePosition(mockPosition.id);
    });

    expect(result.current.selectedPositionId).toBeNull();
  });
});
