// src/mocks/portfolioSummaryData.ts
import { PortfolioSummaryProps } from "@/components/financial/portfolio-summary";

export const mockPortfolioSummaryData: PortfolioSummaryProps = {
  // Core data
  portfolioName: "Cycle Portfolio",
  totalValue: 12485.37,
  change24h: 2.3,
  positionCounts: {
    spot: 12,
    futures: 4,
  },
  ordersFilled: 3,

  // Activity data
  recentActivity: [
    {
      id: "act-1",
      type: "order_filled",
      title: "ETH order filled",
      description: "0.42 ETH @ $2,840 on Binance",
      value: 1192.8,
      timestamp: "03:24 AM",
    },
    {
      id: "act-2",
      type: "alert",
      title: "BTC above alert",
      description: "Crossed $62,500 threshold",
      changePercentage: 3.8,
      timestamp: "05:12 AM",
    },
    {
      id: "act-3",
      type: "order_filled",
      title: "SOL order filled",
      description: "3.5 SOL @ $142 on BingX",
      value: 497.0,
      timestamp: "11:42 PM",
    },
    {
      id: "act-4",
      type: "notification",
      title: "Portfolio milestone reached",
      description: "Total value exceeded $12,000",
      timestamp: "Yesterday",
    },
    {
      id: "act-5",
      type: "order_filled",
      title: "AVAX order filled",
      description: "4.2 AVAX @ $34.25 on Bitget",
      value: 143.85,
      timestamp: "Yesterday",
    },
  ],

  // Watchlist data
  watchlist: [
    {
      id: "watch-1",
      ticker: "BTC",
      name: "Bitcoin",
      type: "futures",
      status: "Approaching take-profit zone",
      leverage: 5,
      changePercentage: 3.8,
      currentPrice: 62584,
    },
    {
      id: "watch-2",
      ticker: "ETH",
      name: "Ethereum",
      type: "spot",
      status: "New position (filled overnight)",
      changePercentage: 2.4,
      currentPrice: 2850,
    },
    {
      id: "watch-3",
      ticker: "SOL",
      name: "Solana",
      type: "spot",
      status: "Near stop-loss level",
      changePercentage: -1.2,
      currentPrice: 138.45,
    },
    {
      id: "watch-4",
      ticker: "AVAX",
      name: "Avalanche",
      type: "spot",
      status: "Consolidating within range",
      changePercentage: 0.3,
      currentPrice: 34.28,
    },
    {
      id: "watch-5",
      ticker: "LINK",
      name: "Chainlink",
      type: "futures",
      status: "Approaching key resistance",
      leverage: 3,
      changePercentage: 5.7,
      currentPrice: 17.86,
    },
  ],

  // Exchange data - CORRECTED to match position counts
  exchanges: [
    {
      name: "Binance",
      spotCount: 3,
      futuresCount: 1,
      totalValue: 3845.2,
    },
    {
      name: "BingX",
      spotCount: 3,
      futuresCount: 1,
      totalValue: 2842.12,
    },
    {
      name: "Bitget",
      spotCount: 4,
      futuresCount: 1,
      totalValue: 3918.22,
    },
    {
      name: "Bitso",
      spotCount: 2,
      futuresCount: 0,
      totalValue: 879.55,
    },
    {
      name: "Kraken",
      spotCount: 0,
      futuresCount: 0,
      totalValue: 562.15,
    },
    {
      name: "Bybit",
      spotCount: 0,
      futuresCount: 1,
      totalValue: 438.13,
    },
  ],

  // Position breakdown - CORRECTED to match total portfolio value
  spotPositions: {
    count: 12,
    totalValue: 8454.98, // Adjusted to ensure correct sum
    change24h: 2.1,
  },

  futuresPositions: {
    count: 4,
    totalValue: 4030.39,
    change24h: 3.4,
  },

  // Callbacks
  onRefresh: () => console.log("Refresh data triggered"),
  onViewAllActivity: () => console.log("View all activity triggered"),
  onFullAnalysis: () => console.log("Full analysis triggered"),

  // Optional
  className: "",
  isLoading: false,
};

// Variant with loading state
export const loadingPortfolioSummary: PortfolioSummaryProps = {
  ...mockPortfolioSummaryData,
  isLoading: true,
};

// Empty state for new portfolios - ALREADY CORRECT
export const emptyPortfolioSummary: PortfolioSummaryProps = {
  portfolioName: "New Portfolio",
  totalValue: 0,
  change24h: 0,
  positionCounts: {
    spot: 0,
    futures: 0,
  },
  ordersFilled: 0,
  recentActivity: [],
  watchlist: [],
  exchanges: [],
  spotPositions: {
    count: 0,
    totalValue: 0,
    change24h: 0,
  },
  futuresPositions: {
    count: 0,
    totalValue: 0,
    change24h: 0,
  },
  onRefresh: () => console.log("Refresh data triggered"),
  onViewAllActivity: () => console.log("View all activity triggered"),
  onFullAnalysis: () => console.log("Full analysis triggered"),
  isLoading: false,
};

