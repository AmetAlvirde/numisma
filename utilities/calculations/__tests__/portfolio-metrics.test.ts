/**
 * portfolio-metrics.test.ts - Tests for portfolio calculation utilities
 */

import { describe, it, expect } from "vitest";
import {
  calculatePortfolioValue,
  calculatePortfolioProfitLoss,
  calculatePortfolioReturn,
  calculateAssetAllocations,
  calculatePortfolioRisk,
  calculatePortfolioPerformance,
  calculatePositionValuations,
  calculatePortfolioMetricsForPeriod,
} from "../portfolio-metrics";
import type {
  Position,
  Asset,
  PositionDetails,
  PositionStatus,
} from "@/types/numisma-types";

const mockAsset1: Asset = {
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

const mockAsset2: Asset = {
  name: "Ethereum",
  ticker: "ETH",
  pair: "ETH/USD",
  locationType: "exchange",
  exchange: "Test Exchange",
  wallet: "test-wallet",
  network: "ethereum",
  iconUrl: "eth-icon.png",
  category: "cryptocurrency",
  marketData: {
    currentPrice: 3000,
    priceChangePercentage24h: 3,
    marketCap: 400000000000,
    volume24h: 20000000000,
    lastUpdated: new Date(),
  },
};

const mockPosition1: Position = {
  id: "pos_1",
  name: "BTC Long",
  riskLevel: 7,
  portfolio: "test-portfolio",
  walletType: "hot",
  seedCapitalTier: "C1",
  strategy: "Long-term hold",
  asset: mockAsset1,
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

const mockPosition2: Position = {
  id: "pos_2",
  name: "ETH Long",
  riskLevel: 6,
  portfolio: "test-portfolio",
  walletType: "hot",
  seedCapitalTier: "C1",
  strategy: "Long-term hold",
  asset: mockAsset2,
  positionDetails: {
    status: "active",
    side: "long",
    timeFrame: "1D",
    dateOpened: new Date().toISOString(),
    orders: [],
    averageEntryPrice: 2800,
    totalSize: 5,
    totalCost: 14000,
    isLeveraged: false,
    unrealizedProfitLoss: 1000,
    currentReturn: 7.14,
  },
  tags: ["eth", "long"],
  userId: "test-user",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  currentValue: 15000,
  isHidden: false,
  alertsEnabled: true,
};

describe("Portfolio Metrics Calculations", () => {
  const positions = [mockPosition1, mockPosition2];

  describe("calculatePortfolioValue", () => {
    it("should calculate total portfolio value", () => {
      const value = calculatePortfolioValue(positions);
      expect(value).toBe(65000); // 50000 + 15000
    });

    it("should handle empty positions array", () => {
      const value = calculatePortfolioValue([]);
      expect(value).toBe(0);
    });
  });

  describe("calculatePortfolioProfitLoss", () => {
    it("should calculate total profit/loss", () => {
      const profitLoss = calculatePortfolioProfitLoss(positions);
      expect(profitLoss).toBe(6000); // 5000 + 1000
    });

    it("should handle positions with no profit/loss", () => {
      const positionsWithNoPnL = positions.map(pos => ({
        ...pos,
        positionDetails: {
          ...pos.positionDetails,
          unrealizedProfitLoss: 0,
        },
      }));
      const profitLoss = calculatePortfolioProfitLoss(positionsWithNoPnL);
      expect(profitLoss).toBe(0);
    });
  });

  describe("calculatePortfolioReturn", () => {
    it("should calculate portfolio return percentage", () => {
      const initialInvestment = 59000; // 45000 + 14000
      const returnPercentage = calculatePortfolioReturn(
        positions,
        initialInvestment
      );
      expect(returnPercentage).toBeCloseTo(10.17, 2); // ((65000 - 59000) / 59000) * 100
    });

    it("should handle zero initial investment", () => {
      const returnPercentage = calculatePortfolioReturn(positions, 0);
      expect(returnPercentage).toBe(0);
    });
  });

  describe("calculateAssetAllocations", () => {
    it("should calculate asset allocation percentages", () => {
      const allocations = calculateAssetAllocations(positions);
      expect(allocations).toHaveLength(2);
      expect(allocations[0]).toEqual({
        asset: "BTC",
        value: 50000,
        percentage: (50000 / 65000) * 100,
      });
      expect(allocations[1]).toEqual({
        asset: "ETH",
        value: 15000,
        percentage: (15000 / 65000) * 100,
      });
    });

    it("should handle empty positions array", () => {
      const allocations = calculateAssetAllocations([]);
      expect(allocations).toHaveLength(0);
    });
  });

  describe("calculatePortfolioRisk", () => {
    it("should calculate portfolio risk metrics", () => {
      const risk = calculatePortfolioRisk(positions);
      expect(risk.averageRiskLevel).toBe(6.5); // (7 + 6) / 2
      expect(risk.maxDrawdown).toBe(-5000); // Minimum unrealized loss
      expect(risk.volatility).toBeCloseTo(82.64, 2); // Average of squared returns
    });

    it("should handle positions with no risk metrics", () => {
      const positionsWithNoRisk = positions.map(pos => ({
        ...pos,
        riskLevel: 0,
        positionDetails: {
          ...pos.positionDetails,
          unrealizedProfitLoss: 0,
          currentReturn: 0,
        },
      }));
      const risk = calculatePortfolioRisk(positionsWithNoRisk);
      expect(risk.averageRiskLevel).toBe(0);
      expect(risk.maxDrawdown).toBe(0);
      expect(risk.volatility).toBe(0);
    });
  });

  describe("calculatePortfolioPerformance", () => {
    it("should calculate all portfolio performance metrics", () => {
      const performance = calculatePortfolioPerformance(positions);
      expect(performance.totalValue).toBe(65000);
      expect(performance.profitLoss).toBe(6000);
      expect(performance.returnPercentage).toBeCloseTo(10.17, 2);
      expect(performance.assetAllocations).toHaveLength(2);
      expect(performance.riskMetrics).toEqual({
        averageRiskLevel: 6.5,
        maxDrawdown: -5000,
        volatility: expect.any(Number),
      });
    });
  });

  describe("calculatePositionValuations", () => {
    it("should calculate position valuations", () => {
      const valuations = calculatePositionValuations(positions);
      expect(valuations).toHaveLength(2);
      expect(valuations[0]).toEqual({
        id: "val_pos_1",
        positionId: "pos_1",
        value: 50000,
        marketPrice: 50000,
        quantity: 1,
        costBasis: 45000,
        profitLoss: 5000,
        percentageReturn: 11.11,
        isOpen: true,
        tags: ["btc", "long"],
      });
      expect(valuations[1]).toEqual({
        id: "val_pos_2",
        positionId: "pos_2",
        value: 15000,
        marketPrice: 3000,
        quantity: 5,
        costBasis: 14000,
        profitLoss: 1000,
        percentageReturn: 7.14,
        isOpen: true,
        tags: ["eth", "long"],
      });
    });
  });

  describe("calculatePortfolioMetricsForPeriod", () => {
    it("should calculate metrics for a specific time period", () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30); // 30 days ago
      const endDate = new Date();

      const metrics = calculatePortfolioMetricsForPeriod(
        positions,
        startDate,
        endDate
      );

      expect(metrics.periodValue).toBe(65000);
      expect(metrics.periodProfitLoss).toBe(6000);
      expect(metrics.periodReturn).toBeCloseTo(10.17, 2);
      expect(metrics.positionValuations).toHaveLength(2);
    });

    it("should filter out positions not active during the period", () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
      const endDate = new Date();

      const closedPosition: Position = {
        ...mockPosition1,
        positionDetails: {
          ...mockPosition1.positionDetails,
          status: "closed" as PositionStatus,
          dateClosed: new Date(startDate.getTime() - 1).toISOString(),
        },
      };

      const metrics = calculatePortfolioMetricsForPeriod(
        [closedPosition, mockPosition2],
        startDate,
        endDate
      );

      expect(metrics.positionValuations).toHaveLength(1);
      expect(metrics.positionValuations[0].positionId).toBe("pos_2");
    });
  });
});
