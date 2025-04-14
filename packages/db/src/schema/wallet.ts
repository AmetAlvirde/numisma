/**
 * Wallet schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema, foreignKeySchema } from "./common";
import {
  AssetLocationType,
  // ValidationResult,
  // ValidationError,
} from "@numisma/types";

/**
 * Wallet type classification
 */
export enum WalletType {
  HOT = "hot",
  COLD = "cold",
}

/**
 * Wallet status enum
 */
export const walletStatusSchema = z.enum([
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
 * Base wallet schema without refinements
 */
const baseWalletSchema = z
  .object({
    // Core fields
    id: idSchema,
    userId: foreignKeySchema,
    name: z.string().min(1).max(100),
    type: z.nativeEnum(WalletType),
    locationType: z.nativeEnum(AssetLocationType),

    // Connection details
    isConnected: z.boolean().default(false),
    lastSynced: z.date().optional(),
    status: walletStatusSchema,
    errorMessage: z.string().optional(),

    // API credentials (encrypted in the database)
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().min(1).optional(),
    apiPassphrase: z.string().optional(),

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
 * Wallet schema with refinements
 */
export const walletSchema = baseWalletSchema.refine(
  data => {
    // If location type is EXCHANGE, require API credentials
    if (data.locationType === AssetLocationType.EXCHANGE) {
      return !!data.apiKey && !!data.apiSecret;
    }
    return true;
  },
  {
    message: "Exchange wallets require API credentials",
    path: ["locationType"],
  }
);

/**
 * Schema for creating a new wallet
 */
export const createWalletSchema = baseWalletSchema
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
      // If location type is EXCHANGE, require API credentials
      if (data.locationType === AssetLocationType.EXCHANGE) {
        return !!data.apiKey && !!data.apiSecret;
      }
      return true;
    },
    {
      message: "Exchange wallets require API credentials",
      path: ["locationType"],
    }
  );

/**
 * Schema for updating a wallet
 */
export const updateWalletSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    type: z.nativeEnum(WalletType).optional(),
    locationType: z.nativeEnum(AssetLocationType).optional(),
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().min(1).optional(),
    apiPassphrase: z.string().optional(),
    autoSync: z.boolean().optional(),
    syncFrequency: z.number().int().positive().optional(),
    permissions: apiPermissionsSchema.optional(),
  })
  .refine(
    data => {
      // If location type is EXCHANGE, require API credentials
      if (data.locationType === AssetLocationType.EXCHANGE) {
        return !!data.apiKey && !!data.apiSecret;
      }
      return true;
    },
    {
      message: "Exchange wallets require API credentials",
      path: ["locationType"],
    }
  );

/**
 * Wallet search parameters
 */
export const walletSearchSchema = z.object({
  userId: foreignKeySchema,
  type: z.nativeEnum(WalletType).optional(),
  locationType: z.nativeEnum(AssetLocationType).optional(),
  status: walletStatusSchema.optional(),
  isConnected: z.boolean().optional(),
});

export type Wallet = z.infer<typeof walletSchema>;
export type CreateWalletInput = z.infer<typeof createWalletSchema>;
export type UpdateWalletInput = z.infer<typeof updateWalletSchema>;
export type WalletSearch = z.infer<typeof walletSearchSchema>;
