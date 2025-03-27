/**
 * Market schema validation
 */

import { z } from 'zod';
import { idSchema, timestampSchema } from './common';
import { assetSchema } from './asset';

/**
 * Market schema definition
 */
export const marketSchema = z.object({
  // Core fields
  id: idSchema,
  baseAssetId: idSchema,
  quoteAssetId: idSchema,
  marketSymbol: z.string().min(1).max(50),
  pairNotation: z.string().min(1).max(50),
  exchange: z.string().optional(),
  isTradable: z.boolean().default(true),
  
  // Relationships (optional based on query inclusion)
  baseAsset: assetSchema.optional(),
  quoteAsset: assetSchema.optional(),
  
  // Timestamps (from database)
  ...timestampSchema.shape
}).strict();

/**
 * Schema for creating a new market
 */
export const createMarketSchema = marketSchema
  .omit({ 
    id: true, 
    baseAsset: true, 
    quoteAsset: true, 
    createdAt: true, 
    updatedAt: true 
  })
  .extend({
    baseAssetId: idSchema,
    quoteAssetId: idSchema
  });

/**
 * Schema for updating a market
 */
export const updateMarketSchema = createMarketSchema.partial();

/**
 * Market search parameters schema
 */
export const marketSearchSchema = z.object({
  marketSymbol: z.string().optional(),
  baseAssetId: idSchema.optional(),
  quoteAssetId: idSchema.optional(),
  exchange: z.string().optional(),
  isTradable: z.boolean().optional(),
});

export type Market = z.infer<typeof marketSchema>;
export type CreateMarketInput = z.infer<typeof createMarketSchema>;
export type UpdateMarketInput = z.infer<typeof updateMarketSchema>;
export type MarketSearch = z.infer<typeof marketSearchSchema>;
