/**
 * Market schema validation
 */

import { z } from "zod";
import {
  idSchema,
  timestampSchema,
  foreignKeySchema,
  oneToOneSchema,
} from "./common";
import { assetSchema } from "./asset";

/**
 * Market schema definition
 */
export const marketSchema = z
  .object({
    // Core fields
    id: idSchema,
    baseAssetId: foreignKeySchema,
    quoteAssetId: foreignKeySchema,
    marketSymbol: z.string().min(1).max(50),
    pairNotation: z.string().min(1).max(50),
    exchange: z.string().optional(),
    isTradable: z.boolean().default(true),

    // Relationships (optional based on query inclusion)
    baseAsset: oneToOneSchema(assetSchema),
    quoteAsset: oneToOneSchema(assetSchema),

    // Market data
    marketData: z
      .object({
        lastPrice: z.number().optional(),
        volume24h: z.number().optional(),
        priceChange24h: z.number().optional(),
        priceChangePercent24h: z.number().optional(),
        high24h: z.number().optional(),
        low24h: z.number().optional(),
        lastUpdated: z.date().optional(),
      })
      .optional(),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Schema for creating a new market
 */
export const createMarketSchema = marketSchema
  .omit({
    id: true,
    baseAsset: true,
    quoteAsset: true,
    marketData: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    baseAssetId: foreignKeySchema,
    quoteAssetId: foreignKeySchema,
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
  baseAssetId: foreignKeySchema.optional(),
  quoteAssetId: foreignKeySchema.optional(),
  exchange: z.string().optional(),
  isTradable: z.boolean().optional(),
  includeAssets: z.boolean().optional(),
});

export type Market = z.infer<typeof marketSchema>;
export type CreateMarketInput = z.infer<typeof createMarketSchema>;
export type UpdateMarketInput = z.infer<typeof updateMarketSchema>;
export type MarketSearch = z.infer<typeof marketSearchSchema>;
