/**
 * Historical Valuation schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema, foreignKeySchema } from "./common";
import { TimeFrame, ValidationResult, ValidationError } from "@numisma/types";

/**
 * Time frame unit enum
 */
export enum TimeFrameUnit {
  DAY = "day",
  WEEK = "week",
  MONTH = "month",
  QUARTER = "quarter",
  YEAR = "year",
  ALL_TIME = "all_time",
}

/**
 * Base historical valuation schema without refinements
 */
const baseHistoricalValuationSchema = z
  .object({
    // Core fields
    id: idSchema,
    portfolioId: foreignKeySchema,
    timestamp: z.date(),

    // Temporal metadata
    year: z.number().int(),
    month: z.number().int().min(1).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    periodKey: z.string(),
    periodName: z.string(),
    timeFrameUnit: z.nativeEnum(TimeFrameUnit),
    periodStart: z.date(),
    periodEnd: z.date(),
    isTimeframeBoundary: z.boolean(),

    // Analytics fields
    totalValue: z.number().positive(),
    valueCurrency: z.string().length(3), // ISO 4217 currency code
    initialInvestment: z.number().nonnegative(),
    profitLoss: z.number(),
    percentageReturn: z.number(),
    realizedProfitLoss: z.number().optional(),
    unrealizedProfitLoss: z.number().optional(),

    // Risk metrics
    volatility: z.number().nonnegative().optional(),
    maxDrawdown: z.number().nonnegative().optional(),
    sharpeRatio: z.number().optional(),
    sortinoRatio: z.number().optional(),
    calmarRatio: z.number().optional(),

    // Return metrics
    dailyReturn: z.number().optional(),
    weeklyReturn: z.number().optional(),
    monthlyReturn: z.number().optional(),
    quarterlyReturn: z.number().optional(),
    yearlyReturn: z.number().optional(),
    inceptionReturn: z.number().optional(),

    // Position metrics
    positionCount: z.number().int().nonnegative().optional(),

    // JSON data fields
    positionValuations: z.record(z.any()), // Complex structure stored as JSON
    returnMetrics: z.record(z.any()).optional(),
    riskMetrics: z.record(z.any()).optional(),
    assetAllocation: z.record(z.any()).optional(),

    // Market context
    btcPrice: z.number().positive().optional(),
    ethPrice: z.number().positive().optional(),
    totalMarketCap: z.number().positive().optional(),
    fearGreedIndex: z.number().int().min(0).max(100).optional(),

    // Metadata
    isRetroactive: z.boolean().default(false),
    notes: z.string().optional(),

    // Standard timestamps
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Historical valuation schema with refinements
 */
export const historicalValuationSchema = baseHistoricalValuationSchema
  .refine(
    data => {
      // Validate that periodEnd is after periodStart
      return data.periodEnd > data.periodStart;
    },
    {
      message: "Period end must be after period start",
      path: ["periodEnd"],
    }
  )
  .refine(
    data => {
      // Validate that profitLoss matches realized + unrealized
      const calculatedProfitLoss =
        (data.realizedProfitLoss || 0) + (data.unrealizedProfitLoss || 0);
      return Math.abs(data.profitLoss - calculatedProfitLoss) < 0.01;
    },
    {
      message:
        "Profit loss must equal the sum of realized and unrealized profit loss",
      path: ["profitLoss"],
    }
  );

/**
 * Schema for creating a new historical valuation
 */
export const createHistoricalValuationSchema = baseHistoricalValuationSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine(
    data => {
      // Validate that periodEnd is after periodStart
      return data.periodEnd > data.periodStart;
    },
    {
      message: "Period end must be after period start",
      path: ["periodEnd"],
    }
  )
  .refine(
    data => {
      // Validate that profitLoss matches realized + unrealized
      const calculatedProfitLoss =
        (data.realizedProfitLoss || 0) + (data.unrealizedProfitLoss || 0);
      return Math.abs(data.profitLoss - calculatedProfitLoss) < 0.01;
    },
    {
      message:
        "Profit loss must equal the sum of realized and unrealized profit loss",
      path: ["profitLoss"],
    }
  );

/**
 * Historical valuation search parameters
 */
export const historicalValuationSearchSchema = z.object({
  portfolioId: foreignKeySchema,
  timeFrameUnit: z.nativeEnum(TimeFrameUnit).optional(),
  periodStart: z.date().optional(),
  periodEnd: z.date().optional(),
  isTimeframeBoundary: z.boolean().optional(),
});

export type HistoricalValuation = z.infer<typeof historicalValuationSchema>;
export type CreateHistoricalValuationInput = z.infer<
  typeof createHistoricalValuationSchema
>;
export type HistoricalValuationSearch = z.infer<
  typeof historicalValuationSearchSchema
>;
