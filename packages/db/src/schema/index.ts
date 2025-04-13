/**
 * Zod schemas for database entities
 *
 * This file exports validation schemas for all database entities.
 * These schemas are used to validate input data before database operations.
 */

// Core entity schemas
export * from "./asset";
export * from "./market";
export * from "./portfolio";
export * from "./position";
export * from "./wallet-location";

// Order-related schemas
export * from "./order";
export * from "./stop-loss-order";
export * from "./take-profit-order";

// Portfolio analysis schemas
export * from "./historical-valuation";

// Common utilities and shared schemas
export * from "./common";

// Additional schemas - selectively re-exporting to avoid conflicts
// The following schemas have conflicts with others, so we're exporting them selectively
export {
  notificationSchema,
  createNotificationSchema,
  updateNotificationSchema,
  type Notification,
  type CreateNotificationInput,
  type UpdateNotificationInput,
} from "./notification";

export {
  priceAlertSchema,
  createPriceAlertSchema,
  updatePriceAlertSchema,
  type PriceAlert,
  type CreatePriceAlertInput,
  type UpdatePriceAlertInput,
} from "./price-alert";

export {
  exchangeAccountSchema,
  createExchangeAccountSchema,
  updateExchangeAccountSchema,
  exchangeAccountStatusSchema,
  type ExchangeAccount,
  type CreateExchangeAccountInput,
  type UpdateExchangeAccountInput,
  type ExchangeAccountSearch,
} from "./exchange-account";

export {
  walletSchema,
  createWalletSchema,
  updateWalletSchema,
  type Wallet,
  type CreateWalletInput,
  type UpdateWalletInput,
} from "./wallet";

export { tradingMetricsSchema, type TradingMetrics } from "./trading-metrics";

// Note: The following schemas are not available yet:
// - performance-report
// - user
// - system-setting
