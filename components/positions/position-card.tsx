/**
 * position-card.tsx - Card component for displaying position information
 *
 * This component displays essential position information in a card format,
 * including current value, 24h change, and status.
 */

"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PositionCardProps } from "@/types/position-components";
import { PositionStatusBadge } from "./position-status-badge";
import { formatCurrency, formatPercentage } from "@/utilities/format";

// Map of common crypto pairs to their quote currency codes
const QUOTE_CURRENCY_MAP: Record<string, string> = {
  USDT: "USD",
  USDC: "USD",
  DAI: "USD",
  EUR: "EUR",
  GBP: "GBP",
  JPY: "JPY",
};

export function PositionCard({ position }: PositionCardProps) {
  // Helper function to get the quote currency code
  const getQuoteCurrency = (pair: string): string => {
    const quoteCurrency = pair.split("/")[1];
    return QUOTE_CURRENCY_MAP[quoteCurrency] || "USD"; // Default to USD if not found
  };

  return (
    <Card className="w-full">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{position.name}</CardTitle>
        <PositionStatusBadge status={position.lifecycle} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {formatCurrency(position.positionDetails.currentInvestment || 0, {
            currency: getQuoteCurrency(position.asset.pair),
          })}
        </div>
        <div className="flex items-center text-xs text-muted-foreground">
          <span className="mr-1">24h:</span>
          <span
            className={
              position.asset.marketData?.priceChangePercentage24h
                ? position.asset.marketData.priceChangePercentage24h >= 0
                  ? "text-green-600"
                  : "text-red-600"
                : ""
            }
          >
            {position.asset.marketData?.priceChangePercentage24h
              ? formatPercentage(
                  position.asset.marketData.priceChangePercentage24h,
                  {
                    signDisplay: "always",
                  }
                )
              : "N/A"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
