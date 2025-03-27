/**
 * Common schema utilities and shared schemas
 */

import { z } from "zod";

/**
 * Schema for DateOrGenesis values
 *
 * Accepts either a Date object, a string date, or the special "genesis" value.
 */
export const dateOrGenesisSchema = z.union([
  z.date(),
  z.string().datetime(),
  z.literal("genesis"),
]);

/**
 * Schema for basic ID fields
 */
export const idSchema = z.string().min(1);

/**
 * Schema for common timestamps
 */
export const timestampSchema = z.object({
  createdAt: z.date().optional(),
  updatedAt: z.date().optional(),
});

/**
 * Schema for pagination parameters
 */
export const paginationSchema = z.object({
  skip: z.number().int().nonnegative().optional(),
  take: z.number().int().positive().optional(),
});

/**
 * Schema for sorting parameters
 */
export const sortingSchema = z.record(z.enum(["asc", "desc"])).optional();

/**
 * Schema for basic query parameters
 */
export const queryParamsSchema = z.object({
  pagination: paginationSchema.optional(),
  sorting: sortingSchema.optional(),
});

/**
 * Basic validation for user IDs
 */
export const userIdSchema = z.string().min(1);

/**
 * Schema for lifecycle status values
 */
export const lifecycleSchema = z.enum([
  "planned",
  "active",
  "closed",
  "partial",
]);

/**
 * Schema for capital tier values (e.g., 'C1', 'C2')
 */
export const capitalTierSchema = z.string().regex(/^C\d+$/);

/**
 * Schema for risk level (1-10 scale)
 */
export const riskLevelSchema = z.number().int().min(1).max(10);

/**
 * Schema for wallet types
 */
export const walletTypeSchema = z.enum(["hot", "cold"]);

/**
 * Schema for order status
 */
export const orderStatusSchema = z.enum([
  "submitted",
  "filled",
  "cancelled",
  "partially_filled",
  "expired",
]);

/**
 * Schema for order types
 */
export const orderTypeSchema = z.enum([
  "trigger",
  "market",
  "limit",
  "trailing_stop",
  "oco",
]);

/**
 * Schema for order purposes
 */
export const orderPurposeSchema = z.enum([
  "entry",
  "exit",
  "rebalance",
  "add",
  "reduce",
]);

/**
 * Schema for size units
 */
export const sizeUnitSchema = z.enum(["percentage", "base", "quote"]);

/**
 * Schema for asset location types
 */
export const assetLocationTypeSchema = z.enum([
  "exchange",
  "dex",
  "cold_storage",
  "defi",
  "staking",
  "lending",
]);

/**
 * Schema for trade side
 */
export const tradeSideSchema = z.enum(["long", "short"]);
