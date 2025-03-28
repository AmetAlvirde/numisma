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
import { ValidationResult, ValidationError } from "@numisma/types";

/**
 * Exchange name enum
 */
export enum ExchangeName {
  BINANCE = "binance",
  COINBASE = "coinbase",
  KRAKEN = "kraken",
  KUCOIN = "kucoin",
  GEMINI = "gemini",
  BITFINEX = "bitfinex",
  HUOBI = "huobi",
  OKX = "okx",
  BYBIT = "bybit",
  FTX = "ftx",
}

/**
 * Market data schema
 */
const marketDataSchema = z.object({
  lastPrice: z.number().positive().optional(),
  volume24h: z.number().nonnegative().optional(),
  priceChange24h: z.number().optional(),
  priceChangePercent24h: z.number().optional(),
  high24h: z.number().positive().optional(),
  low24h: z.number().positive().optional(),
  lastUpdated: z.date().optional(),
});

/**
 * Base market schema without refinements
 */
const baseMarketSchema = z
  .object({
    // Core fields
    id: idSchema,
    baseAssetId: foreignKeySchema,
    quoteAssetId: foreignKeySchema,
    marketSymbol: z.string().min(1).max(50),
    pairNotation: z.string().min(1).max(50),
    exchange: z.nativeEnum(ExchangeName).optional(),
    isTradable: z.boolean().default(true),

    // Relationships (optional based on query inclusion)
    baseAsset: oneToOneSchema(assetSchema),
    quoteAsset: oneToOneSchema(assetSchema),

    // Market data
    marketData: marketDataSchema.optional(),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Market schema with refinements
 */
export const marketSchema = baseMarketSchema
  .refine(
    data => {
      // Validate that baseAssetId and quoteAssetId are different
      return data.baseAssetId !== data.quoteAssetId;
    },
    {
      message: "Base and quote assets must be different",
      path: ["baseAssetId"],
    }
  )
  .refine(
    data => {
      // If marketData is present, validate price relationships
      if (data.marketData) {
        const { high24h, low24h, lastPrice } = data.marketData;
        if (high24h && low24h) {
          return high24h >= low24h;
        }
        if (lastPrice && high24h) {
          return high24h >= lastPrice;
        }
        if (lastPrice && low24h) {
          return lastPrice >= low24h;
        }
      }
      return true;
    },
    {
      message: "Invalid price relationships in market data",
      path: ["marketData"],
    }
  );

/**
 * Schema for creating a new market
 */
export const createMarketSchema = baseMarketSchema
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
  })
  .refine(
    data => {
      // Validate that baseAssetId and quoteAssetId are different
      return data.baseAssetId !== data.quoteAssetId;
    },
    {
      message: "Base and quote assets must be different",
      path: ["baseAssetId"],
    }
  );

/**
 * Schema for updating a market
 */
export const updateMarketSchema = z
  .object({
    marketSymbol: z.string().min(1).max(50).optional(),
    pairNotation: z.string().min(1).max(50).optional(),
    exchange: z.nativeEnum(ExchangeName).optional(),
    isTradable: z.boolean().optional(),
    baseAssetId: foreignKeySchema.optional(),
    quoteAssetId: foreignKeySchema.optional(),
  })
  .refine(
    data => {
      // If both IDs are provided, validate they are different
      if (data.baseAssetId && data.quoteAssetId) {
        return data.baseAssetId !== data.quoteAssetId;
      }
      return true;
    },
    {
      message: "Base and quote assets must be different",
      path: ["baseAssetId"],
    }
  );

/**
 * Market search parameters schema
 */
export const marketSearchSchema = z.object({
  marketSymbol: z.string().optional(),
  baseAssetId: foreignKeySchema.optional(),
  quoteAssetId: foreignKeySchema.optional(),
  exchange: z.nativeEnum(ExchangeName).optional(),
  isTradable: z.boolean().optional(),
  includeAssets: z.boolean().optional(),
});

export type Market = z.infer<typeof marketSchema>;
export type CreateMarketInput = z.infer<typeof createMarketSchema>;
export type UpdateMarketInput = z.infer<typeof updateMarketSchema>;
export type MarketSearch = z.infer<typeof marketSearchSchema>;
