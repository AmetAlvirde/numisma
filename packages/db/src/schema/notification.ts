/**
 * Notification schema validation
 */

import { z } from "zod";
import { idSchema, timestampSchema, userIdSchema } from "./common";

/**
 * Notification types enum
 */
export const notificationTypeSchema = z.enum([
  "price_alert",
  "position_update",
  "portfolio_alert",
  "report_generated",
  "system_notification",
]);

/**
 * Notification priority levels
 */
export const notificationPrioritySchema = z.enum([
  "low",
  "medium",
  "high",
  "critical",
]);

/**
 * Notification entity schema
 */
export const notificationSchema = z
  .object({
    // Core fields
    id: idSchema,
    userId: userIdSchema,
    type: notificationTypeSchema,
    title: z.string().min(1).max(200),
    message: z.string().min(1).max(2000),
    priority: notificationPrioritySchema.default("medium"),
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
          type: z.string(),
          id: idSchema,
        })
      )
      .optional(),

    // Timestamps
    ...timestampSchema.shape,
  })
  .strict();

/**
 * Schema for creating a new notification
 */
export const createNotificationSchema = notificationSchema
  .omit({
    id: true,
    isRead: true,
    isActioned: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    userId: userIdSchema,
    type: notificationTypeSchema,
    title: z.string().min(1).max(200),
    message: z.string().min(1).max(2000),
  });

/**
 * Schema for updating a notification
 */
export const updateNotificationSchema = z
  .object({
    isRead: z.boolean().optional(),
    isActioned: z.boolean().optional(),
  })
  .strict();

/**
 * Notification search parameters
 */
export const notificationSearchSchema = z.object({
  userId: userIdSchema,
  type: notificationTypeSchema.optional(),
  isRead: z.boolean().optional(),
  priority: notificationPrioritySchema.optional(),
  from: z.date().optional(),
  to: z.date().optional(),
});

export type Notification = z.infer<typeof notificationSchema>;
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
export type UpdateNotificationInput = z.infer<typeof updateNotificationSchema>;
export type NotificationSearch = z.infer<typeof notificationSearchSchema>;
