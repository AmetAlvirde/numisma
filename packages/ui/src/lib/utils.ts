import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Add financial formatting utilities
export function formatCurrency(
  value: number,
  currency = "USD",
  options = {}
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    ...options,
  }).format(value);
}

export function formatPercentage(value: number, options = {}): string {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: 2,
    ...options,
  }).format(value / 100);
}
