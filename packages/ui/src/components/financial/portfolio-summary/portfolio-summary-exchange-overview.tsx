// src/components/financial/portfolio-summary-exchange-overview.tsx
import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface PortfolioSummaryExchangeOverviewProps {
  exchanges: {
    name: string;
    spotCount: number;
    futuresCount: number;
    totalValue: number;
  }[];
}
export const PortfolioSummaryExchangeOverview: React.FC<
  PortfolioSummaryExchangeOverviewProps
> = ({ exchanges }) => {
  return (
    <Card className="shadow-lg border border-divider bg-card">
      <CardHeader className="pb-2 sm:pb-3 border-b border-divider">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2 text-gold-primary">
            <DollarSign className="h-4 w-4 sm:h-5 sm:w-5 text-gold-primary/70" />
            Exchange Overview
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          {exchanges.map(exchange => (
            <div
              key={exchange.name}
              className="rounded-lg p-3 sm:p-4  bg-card/70 border border-divider"
            >
              <div className="font-medium mb-2 text-text-primary text-sm sm:text-base">
                {exchange.name}
              </div>
              <div className="flex gap-2 mb-2">
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    exchange.spotCount > 0 &&
                      "text-blue-light/80 border-blue-light/80",
                    exchange.spotCount === 0 &&
                      "border-text-tertiary text-text-tertiary"
                  )}
                >
                  <span className="font-mono">{exchange.spotCount}</span> Spot
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-xs",
                    exchange.futuresCount > 0 &&
                      "text-blue-light/80 border-blue-light/80",
                    exchange.futuresCount === 0 &&
                      "border-text-tertiary text-text-tertiary"
                  )}
                >
                  <span className="font-mono">{exchange.futuresCount}</span>
                  Futures
                </Badge>
              </div>

              <div className="text-base sm:text-lg font-bold font-mono text-gold-primary">
                {exchange.totalValue}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

PortfolioSummaryExchangeOverview.displayName =
  "PortfolioSummaryExchangeOverview";
