"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pin, TrendingUp, TrendingDown, ArrowLeft } from "lucide-react";
import { usePortfolioById } from "@/hooks/use-portfolio-data";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import {
  PortfolioLoadingSkeleton,
  PortfolioErrorFallback,
  TrpcErrorFallback,
  NetworkStatusIndicator,
} from "@/components/ui/portfolio-fallbacks";

interface PortfolioDetailContentProps {
  portfolioId: string;
}

function PortfolioDetailContentInner({
  portfolioId,
}: PortfolioDetailContentProps) {
  const router = useRouter();

  const {
    portfolio,
    isLoading,
    isError,
    error,
    errorContext,
    retryQuery,
    networkStatus,
  } = usePortfolioById(portfolioId);

  const isPositive = useMemo(
    () => portfolio?.dayChange && portfolio.dayChange > 0,
    [portfolio?.dayChange]
  );

  // Loading state
  if (isLoading && !portfolio) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
        <PortfolioLoadingSkeleton />
      </div>
    );
  }

  // Network-specific error handling
  if (!networkStatus.isOnline) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
        <PortfolioErrorFallback onRetry={networkStatus.testConnection} />
        <NetworkStatusIndicator
          isOnline={networkStatus.isOnline}
          onRetryConnection={networkStatus.testConnection}
        />
      </div>
    );
  }

  // Error handling
  if (isError && errorContext) {
    if (errorContext.code === "NOT_FOUND") {
      return (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
          <Card>
            <CardContent className="p-12 text-center">
              <h2 className="text-2xl font-semibold mb-2">
                Portfolio Not Found
              </h2>
              <p className="text-muted-foreground mb-4">
                {
                  "The portfolio you're looking for doesn't exist or you don't have access to it."
                }
              </p>
              <Button onClick={() => router.push("/")} variant="outline">
                Go to Home
              </Button>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (errorContext.isClientError) {
      return (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push("/")}
              className="gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
          </div>
          <TrpcErrorFallback
            error={error}
            onRetry={errorContext.canRetry ? retryQuery : undefined}
          />
        </div>
      );
    }

    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
        <PortfolioErrorFallback
          onRetry={errorContext.canRetry ? retryQuery : undefined}
        />
      </div>
    );
  }

  // No portfolio data
  if (!portfolio) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push("/")}
            className="gap-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>
        <Card>
          <CardContent className="p-12 text-center">
            <h2 className="text-2xl font-semibold mb-2">No Portfolio Data</h2>
            <p className="text-muted-foreground">
              Unable to load portfolio information.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push("/")}
          className="gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
      </div>

      {/* Portfolio Overview Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {portfolio.isPinned && (
                <Pin className="h-5 w-5 fill-yellow-400 text-yellow-400" />
              )}
              <div>
                <CardTitle className="text-2xl">{portfolio.name}</CardTitle>
                {portfolio.description && (
                  <CardDescription className="mt-1">
                    {portfolio.description}
                  </CardDescription>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Portfolio Value */}
          <div>
            <div className="flex items-end justify-between mb-2">
              <p className="text-4xl font-bold">
                $
                {portfolio.totalValue.toLocaleString("en-US", {
                  minimumFractionDigits: 0,
                  maximumFractionDigits: 0,
                })}
              </p>
              <div
                className={`flex items-center space-x-2 ${
                  isPositive ? "text-green-600" : "text-red-600"
                }`}
              >
                {isPositive ? (
                  <TrendingUp className="h-5 w-5" />
                ) : (
                  <TrendingDown className="h-5 w-5" />
                )}
                <div className="flex flex-col items-end">
                  <span className="text-lg font-semibold">
                    {isPositive ? "+" : ""}
                    {portfolio.dayChangePercent.toFixed(2)}%
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {isPositive ? "+" : ""}$
                    {Math.abs(portfolio.dayChange).toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Total Value</p>
          </div>

          {/* Top Holdings */}
          {portfolio.topHoldings && portfolio.topHoldings.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-3">Top Holdings</h3>
              <div className="flex flex-wrap gap-2">
                {portfolio.topHoldings.map((symbol, index) => (
                  <Badge
                    key={`${symbol}-${index}`}
                    variant="secondary"
                    className="text-sm px-3 py-1"
                  >
                    {symbol}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Portfolio Metadata */}
          <div className="pt-4 border-t">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Created</p>
                <p className="font-medium">
                  {new Date(portfolio.createdAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Last Updated</p>
                <p className="font-medium">
                  {new Date(portfolio.updatedAt).toLocaleDateString("en-US", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Network Status Indicator */}
      <NetworkStatusIndicator
        isOnline={networkStatus.isOnline}
        onRetryConnection={retryQuery}
      />
    </div>
  );
}

export function PortfolioDetailContent({
  portfolioId,
}: PortfolioDetailContentProps) {
  return (
    <ErrorBoundary
      title="Portfolio Detail Error"
      description="There was an error loading the portfolio details. This might be a temporary issue."
      onError={(error, errorInfo) => {
        console.error("PortfolioDetailContent error:", error, errorInfo);
      }}
      resetKeys={[portfolioId]}
      showErrorDetails={process.env.NODE_ENV === "development"}
      fallback={
        <PortfolioErrorFallback onRetry={() => window.location.reload()} />
      }
    >
      <PortfolioDetailContentInner portfolioId={portfolioId} />
    </ErrorBoundary>
  );
}
