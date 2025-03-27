/**
 * Position schema validation
 */

import { z } from 'zod';
import { 
  idSchema, 
  timestampSchema, 
  lifecycleSchema, 
  capitalTierSchema, 
  riskLevelSchema, 
  walletTypeSchema,
  dateOrGenesisSchema,
  userIdSchema
} from './common';
import { orderSchema } from './order';
import { stopLossOrderSchema } from './stop-loss-order';
import { takeProfitOrderSchema } from './take-profit-order';

/**
 * Position side type
 */
export const positionSideSchema = z.enum(['buy', 'sell']);

/**
 * Thesis schema
 */
export const thesisSchema = z.object({
  id: idSchema.optional(),
  reasoning: z.string(),
  invalidation: z.string().optional(),
  fulfillment: z.string().optional(),
  notes: z.string().optional(),
});

/**
 * Journal entry schema
 */
export const journalEntrySchema = z.object({
  id: idSchema.optional(),
  thought: z.string(),
  attachments: z.array(z.string()).default([]),
  timestamp: z.date().default(() => new Date()),
  userId: userIdSchema,
});

/**
 * Lifecycle history entry schema
 */
export const lifecycleHistorySchema = z.object({
  id: idSchema.optional(),
  from: z.string(),
  to: lifecycleSchema,
  timestamp: z.date().default(() => new Date()),
  userId: userIdSchema,
  notes: z.string().optional(),
  relatedOrderIds: z.array(idSchema).default([]),
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
  relatedOrderId: idSchema.optional(),
  notes: z.string().optional(),
});

/**
 * Position details schema
 */
export const positionDetailsSchema = z.object({
  id: idSchema.optional(),
  side: positionSideSchema,
  fractal: z.string(),
  initialInvestment: z.number().nonnegative(),
  currentInvestment: z.number().nonnegative(),
  recoveredAmount: z.number().nonnegative().default(0),
  dateOpened: dateOrGenesisSchema.optional(),
  closedPercentage: z.number().min(0).max(100).default(0),
  
  // Order collections
  orders: z.array(orderSchema).optional(),
  stopLoss: z.array(stopLossOrderSchema).optional(),
  takeProfit: z.array(takeProfitOrderSchema).optional(),
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
export const positionSchema = z.object({
  // Core fields
  id: idSchema,
  name: z.string().min(1).max(100),
  
  // Market and wallet references
  marketId: idSchema,
  walletLocationId: idSchema,
  walletType: walletTypeSchema,
  
  // Position management fields
  lifecycle: lifecycleSchema,
  capitalTier: capitalTierSchema,
  riskLevel: riskLevelSchema,
  strategy: z.string(),
  
  // Additional fields for updates
  userId: userIdSchema.optional(),
  lifecycleNotes: z.string().optional(),
  capitalTierAmount: z.number().optional(),
  capitalTierNotes: z.string().optional(),
  
  // Relationships
  market: z.any().optional(), // Fully typed in repository
  walletLocation: z.any().optional(), // Fully typed in repository
  positionDetails: positionDetailsSchema,
  metrics: positionMetricsSchema.optional(),
  thesis: thesisSchema.optional(),
  journalEntries: z.array(journalEntrySchema).optional(),
  lifecycleHistory: z.array(lifecycleHistorySchema).optional(),
  capitalTierHistory: z.array(capitalTierHistorySchema).optional(),
  
  // Timestamps (from database)
  ...timestampSchema.shape
}).strict();

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
    updatedAt: true 
  })
  .extend({
    // Make userId required for creation
    userId: userIdSchema.optional().default('system'),
  });

/**
 * Schema for updating a position
 */
export const updatePositionSchema = z.object({
  // Core fields that can be updated
  name: z.string().min(1).max(100).optional(),
  marketId: idSchema.optional(),
  walletLocationId: idSchema.optional(),
  walletType: walletTypeSchema.optional(),
  lifecycle: lifecycleSchema.optional(),
  capitalTier: capitalTierSchema.optional(),
  riskLevel: riskLevelSchema.optional(),
  strategy: z.string().optional(),
  
  // Additional fields for history entries
  userId: userIdSchema.optional(),
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
  portfolioId: idSchema.optional(),
  marketId: idSchema.optional(),
  walletType: walletTypeSchema.optional(),
  lifecycle: lifecycleSchema.optional(),
  capitalTier: capitalTierSchema.optional(),
  strategy: z.string().optional(),
});

/**
 * Journal entry creation schema
 */
export const createJournalEntrySchema = z.object({
  positionId: idSchema,
  thought: z.string().min(1),
  attachments: z.array(z.string()).default([]),
  userId: userIdSchema,
});

export type Position = z.infer<typeof positionSchema>;
export type CreatePositionInput = z.infer<typeof createPositionSchema>;
export type UpdatePositionInput = z.infer<typeof updatePositionSchema>;
export type PositionSearch = z.infer<typeof positionSearchSchema>;
export type CreateJournalEntry = z.infer<typeof createJournalEntrySchema>;
