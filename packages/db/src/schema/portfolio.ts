/**
 * Portfolio schema validation
 */

import { z } from 'zod';
import { idSchema, timestampSchema, dateOrGenesisSchema, userIdSchema } from './common';

/**
 * Portfolio status type
 */
export const portfolioStatusSchema = z.enum(['active', 'archived']);

/**
 * Portfolio schema definition
 */
export const portfolioSchema = z.object({
  // Core fields
  id: idSchema,
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  dateCreated: dateOrGenesisSchema,
  status: portfolioStatusSchema,
  userId: userIdSchema,
  tags: z.array(z.string()).default([]),
  notes: z.string().optional(),
  
  // Display metadata
  color: z.string().optional(),
  sortOrder: z.number().int().optional(),
  isPinned: z.boolean().optional().default(false),
  
  // Relationships
  positionIds: z.array(idSchema).optional(),
  
  // Optional valuation summary
  latestValuation: z.object({
    timestamp: z.date(),
    totalValue: z.number(),
    profitLoss: z.number(),
    percentageReturn: z.number()
  }).optional(),
  
  // Timestamps (from database)
  ...timestampSchema.shape
}).strict();

/**
 * Schema for creating a new portfolio
 */
export const createPortfolioSchema = portfolioSchema
  .omit({ 
    id: true, 
    positionIds: true, 
    latestValuation: true,
    createdAt: true, 
    updatedAt: true 
  });

/**
 * Schema for updating a portfolio
 */
export const updatePortfolioSchema = createPortfolioSchema.partial();

/**
 * Portfolio search parameters schema
 */
export const portfolioSearchSchema = z.object({
  userId: userIdSchema,
  status: portfolioStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  isPinned: z.boolean().optional(),
});

/**
 * Schema for portfolio position operations
 */
export const portfolioPositionSchema = z.object({
  portfolioId: idSchema,
  positionId: idSchema,
  displayOrder: z.number().int().optional()
});

export type Portfolio = z.infer<typeof portfolioSchema>;
export type CreatePortfolioInput = z.infer<typeof createPortfolioSchema>;
export type UpdatePortfolioInput = z.infer<typeof updatePortfolioSchema>;
export type PortfolioSearch = z.infer<typeof portfolioSearchSchema>;
export type PortfolioPositionOperation = z.infer<typeof portfolioPositionSchema>;
