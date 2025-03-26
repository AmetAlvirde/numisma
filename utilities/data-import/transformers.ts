/**
 * transformers.ts - Data transformation utilities for portfolio import
 *
 * This file contains functions to transform and normalize imported data
 * into the format expected by the application.
 */

import { z } from "zod";
import type { Portfolio, Position, Asset, Order } from "@/types/numisma-types";
import type { ValidatedPortfolioData, ProcessedPortfolioData } from "./types";
import { portfolioSchema } from "./validators";

/**
 * Type for the result of a transformation operation
 */
type TransformResult<T> =
  | {
      success: true;
      data: T;
    }
  | {
      success: false;
      error: z.ZodError;
    };

/**
 * Type guard for TransformResult
 */
function isSuccessfulResult<T>(
  result: TransformResult<T>
): result is { success: true; data: T } {
  return result.success;
}

/**
 * Normalizes a date value to a Date object
 * Handles string dates, Date objects, and the "genesis" special value
 */
function normalizeDate(value: Date | string | "genesis"): Date | "genesis" {
  if (value === "genesis") return "genesis";
  if (value instanceof Date) return value;
  return new Date(value);
}

/**
 * Normalizes a numeric value, ensuring it's a valid number
 */
function normalizeNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

/**
 * Normalizes a boolean value
 */
function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return undefined;
}

/**
 * Normalizes an array of strings
 */
function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  return [];
}

/**
 * Transforms a validated portfolio data into the processed format
 */
export function transformPortfolioData(
  data: ValidatedPortfolioData,
  options: {
    normalizeDates?: boolean;
    normalizeNumbers?: boolean;
    normalizeBooleans?: boolean;
  } = {}
): ProcessedPortfolioData {
  const {
    normalizeDates = true,
    normalizeNumbers = true,
    normalizeBooleans = true,
  } = options;

  // Create a deep copy of the data to avoid mutating the original
  const transformed = JSON.parse(JSON.stringify(data));

  // Normalize dates if requested
  if (normalizeDates) {
    transformed.dateCreated = normalizeDate(transformed.dateCreated);
  }

  // Normalize numeric values if requested
  if (normalizeNumbers) {
    transformed.currentValue = normalizeNumber(transformed.currentValue);
    transformed.initialInvestment = normalizeNumber(
      transformed.initialInvestment
    );
    transformed.profitLoss = normalizeNumber(transformed.profitLoss);
    transformed.returnPercentage = normalizeNumber(
      transformed.returnPercentage
    );
  }

  // Normalize boolean values if requested
  if (normalizeBooleans) {
    transformed.isPublic = normalizeBoolean(transformed.isPublic);
  }

  // Normalize arrays
  transformed.positionIds = normalizeStringArray(transformed.positionIds);
  transformed.tags = normalizeStringArray(transformed.tags);

  // Normalize target allocations if present
  if (transformed.targetAllocations) {
    transformed.targetAllocations = transformed.targetAllocations.map(
      (allocation: { asset: string; percentage: number }) => ({
        asset: String(allocation.asset),
        percentage: normalizeNumber(allocation.percentage) ?? 0,
      })
    );
  }

  // Normalize display metadata if present
  if (transformed.displayMetadata) {
    if (normalizeNumbers) {
      transformed.displayMetadata.sortOrder = normalizeNumber(
        transformed.displayMetadata.sortOrder
      );
    }
    if (normalizeBooleans) {
      transformed.displayMetadata.isPinned = normalizeBoolean(
        transformed.displayMetadata.isPinned
      );
    }
  }

  return transformed;
}

/**
 * Transforms raw portfolio data into the processed format
 * This function combines validation and transformation
 */
export function transformRawPortfolioData(
  data: unknown,
  options: {
    validate?: boolean;
    normalizeDates?: boolean;
    normalizeNumbers?: boolean;
    normalizeBooleans?: boolean;
  } = {}
): TransformResult<Portfolio> {
  const { validate = true, ...transformOptions } = options;

  // First validate the data if requested
  if (validate) {
    const validationResult = portfolioSchema.safeParse(data);
    if (!validationResult.success) {
      return { success: false, error: validationResult.error };
    }

    // Transform the validated data
    const transformed = transformPortfolioData(
      validationResult.data,
      transformOptions
    );
    return { success: true, data: transformed };
  }

  // If validation is skipped, attempt to transform directly
  try {
    const transformed = transformPortfolioData(
      data as ValidatedPortfolioData,
      transformOptions
    );
    return { success: true, data: transformed };
  } catch (error) {
    return { success: false, error: new z.ZodError([]) };
  }
}

/**
 * Transforms an array of raw portfolio data
 */
export function transformRawPortfolioDataArray(
  data: unknown[],
  options: {
    validate?: boolean;
    normalizeDates?: boolean;
    normalizeNumbers?: boolean;
    normalizeBooleans?: boolean;
  } = {}
): z.SafeParseReturnType<Portfolio[], Portfolio[]> {
  const results = data.map(item => transformRawPortfolioData(item, options));

  // Check if any transformations failed
  const failures = results.filter(result => !result.success);
  if (failures.length > 0) {
    return z.error(new z.ZodError([]));
  }

  // All transformations succeeded, return the array of transformed data
  return z.success(results.map(result => result.data as Portfolio));
}
