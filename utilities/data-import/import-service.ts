/**
 * import-service.ts - Main service for importing portfolio data
 *
 * This file provides the primary entry point for importing portfolio data,
 * handling file reading, validation, and transformation.
 */

import { z } from "zod";
import type { Portfolio } from "@/types/numisma-types";
import type { ValidatedPortfolioData, ProcessedPortfolioData } from "./types";
import { portfolioSchema } from "./validators";
import {
  transformPortfolioData,
  transformRawPortfolioData,
} from "./transformers";

/**
 * Type for import options
 */
export interface ImportOptions {
  validate?: boolean;
  normalizeDates?: boolean;
  normalizeNumbers?: boolean;
  normalizeBooleans?: boolean;
  strict?: boolean;
}

/**
 * Type for import result
 */
export interface ImportResult {
  success: boolean;
  data?: Portfolio;
  error?: {
    message: string;
    details?: unknown;
  };
}

/**
 * Imports portfolio data from a JSON string
 */
export async function importFromJson(
  jsonString: string,
  options: ImportOptions = {}
): Promise<ImportResult> {
  try {
    // Parse the JSON string
    const parsedData = JSON.parse(jsonString);

    // Transform and validate the data
    const result = transformRawPortfolioData(parsedData, options);

    if (!result.success) {
      return {
        success: false,
        error: {
          message: "Validation failed",
          details: result.error,
        },
      };
    }

    return {
      success: true,
      data: result.data,
    };
  } catch (error) {
    return {
      success: false,
      error: {
        message:
          error instanceof Error ? error.message : "Unknown error occurred",
        details: error,
      },
    };
  }
}

/**
 * Imports portfolio data from a file
 */
export async function importFromFile(
  file: File,
  options: ImportOptions = {}
): Promise<ImportResult> {
  try {
    // Read the file content
    const content = await file.text();

    // Import the data
    return await importFromJson(content, options);
  } catch (error) {
    return {
      success: false,
      error: {
        message: error instanceof Error ? error.message : "Failed to read file",
        details: error,
      },
    };
  }
}

/**
 * Imports multiple portfolio data entries from a JSON string
 */
export async function importMultipleFromJson(
  jsonString: string,
  options: ImportOptions = {}
): Promise<ImportResult[]> {
  try {
    // Parse the JSON string
    const parsedData = JSON.parse(jsonString);

    // Ensure we have an array
    if (!Array.isArray(parsedData)) {
      return [
        {
          success: false,
          error: {
            message: "Input must be an array of portfolio data",
          },
        },
      ];
    }

    // Import each portfolio
    return await Promise.all(
      parsedData.map(item => importFromJson(JSON.stringify(item), options))
    );
  } catch (error) {
    return [
      {
        success: false,
        error: {
          message:
            error instanceof Error ? error.message : "Unknown error occurred",
          details: error,
        },
      },
    ];
  }
}

/**
 * Imports multiple portfolio data entries from a file
 */
export async function importMultipleFromFile(
  file: File,
  options: ImportOptions = {}
): Promise<ImportResult[]> {
  try {
    // Read the file content
    const content = await file.text();

    // Import the data
    return await importMultipleFromJson(content, options);
  } catch (error) {
    return [
      {
        success: false,
        error: {
          message:
            error instanceof Error ? error.message : "Failed to read file",
          details: error,
        },
      },
    ];
  }
}
