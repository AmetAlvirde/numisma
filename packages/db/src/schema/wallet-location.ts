/**
 * Wallet Location schema validation
 */

import { z } from 'zod';
import { idSchema, timestampSchema, userIdSchema } from './common';

/**
 * Wallet location types
 */
export const locationTypeSchema = z.enum(['exchange', 'coldStorage']);

/**
 * Wallet Location schema definition
 */
export const walletLocationSchema = z.object({
  // Core fields
  id: idSchema,
  name: z.string().min(1).max(100),
  locationType: locationTypeSchema,
  
  // Exchange-specific fields
  exchangeName: z.string().optional(),
  accountType: z.string().optional(),
  
  // Cold storage fields
  storageType: z.string().optional(),
  storageName: z.string().optional(),
  
  // User relationship
  userId: userIdSchema,
  
  // Timestamps (from database)
  ...timestampSchema.shape
}).strict()
.refine(
  (data) => {
    // If exchange type, require exchange name
    if (data.locationType === 'exchange') {
      return !!data.exchangeName;
    }
    // If cold storage, require storage type
    if (data.locationType === 'coldStorage') {
      return !!data.storageType;
    }
    return true;
  },
  {
    message: "Exchange locations require exchangeName, cold storage requires storageType",
    path: ['locationType'],
  }
);

/**
 * Schema for creating a new wallet location
 */
export const createWalletLocationSchema = walletLocationSchema
  .omit({ id: true, createdAt: true, updatedAt: true });

/**
 * Schema for updating a wallet location
 */
export const updateWalletLocationSchema = createWalletLocationSchema.partial();

/**
 * Wallet location search parameters schema
 */
export const walletLocationSearchSchema = z.object({
  userId: userIdSchema,
  locationType: locationTypeSchema.optional(),
  exchangeName: z.string().optional(),
});

export type WalletLocation = z.infer<typeof walletLocationSchema>;
export type CreateWalletLocationInput = z.infer<typeof createWalletLocationSchema>;
export type UpdateWalletLocationInput = z.infer<typeof updateWalletLocationSchema>;
export type WalletLocationSearch = z.infer<typeof walletLocationSearchSchema>;
