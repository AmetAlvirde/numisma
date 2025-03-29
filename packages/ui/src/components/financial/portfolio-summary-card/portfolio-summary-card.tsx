// src/components/financial/portfolio-summary-card/portfolio-summary-card.tsx
import React from "react";
import { cn, formatCurrency, formatPercentage } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

interface PortfolioSummaryCardProps
  extends React.HTMLAttributes<HTMLDivElement> {
  name: string;
  totalValue: number;
  profitLoss: number;
  percentageReturn: number;
  assetCount: number;
  currency?: string;
}

export const PortfolioSummaryCard = React.forwardRef<
  HTMLDivElement,
  PortfolioSummaryCardProps
>(
  (
    {
      name,
      totalValue,
      profitLoss,
      percentageReturn,
      assetCount,
      currency = "USD",
      className,
      ...props
    },
    ref
  ) => {
    const isProfitable = profitLoss >= 0;

    return (
      <div
        ref={ref}
        className={cn("rounded-lg border bg-card p-4 shadow-sm", className)}
        {...props}
      >
        <h3 className="text-lg font-medium">{name}</h3>
        <div className="mt-2 text-2xl font-bold">
          {formatCurrency(totalValue, currency)}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-md px-2 py-1 text-sm font-medium",
              isProfitable
                ? "bg-success/10 text-success"
                : "bg-error/10 text-error"
            )}
          >
            {isProfitable ? "+" : ""}
            {formatCurrency(profitLoss, currency)}
            <span className="ml-1">
              ({isProfitable ? "+" : ""}
              {formatPercentage(percentageReturn)})
            </span>
          </span>
        </div>

        <Badge variant="default">{assetCount} assets</Badge>
      </div>
    );
  }
);
PortfolioSummaryCard.displayName = "PortfolioSummaryCard";

// src/components/financial/portfolio-summary-card/index.ts
export * from "./portfolio-summary-card";
