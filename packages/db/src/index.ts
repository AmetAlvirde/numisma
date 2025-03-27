/**
 * Database layer for Numisma
 * 
 * This package provides repository implementations and database access utilities.
 * It serves as the data access layer for the Numisma application, separating
 * database concerns from business logic.
 */

// Export prisma client
export * from './prisma';

// Export repositories for data access
export * from './repositories';

// Export schemas for validation
export * from './schema';

// Export utility functions and types
export * from './utils';
