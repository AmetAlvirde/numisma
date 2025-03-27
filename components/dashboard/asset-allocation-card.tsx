/**
 * asset-allocation-card.tsx - Card component for displaying portfolio asset allocation
 *
 * This component visualizes the distribution of assets in a portfolio using
 * progress bars and a legend.
 */

"use client";

import { useAssetAllocation } from "@/hooks/use-asset-allocation";
import { formatCurrency, formatPercentage } from "@/utilities/format";
import { RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

interface AssetAllocationCardProps {
  /** The ID of the portfolio to display */
  portfolioId: string;
  /** Optional className for the card */
  className?: string;
}

export function AssetAllocationCard({
  portfolioId,
  className,
}: AssetAllocationCardProps) {
  const { allocations, isLoading, error, refresh } =
    useAssetAllocation(portfolioId);

  if (isLoading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Loading...</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-24 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Error</CardTitle>
          <CardDescription>Failed to load allocation data</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-destructive">{error.message}</div>
          <Button
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => refresh()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!allocations.length) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>No Data</CardTitle>
          <CardDescription>No asset allocation data available</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle>Asset Allocation</CardTitle>
          <CardDescription>Distribution of portfolio assets</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refresh()}
          aria-label="Refresh allocation data"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Allocation Bars */}
          <div className="space-y-4">
            {allocations.map(allocation => {
              const allocationKey = `${allocation.symbol}-${allocation.name}`;
              return (
                <div key={allocationKey} className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">
                      {allocation.symbol} ({allocation.name})
                    </span>
                    <span className="text-muted-foreground">
                      {formatPercentage(allocation.percentage)}
                    </span>
                  </div>
                  <Progress value={allocation.percentage} className="h-2" />
                  <div className="text-sm text-muted-foreground">
                    {formatCurrency(allocation.value, {
                      currency: allocation.currency,
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t">
            {allocations.map(allocation => {
              const allocationKey = `${allocation.symbol}-${allocation.name}`;
              return (
                <div
                  key={allocationKey}
                  className="flex items-center space-x-2 text-sm"
                >
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{
                      backgroundColor: `hsl(${Math.random() * 360}, 70%, 50%)`,
                    }}
                  />
                  <span>
                    {allocation.symbol} (
                    {formatPercentage(allocation.percentage)})
                  </span>
                </div>
              );
            })}
          </div>

          {/* View Details Button */}
          <div className="flex justify-end pt-4 border-t">
            <Button variant="outline" size="sm">
              View Details
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
