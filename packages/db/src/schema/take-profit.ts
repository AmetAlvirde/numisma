/**
 * Take Profit Order schema validation
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
 * Take Profit Order schema definition
 */
export const takeProfitOrderSchema = z
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
    targetPercentage: z.number().optional(),
    maxSlippage: z.number().optional(),
    tier: z.number().int().optional(),
    moveStopToBreakeven: z.boolean().optional().default(false),

    // Take profit specific fields (required)
    unit: sizeUnitSchema,
    size: z.number().positive(),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Schema for creating a new take profit order
 */
export const createTakeProfitOrderSchema = takeProfitOrderSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    positionDetailsId: idSchema,
  });

/**
 * Schema for updating a take profit order
 */
export const updateTakeProfitOrderSchema = createTakeProfitOrderSchema
  .omit({ positionDetailsId: true })
  .partial();

/**
 * Take profit order search parameters schema
 */
export const takeProfitOrderSearchSchema = z.object({
  positionDetailsId: idSchema.optional(),
  status: orderStatusSchema.optional(),
  type: orderTypeSchema.optional(),
});

export type TakeProfitOrder = z.infer<typeof takeProfitOrderSchema>;
export type CreateTakeProfitOrderInput = z.infer<
  typeof createTakeProfitOrderSchema
>;
export type UpdateTakeProfitOrderInput = z.infer<
  typeof updateTakeProfitOrderSchema
>;
export type TakeProfitOrderSearch = z.infer<typeof takeProfitOrderSearchSchema>;
