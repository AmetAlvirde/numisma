/**
 * Price Alert schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema, foreignKeySchema } from "./common";
// import { AssetType, ValidationResult, ValidationError } from "@numisma/types";

/**
 * Alert direction enum
 */
export enum AlertDirection {
  ABOVE = "above",
  BELOW = "below",
}

/**
 * Notification channel enum
 */
export enum NotificationChannel {
  EMAIL = "email",
  PUSH = "push",
  SMS = "sms",
}

/**
 * Base price alert schema without refinements
 */
const basePriceAlertSchema = z
  .object({
    // Core fields
    id: idSchema,
    userId: foreignKeySchema,
    asset: z.string().min(1), // Asset ticker
    targetPrice: z.number().positive(),
    direction: z.nativeEnum(AlertDirection),
    isPercentageChange: z.boolean().default(false),
    percentageChange: z.number().positive().optional(),
    repeating: z.boolean().default(false),
    isActive: z.boolean().default(true),

    // Notification channels and content
    channels: z
      .array(z.nativeEnum(NotificationChannel))
      .default([NotificationChannel.PUSH]),
    customMessage: z.string().max(200).optional(),

    // Integrations with other entities
    createJournalEntry: z.boolean().default(false),
    positionId: foreignKeySchema.optional(),

    // Tracking fields
    lastTriggeredAt: z.date().optional(),

    // Timestamps
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Price alert schema with refinements
 */
export const priceAlertSchema = basePriceAlertSchema.refine(
  data => {
    // If percentage change is enabled, require percentage value
    if (data.isPercentageChange) {
      return !!data.percentageChange;
    }
    return true;
  },
  {
    message:
      "Percentage change value is required when percentage change is enabled",
    path: ["percentageChange"],
  }
);

/**
 * Schema for creating a new price alert
 */
export const createPriceAlertSchema = basePriceAlertSchema
  .omit({
    id: true,
    lastTriggeredAt: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine(
    data => {
      // If percentage change is enabled, require percentage value
      if (data.isPercentageChange) {
        return !!data.percentageChange;
      }
      return true;
    },
    {
      message:
        "Percentage change value is required when percentage change is enabled",
      path: ["percentageChange"],
    }
  );

/**
 * Schema for updating a price alert
 */
export const updatePriceAlertSchema = z
  .object({
    targetPrice: z.number().positive().optional(),
    direction: z.nativeEnum(AlertDirection).optional(),
    isPercentageChange: z.boolean().optional(),
    percentageChange: z.number().positive().optional(),
    repeating: z.boolean().optional(),
    isActive: z.boolean().optional(),
    channels: z.array(z.nativeEnum(NotificationChannel)).optional(),
    customMessage: z.string().max(200).optional(),
    createJournalEntry: z.boolean().optional(),
  })
  .refine(
    data => {
      // If percentage change is enabled, require percentage value
      if (data.isPercentageChange) {
        return !!data.percentageChange;
      }
      return true;
    },
    {
      message:
        "Percentage change value is required when percentage change is enabled",
      path: ["percentageChange"],
    }
  );

/**
 * Price alert search parameters
 */
export const priceAlertSearchSchema = z.object({
  userId: foreignKeySchema,
  asset: z.string().optional(),
  isActive: z.boolean().optional(),
  positionId: foreignKeySchema.optional(),
});

export type PriceAlert = z.infer<typeof priceAlertSchema>;
export type CreatePriceAlertInput = z.infer<typeof createPriceAlertSchema>;
export type UpdatePriceAlertInput = z.infer<typeof updatePriceAlertSchema>;
export type PriceAlertSearch = z.infer<typeof priceAlertSearchSchema>;
