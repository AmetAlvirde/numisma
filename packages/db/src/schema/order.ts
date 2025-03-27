/**
 * Order schema validation
 */

import { z } from "zod";
import {
  idSchema,
  timestampSchema,
  dateOrGenesisSchema,
  orderStatusSchema,
  orderTypeSchema,
  orderPurposeSchema,
  sizeUnitSchema,
} from "./common";

/**
 * Capital tier impact types
 */
export const capitalTierImpactSchema = z.enum([
  "none",
  "increase",
  "decrease",
  "new",
]);

/**
 * Order schema definition
 */
export const orderSchema = z
  .object({
    // Core fields
    id: idSchema,
    dateOpen: dateOrGenesisSchema.optional(),
    dateFilled: dateOrGenesisSchema.optional(),
    averagePrice: z.number().optional(),
    totalCost: z.number().optional(),
    status: orderStatusSchema,
    type: orderTypeSchema,
    purpose: orderPurposeSchema.optional(),
    fee: z.number().optional(),
    feeUnit: z.string().optional(),
    filled: z.number().optional(),
    unit: sizeUnitSchema.optional(),
    capitalTierImpact: capitalTierImpactSchema.optional().default("none"),
    notes: z.string().optional(),
    direction: z.enum(["entry", "exit"]),
    exchangeOrderId: z.string().optional(),
    isAutomated: z.boolean().optional().default(false),
    expiration: z.date().optional(),
    parentOrderId: idSchema.optional(),
    isHidden: z.boolean().optional().default(false),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Schema for creating a new order
 */
export const createOrderSchema = orderSchema
  .omit({ id: true, createdAt: true, updatedAt: true })
  .extend({
    positionDetailsId: idSchema,
  });

/**
 * Schema for updating an order
 */
export const updateOrderSchema = createOrderSchema
  .omit({ positionDetailsId: true })
  .partial();

/**
 * Order search parameters schema
 */
export const orderSearchSchema = z.object({
  positionDetailsId: idSchema.optional(),
  status: orderStatusSchema.optional(),
  type: orderTypeSchema.optional(),
  purpose: orderPurposeSchema.optional(),
});

export type Order = z.infer<typeof orderSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type OrderSearch = z.infer<typeof orderSearchSchema>;
