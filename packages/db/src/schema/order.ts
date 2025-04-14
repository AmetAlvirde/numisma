/**
 * Order schema validation
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
  OrderPurpose,
  // SizeUnit,
  // ValidationResult,
  // ValidationError,
} from "@numisma/types";

/**
 * Capital tier impact enum
 */
export enum CapitalTierImpact {
  NONE = "none",
  INCREASE = "increase",
  DECREASE = "decrease",
  NEW = "new",
}

/**
 * Order direction enum
 */
export enum OrderDirection {
  ENTRY = "entry",
  EXIT = "exit",
}

/**
 * Base order schema without refinements
 */
const baseOrderSchema = z
  .object({
    // Core fields
    id: idSchema,
    dateOpen: dateOrGenesisSchema.optional(),
    dateFilled: dateOrGenesisSchema.optional(),
    averagePrice: z.number().positive().optional(),
    totalCost: z.number().nonnegative().optional(),
    status: z.nativeEnum(OrderStatus),
    type: z.nativeEnum(OrderType),
    purpose: z.nativeEnum(OrderPurpose).optional(),
    fee: z.number().nonnegative().optional(),
    feeUnit: z.string().length(3).optional(), // ISO 4217 currency code
    filled: z.number().nonnegative().optional(),
    unit: z.enum(["PERCENTAGE", "FIXED"] as const).optional(),
    capitalTierImpact: z
      .nativeEnum(CapitalTierImpact)
      .optional()
      .default(CapitalTierImpact.NONE),
    notes: z.string().max(1000).optional(),
    direction: z.nativeEnum(OrderDirection),
    exchangeOrderId: z.string().max(100).optional(),
    isAutomated: z.boolean().optional().default(false),
    expiration: z.date().optional(),
    parentOrderId: foreignKeySchema.optional(),
    isHidden: z.boolean().optional().default(false),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Order schema with refinements
 */
export const orderSchema = baseOrderSchema
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
      // If expiration is set, it must be in the future
      if (data.expiration) {
        return data.expiration > new Date();
      }
      return true;
    },
    {
      message: "Expiration date must be in the future",
      path: ["expiration"],
    }
  );

/**
 * Schema for creating a new order
 */
export const createOrderSchema = baseOrderSchema
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
      // If expiration is set, it must be in the future
      if (data.expiration) {
        return data.expiration > new Date();
      }
      return true;
    },
    {
      message: "Expiration date must be in the future",
      path: ["expiration"],
    }
  );

/**
 * Schema for updating an order
 */
export const updateOrderSchema = z
  .object({
    dateOpen: dateOrGenesisSchema.optional(),
    dateFilled: dateOrGenesisSchema.optional(),
    averagePrice: z.number().positive().optional(),
    totalCost: z.number().nonnegative().optional(),
    status: z.nativeEnum(OrderStatus).optional(),
    type: z.nativeEnum(OrderType).optional(),
    purpose: z.nativeEnum(OrderPurpose).optional(),
    fee: z.number().nonnegative().optional(),
    feeUnit: z.string().length(3).optional(),
    filled: z.number().nonnegative().optional(),
    unit: z.enum(["PERCENTAGE", "FIXED"] as const).optional(),
    capitalTierImpact: z.nativeEnum(CapitalTierImpact).optional(),
    notes: z.string().max(1000).optional(),
    direction: z.nativeEnum(OrderDirection).optional(),
    exchangeOrderId: z.string().max(100).optional(),
    isAutomated: z.boolean().optional(),
    expiration: z.date().optional(),
    parentOrderId: foreignKeySchema.optional(),
    isHidden: z.boolean().optional(),
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
      // If expiration is set, it must be in the future
      if (data.expiration) {
        return data.expiration > new Date();
      }
      return true;
    },
    {
      message: "Expiration date must be in the future",
      path: ["expiration"],
    }
  );

/**
 * Order search parameters schema
 */
export const orderSearchSchema = z.object({
  positionDetailsId: foreignKeySchema.optional(),
  status: z.nativeEnum(OrderStatus).optional(),
  type: z.nativeEnum(OrderType).optional(),
  purpose: z.nativeEnum(OrderPurpose).optional(),
});

export type Order = z.infer<typeof orderSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type OrderSearch = z.infer<typeof orderSearchSchema>;
