/**
 * Exchange Account schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema, foreignKeySchema } from "./common";
// import {
//   AssetLocationType,
//   ValidationResult,
//   ValidationError,
// } from "@numisma/types";

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
 * Exchange account status enum
 */
export const exchangeAccountStatusSchema = z.enum([
  "active",
  "error",
  "disconnected",
  "pending",
]);

/**
 * API permissions schema
 */
export const apiPermissionsSchema = z.object({
  read: z.boolean().default(true),
  trade: z.boolean().default(false),
  withdraw: z.boolean().default(false),
});

/**
 * Base exchange account schema without refinements
 */
const baseExchangeAccountSchema = z
  .object({
    // Core fields
    id: idSchema,
    userId: foreignKeySchema,
    exchange: z.nativeEnum(ExchangeName),
    label: z.string().min(1).max(100),

    // API credentials (encrypted in the database)
    apiKey: z.string().min(1),
    apiSecret: z.string().min(1),
    apiPassphrase: z.string().optional(), // For exchanges that require it (e.g., Coinbase Pro)

    // Connection state
    isConnected: z.boolean().default(false),
    lastSynced: z.date().optional(),
    status: exchangeAccountStatusSchema,
    errorMessage: z.string().optional(),

    // Permissions
    permissions: apiPermissionsSchema.optional(),

    // Sync settings
    autoSync: z.boolean().default(true),
    syncFrequency: z.number().int().positive().optional(), // In minutes

    // Timestamps
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Exchange account schema with refinements
 */
export const exchangeAccountSchema = baseExchangeAccountSchema.refine(
  data => {
    // Validate that exchange-specific requirements are met
    switch (data.exchange) {
      case ExchangeName.COINBASE:
        return !!data.apiPassphrase;
      default:
        return true;
    }
  },
  {
    message: "Exchange-specific requirements not met",
    path: ["exchange"],
  }
);

/**
 * Schema for creating a new exchange account
 */
export const createExchangeAccountSchema = baseExchangeAccountSchema
  .omit({
    id: true,
    isConnected: true,
    lastSynced: true,
    status: true,
    errorMessage: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine(
    data => {
      // Validate that exchange-specific requirements are met
      switch (data.exchange) {
        case ExchangeName.COINBASE:
          return !!data.apiPassphrase;
        default:
          return true;
      }
    },
    {
      message: "Exchange-specific requirements not met",
      path: ["exchange"],
    }
  );

/**
 * Schema for updating an exchange account
 */
export const updateExchangeAccountSchema = z
  .object({
    exchange: z.nativeEnum(ExchangeName).optional(),
    label: z.string().min(1).max(100).optional(),
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().min(1).optional(),
    apiPassphrase: z.string().optional(),
    autoSync: z.boolean().optional(),
    syncFrequency: z.number().int().positive().optional(),
    permissions: apiPermissionsSchema.optional(),
  })
  .refine(
    data => {
      // If updating Coinbase account, ensure apiPassphrase is provided
      if (data.exchange === ExchangeName.COINBASE) {
        return !!data.apiPassphrase;
      }
      return true;
    },
    {
      message: "Exchange-specific requirements not met",
      path: ["exchange"],
    }
  );

/**
 * Exchange account search parameters
 */
export const exchangeAccountSearchSchema = z.object({
  userId: foreignKeySchema,
  exchange: z.nativeEnum(ExchangeName).optional(),
  status: exchangeAccountStatusSchema.optional(),
  isConnected: z.boolean().optional(),
});

export type ExchangeAccount = z.infer<typeof exchangeAccountSchema>;
export type CreateExchangeAccountInput = z.infer<
  typeof createExchangeAccountSchema
>;
export type UpdateExchangeAccountInput = z.infer<
  typeof updateExchangeAccountSchema
>;
export type ExchangeAccountSearch = z.infer<typeof exchangeAccountSearchSchema>;
