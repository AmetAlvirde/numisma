/**
 * types.ts - Core types and interfaces for data import functionality
 *
 * This file defines the types and interfaces used throughout the data import
 * process, including validation schemas, transformation functions, and error types.
 */

import { z } from "zod";
import type { Portfolio, Position, Asset, Order } from "@/types/numisma-types";

/**
 * Represents the result of a data import operation
 */
export interface ImportResult<T> {
  /** Whether the import was successful */
  success: boolean;
  /** The imported data if successful */
  data?: T;
  /** Error message if unsuccessful */
  error?: string;
  /** Validation errors if any */
  validationErrors?: z.ZodError;
  /** Transformation errors if any */
  transformationErrors?: string[];
}

/**
 * Configuration options for data import
 */
export interface ImportOptions {
  /** Whether to validate the data */
  validate?: boolean;
  /** Whether to transform the data */
  transform?: boolean;
  /** Whether to allow partial data */
  allowPartial?: boolean;
  /** Whether to normalize dates */
  normalizeDates?: boolean;
  /** Whether to normalize currency values */
  normalizeCurrency?: boolean;
}

/**
 * Custom error types for data import operations
 */
export class ImportError extends Error {
  constructor(message: string, public code: string, public details?: unknown) {
    super(message);
    this.name = "ImportError";
  }
}

export class ValidationError extends ImportError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export class TransformationError extends ImportError {
  constructor(message: string, details?: unknown) {
    super(message, "TRANSFORMATION_ERROR", details);
    this.name = "TransformationError";
  }
}

export class FileReadError extends ImportError {
  constructor(message: string, details?: unknown) {
    super(message, "FILE_READ_ERROR", details);
    this.name = "FileReadError";
  }
}

/**
 * Type for raw JSON data before validation and transformation
 */
export type RawPortfolioData = unknown;

/**
 * Type for validated but untransformed portfolio data
 */
export type ValidatedPortfolioData = z.infer<typeof portfolioSchema>;

/**
 * Type for fully processed portfolio data
 */
export type ProcessedPortfolioData = Portfolio;

/**
 * Type for the validation schema
 */
export type ValidationSchema = z.ZodType<Portfolio>;

/**
 * Type for transformation functions
 */
export type TransformFunction<T, R> = (data: T) => R;

/**
 * Type for validation functions
 */
export type ValidateFunction<T> = (
  data: unknown
) => z.SafeParseReturnType<T, T>;
