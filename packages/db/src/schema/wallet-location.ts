/**
 * Wallet Location schema validation
 */

import { z } from "zod";
import {
  idSchema,
  timestampSchema,
  foreignKeySchema,
  assetLocationTypeSchema,
} from "./common";

/**
 * Exchange account type schema
 */
export const exchangeAccountTypeSchema = z.enum([
  "spot",
  "margin",
  "futures",
  "options",
  "staking",
  "savings",
]);

/**
 * Cold storage type schema
 */
export const coldStorageTypeSchema = z.enum([
  "hardware_wallet",
  "paper_wallet",
  "software_wallet",
  "custodial",
  "multisig",
]);

/**
 * Base wallet location schema without refinements
 */
export const baseWalletLocationSchema = z
  .object({
    // Core fields
    id: idSchema,
    name: z.string().min(1).max(100),
    locationType: assetLocationTypeSchema,

    // Exchange-specific fields
    exchangeName: z.string().optional(),
    accountType: exchangeAccountTypeSchema.optional(),
    apiKey: z.string().optional(),
    apiSecret: z.string().optional(),
    apiPassphrase: z.string().optional(),

    // Cold storage fields
    storageType: coldStorageTypeSchema.optional(),
    storageName: z.string().optional(),
    address: z.string().optional(),
    xpubKey: z.string().optional(),

    // User relationship
    userId: foreignKeySchema,

    // Metadata
    isActive: z.boolean().default(true),
    lastSynced: z.date().optional(),
    notes: z.string().optional(),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Wallet Location schema definition with refinements
 */
export const walletLocationSchema = baseWalletLocationSchema.refine(
  data => {
    // If exchange type, require exchange name and account type
    if (data.locationType === "EXCHANGE") {
      return !!data.exchangeName && !!data.accountType;
    }
    // If cold storage, require storage type
    if (data.locationType === "COLD_STORAGE") {
      return !!data.storageType;
    }
    return true;
  },
  {
    message:
      "Exchange locations require exchangeName and accountType, cold storage requires storageType",
    path: ["locationType"],
  }
);

/**
 * Base schema for creating a new wallet location
 */
const baseCreateWalletLocationSchema = baseWalletLocationSchema.omit({
  id: true,
  lastSynced: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Schema for creating a new wallet location
 */
export const createWalletLocationSchema = baseCreateWalletLocationSchema.refine(
  data => {
    // If exchange type, require exchange name and account type
    if (data.locationType === "EXCHANGE") {
      return !!data.exchangeName && !!data.accountType;
    }
    // If cold storage, require storage type
    if (data.locationType === "COLD_STORAGE") {
      return !!data.storageType;
    }
    return true;
  },
  {
    message:
      "Exchange locations require exchangeName and accountType, cold storage requires storageType",
    path: ["locationType"],
  }
);

/**
 * Schema for updating a wallet location
 */
export const updateWalletLocationSchema = z
  .object({
    // Core fields that can be updated
    name: z.string().min(1).max(100).optional(),
    locationType: assetLocationTypeSchema.optional(),

    // Exchange-specific fields
    exchangeName: z.string().optional(),
    accountType: exchangeAccountTypeSchema.optional(),
    apiKey: z.string().optional(),
    apiSecret: z.string().optional(),
    apiPassphrase: z.string().optional(),

    // Cold storage fields
    storageType: coldStorageTypeSchema.optional(),
    storageName: z.string().optional(),
    address: z.string().optional(),
    xpubKey: z.string().optional(),

    // Metadata
    isActive: z.boolean().optional(),
    notes: z.string().optional(),
  })
  .refine(
    data => {
      // If exchange type is being updated, require exchange name and account type
      if (data.locationType === "EXCHANGE") {
        return !!data.exchangeName && !!data.accountType;
      }
      // If cold storage type is being updated, require storage type
      if (data.locationType === "COLD_STORAGE") {
        return !!data.storageType;
      }
      return true;
    },
    {
      message:
        "Exchange locations require exchangeName and accountType, cold storage requires storageType",
      path: ["locationType"],
    }
  );

/**
 * Wallet location search parameters schema
 */
export const walletLocationSearchSchema = z.object({
  userId: foreignKeySchema,
  locationType: assetLocationTypeSchema.optional(),
  exchangeName: z.string().optional(),
  accountType: exchangeAccountTypeSchema.optional(),
  storageType: coldStorageTypeSchema.optional(),
  isActive: z.boolean().optional(),
});

export type WalletLocation = z.infer<typeof walletLocationSchema>;
export type CreateWalletLocationInput = z.infer<
  typeof createWalletLocationSchema
>;
export type UpdateWalletLocationInput = z.infer<
  typeof updateWalletLocationSchema
>;
export type WalletLocationSearch = z.infer<typeof walletLocationSearchSchema>;
