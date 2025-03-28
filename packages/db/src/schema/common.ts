/**
 * Common schema utilities and shared schemas
 */

import { z } from "zod";
import {
  PositionLifecycle,
  CapitalTier,
  AssetLocationType,
  OrderStatus,
  OrderType,
  OrderPurpose,
  AssetType,
  CascadeBehavior,
} from "@numisma/types";

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
  page: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  sortBy: z.string().optional(),
  sortOrder: z.enum(["asc", "desc"]).optional(),
});

/**
 * Schema for filter parameters
 */
export const filterSchema = z.object({
  field: z.string(),
  operator: z.enum([
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "startsWith",
    "endsWith",
    "in",
    "nin",
  ]),
  value: z.any(),
});

/**
 * Schema for query parameters
 */
export const queryParamsSchema = z.object({
  filters: z.array(filterSchema).optional(),
  pagination: paginationSchema.optional(),
  includes: z.array(z.string()).optional(),
});

/**
 * Schema for operation results
 */
export const operationResultSchema = z.object({
  success: z.boolean(),
  data: z.any().optional(),
  error: z.string().optional(),
  metadata: z.record(z.any()).optional(),
});

/**
 * Schema for batch operation results
 */
export const batchOperationResultSchema = z.object({
  success: z.boolean(),
  results: z.array(operationResultSchema),
  total: z.number(),
  successful: z.number(),
  failed: z.number(),
});

/**
 * Schema for relationship options
 */
export const relationOptionsSchema = z.object({
  onDelete: z.nativeEnum(CascadeBehavior).optional(),
  onUpdate: z.nativeEnum(CascadeBehavior).optional(),
});

/**
 * Schema for foreign keys
 */
export const foreignKeySchema = z.string().min(1);

/**
 * Schema for one-to-one relationships
 */
export const oneToOneSchema = <T extends z.ZodType>(schema: T) =>
  z.union([schema, z.null()]);

/**
 * Schema for one-to-many relationships
 */
export const oneToManySchema = <T extends z.ZodType>(schema: T) =>
  z.array(schema);

/**
 * Schema for many-to-many relationships
 */
export const manyToManySchema = <T extends z.ZodType>(schema: T) =>
  z.object({
    items: z.array(schema),
    add: z.function().args(schema).returns(z.void()),
    remove: z.function().args(schema).returns(z.void()),
  });

/**
 * Schema for position lifecycle
 */
export const positionLifecycleSchema = z.nativeEnum(PositionLifecycle);

/**
 * Schema for capital tier
 */
export const capitalTierSchema = z.nativeEnum(CapitalTier);

/**
 * Schema for asset location type
 */
export const assetLocationTypeSchema = z.nativeEnum(AssetLocationType);

/**
 * Schema for order status
 */
export const orderStatusSchema = z.nativeEnum(OrderStatus);

/**
 * Schema for order type
 */
export const orderTypeSchema = z.nativeEnum(OrderType);

/**
 * Schema for order purpose
 */
export const orderPurposeSchema = z.nativeEnum(OrderPurpose);

/**
 * Schema for asset type
 */
export const assetTypeSchema = z.nativeEnum(AssetType);

/**
 * Schema for risk level (1-10 scale)
 */
export const riskLevelSchema = z.number().int().min(1).max(10);

/**
 * Schema for wallet types
 */
export const walletTypeSchema = z.enum(["hot", "cold"]);

/**
 * Schema for trade side
 */
export const tradeSideSchema = z.enum(["long", "short"]);

/**
 * Schema for size units
 */
export const sizeUnitSchema = z.enum(["percentage", "base", "quote"]);

// Type exports
export type DateOrGenesis = z.infer<typeof dateOrGenesisSchema>;
export type Id = z.infer<typeof idSchema>;
export type Timestamp = z.infer<typeof timestampSchema>;
export type Pagination = z.infer<typeof paginationSchema>;
export type Filter = z.infer<typeof filterSchema>;
export type QueryParams = z.infer<typeof queryParamsSchema>;
export type OperationResult<T = any> = z.infer<typeof operationResultSchema> & {
  data?: T;
};
export type BatchOperationResult<T = any> = z.infer<
  typeof batchOperationResultSchema
> & { results: Array<OperationResult<T>> };
export type RelationOptions = z.infer<typeof relationOptionsSchema>;
export type ForeignKey<T> = string & {
  readonly __brand: unique symbol;
  readonly __type: T;
};

// Relationship type exports with proper type constraints
export type OneToOne<T> = T | null;
export type OneToMany<T> = T[];
export type ManyToMany<T> = {
  items: T[];
  add(item: T): void;
  remove(item: T): void;
};
