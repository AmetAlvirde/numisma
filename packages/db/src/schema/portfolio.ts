/**
 * Portfolio schema validation
 */

import { z } from "zod";
import {
  idSchema,
  timestampSchema,
  dateOrGenesisSchema,
  foreignKeySchema,
  oneToManySchema,
} from "./common";
import { positionSchema } from "./position";
// import { ValidationResult, ValidationError } from "@numisma/types";

/**
 * Portfolio status enum
 */
export enum PortfolioStatus {
  ACTIVE = "active",
  ARCHIVED = "archived",
  DELETED = "deleted",
}

/**
 * Risk profile enum
 */
export enum RiskProfile {
  CONSERVATIVE = "conservative",
  MODERATE = "moderate",
  AGGRESSIVE = "aggressive",
  CUSTOM = "custom",
}

/**
 * Portfolio valuation schema
 */
const portfolioValuationSchema = z.object({
  timestamp: z.date(),
  totalValue: z.number().positive(),
  profitLoss: z.number(),
  percentageReturn: z.number(),
  assetAllocation: z.record(z.number().nonnegative()).optional(),
  riskMetrics: z
    .object({
      sharpeRatio: z.number().optional(),
      maxDrawdown: z.number().nonnegative().optional(),
      volatility: z.number().nonnegative().optional(),
    })
    .optional(),
});

/**
 * Base portfolio schema without refinements
 */
const basePortfolioSchema = z
  .object({
    // Core fields
    id: idSchema,
    name: z.string().min(1).max(100),
    description: z.string().max(1000).optional(),
    dateCreated: dateOrGenesisSchema,
    status: z.nativeEnum(PortfolioStatus),
    userId: foreignKeySchema,
    tags: z.array(z.string().max(50)).default([]),
    notes: z.string().max(2000).optional(),

    // Display metadata
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    sortOrder: z.number().int().min(0).optional(),
    isPinned: z.boolean().optional().default(false),

    // Risk profile
    riskProfile: z.nativeEnum(RiskProfile).optional(),

    // Relationships
    positions: oneToManySchema(positionSchema).optional(),

    // Optional valuation summary
    latestValuation: portfolioValuationSchema.optional(),

    // Timestamps (from database)
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Portfolio schema with refinements
 */
export const portfolioSchema = basePortfolioSchema.refine(
  data => {
    // If latestValuation is present, validate that profitLoss matches totalValue
    if (data.latestValuation) {
      const { totalValue, profitLoss } = data.latestValuation;
      return Math.abs(totalValue - profitLoss) < 0.01;
    }
    return true;
  },
  {
    message: "Total value must equal profit loss in latest valuation",
    path: ["latestValuation"],
  }
);

/**
 * Schema for creating a new portfolio
 */
export const createPortfolioSchema = basePortfolioSchema.omit({
  id: true,
  positions: true,
  latestValuation: true,
  createdAt: true,
  updatedAt: true,
});

/**
 * Schema for updating a portfolio
 */
export const updatePortfolioSchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(1000).optional(),
    dateCreated: dateOrGenesisSchema.optional(),
    status: z.nativeEnum(PortfolioStatus).optional(),
    tags: z.array(z.string().max(50)).optional(),
    notes: z.string().max(2000).optional(),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional(),
    sortOrder: z.number().int().min(0).optional(),
    isPinned: z.boolean().optional(),
    riskProfile: z.nativeEnum(RiskProfile).optional(),
    latestValuation: portfolioValuationSchema.optional(),
  })
  .refine(
    data => {
      // If latestValuation is present, validate that profitLoss matches totalValue
      if (data.latestValuation) {
        const { totalValue, profitLoss } = data.latestValuation;
        return Math.abs(totalValue - profitLoss) < 0.01;
      }
      return true;
    },
    {
      message: "Total value must equal profit loss in latest valuation",
      path: ["latestValuation"],
    }
  );

/**
 * Portfolio search parameters schema
 */
export const portfolioSearchSchema = z.object({
  userId: foreignKeySchema,
  status: z.nativeEnum(PortfolioStatus).optional(),
  tags: z.array(z.string().max(50)).optional(),
  isPinned: z.boolean().optional(),
  includePositions: z.boolean().optional(),
  riskProfile: z.nativeEnum(RiskProfile).optional(),
});

/**
 * Schema for portfolio position operations
 */
export const portfolioPositionSchema = z.object({
  portfolioId: foreignKeySchema,
  positionId: foreignKeySchema,
  displayOrder: z.number().int().min(0).optional(),
});

export type Portfolio = z.infer<typeof portfolioSchema>;
export type CreatePortfolioInput = z.infer<typeof createPortfolioSchema>;
export type UpdatePortfolioInput = z.infer<typeof updatePortfolioSchema>;
export type PortfolioSearch = z.infer<typeof portfolioSearchSchema>;
export type PortfolioPositionOperation = z.infer<
  typeof portfolioPositionSchema
>;
