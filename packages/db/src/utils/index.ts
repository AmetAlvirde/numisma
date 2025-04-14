/**
 * Index file for database utility functions
 *
 * This file exports all utility functions for handling database operations,
 * type conversions, and entity mappings.
 */

// Export date handling utilities from legacy utils file
export {
  dateOrGenesisToDate,
  databaseDateToDateOrGenesis,
  handleDatabaseError,
} from "../utils";

// ======== TYPE MAPPING FUNCTIONS ========
// Functions for mapping primitive types, enums, and simple conversions
export {
  // Type guards
  isWalletType,
  isPositionLifecycle,
  isCapitalTier,
  isOrderStatus,
  isOrderType,
  isOrderPurpose,
  isAssetLocationType,
  isTradeSide,
  isPositionStatus,
  isTimeFrame,

  // Type conversions
  stringToWalletType,
  stringToPositionLifecycle,
  stringToCapitalTier,
  stringToTimeFrame,
  stringToAssetType,

  // Only include dateToDateOrGenesis from type-mappers (the other date function comes from ../utils)
  dateToDateOrGenesis,

  // Enum mappers
  mapOrderStatus,
  mapToPrismaOrderStatus,
  mapOrderType,
  mapToPrismaOrderType,
  mapAssetLocationType,
  mapToPrismaAssetLocationType,
  mapTradeSide,
  mapToPrismaTradeSide,
  mapPositionStatus,
  mapToPrismaPositionStatus,

  // Entity to Prisma mappers (CREATE/UPDATE operations)
  mapPositionToPrisma,
  mapPortfolioToPrisma,
  mapMarketToPrisma,
} from "./type-mappers";

// ======== ENTITY MAPPING FUNCTIONS ========
// Functions for mapping complete entities between database and domain models
export {
  // Prisma to Domain entity mappers (READ operations)
  mapAssetToDomain,
  mapAssetToPrisma,
  mapMarketToDomain,
  mapWalletLocationToDomain,
  mapOrderToDomain,
  mapStopLossOrderToDomain,
  mapTakeProfitOrderToDomain,
  mapPositionDetailsToDomain,
  mapThesisToDomain,
  mapJournalEntryToDomain,
  mapPositionToDomain,
  mapPortfolioToDomain,
} from "./entity-mappers";
