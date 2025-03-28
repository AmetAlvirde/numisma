/**
 * Trading Metrics schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema, foreignKeySchema } from "./common";
import {
  OrderType,
  AssetType,
  ValidationResult,
  ValidationError,
} from "@numisma/types";

/**
 * Time frame for metrics calculation
 */
export enum TimeFrame {
  MINUTE_1 = "1m",
  MINUTE_5 = "5m",
  MINUTE_15 = "15m",
  MINUTE_30 = "30m",
  HOUR_1 = "1H",
  HOUR_4 = "4H",
  DAY_1 = "1D",
  DAY_3 = "3D",
  WEEK_1 = "1W",
  MONTH_1 = "1M",
}

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
const baseTradingMetricsSchema = z
  .object({
    // Core fields
    id: idSchema,
    userId: foreignKeySchema,
    portfolioId: foreignKeySchema.optional(),

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
    byTradeType: z
      .record(z.nativeEnum(OrderType), tradeTypeAnalyticsSchema)
      .optional(),
    byAsset: z.record(z.nativeEnum(AssetType), assetAnalyticsSchema).optional(),
    byTimeFrame: z
      .record(z.nativeEnum(TimeFrame), timeFrameAnalyticsSchema)
      .optional(),

    // Timestamps
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Trading Metrics entity schema with refinements
 */
export const tradingMetricsSchema = baseTradingMetricsSchema
  .refine(
    data => {
      // Validate that winningTrades + losingTrades equals totalTrades
      return data.winningTrades + data.losingTrades === data.totalTrades;
    },
    {
      message: "Total trades must equal the sum of winning and losing trades",
      path: ["totalTrades"],
    }
  )
  .refine(
    data => {
      // Validate that winRate matches the calculated value
      const calculatedWinRate = (data.winningTrades / data.totalTrades) * 100;
      return Math.abs(data.winRate - calculatedWinRate) < 0.01;
    },
    {
      message: "Win rate must match the calculated value from winning trades",
      path: ["winRate"],
    }
  );

/**
 * Schema for creating trading metrics
 * (typically calculated by the system, not user-created)
 */
export const createTradingMetricsSchema = baseTradingMetricsSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Trading metrics search parameters
 */
export const tradingMetricsSearchSchema = z.object({
  userId: foreignKeySchema,
  portfolioId: foreignKeySchema.optional(),
  period: metricsPeriodSchema.optional(),
  startDate: z.date().optional(),
  endDate: z.date().optional(),
});

export type TradingMetrics = z.infer<typeof tradingMetricsSchema>;
export type CreateTradingMetricsInput = z.infer<
  typeof createTradingMetricsSchema
>;
export type TradingMetricsSearch = z.infer<typeof tradingMetricsSearchSchema>;
