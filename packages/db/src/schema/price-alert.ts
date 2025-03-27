/**
 * Price Alert schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema, userIdSchema } from "./common";

/**
 * Alert direction enum
 */
export const alertDirectionSchema = z.enum(["above", "below"]);

/**
 * Notification channels
 */
export const notificationChannelSchema = z.enum(["email", "push", "sms"]);

/**
 * Price Alert entity schema
 */
export const priceAlertSchema = z
  .object({
    // Core fields
    id: idSchema,
    userId: userIdSchema,
    asset: z.string().min(1), // Asset ticker
    targetPrice: z.number(),
    direction: alertDirectionSchema,
    isPercentageChange: z.boolean().default(false),
    percentageChange: z.number().optional(),
    repeating: z.boolean().default(false),
    isActive: z.boolean().default(true),

    // Notification channels and content
    channels: z.array(notificationChannelSchema).default(["push"]),
    customMessage: z.string().max(200).optional(),

    // Integrations with other entities
    createJournalEntry: z.boolean().default(false),
    positionId: idSchema.optional(),

    // Tracking fields
    lastTriggeredAt: z.date().optional(),

    // Timestamps
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Schema for creating a new price alert
 */
export const createPriceAlertSchema = priceAlertSchema
  .omit({
    id: true,
    lastTriggeredAt: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    asset: z.string().min(1),
    targetPrice: z.number(),
    direction: alertDirectionSchema,
  });

/**
 * Schema for updating a price alert
 */
export const updatePriceAlertSchema = z
  .object({
    targetPrice: z.number().optional(),
    direction: alertDirectionSchema.optional(),
    isPercentageChange: z.boolean().optional(),
    percentageChange: z.number().optional(),
    repeating: z.boolean().optional(),
    isActive: z.boolean().optional(),
    channels: z.array(notificationChannelSchema).optional(),
    customMessage: z.string().max(200).optional(),
    createJournalEntry: z.boolean().optional(),
  })
  .strict();

/**
 * Price alert search parameters
 */
export const priceAlertSearchSchema = z.object({
  userId: userIdSchema,
  asset: z.string().optional(),
  isActive: z.boolean().optional(),
  positionId: idSchema.optional(),
});

export type PriceAlert = z.infer<typeof priceAlertSchema>;
export type CreatePriceAlertInput = z.infer<typeof createPriceAlertSchema>;
export type UpdatePriceAlertInput = z.infer<typeof updatePriceAlertSchema>;
export type PriceAlertSearch = z.infer<typeof priceAlertSearchSchema>;
