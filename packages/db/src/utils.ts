/**
 * Utility functions for the database layer
 */

import { DateOrGenesis } from '@numisma/types';

/**
 * Convert a DateOrGenesis value to a Date object for database storage
 * 
 * @param date Date, string date, or "genesis"
 * @returns Date object, or null for "genesis" (handled in application code)
 */
export function dateOrGenesisToDate(date: DateOrGenesis): Date | null {
  if (date === 'genesis') {
    return null;
  }
  
  if (typeof date === 'string' && date !== 'genesis') {
    return new Date(date);
  }
  
  return date;
}

/**
 * Convert a database date (which may be null) to a DateOrGenesis value
 * 
 * @param date Date from database (may be null)
 * @returns DateOrGenesis value (Date or "genesis")
 */
export function databaseDateToDateOrGenesis(date: Date | null): DateOrGenesis {
  if (date === null) {
    return 'genesis';
  }
  
  return date;
}

/**
 * Handles database errors by wrapping them in more user-friendly errors
 * with appropriate status codes and messages
 * 
 * @param error Original error from database operation
 * @returns Properly formatted error for the API layer
 */
export function handleDatabaseError(error: any): Error {
  // Check for Prisma-specific errors and convert them to more user-friendly errors
  if (error.code === 'P2002') {
    // Unique constraint violation
    return new Error(`A record with this identifier already exists: ${error.meta?.target}`);
  }
  
  if (error.code === 'P2025') {
    // Record not found
    return new Error('The requested record was not found');
  }
  
  // For other errors, return a generic message but log the details
  console.error('Database error:', error);
  return new Error('An error occurred while accessing the database');
}
