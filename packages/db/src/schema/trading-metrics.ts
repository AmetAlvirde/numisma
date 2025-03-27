/**
 * Trading Metrics schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema, userIdSchema } from "./common";

/**
 * Period type for metrics calculation
 */
export const metricsPeriodSchema = z.enum([
  "all_time",
  "yearly",
  "quarterly",
  "monthly",
  "weekly",
  "daily",
  "custom",
]);

/**
 * Trade type analytics schema
 */
export const tradeTypeAnalyticsSchema = z.record(
  z.object({
    count: z.number().int().nonnegative(),
    winRate: z.number().min(0).max(100),
    avgProfitLoss: z.number(),
  })
);

/**
 * Asset analytics schema
 */
export const assetAnalyticsSchema = z.record(
  z.object({
    count: z.number().int().nonnegative(),
    winRate: z.number().min(0).max(100),
    avgProfitLoss: z.number(),
  })
);

/**
 * Time frame analytics schema
 */
export const timeFrameAnalyticsSchema = z.record(
  z.object({
    count: z.number().int().nonnegative(),
    winRate: z.number().min(0).max(100),
    avgProfitLoss: z.number(),
  })
);

/**
 * Trading Metrics entity schema
 */
export const tradingMetricsSchema = z
  .object({
    // Core fields
    id: idSchema,
    userId: userIdSchema,
    portfolioId: idSchema.optional(),

    // Period configuration
    period: metricsPeriodSchema,
    periodStart: z.date().optional(),
    periodEnd: z.date().optional(),

    // Basic metrics
    totalTrades: z.number().int().nonnegative(),
    winningTrades: z.number().int().nonnegative(),
    losingTrades: z.number().int().nonnegative(),
    winRate: z.number().min(0).max(100),

    // Financial metrics
    avgWinAmount: z.number(),
    avgLossAmount: z.number(),
    avgProfitLoss: z.number(),
    maxConsecutiveWins: z.number().int().nonnegative(),
    maxConsecutiveLosses: z.number().int().nonnegative(),
    maxDrawdown: z.number().nonnegative(),
    profitFactor: z.number().nonnegative(),
    expectancy: z.number(),

    // Additional metrics
    avgHoldingTime: z.string().optional(),
    stdDeviation: z.number().nonnegative().optional(),

    // Breakdown analytics
    byTradeType: tradeTypeAnalyticsSchema.optional(),
    byAsset: assetAnalyticsSchema.optional(),
    byTimeFrame: timeFrameAnalyticsSchema.optional(),

    // Timestamps
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Schema for creating trading metrics
 * (typically calculated by the system, not user-created)
 */
export const createTradingMetricsSchema = tradingMetricsSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Trading metrics search parameters
 */
export const tradingMetricsSearchSchema = z.object({
  userId: userIdSchema,
  portfolioId: idSchema.optional(),
  period: metricsPeriodSchema.optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

export type TradingMetrics = z.infer<typeof tradingMetricsSchema>;
export type CreateTradingMetricsInput = z.infer<
  typeof createTradingMetricsSchema
>;
export type TradingMetricsSearch = z.infer<typeof tradingMetricsSearchSchema>;
