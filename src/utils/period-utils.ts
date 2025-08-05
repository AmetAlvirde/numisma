/**
 * Get the current period in Q{quarter}/W{week} format
 * @returns A string like "Q1/W11" representing the current quarter and week
 */
export function getCurrentPeriod(): string {
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);

  // Calculate week number
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const pastDaysOfYear = (now.getTime() - startOfYear.getTime()) / 86400000;
  const week = Math.ceil((pastDaysOfYear + startOfYear.getDay() + 1) / 7);

  return `Q${quarter}/W${week}`;
}
