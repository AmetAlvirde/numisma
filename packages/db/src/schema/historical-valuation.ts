/**
 * Historical Valuation schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema } from "./common";

export const historicalValuationSchema = z.object({
  id: idSchema,
  portfolioId: idSchema,
  timestamp: z.date(),

  // Temporal metadata
  year: z.number().int(),
  month: z.number().int().optional(),
  day: z.number().int().optional(),
  periodKey: z.string(),
  periodName: z.string(),
  timeFrameUnit: z.string(),
  periodStart: z.date(),
  periodEnd: z.date(),
  isTimeframeBoundary: z.boolean(),

  // Analytics fields
  totalValue: z.number(),
  valueCurrency: z.string(),
  initialInvestment: z.number(),
  profitLoss: z.number(),
  percentageReturn: z.number(),
  realizedProfitLoss: z.number().optional(),
  unrealizedProfitLoss: z.number().optional(),

  // Risk metrics
  volatility: z.number().optional(),
  maxDrawdown: z.number().optional(),
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
  positionCount: z.number().int().optional(),

  // JSON data fields
  positionValuations: z.any(), // Complex structure stored as JSON
  returnMetrics: z.any().optional(),
  riskMetrics: z.any().optional(),
  assetAllocation: z.any().optional(),

  // Market context
  btcPrice: z.number().optional(),
  ethPrice: z.number().optional(),
  totalMarketCap: z.number().optional(),
  fearGreedIndex: z.number().int().optional(),

  // Metadata
  isRetroactive: z.boolean().default(false),
  notes: z.string().optional(),

  // Standard timestamps
  ...timestampSchema.shape,
});
