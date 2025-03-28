/**
 * Notification schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema, foreignKeySchema } from "./common";
import { ValidationResult, ValidationError } from "@numisma/types";

/**
 * Notification type enum
 */
export enum NotificationType {
  PRICE_ALERT = "price_alert",
  POSITION_UPDATE = "position_update",
  PORTFOLIO_ALERT = "portfolio_alert",
  REPORT_GENERATED = "report_generated",
  SYSTEM_NOTIFICATION = "system_notification",
}

/**
 * Notification priority enum
 */
export enum NotificationPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * Related entity type enum
 */
export enum RelatedEntityType {
  POSITION = "position",
  PORTFOLIO = "portfolio",
  PRICE_ALERT = "price_alert",
  REPORT = "report",
  WALLET = "wallet",
  EXCHANGE_ACCOUNT = "exchange_account",
}

/**
 * Base notification schema without refinements
 */
const baseNotificationSchema = z
  .object({
    // Core fields
    id: idSchema,
    userId: foreignKeySchema,
    type: z.nativeEnum(NotificationType),
    title: z.string().min(1).max(200),
    message: z.string().min(1).max(2000),
    priority: z
      .nativeEnum(NotificationPriority)
      .default(NotificationPriority.MEDIUM),
    isRead: z.boolean().default(false),
    isActioned: z.boolean().default(false),
    actionUrl: z.string().url().optional(),
    actionText: z.string().max(50).optional(),
    icon: z.string().optional(),

    // Additional structured data
    data: z.record(z.any()).optional(),

    // Related entities
    relatedEntityIds: z
      .array(
        z.object({
          type: z.nativeEnum(RelatedEntityType),
          id: foreignKeySchema,
        })
      )
      .optional(),

    // Timestamps
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Notification schema with refinements
 */
export const notificationSchema = baseNotificationSchema.refine(
  data => {
    // If actionUrl is provided, actionText must also be provided
    if (data.actionUrl) {
      return !!data.actionText;
    }
    return true;
  },
  {
    message: "Action text is required when action URL is provided",
    path: ["actionText"],
  }
);

/**
 * Schema for creating a new notification
 */
export const createNotificationSchema = baseNotificationSchema
  .omit({
    id: true,
    isRead: true,
    isActioned: true,
    createdAt: true,
    updatedAt: true,
  })
  .refine(
    data => {
      // If actionUrl is provided, actionText must also be provided
      if (data.actionUrl) {
        return !!data.actionText;
      }
      return true;
    },
    {
      message: "Action text is required when action URL is provided",
      path: ["actionText"],
    }
  );

/**
 * Schema for updating a notification
 */
export const updateNotificationSchema = z
  .object({
    isRead: z.boolean().optional(),
    isActioned: z.boolean().optional(),
  })
  .refine(
    data => {
      // If marking as actioned, it must also be marked as read
      if (data.isActioned) {
        return data.isRead !== false;
      }
      return true;
    },
    {
      message:
        "A notification must be read before it can be marked as actioned",
      path: ["isActioned"],
    }
  );

/**
 * Notification search parameters
 */
export const notificationSearchSchema = z.object({
  userId: foreignKeySchema,
  type: z.nativeEnum(NotificationType).optional(),
  isRead: z.boolean().optional(),
  priority: z.nativeEnum(NotificationPriority).optional(),
  from: z.date().optional(),
  to: z.date().optional(),
});

export type Notification = z.infer<typeof notificationSchema>;
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
export type UpdateNotificationInput = z.infer<typeof updateNotificationSchema>;
export type NotificationSearch = z.infer<typeof notificationSearchSchema>;