// Negative performance variant - CORRECTED for mathematical consistency
export const negativePerformance: PortfolioSummaryProps = {
  ...mockPortfolioSummaryData,
  totalValue: 11985.62,
  change24h: -3.2,
  spotPositions: {
    ...mockPortfolioSummaryData.spotPositions,
    totalValue: 8105.23, // Adjusted to ensure correct sum
    change24h: -2.8,
  },
  futuresPositions: {
    ...mockPortfolioSummaryData.futuresPositions,
    totalValue: 3880.39, // Adjusted to ensure total adds up
    change24h: -4.1,
  },
  // Updated exchange values to match the new total
  exchanges: [
    {
      name: "Binance",
      spotCount: 3,
      futuresCount: 1,
      totalValue: 3685.2,
    },
    {
      name: "BingX",
      spotCount: 3,
      futuresCount: 1,
      totalValue: 2742.12,
    },
    {
      name: "Bitget",
      spotCount: 4,
      futuresCount: 1,
      totalValue: 3718.22,
    },
    {
      name: "Bitso",
      spotCount: 2,
      futuresCount: 0,
      totalValue: 839.55,
    },
    {
      name: "Kraken",
      spotCount: 0,
      futuresCount: 0,
      totalValue: 542.15,
    },
    {
      name: "Bybit",
      spotCount: 0,
      futuresCount: 1,
      totalValue: 458.38,
    },
  ],
  watchlist: [
    {
      id: "watch-1",
      ticker: "BTC",
      name: "Bitcoin",
      type: "futures",
      status: "Approaching stop-loss level",
      leverage: 5,
      changePercentage: -2.7,
      currentPrice: 59854,
    },
    {
      id: "watch-2",
      ticker: "ETH",
      name: "Ethereum",
      type: "spot",
      status: "Breaking support level",
      changePercentage: -3.9,
      currentPrice: 2682,
    },
    {
      id: "watch-3",
      ticker: "SOL",
      name: "Solana",
      type: "spot",
      status: "Stop-loss triggered",
      changePercentage: -5.3,
      currentPrice: 126.18,
    },
    {
      id: "watch-4",
      ticker: "AVAX",
      name: "Avalanche",
      type: "spot",
      status: "Reached key support",
      changePercentage: -1.8,
      currentPrice: 32.56,
    },
    {
      id: "watch-5",
      ticker: "LINK",
      name: "Chainlink",
      type: "futures",
      status: "Liquidation risk",
      leverage: 3,
      changePercentage: -4.2,
      currentPrice: 15.94,
    },
  ],
};

// Mix of different performance data - CORRECTED for mathematical consistency
export const mixedPerformance: PortfolioSummaryProps = {
  ...mockPortfolioSummaryData,
  totalValue: 12268.91,
  change24h: 0.8,
  spotPositions: {
    ...mockPortfolioSummaryData.spotPositions,
    totalValue: 8220.91, // Adjusted for correct sum
    change24h: -1.2,
  },
  futuresPositions: {
    ...mockPortfolioSummaryData.futuresPositions,
    totalValue: 4048.0, // Adjusted for correct sum
    change24h: 4.3,
  },
  // Updated exchange values to match the new total
  exchanges: [
    {
      name: "Binance",
      spotCount: 3,
      futuresCount: 1,
      totalValue: 3780.2,
    },
    {
      name: "BingX",
      spotCount: 3,
      futuresCount: 1,
      totalValue: 2812.12,
    },
    {
      name: "Bitget",
      spotCount: 4,
      futuresCount: 1,
      totalValue: 3798.22,
    },
    {
      name: "Bitso",
      spotCount: 2,
      futuresCount: 0,
      totalValue: 869.55,
    },
    {
      name: "Kraken",
      spotCount: 0,
      futuresCount: 0,
      totalValue: 552.15,
    },
    {
      name: "Bybit",
      spotCount: 0,
      futuresCount: 1,
      totalValue: 456.67,
    },
  ],
  watchlist: [
    {
      id: "watch-1",
      ticker: "BTC",
      name: "Bitcoin",
      type: "futures",
      status: "Above resistance level",
      leverage: 5,
      changePercentage: 2.1,
      currentPrice: 61879,
    },
    {
      id: "watch-2",
      ticker: "ETH",
      name: "Ethereum",
      type: "spot",
      status: "Testing support level",
      changePercentage: -1.7,
      currentPrice: 2764,
    },
    {
      id: "watch-3",
      ticker: "SOL",
      name: "Solana",
      type: "spot",
      status: "Nearing take-profit zone",
      changePercentage: 3.4,
      currentPrice: 142.76,
    },
    {
      id: "watch-4",
      ticker: "AVAX",
      name: "Avalanche",
      type: "spot",
      status: "Ranging sideways",
      changePercentage: 0.2,
      currentPrice: 33.98,
    },
    {
      id: "watch-5",
      ticker: "LINK",
      name: "Chainlink",
      type: "futures",
      status: "Approaching resistance",
      leverage: 3,
      changePercentage: -0.8,
      currentPrice: 16.92,
    },
  ],
};
