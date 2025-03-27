/**
 * Prisma client export with connection management
 * 
 * This file implements the singleton pattern for the Prisma client
 * to prevent multiple connections to the database during development.
 */

import { PrismaClient } from '@prisma/client';

// Create a type for the global object with prisma
declare global {
  var prisma: PrismaClient | undefined;
}

// Create a singleton Prisma client instance
export const prisma =
  global.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
      ? ['query', 'error', 'warn'] 
      : ['error'],
  });

// In development, attach the client to the global object to prevent
// multiple instances during hot reloading
if (process.env.NODE_ENV !== 'production') {
  global.prisma = prisma;
}

// Re-export Prisma client types
export * from '@prisma/client';
