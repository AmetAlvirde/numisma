// src/components/financial/portfolio-summary-card/portfolio-summary-card.tsx
import React from "react";
import { cn } from "@/lib/utils";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Clock, ArrowUp, ArrowDown, Plus, CheckCircle2 } from "lucide-react";

export interface PortfolioSummaryCardProps {
  portfolioName: string;
  totalValue: number;
  change24h: number;
  positionCounts: { spot: number; futures: number };
  ordersFilled: number;
}

export const PortfolioSummaryCard: React.FC<PortfolioSummaryCardProps> = ({
  portfolioName,
  totalValue,
  change24h,
  positionCounts,
  ordersFilled,
}) => {
  return (
    <Card className="overflow-hidden shadow-xl border border-divider bg-card">
      <CardHeader className="pb-2 sm:pb-3 border-b border-divider">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2 text-gold-primary">
            <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-gold-primary/70" />
            {portfolioName}
          </CardTitle>
        </div>
      </CardHeader>
      <div className="p-3 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 sm:gap-0">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className="bg-gold-primary/20 border-gold-primary/50 text-gold-primary text-xs sm:text-sm"
              >
                24h Change
              </Badge>
              <span
                className={cn(
                  "flex items-center text-success text-xs sm:text-sm",
                  change24h < 0 && "text-danger"
                )}
              >
                {change24h > 0 ? <Plus className="h-3 w-3 mr-0.5" /> : null}

                <span>{change24h}%</span>
              </span>
            </div>
            <div className="flex items-center gap-1 text-success">
              {change24h < 0 ? (
                <ArrowDown
                  className={cn(
                    "h-4 w-4 sm:h-5 sm:w-5",
                    change24h < 0 && "text-danger"
                  )}
                />
              ) : (
                <ArrowUp className="h-4 w-4 sm:h-5 sm:w-5" />
              )}
              <span
                className={cn(
                  "text-2xl sm:text-3xl font-bold font-mono",
                  change24h < 0 && "text-danger"
                )}
              >
                {totalValue}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-1 sm:gap-2">
            <Badge
              variant="outline"
              className="bg-interactive/20 border-blue-primary/50 text-blue-light text-xs"
            >
              <span className="font-medium font-mono">
                {positionCounts.spot}
              </span>
              <span className="ml-1 opacity-80">Spot</span>
            </Badge>
            <Badge
              variant="outline"
              className="bg-interactive/20 border-gold-primary/50 text-blue-light text-xs"
            >
              <span className="font-medium font-mono">
                {positionCounts.futures}
              </span>
              <span className="ml-1 opacity-80">Futures</span>
            </Badge>
            <Badge
              variant="outline"
              className="bg-interactive/20 border-success/50 text-blue-light text-xs"
            >
              <CheckCircle2 className="mr-1 h-3 w-3 text-success" />
              <span className="font-medium font-mono">{ordersFilled}</span>
              <span className="ml-1 opacity-80">Orders</span>
            </Badge>
          </div>
        </div>
      </div>
    </Card>
  );
};

PortfolioSummaryCard.displayName = "PortfolioSummaryCard";
