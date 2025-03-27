/**
 * Asset schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema } from "./common";

/**
 * Supported asset types
 */
export const assetTypesSchema = z.enum([
  "crypto",
  "stock",
  "forex",
  "commodity",
  "fund",
  "index",
  "bond",
  "option",
  "future",
  "stablecoin",
]);

/**
 * Asset schema definition
 */
export const assetSchema = z
  .object({
    // Core fields
    id: idSchema,
    name: z.string().min(1).max(100),
    ticker: z.string().min(1).max(20),
    assetType: assetTypesSchema,
    description: z.string().optional(),
    network: z.string().optional(),
    contractAddress: z.string().optional(),
    iconUrl: z.string().optional(),
    category: z.string().optional(),
    marketData: z.any().optional(), // Structured market data

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Schema for creating a new asset
 */
export const createAssetSchema = assetSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Schema for updating an asset
 */
export const updateAssetSchema = createAssetSchema.partial();

/**
 * Asset search parameters schema
 */
export const assetSearchSchema = z.object({
  ticker: z.string().optional(),
  assetType: assetTypesSchema.optional(),
  query: z.string().optional(),
});

export type Asset = z.infer<typeof assetSchema>;
export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type AssetSearch = z.infer<typeof assetSearchSchema>;
