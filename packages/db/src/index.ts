/**
 * Database layer for Numisma
 *
 * This package provides repository implementations and database access utilities.
 * It serves as the data access layer for the Numisma application, separating
 * database concerns from business logic.
 */

// Export prisma client instance
export { prisma } from "./prisma";

// Export repositories
export * from "./repositories";

// Export schema validation functions
export * from "./schema";

// Export utility functions
export * from "./utils";

// Note on type usage:
// 1. Domain types should be imported from @numisma/types
// 2. Database model types should be imported from @prisma/client
// 3. Schema validation types are exported from ./schema
// 4. Type-safe conversion utilities are exported from ./utils
