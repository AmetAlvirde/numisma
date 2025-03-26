/**
 * validators.ts - Zod validation schemas for data import
 *
 * This file defines the Zod validation schemas used to validate
 * imported portfolio data against our TypeScript interfaces.
 */

import { z } from "zod";
import type { Portfolio, Position, Asset, Order } from "@/types/numisma-types";

/**
 * Schema for validating asset data
 */
export const assetSchema = z.object({
  name: z.string(),
  ticker: z.string(),
  pair: z.string(),
  locationType: z.enum([
    "exchange",
    "dex",
    "cold_storage",
    "defi",
    "staking",
    "lending",
  ]),
  exchange: z.string().optional(),
  wallet: z.string(),
  network: z.string().optional(),
  contractAddress: z.string().optional(),
  iconUrl: z.string().optional(),
  category: z.string().optional(),
  marketData: z
    .object({
      currentPrice: z.number().optional(),
      priceChangePercentage24h: z.number().optional(),
      marketCap: z.number().optional(),
      volume24h: z.number().optional(),
      lastUpdated: z.date().optional(),
    })
    .optional(),
});

/**
 * Schema for validating order data
 */
export const orderSchema = z.object({
  id: z.string(),
  positionId: z.string(),
  dateOpen: z.union([z.date(), z.string(), z.literal("genesis")]).optional(),
  averagePrice: z.number().optional(),
  totalCost: z.number().optional(),
  status: z.enum([
    "submitted",
    "filled",
    "cancelled",
    "partially_filled",
    "expired",
  ]),
  type: z.enum(["trigger", "market", "limit", "trailing_stop", "oco"]),
  fee: z.union([z.number(), z.literal("genesis")]).optional(),
  feeUnit: z.string().optional(),
  filled: z.number().optional(),
  unit: z.enum(["percentage", "base", "quote", "fiat"]).optional(),
  trigger: z.number().optional(),
  estimatedCost: z.number().optional(),
  direction: z.enum(["entry", "exit"]),
  expiration: z.date().optional(),
  exchangeOrderId: z.string().optional(),
  exchangeApiRef: z.string().optional(),
  isAutomated: z.boolean().optional(),
  isHidden: z.boolean().optional(),
  parentOrderId: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Schema for validating position data
 */
export const positionSchema = z.object({
  id: z.string(),
  name: z.string(),
  riskLevel: z.number().min(1).max(10),
  portfolio: z.string(),
  walletType: z.enum(["hot", "cold"]),
  seedCapitalTier: z.string(),
  strategy: z.string(),
  thesis: z
    .object({
      reasoning: z.string(),
      invalidation: z.string().optional(),
      fulfillment: z.string().optional(),
      notes: z.string().optional(),
      technicalAnalysis: z.string().optional(),
      fundamentalAnalysis: z.string().optional(),
      timeHorizon: z.string().optional(),
      riskRewardRatio: z.string().optional(),
    })
    .optional(),
  journal: z
    .array(
      z.object({
        id: z.string(),
        positionId: z.string(),
        thought: z.string(),
        attachments: z.array(z.string()).optional(),
        timestamp: z.union([z.date(), z.string(), z.literal("genesis")]),
        userId: z.string(),
        tags: z.array(z.string()).optional(),
        sentiment: z.enum(["bullish", "bearish", "neutral"]).optional(),
        isKeyLearning: z.boolean().optional(),
      })
    )
    .optional(),
  asset: assetSchema,
  positionDetails: z.object({
    status: z.enum(["active", "closed", "partial"]),
    side: z.enum(["long", "short"]),
    timeFrame: z.enum([
      "1m",
      "5m",
      "15m",
      "30m",
      "1H",
      "4H",
      "1D",
      "3D",
      "1W",
      "1M",
    ]),
    transactionFee: z
      .union([z.number(), z.string(), z.literal("genesis")])
      .optional(),
    dateOpened: z
      .union([z.date(), z.string(), z.literal("genesis")])
      .optional(),
    dateClosed: z
      .union([z.date(), z.string(), z.literal("genesis")])
      .optional(),
    orders: z.array(orderSchema),
    stopLoss: z.array(orderSchema).optional(),
    takeProfit: z.array(orderSchema).optional(),
    averageEntryPrice: z.number().optional(),
    averageExitPrice: z.number().optional(),
    totalSize: z.number().optional(),
    totalCost: z.number().optional(),
    realizedProfitLoss: z.number().optional(),
    isLeveraged: z.boolean().optional(),
    leverage: z.number().optional(),
    unrealizedProfitLoss: z.number().optional(),
    currentReturn: z.number().optional(),
    targetPrice: z.number().optional(),
    stopPrice: z.number().optional(),
    riskRewardRatio: z.number().optional(),
  }),
  tags: z.array(z.string()).optional(),
  userId: z.string(),
  dateCreated: z.date(),
  dateUpdated: z.date(),
  currentValue: z.number().optional(),
  isHidden: z.boolean().optional(),
  alertsEnabled: z.boolean().optional(),
});

/**
 * Schema for validating portfolio data
 */
export const portfolioSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  dateCreated: z.union([z.date(), z.string(), z.literal("genesis")]),
  status: z.enum(["active", "archived", "deleted"]),
  positionIds: z.array(z.string()),
  userId: z.string(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  baseCurrency: z.string(),
  riskProfile: z
    .enum(["conservative", "moderate", "aggressive", "custom"])
    .optional(),
  targetAllocations: z
    .array(
      z.object({
        asset: z.string(),
        percentage: z.number(),
      })
    )
    .optional(),
  currentValue: z.number().optional(),
  initialInvestment: z.number().optional(),
  profitLoss: z.number().optional(),
  returnPercentage: z.number().optional(),
  isPublic: z.boolean().optional(),
  displayMetadata: z
    .object({
      color: z.string().optional(),
      sortOrder: z.number().optional(),
      isPinned: z.boolean().optional(),
      icon: z.string().optional(),
      headerImage: z.string().optional(),
    })
    .optional(),
});

/**
 * Validates raw portfolio data against our schema
 */
export function validatePortfolioData(data: unknown) {
  return portfolioSchema.safeParse(data);
}

/**
 * Validates raw position data against our schema
 */
export function validatePositionData(data: unknown) {
  return positionSchema.safeParse(data);
}

/**
 * Validates raw asset data against our schema
 */
export function validateAssetData(data: unknown) {
  return assetSchema.safeParse(data);
}

/**
 * Validates raw order data against our schema
 */
export function validateOrderData(data: unknown) {
  return orderSchema.safeParse(data);
}
