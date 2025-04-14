/**
 * Stop Loss Order schema validation
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
  // SizeUnit,
  // ValidationResult,
  // ValidationError,
} from "@numisma/types";

/**
 * Stop loss strategy enum
 */
export enum StopLossStrategy {
  BREAKEVEN = "breakeven",
  PARTIAL = "partial",
  FULL = "full",
  TIERED = "tiered",
}

/**
 * Trailing unit enum
 */
export enum TrailingUnit {
  PERCENTAGE = "percentage",
  ABSOLUTE = "absolute",
}

/**
 * Base stop loss order schema without refinements
 */
const baseStopLossOrderSchema = z
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
    isTrailing: z.boolean().optional().default(false),
    trailingDistance: z.number().positive().optional(),
    trailingUnit: z.nativeEnum(TrailingUnit).optional(),
    maxSlippage: z.number().positive().optional(),
    strategy: z.nativeEnum(StopLossStrategy).optional(),

    // Stop loss specific fields (required)
    unit: z.enum(["PERCENTAGE", "FIXED"] as const),
    size: z.number().positive(),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Stop loss order schema with refinements
 */
export const stopLossOrderSchema = baseStopLossOrderSchema
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
  )
  .refine(
    data => {
      // If trailing is enabled, require trailing distance and unit
      if (data.isTrailing) {
        return !!data.trailingDistance && !!data.trailingUnit;
      }
      return true;
    },
    {
      message:
        "Trailing distance and unit are required when trailing is enabled",
      path: ["isTrailing"],
    }
  );

/**
 * Schema for creating a new stop loss order
 */
export const createStopLossOrderSchema = baseStopLossOrderSchema
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
  )
  .refine(
    data => {
      // If trailing is enabled, require trailing distance and unit
      if (data.isTrailing) {
        return !!data.trailingDistance && !!data.trailingUnit;
      }
      return true;
    },
    {
      message:
        "Trailing distance and unit are required when trailing is enabled",
      path: ["isTrailing"],
    }
  );

/**
 * Schema for updating a stop loss order
 */
export const updateStopLossOrderSchema = z
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
    isTrailing: z.boolean().optional(),
    trailingDistance: z.number().positive().optional(),
    trailingUnit: z.nativeEnum(TrailingUnit).optional(),
    maxSlippage: z.number().positive().optional(),
    strategy: z.nativeEnum(StopLossStrategy).optional(),
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
  )
  .refine(
    data => {
      // If trailing is enabled, require trailing distance and unit
      if (data.isTrailing) {
        return !!data.trailingDistance && !!data.trailingUnit;
      }
      return true;
    },
    {
      message:
        "Trailing distance and unit are required when trailing is enabled",
      path: ["isTrailing"],
    }
  );

/**
 * Stop loss order search parameters schema
 */
export const stopLossOrderSearchSchema = z.object({
  positionDetailsId: foreignKeySchema.optional(),
  status: z.nativeEnum(OrderStatus).optional(),
  type: z.nativeEnum(OrderType).optional(),
});

export type StopLossOrder = z.infer<typeof stopLossOrderSchema>;
export type CreateStopLossOrderInput = z.infer<
  typeof createStopLossOrderSchema
>;
export type UpdateStopLossOrderInput = z.infer<
  typeof updateStopLossOrderSchema
>;
export type StopLossOrderSearch = z.infer<typeof stopLossOrderSearchSchema>;
