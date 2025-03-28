/**
 * Position schema validation
 */

import { z } from "zod";
import {
  idSchema,
  timestampSchema,
  positionLifecycleSchema,
  capitalTierSchema,
  riskLevelSchema,
  walletTypeSchema,
  dateOrGenesisSchema,
  foreignKeySchema,
  oneToOneSchema,
  oneToManySchema,
  tradeSideSchema,
} from "./common";
import { marketSchema } from "./market";
import { walletLocationSchema } from "./wallet-location";
import { orderSchema } from "./order";
import { stopLossOrderSchema } from "./stop-loss-order";
import { takeProfitOrderSchema } from "./take-profit-order";

/**
 * Thesis schema
 */
export const thesisSchema = z.object({
  id: idSchema.optional(),
  reasoning: z.string(),
  invalidation: z.string().optional(),
  fulfillment: z.string().optional(),
  notes: z.string().optional(),
  technicalAnalysis: z.string().optional(),
  fundamentalAnalysis: z.string().optional(),
  timeHorizon: z.string().optional(),
  riskRewardRatio: z.string().optional(),
});

/**
 * Journal entry schema
 */
export const journalEntrySchema = z.object({
  id: idSchema.optional(),
  thought: z.string(),
  attachments: z.array(z.string()).default([]),
  timestamp: z.date().default(() => new Date()),
  userId: foreignKeySchema,
  tags: z.array(z.string()).default([]),
  sentiment: z.enum(["bullish", "bearish", "neutral"]).optional(),
  isKeyLearning: z.boolean().default(false),
});

/**
 * Lifecycle history entry schema
 */
export const lifecycleHistorySchema = z.object({
  id: idSchema.optional(),
  from: positionLifecycleSchema,
  to: positionLifecycleSchema,
  timestamp: z.date().default(() => new Date()),
  userId: foreignKeySchema,
  notes: z.string().optional(),
  relatedOrderIds: z.array(foreignKeySchema).default([]),
});

/**
 * Capital tier history entry schema
 */
export const capitalTierHistorySchema = z.object({
  id: idSchema.optional(),
  from: capitalTierSchema,
  to: capitalTierSchema,
  timestamp: z.date().default(() => new Date()),
  amountSecured: z.number().nonnegative(),
  relatedOrderId: foreignKeySchema.optional(),
  notes: z.string().optional(),
});

/**
 * Position details schema
 */
export const positionDetailsSchema = z.object({
  id: idSchema.optional(),
  side: tradeSideSchema,
  timeFrame: z.string(),
  initialInvestment: z.number().nonnegative(),
  currentInvestment: z.number().nonnegative(),
  recoveredAmount: z.number().nonnegative().default(0),
  dateOpened: dateOrGenesisSchema.optional(),
  closedPercentage: z.number().min(0).max(100).default(0),

  // Order collections
  orders: oneToManySchema(orderSchema).optional(),
  stopLoss: oneToManySchema(stopLossOrderSchema).optional(),
  takeProfit: oneToManySchema(takeProfitOrderSchema).optional(),

  averageEntryPrice: z.number().optional(),
  averageExitPrice: z.number().optional(),
  totalSize: z.number().optional(),
  totalCost: z.number().optional(),
  realizedProfitLoss: z.number().optional(),
  isLeveraged: z.boolean().default(false),
  leverage: z.number().optional(),
  unrealizedProfitLoss: z.number().optional(),
  currentReturn: z.number().optional(),
  targetPrice: z.number().optional(),
  stopPrice: z.number().optional(),
  riskRewardRatio: z.number().optional(),
});

/**
 * Position metrics schema
 */
export const positionMetricsSchema = z.object({
  id: idSchema.optional(),
  realizedPnL: z.number(),
  unrealizedPnL: z.number(),
  roi: z.number(),
  maxDrawdown: z.number().min(0).max(100),
  duration: z.string(),
});

/**
 * Position schema definition
 */
export const positionSchema = z
  .object({
    // Core fields
    id: idSchema,
    name: z.string().min(1).max(100),

    // Market and wallet references
    marketId: foreignKeySchema,
    walletLocationId: foreignKeySchema,
    walletType: walletTypeSchema,

    // Position management fields
    lifecycle: positionLifecycleSchema,
    capitalTier: capitalTierSchema,
    riskLevel: riskLevelSchema,
    strategy: z.string(),

    // Additional fields for updates
    userId: foreignKeySchema.optional(),
    lifecycleNotes: z.string().optional(),
    capitalTierAmount: z.number().optional(),
    capitalTierNotes: z.string().optional(),

    // Relationships
    market: oneToOneSchema(marketSchema),
    walletLocation: oneToOneSchema(walletLocationSchema),
    positionDetails: positionDetailsSchema,
    metrics: oneToOneSchema(positionMetricsSchema),
    thesis: oneToOneSchema(thesisSchema),
    journalEntries: oneToManySchema(journalEntrySchema),
    lifecycleHistory: oneToManySchema(lifecycleHistorySchema),
    capitalTierHistory: oneToManySchema(capitalTierHistorySchema),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Schema for creating a new position
 */
export const createPositionSchema = positionSchema
  .omit({
    id: true,
    market: true,
    walletLocation: true,
    metrics: true,
    lifecycleHistory: true,
    capitalTierHistory: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    // Make userId required for creation
    userId: foreignKeySchema.optional().default("system"),
  });

/**
 * Schema for updating a position
 */
export const updatePositionSchema = z.object({
  // Core fields that can be updated
  name: z.string().min(1).max(100).optional(),
  marketId: foreignKeySchema.optional(),
  walletLocationId: foreignKeySchema.optional(),
  walletType: walletTypeSchema.optional(),
  lifecycle: positionLifecycleSchema.optional(),
  capitalTier: capitalTierSchema.optional(),
  riskLevel: riskLevelSchema.optional(),
  strategy: z.string().optional(),

  // Additional fields for history entries
  userId: foreignKeySchema.optional(),
  lifecycleNotes: z.string().optional(),
  capitalTierAmount: z.number().optional(),
  capitalTierNotes: z.string().optional(),

  // Relationships that can be updated
  positionDetails: positionDetailsSchema.partial().optional(),
  thesis: thesisSchema.optional(),
});

/**
 * Position search parameters schema
 */
export const positionSearchSchema = z.object({
  portfolioId: foreignKeySchema.optional(),
  marketId: foreignKeySchema.optional(),
  walletType: walletTypeSchema.optional(),
  lifecycle: positionLifecycleSchema.optional(),
  capitalTier: capitalTierSchema.optional(),
  strategy: z.string().optional(),
});

/**
 * Journal entry creation schema
 */
export const createJournalEntrySchema = z.object({
  positionId: foreignKeySchema,
  thought: z.string().min(1),
  attachments: z.array(z.string()).default([]),
  userId: foreignKeySchema,
});

export type Position = z.infer<typeof positionSchema>;
export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
export type PositionSearch = z.infer<typeof positionSearchSchema>;
export type CreateJournalEntry = z.infer<typeof createJournalEntrySchema>;
