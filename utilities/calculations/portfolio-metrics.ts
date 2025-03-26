/**
 * portfolio-metrics.ts - Portfolio calculation utilities
 *
 * This file contains utility functions for calculating various portfolio metrics
 * such as total value, profit/loss, returns, and asset allocations.
 */

import type {
  Portfolio,
  Position,
  PositionValuation,
} from "@/types/numisma-types";

/**
 * Calculate total portfolio value from positions
 */
export function calculatePortfolioValue(positions: Position[]): number {
  return positions.reduce((total, position) => {
    return total + (position.currentValue || 0);
  }, 0);
}

/**
 * Calculate total portfolio profit/loss
 */
export function calculatePortfolioProfitLoss(positions: Position[]): number {
  return positions.reduce((total, position) => {
    const positionDetails = position.positionDetails;
    return (
      total +
      (positionDetails.realizedProfitLoss || 0) +
      (positionDetails.unrealizedProfitLoss || 0)
    );
  }, 0);
}

/**
 * Calculate portfolio return percentage
 */
export function calculatePortfolioReturn(
  positions: Position[],
  initialInvestment: number
): number {
  const totalValue = calculatePortfolioValue(positions);
  if (initialInvestment === 0) return 0;
  return ((totalValue - initialInvestment) / initialInvestment) * 100;
}

/**
 * Calculate asset allocation percentages
 */
export function calculateAssetAllocations(positions: Position[]): Array<{
  asset: string;
  value: number;
  percentage: number;
}> {
  const totalValue = calculatePortfolioValue(positions);
  if (totalValue === 0) return [];

  // Group positions by asset
  const assetGroups = positions.reduce((acc, position) => {
    const asset = position.asset.ticker;
    const value = position.currentValue || 0;

    if (!acc[asset]) {
      acc[asset] = {
        asset,
        value: 0,
      };
    }

    acc[asset].value += value;
    return acc;
  }, {} as Record<string, { asset: string; value: number }>);

  // Convert to array and calculate percentages
  return Object.values(assetGroups)
    .map(({ asset, value }) => ({
      asset,
      value,
      percentage: (value / totalValue) * 100,
    }))
    .sort((a, b) => b.value - a.value);
}

/**
 * Calculate portfolio risk metrics
 */
export function calculatePortfolioRisk(positions: Position[]): {
  averageRiskLevel: number;
  maxDrawdown: number;
  volatility: number;
} {
  // Calculate average risk level
  const averageRiskLevel =
    positions.reduce((sum, position) => sum + position.riskLevel, 0) /
    positions.length;

  // Calculate max drawdown (simplified version)
  const maxDrawdown = positions.reduce((max, position) => {
    const positionDetails = position.positionDetails;
    const unrealizedLoss = positionDetails.unrealizedProfitLoss || 0;
    return Math.min(max, unrealizedLoss);
  }, 0);

  // Calculate volatility (simplified version using position returns)
  const volatility =
    positions.reduce((sum, position) => {
      const positionDetails = position.positionDetails;
      const returnValue = positionDetails.currentReturn || 0;
      return sum + Math.pow(returnValue, 2);
    }, 0) / positions.length;

  return {
    averageRiskLevel,
    maxDrawdown,
    volatility,
  };
}

/**
 * Calculate portfolio performance metrics
 */
export function calculatePortfolioPerformance(positions: Position[]): {
  totalValue: number;
  profitLoss: number;
  returnPercentage: number;
  assetAllocations: Array<{ asset: string; value: number; percentage: number }>;
  riskMetrics: {
    averageRiskLevel: number;
    maxDrawdown: number;
    volatility: number;
  };
} {
  const totalValue = calculatePortfolioValue(positions);
  const profitLoss = calculatePortfolioProfitLoss(positions);
  const initialInvestment = positions.reduce((sum, position) => {
    return sum + (position.positionDetails.totalCost || 0);
  }, 0);
  const returnPercentage = calculatePortfolioReturn(
    positions,
    initialInvestment
  );
  const assetAllocations = calculateAssetAllocations(positions);
  const riskMetrics = calculatePortfolioRisk(positions);

  return {
    totalValue,
    profitLoss,
    returnPercentage,
    assetAllocations,
    riskMetrics,
  };
}

/**
 * Calculate position valuations for a portfolio
 */
export function calculatePositionValuations(
  positions: Position[]
): PositionValuation[] {
  return positions.map(position => {
    const positionDetails = position.positionDetails;
    const value = position.currentValue || 0;
    const costBasis = positionDetails.totalCost || 0;
    const profitLoss =
      (positionDetails.realizedProfitLoss || 0) +
      (positionDetails.unrealizedProfitLoss || 0);
    const percentageReturn = positionDetails.currentReturn || 0;

    return {
      id: `val_${position.id}`,
      positionId: position.id,
      value,
      marketPrice: position.asset.marketData?.currentPrice || 0,
      quantity: positionDetails.totalSize || 0,
      costBasis,
      profitLoss,
      percentageReturn,
      isOpen: positionDetails.status === "active",
      tags: position.tags,
    };
  });
}

/**
 * Calculate portfolio metrics for a specific time period
 */
export function calculatePortfolioMetricsForPeriod(
  positions: Position[],
  startDate: Date,
  endDate: Date
): {
  periodValue: number;
  periodProfitLoss: number;
  periodReturn: number;
  positionValuations: PositionValuation[];
} {
  // Filter positions that were active during the period
  const activePositions = positions.filter(position => {
    const positionDetails = position.positionDetails;
    const openedDate = positionDetails.dateOpened
      ? new Date(positionDetails.dateOpened)
      : null;
    const closedDate = positionDetails.dateClosed
      ? new Date(positionDetails.dateClosed)
      : null;

    return (
      openedDate &&
      openedDate <= endDate &&
      (!closedDate || closedDate >= startDate)
    );
  });

  const periodValue = calculatePortfolioValue(activePositions);
  const periodProfitLoss = calculatePortfolioProfitLoss(activePositions);
  const initialInvestment = activePositions.reduce((sum, position) => {
    return sum + (position.positionDetails.totalCost || 0);
  }, 0);
  const periodReturn = calculatePortfolioReturn(
    activePositions,
    initialInvestment
  );
  const positionValuations = calculatePositionValuations(activePositions);

  return {
    periodValue,
    periodProfitLoss,
    periodReturn,
    positionValuations,
  };
}
