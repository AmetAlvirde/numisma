/**
 * Take Profit Order schema validation
 */

import { z } from "zod";
import {
  idSchema,
  timestampSchema,
  foreignKeySchema,
  dateOrGenesisSchema,
} from "./common";
import {
  OrderStatus,
  OrderType,
  SizeUnit,
  ValidationResult,
  ValidationError,
} from "@numisma/types";

/**
 * Base take profit order schema without refinements
 */
const baseTakeProfitOrderSchema = z
  .object({
    // Core fields
    id: idSchema,
    dateOpen: dateOrGenesisSchema.optional(),
    dateFilled: dateOrGenesisSchema.optional(),
    averagePrice: z.number().positive().optional(),
    totalCost: z.number().nonnegative().optional(),
    status: z.nativeEnum(OrderStatus),
    type: z.nativeEnum(OrderType),
    fee: z.number().nonnegative().optional(),
    feeUnit: z.string().length(3).optional(), // ISO 4217 currency code
    filled: z.number().nonnegative().optional(),
    trigger: z.number().positive().optional(),
    estimatedCost: z.number().nonnegative().optional(),
    targetPercentage: z.number().positive().optional(),
    maxSlippage: z.number().positive().optional(),
    tier: z.number().int().positive().optional(),
    moveStopToBreakeven: z.boolean().optional().default(false),

    // Take profit specific fields (required)
    unit: z.enum(["PERCENTAGE", "FIXED"] as const),
    size: z.number().positive(),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Take profit order schema with refinements
 */
export const takeProfitOrderSchema = baseTakeProfitOrderSchema
  .refine(
    data => {
      // If order is filled, require filled amount and average price
      if (data.status === OrderStatus.FILLED) {
        return !!data.filled && !!data.averagePrice;
      }
      return true;
    },
    {
      message: "Filled orders must have filled amount and average price",
      path: ["status"],
    }
  )
  .refine(
    data => {
      // If order is filled, validate that filled amount matches size
      if (data.status === OrderStatus.FILLED && data.filled) {
        const filled = data.filled as number;
        const size = data.size as number;
        return Math.abs(filled - size) < 0.00000001;
      }
      return true;
    },
    {
      message: "Filled amount must match order size",
      path: ["filled"],
    }
  );

/**
 * Schema for creating a new take profit order
 */
export const createTakeProfitOrderSchema = baseTakeProfitOrderSchema
  .omit({
    id: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    positionDetailsId: foreignKeySchema,
  })
  .refine(
    data => {
      // If order is filled, require filled amount and average price
      if (data.status === OrderStatus.FILLED) {
        return !!data.filled && !!data.averagePrice;
      }
      return true;
    },
    {
      message: "Filled orders must have filled amount and average price",
      path: ["status"],
    }
  )
  .refine(
    data => {
      // If order is filled, validate that filled amount matches size
      if (data.status === OrderStatus.FILLED && data.filled) {
        const filled = data.filled as number;
        const size = data.size as number;
        return Math.abs(filled - size) < 0.00000001;
      }
      return true;
    },
    {
      message: "Filled amount must match order size",
      path: ["filled"],
    }
  );

/**
 * Schema for updating a take profit order
 */
export const updateTakeProfitOrderSchema = z
  .object({
    dateOpen: dateOrGenesisSchema.optional(),
    dateFilled: dateOrGenesisSchema.optional(),
    averagePrice: z.number().positive().optional(),
    totalCost: z.number().nonnegative().optional(),
    status: z.nativeEnum(OrderStatus).optional(),
    type: z.nativeEnum(OrderType).optional(),
    fee: z.number().nonnegative().optional(),
    feeUnit: z.string().length(3).optional(),
    filled: z.number().nonnegative().optional(),
    trigger: z.number().positive().optional(),
    estimatedCost: z.number().nonnegative().optional(),
    targetPercentage: z.number().positive().optional(),
    maxSlippage: z.number().positive().optional(),
    tier: z.number().int().positive().optional(),
    moveStopToBreakeven: z.boolean().optional(),
    unit: z.enum(["PERCENTAGE", "FIXED"] as const).optional(),
    size: z.number().positive().optional(),
  })
  .refine(
    data => {
      // If order is filled, require filled amount and average price
      if (data.status === OrderStatus.FILLED) {
        return !!data.filled && !!data.averagePrice;
      }
      return true;
    },
    {
      message: "Filled orders must have filled amount and average price",
      path: ["status"],
    }
  )
  .refine(
    data => {
      // If order is filled, validate that filled amount matches size
      if (data.status === OrderStatus.FILLED && data.filled && data.size) {
        const filled = data.filled as number;
        const size = data.size as number;
        return Math.abs(filled - size) < 0.00000001;
      }
      return true;
    },
    {
      message: "Filled amount must match order size",
      path: ["filled"],
    }
  );

/**
 * Take profit order search parameters schema
 */
export const takeProfitOrderSearchSchema = z.object({
  positionDetailsId: foreignKeySchema.optional(),
  status: z.nativeEnum(OrderStatus).optional(),
  type: z.nativeEnum(OrderType).optional(),
});

export type TakeProfitOrder = z.infer<typeof takeProfitOrderSchema>;
export type CreateTakeProfitOrderInput = z.infer<
  typeof createTakeProfitOrderSchema
>;
export type UpdateTakeProfitOrderInput = z.infer<
  typeof updateTakeProfitOrderSchema
>;
export type TakeProfitOrderSearch = z.infer<typeof takeProfitOrderSearchSchema>;
