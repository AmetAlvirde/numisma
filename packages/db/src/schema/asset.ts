/**
 * Asset schema validation
 */

import { z } from "zod";
import {
  idSchema,
  timestampSchema,
  //  foreignKeySchema
} from "./common";
import {
  AssetType,
  AssetLocationType,
  // ValidationResult,
  // ValidationError,
} from "@numisma/types";

/**
 * Asset market data schema
 */
const assetMarketDataSchema = z.object({
  currentPrice: z.number().positive().optional(),
  priceChangePercentage24h: z.number().optional(),
  marketCap: z.number().nonnegative().optional(),
  volume24h: z.number().nonnegative().optional(),
  lastUpdated: z.date().optional(),
});

/**
 * Base asset schema without refinements
 */
const baseAssetSchema = z
  .object({
    // Core fields
    id: idSchema,
    name: z.string().min(1).max(100),
    ticker: z.string().min(1).max(20),
    assetType: z.nativeEnum(AssetType),
    description: z.string().max(1000).optional(),
    network: z.string().max(50).optional(),
    contractAddress: z.string().max(42).optional(), // Ethereum address length
    iconUrl: z.string().url().optional(),
    category: z.string().max(50).optional(),
    locationType: z.nativeEnum(AssetLocationType).optional(),
    wallet: z.string().max(100).optional(),
    marketData: assetMarketDataSchema.optional(),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Asset schema with refinements
 */
export const assetSchema = baseAssetSchema
  .refine(
    data => {
      // If asset type is CRYPTO or TOKEN, require network and contract address
      if (
        data.assetType === AssetType.CRYPTO ||
        data.assetType === AssetType.TOKEN
      ) {
        return !!data.network && !!data.contractAddress;
      }
      return true;
    },
    {
      message:
        "Network and contract address are required for crypto and token assets",
      path: ["assetType"],
    }
  )
  .refine(
    data => {
      // If location type is provided, wallet must be provided
      if (data.locationType) {
        return !!data.wallet;
      }
      return true;
    },
    {
      message: "Wallet is required when location type is specified",
      path: ["wallet"],
    }
  );

/**
 * Schema for creating a new asset
 */
export const createAssetSchema = baseAssetSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine(
    data => {
      // If asset type is CRYPTO or TOKEN, require network and contract address
      if (
        data.assetType === AssetType.CRYPTO ||
        data.assetType === AssetType.TOKEN
      ) {
        return !!data.network && !!data.contractAddress;
      }
      return true;
    },
    {
      message:
        "Network and contract address are required for crypto and token assets",
      path: ["assetType"],
    }
  )
  .refine(
    data => {
      // If location type is provided, wallet must be provided
      if (data.locationType) {
        return !!data.wallet;
      }
      return true;
    },
    {
      message: "Wallet is required when location type is specified",
      path: ["wallet"],
    }
  );

/**
 * Schema for updating an asset
 */
export const updateAssetSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    ticker: z.string().min(1).max(20).optional(),
    assetType: z.nativeEnum(AssetType).optional(),
    description: z.string().max(1000).optional(),
    network: z.string().max(50).optional(),
    contractAddress: z.string().max(42).optional(),
    iconUrl: z.string().url().optional(),
    category: z.string().max(50).optional(),
    locationType: z.nativeEnum(AssetLocationType).optional(),
    wallet: z.string().max(100).optional(),
    marketData: assetMarketDataSchema.optional(),
  })
  .refine(
    data => {
      // If asset type is CRYPTO or TOKEN, require network and contract address
      if (
        data.assetType === AssetType.CRYPTO ||
        data.assetType === AssetType.TOKEN
      ) {
        return !!data.network && !!data.contractAddress;
      }
      return true;
    },
    {
      message:
        "Network and contract address are required for crypto and token assets",
      path: ["assetType"],
    }
  )
  .refine(
    data => {
      // If location type is provided, wallet must be provided
      if (data.locationType) {
        return !!data.wallet;
      }
      return true;
    },
    {
      message: "Wallet is required when location type is specified",
      path: ["wallet"],
    }
  );

/**
 * Asset search parameters schema
 */
export const assetSearchSchema = z.object({
  ticker: z.string().optional(),
  assetType: z.nativeEnum(AssetType).optional(),
  query: z.string().optional(),
  locationType: z.nativeEnum(AssetLocationType).optional(),
});

export type Asset = z.infer<typeof assetSchema>;
export type CreateAssetInput = z.infer<typeof createAssetSchema>;
export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;
export type AssetSearch = z.infer<typeof assetSearchSchema>;
