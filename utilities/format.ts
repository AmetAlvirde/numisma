/**
 * format.ts - Formatting utilities for numbers, currency, and percentages
 */

/**
 * Format a number as currency
 */
export function formatCurrency(
  value: number,
  options: {
    locale?: string;
    currency?: string;
    signDisplay?: "auto" | "never" | "always" | "exceptZero";
  } = {}
): string {
  const { locale = "en-US", currency = "USD", signDisplay = "auto" } = options;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    signDisplay,
    currencyDisplay: "symbol",
  }).format(value);
}

/**
 * Format a number as a percentage
 */
export function formatPercentage(
  value: number,
  options: {
    locale?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    signDisplay?: "auto" | "never" | "always" | "exceptZero";
  } = {}
): string {
  const {
    locale = "en-US",
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    signDisplay = "auto",
  } = options;

  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits,
    maximumFractionDigits,
    signDisplay,
  }).format(value / 100); // Convert from decimal to percentage
}

/**
 * Format a number with appropriate decimal places
 */
export function formatNumber(
  value: number,
  options: {
    locale?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
    signDisplay?: "auto" | "never" | "always" | "exceptZero";
  } = {}
): string {
  const {
    locale = "en-US",
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    signDisplay = "auto",
  } = options;

  return new Intl.NumberFormat(locale, {
    minimumFractionDigits,
    maximumFractionDigits,
    signDisplay,
  }).format(value);
}
