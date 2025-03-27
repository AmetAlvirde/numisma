/**
 * Stop Loss Order schema validation
 */

import { z } from "zod";
import {
  idSchema,
  timestampSchema,
  dateOrGenesisSchema,
  orderStatusSchema,
  orderTypeSchema,
  sizeUnitSchema,
} from "./common";

/**
 * Stop Loss Order schema definition
 */
export const stopLossOrderSchema = z
  .object({
    // Core fields
    id: idSchema,
    dateOpen: dateOrGenesisSchema.optional(),
    dateFilled: dateOrGenesisSchema.optional(),
    averagePrice: z.number().optional(),
    totalCost: z.number().optional(),
    status: orderStatusSchema,
    type: orderTypeSchema,
    fee: z.number().optional(),
    feeUnit: z.string().optional(),
    filled: z.number().optional(),
    trigger: z.number().optional(),
    estimatedCost: z.number().optional(),
    isTrailing: z.boolean().optional().default(false),
    trailingDistance: z.number().optional(),
    trailingUnit: z.enum(["percentage", "absolute"]).optional(),
    maxSlippage: z.number().optional(),
    strategy: z.enum(["breakeven", "partial", "full", "tiered"]).optional(),

    // Stop loss specific fields (required)
    unit: sizeUnitSchema,
    size: z.number().positive(),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Schema for creating a new stop loss order
 */
export const createStopLossOrderSchema = stopLossOrderSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    positionDetailsId: idSchema,
  });

/**
 * Schema for updating a stop loss order
 */
export const updateStopLossOrderSchema = createStopLossOrderSchema
  .omit({ positionDetailsId: true })
  .partial();

/**
 * Stop loss order search parameters schema
 */
export const stopLossOrderSearchSchema = z.object({
  positionDetailsId: idSchema.optional(),
  status: orderStatusSchema.optional(),
  type: orderTypeSchema.optional(),
});

export type StopLossOrder = z.infer<typeof stopLossOrderSchema>;
export type CreateStopLossOrderInput = z.infer<
  typeof createStopLossOrderSchema
>;
export type UpdateStopLossOrderInput = z.infer<
  typeof updateStopLossOrderSchema
>;
export type StopLossOrderSearch = z.infer<typeof stopLossOrderSearchSchema>;
