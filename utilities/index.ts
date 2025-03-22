/**
 * utils.ts - Core utility functions for portfolio operations
 *
 * This module provides pure functions for working with positions and portfolios.
 * Functions are designed to be composable and avoid side effects.
 *
 * @ai-guidance These utilities follow functional programming principles.
 * Each function takes inputs and returns new objects rather than mutating
 * existing ones. When suggesting changes, preserve this pattern.
 */

import { Position, Order, DateOrGenesis } from "../types";

/**
 * Filters positions that belong to a specific portfolio
 *
 * @param positions - All available positions
 * @param portfolioName - Name of the portfolio to filter by
 * @returns Array of positions that belong to the specified portfolio
 *
 * @example
 * const btcPositions = getPositionsByPortfolio(allPositions, "BTC Portfolio");
 */
export const getPositionsByPortfolio = (
  positions: Position[],
  portfolioName: string
): Position[] => {
  // Filter positions by exact portfolio name match
  return positions.filter(p => p.portfolio === portfolioName);
};

/**
 * Calculates the current value of a position based on market prices
 *
 * This function multiplies the filled amount of each order by the current price.
 * Only considers filled orders, ignoring pending/cancelled ones.
 *
 * @param position - The position to evaluate
 * @param currentPrices - Object mapping tickers to their current prices
 * @returns The current value in quote currency (e.g., USD)
 *
 * @ai-guidance Handle edge cases where orders might have undefined filled
 * amounts or when filledUnit doesn't match the asset ticker (rare but possible
 * in complex positions).
 *
 * @example
 * const btcPosition = {...};
 * const value = calculatePositionValue(btcPosition, { "BTC": 85000 });
 */
export const calculatePositionValue = (
  position: Position,
  currentPrices: Record<string, number>
): number => {
  const ticker = position.asset.ticker;
  // Default to 0 if price is not available
  const price = currentPrices[ticker] || 0;

  // Sum value from all filled orders
  return position.positionDetails.orders
    .filter(o => o.status === "filled" && o.filled !== undefined)
    .reduce((sum, order) => {
      // Ensure filled amount exists and units match
      if (typeof order.filled === "number" && order.filledUnit === ticker) {
        return sum + order.filled * price;
      }
      // Handle case where filledUnit doesn't match ticker
      // This can happen with complex trading pairs or calculated positions
      return sum;
    }, 0);
};

/**
 * Calculates the total value of a portfolio
 *
 * @param positions - All available positions
 * @param portfolioName - Name of the portfolio to calculate
 * @param currentPrices - Object mapping tickers to their current prices
 * @returns Total portfolio value in quote currency (e.g., USD)
 *
 * @ai-guidance This is a composition of getPositionsByPortfolio and
 * calculatePositionValue, demonstrating functional composition.
 */
export const calculatePortfolioValue = (
  positions: Position[],
  portfolioName: string,
  currentPrices: Record<string, number>
): number => {
  const portfolioPositions = getPositionsByPortfolio(positions, portfolioName);
  return portfolioPositions.reduce(
    (total, position) =>
      total + calculatePositionValue(position, currentPrices),
    0
  );
};

/**
 * Adds a new order to a position immutably
 *
 * Creates a new position object with the updated orders array.
 *
 * @param position - Original position
 * @param newOrder - Order to add
 * @returns New position object with added order
 *
 * @ai-guidance This function creates a deep copy to maintain immutability.
 * This pattern should be followed for all state updates.
 */
export const addOrderToPosition = (
  position: Position,
  newOrder: Order
): Position => {
  return {
    ...position,
    positionDetails: {
      ...position.positionDetails,
      orders: [...position.positionDetails.orders, newOrder],
    },
  };
};

/**
 * Calculates unrealized profit/loss for a position
 *
 * P&L = Current Value - Invested Amount
 *
 * @param position - Position to calculate P&L for
 * @param currentPrice - Current market price of the asset
 * @returns Unrealized P&L in quote currency (e.g., USD)
 *
 * @ai-guidance This calculation handles missing data gracefully by
 * defaulting to 0 for missing totalCost values.
 */
export const calculateUnrealizedPnL = (
  position: Position,
  currentPrice: number
): number => {
  // Calculate total cost basis from all filled orders
  const investedAmount = position.positionDetails.orders
    .filter(o => o.status === "filled")
    .reduce((sum, order) => sum + (order.totalCost || 0), 0);

  // Get current position value at market price
  const currentValue = calculatePositionValue(position, {
    [position.asset.ticker]: currentPrice,
  });

  // P&L is difference between current value and invested amount
  return currentValue - investedAmount;
};

/**
 * Formats a DateOrGenesis value for UI display
 *
 * Handles special "genesis" value and different date formats.
 *
 * @param date - Date value which might be Date, string, or "genesis"
 * @param format - Optional format specification
 * @returns Formatted string representation
 *
 * @ai-guidance The "genesis" concept is unique to our application and
 * represents data that existed before tracking began.
 */
export const formatDate = (
  date?: DateOrGenesis,
  format: string = "medium"
): string => {
  if (!date) return "N/A";

  if (date === "genesis") return "Genesis";

  if (typeof date === "string" && date !== "genesis") {
    // Try to parse the string into a Date object
    try {
      const dateObj = new Date(date);
      return formatDateObj(dateObj, format);
    } catch (e) {
      console.log(e);
      return date; // Return as-is if parsing fails
    }
  }

  if (date instanceof Date) {
    return formatDateObj(date, format);
  }

  return String(date);
};

/**
 * Helper function to format a Date object
 *
 * @param date - Date object to format
 * @param format - Format specification
 * @returns Formatted date string
 *
 * @private Internal helper function
 */
const formatDateObj = (date: Date, format: string): string => {
  switch (format) {
    case "short":
      return date.toLocaleDateString();
    case "medium":
      return date.toLocaleString();
    case "long":
      return date.toLocaleString(undefined, {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    default:
      return date.toLocaleString();
  }
};

/**
 * Calculates risk-adjusted return metrics for a position
 *
 * @param position - Position to analyze
 * @param currentPrice - Current market price
 * @returns Object with risk metrics
 *
 * @ai-guidance This implements a simplified Sharpe ratio calculation.
 * Future versions could incorporate volatility measurements.
 *
 * @todo Implement more sophisticated risk metrics
 */
export const calculateRiskMetrics = (
  position: Position,
  currentPrice: number
) => {
  const pnl = calculateUnrealizedPnL(position, currentPrice);
  const investedAmount = position.positionDetails.orders
    .filter(o => o.status === "filled")
    .reduce((sum, order) => sum + (order.totalCost || 0), 0);

  // Avoid division by zero
  const roi = investedAmount > 0 ? pnl / investedAmount : 0;

  // Risk-adjusted return (simplified)
  // Higher riskLevel means lower risk-adjusted return
  const riskAdjustedReturn = roi / (position.riskLevel / 10);

  return {
    roi,
    riskAdjustedReturn,
    riskLevel: position.riskLevel,
  };
};
