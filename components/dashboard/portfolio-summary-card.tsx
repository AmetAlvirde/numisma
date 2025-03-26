/**
 * portfolio-summary-card.tsx - Card component for displaying portfolio summary information
 *
 * This component displays key portfolio metrics including total value,
 * profit/loss, ROI, and other relevant information in a clean, accessible format.
 */

"use client";

import { usePortfolioSummary } from "@/hooks/use-portfolio-summary";
import { formatCurrency, formatPercentage } from "@/lib/format";
import { ArrowUp, ArrowDown, RefreshCw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PortfolioSummaryCardProps {
  /** The ID of the portfolio to display */
  portfolioId: string;
  /** Optional className for the card */
  className?: string;
}

export function PortfolioSummaryCard({
  portfolioId,
  className,
}: PortfolioSummaryCardProps) {
  const { summary, isLoading, error, refresh } =
    usePortfolioSummary(portfolioId);

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
          <CardDescription>Failed to load portfolio data</CardDescription>
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

  if (!summary) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>No Data</CardTitle>
          <CardDescription>No portfolio data available</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const isPositive = summary.profitLoss >= 0;
  const isNegative = summary.profitLoss < 0;

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div>
          <CardTitle className="text-2xl font-bold">{summary.name}</CardTitle>
          {summary.description && (
            <CardDescription>{summary.description}</CardDescription>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => refresh()}
          aria-label="Refresh portfolio data"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4">
          {/* Total Value */}
          <div>
            <div className="text-sm text-muted-foreground">Total Value</div>
            <div className="text-2xl font-bold">
              {formatCurrency(summary.totalValue, {
                currency: summary.baseCurrency,
              })}
            </div>
          </div>

          {/* Profit/Loss */}
          <div>
            <div className="text-sm text-muted-foreground">Profit/Loss</div>
            <div
              className={cn(
                "text-2xl font-bold flex items-center",
                isPositive && "text-green-600",
                isNegative && "text-red-600"
              )}
            >
              {formatCurrency(summary.profitLoss, {
                currency: summary.baseCurrency,
                signDisplay: "always",
              })}
              {isPositive && <ArrowUp className="ml-1 h-4 w-4" />}
              {isNegative && <ArrowDown className="ml-1 h-4 w-4" />}
            </div>
          </div>

          {/* ROI */}
          <div>
            <div className="text-sm text-muted-foreground">
              Return on Investment
            </div>
            <div
              className={cn(
                "text-2xl font-bold",
                isPositive && "text-green-600",
                isNegative && "text-red-600"
              )}
            >
              {formatPercentage(summary.returnPercentage, {
                signDisplay: "always",
              })}
            </div>
          </div>

          {/* Additional Info */}
          <div className="flex flex-wrap gap-2 mt-4">
            <Badge variant="secondary">
              {summary.positionCount} Position
              {summary.positionCount !== 1 ? "s" : ""}
            </Badge>
            {summary.riskProfile && (
              <Badge variant="outline">{summary.riskProfile}</Badge>
            )}
            {summary.tags.map(tag => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
