/**
 * indexeddb-schema.ts - IndexedDB database schema definition
 */

import type { Portfolio, Position, Asset, Order } from "@/types/numisma-types";

export const DB_NAME = "numisma_db";
export const DB_VERSION = 2;

interface PortfolioPosition {
  portfolioId: string;
  positionId: string;
  addedAt: string;
  addedBy: string;
  isHidden: boolean;
  displayOrder: number;
}

interface HistoricalValuation {
  id: string;
  portfolioId: string;
  timestamp: string;
  totalValue: number;
  valueCurrency: string;
  initialInvestment: number;
  profitLoss: number;
  percentageReturn: number;
  positionValuations: Array<{
    id: string;
    positionId: string;
    value: number;
    marketPrice: number;
    quantity: number;
    costBasis: number;
    profitLoss: number;
    percentageReturn: number;
  }>;
  isRetroactive: boolean;
  marketContext?: {
    btcPrice: number;
    ethPrice: number;
    totalMarketCap: number;
    fearGreedIndex: number;
  };
}

export interface DatabaseSchema {
  portfolios: Portfolio;
  positions: Position;
  assets: Asset;
  orders: Order;
  portfolioPositions: PortfolioPosition;
  historicalValuations: HistoricalValuation;
}

export const STORE_CONFIGS = {
  portfolios: {
    keyPath: "id",
    indexes: [
      { name: "userId", keyPath: "userId", options: { unique: false } },
      {
        name: "dateCreated",
        keyPath: "dateCreated",
        options: { unique: false },
      },
      {
        name: "dateUpdated",
        keyPath: "dateUpdated",
        options: { unique: false },
      },
    ],
  },
  positions: {
    keyPath: "id",
    indexes: [
      { name: "portfolio", keyPath: "portfolio", options: { unique: false } },
      { name: "userId", keyPath: "userId", options: { unique: false } },
      { name: "asset", keyPath: "asset.ticker", options: { unique: false } },
      {
        name: "dateCreated",
        keyPath: "dateCreated",
        options: { unique: false },
      },
      {
        name: "dateUpdated",
        keyPath: "dateUpdated",
        options: { unique: false },
      },
      {
        name: "status",
        keyPath: "positionDetails.status",
        options: { unique: false },
      },
    ],
  },
  assets: {
    keyPath: "ticker",
    indexes: [
      { name: "category", keyPath: "category", options: { unique: false } },
      { name: "network", keyPath: "network", options: { unique: false } },
      {
        name: "lastUpdated",
        keyPath: "marketData.lastUpdated",
        options: { unique: false },
      },
    ],
  },
  orders: {
    keyPath: "id",
    indexes: [
      { name: "positionId", keyPath: "positionId", options: { unique: false } },
      { name: "userId", keyPath: "userId", options: { unique: false } },
      { name: "dateOpen", keyPath: "dateOpen", options: { unique: false } },
      { name: "dateClose", keyPath: "dateClose", options: { unique: false } },
      { name: "status", keyPath: "status", options: { unique: false } },
    ],
  },
  portfolioPositions: {
    keyPath: ["portfolioId", "positionId"] as string[],
    indexes: [
      {
        name: "portfolioId",
        keyPath: "portfolioId",
        options: { unique: false },
      },
      { name: "positionId", keyPath: "positionId", options: { unique: false } },
      { name: "addedAt", keyPath: "addedAt", options: { unique: false } },
      {
        name: "displayOrder",
        keyPath: "displayOrder",
        options: { unique: false },
      },
    ],
  },
  historicalValuations: {
    keyPath: "id",
    indexes: [
      {
        name: "portfolioId",
        keyPath: "portfolioId",
        options: { unique: false },
      },
      { name: "timestamp", keyPath: "timestamp", options: { unique: false } },
      {
        name: "isRetroactive",
        keyPath: "isRetroactive",
        options: { unique: false },
      },
    ],
  },
} as const;

export type StoreName = keyof typeof STORE_CONFIGS;
export type IndexName<T extends StoreName> =
  (typeof STORE_CONFIGS)[T]["indexes"][number]["name"];
