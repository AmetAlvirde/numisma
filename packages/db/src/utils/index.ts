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

// Export type conversion functions
export * from "./type-mappers";

// Export entity mapper functions, but rename mapPortfolioToPrisma to avoid conflict
export {
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
  // Rename the conflicting function from entity-mappers
  mapPortfolioToPrisma as mapPortfolioEntityToPrisma,
} from "./entity-mappers";
