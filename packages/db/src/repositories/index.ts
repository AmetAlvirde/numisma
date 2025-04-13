/**
 * Database repositories
 *
 * This file exports all repository implementations, which provide
 * a clean, domain-focused API for database access.
 */

// Core entity repositories
export * from "./asset";
export * from "./market";
export * from "./portfolio";
export * from "./position";
export * from "./wallet-location";

// Repository factory for dependency injection
export * from "./repository-factory";

// Note: The following repositories are commented out because they don't exist yet
// Add them back when they're implemented
/*
// Order-related repositories
export * from './order';
export * from './stop-loss-order';
export * from './take-profit-order';

// Portfolio analysis repositories
export * from './historical-valuation';
export * from './performance-report';

// User-related repositories
export * from './user';
export * from './system-setting';
*/
