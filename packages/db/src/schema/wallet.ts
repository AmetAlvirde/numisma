/**
 * Exchange Account schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema, userIdSchema } from "./common";

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
 * Exchange Account entity schema
 */
export const exchangeAccountSchema = z
  .object({
    // Core fields
    id: idSchema,
    userId: userIdSchema,
    exchange: z.string().min(1), // Exchange name
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
 * Schema for creating a new exchange account
 */
export const createExchangeAccountSchema = exchangeAccountSchema
  .omit({
    id: true,
    isConnected: true,
    lastSynced: true,
    status: true,
    errorMessage: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    exchange: z.string().min(1),
    label: z.string().min(1).max(100),
    apiKey: z.string().min(1),
    apiSecret: z.string().min(1),
  });

/**
 * Schema for updating an exchange account
 */
export const updateExchangeAccountSchema = z
  .object({
    label: z.string().min(1).max(100).optional(),
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().min(1).optional(),
    apiPassphrase: z.string().optional(),
    autoSync: z.boolean().optional(),
    syncFrequency: z.number().int().positive().optional(),
    permissions: apiPermissionsSchema.optional(),
  })
  .strict();

/**
 * Exchange account search parameters
 */
export const exchangeAccountSearchSchema = z.object({
  userId: userIdSchema,
  exchange: z.string().optional(),
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
