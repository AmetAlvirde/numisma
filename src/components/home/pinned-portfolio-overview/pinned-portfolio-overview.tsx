"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pin, TrendingUp, TrendingDown, Eye } from "lucide-react";
import { PortfolioSelectDialog } from "./portfolio-select-dialog";
import { PinnedPortfolioOverviewActions } from "./pinned-portfolio-overview-actions";
import {
  usePinnedPortfolio,
  useUserPortfolios,
  useSetPinnedPortfolio,
} from "@/hooks/use-portfolio-data";
import { useState, useCallback, useMemo } from "react";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import {
  PortfolioLoadingSkeleton,
  PortfolioErrorFallback,
  TrpcErrorFallback,
  NetworkStatusIndicator,
  NoPortfoliosFallback,
} from "@/components/ui/portfolio-fallbacks";

interface PinnedPortfolioOverviewProps {
  className?: string;
}

function PinnedPortfolioOverviewContent({
  className,
}: PinnedPortfolioOverviewProps) {
  // State for dialog management
  const [isChangeDialogOpen, setIsChangeDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Data hooks with comprehensive error handling
  const {
    pinnedPortfolio,
    isLoading: isPinnedLoading,
    isError: isPinnedError,
    error: pinnedError,
    errorContext: pinnedErrorContext,
    hasPinnedPortfolio,
    retryQuery: retryPinnedQuery,
    networkStatus,
  } = usePinnedPortfolio();

  const {
    portfolios: rawPortfolios,
    isLoading: isPortfoliosLoading,
    isError: isPortfoliosError,
    retryQuery: retryPortfoliosQuery,
  } = useUserPortfolios();

  // Convert Decimal totalValue to number for dialog compatibility
  const availablePortfolios = useMemo(() => {
    return rawPortfolios.map(portfolio => ({
      ...portfolio,
      totalValue: Number(portfolio.totalValue),
    }));
  }, [rawPortfolios]);

  // Mutation hook with retry capabilities
  const {
    setPinnedPortfolioWithRetry,
    isLoading: isSettingPinned,
    isError: isPinError,
  } = useSetPinnedPortfolio();

  // Computed values
  const isPositive = useMemo(
    () => pinnedPortfolio?.dayChange && pinnedPortfolio.dayChange > 0,
    [pinnedPortfolio?.dayChange]
  );

  // Event handlers
  const handleChangePinnedPortfolio = useCallback(() => {
    setIsDropdownOpen(false);
    requestAnimationFrame(() => {
      setIsChangeDialogOpen(true);
    });
  }, []);

  const handleAddPinnedPortfolio = useCallback(() => {
    setIsDropdownOpen(false);
    requestAnimationFrame(() => {
      setIsAddDialogOpen(true);
    });
  }, []);

  const handlePortfolioSelect = useCallback(
    async (portfolioId: string) => {
      try {
        const selectedPortfolio = availablePortfolios.find(
          p => p.id === portfolioId
        );

        if (!selectedPortfolio) {
          console.error("Portfolio not found:", portfolioId);
          return;
        }

        if (isChangeDialogOpen) {
          // Use retry mechanism
          await setPinnedPortfolioWithRetry({ portfolioId });
          console.log(
            "Successfully changed pinned portfolio to:",
            selectedPortfolio.name
          );
          setIsChangeDialogOpen(false);
        } else if (isAddDialogOpen) {
          // Use retry mechanism
          await setPinnedPortfolioWithRetry({ portfolioId });
          console.log(
            "Successfully pinned new portfolio:",
            selectedPortfolio.name
          );
          setIsAddDialogOpen(false);
        }
      } catch (error) {
        console.error("Error selecting portfolio:", error);
        // Keep dialog open on error so user can retry
        // Error will be displayed via the error context
      }
    },
    [
      availablePortfolios,
      isChangeDialogOpen,
      isAddDialogOpen,
      setPinnedPortfolioWithRetry,
    ]
  );

  // Global retry handler for all portfolio operations
  const handleRetryAll = useCallback(async () => {
    try {
      await Promise.all([retryPinnedQuery(), retryPortfoliosQuery()]);
    } catch (error) {
      console.error("Failed to retry portfolio operations:", error);
    }
  }, [retryPinnedQuery, retryPortfoliosQuery]);

  // Loading state with skeleton
  if (isPinnedLoading && !pinnedPortfolio) {
    return <PortfolioLoadingSkeleton className={className} />;
  }

  // Network-specific error handling
  if (!networkStatus.isOnline) {
    return (
      <div className={className}>
        <PortfolioErrorFallback onRetry={networkStatus.testConnection} />
        <NetworkStatusIndicator
          isOnline={networkStatus.isOnline}
          onRetryConnection={networkStatus.testConnection}
        />
      </div>
    );
  }

  // Error handling with specific error types
  if (isPinnedError && pinnedErrorContext) {
    if (pinnedErrorContext.isClientError) {
      return (
        <TrpcErrorFallback
          error={pinnedError}
          onRetry={pinnedErrorContext.canRetry ? retryPinnedQuery : undefined}
          className={className}
        />
      );
    } else {
      return (
        <PortfolioErrorFallback
          onRetry={pinnedErrorContext.canRetry ? retryPinnedQuery : undefined}
          className={className}
        />
      );
    }
  }

  // Handle case where user has no portfolios at all
  if (
    !isPortfoliosLoading &&
    !isPortfoliosError &&
    availablePortfolios.length === 0
  ) {
    return <NoPortfoliosFallback className={className} />;
  }

  // No pinned portfolio state
  if (!hasPinnedPortfolio || !pinnedPortfolio) {
    return (
      <div className={`w-full max-w-6xl ${className}`}>
        <Card className="relative gap-0">
          <CardContent className="p-6">
            <div className="text-center space-y-3">
              <Pin className="h-8 w-8 mx-auto text-muted-foreground" />
              <div>
                <h3 className="text-lg font-medium">No Pinned Portfolio</h3>
                <p className="text-sm text-muted-foreground">
                  Pin a portfolio to see it on your dashboard
                </p>
              </div>
              <Button
                onClick={handleAddPinnedPortfolio}
                variant="outline"
                disabled={
                  isPortfoliosLoading || availablePortfolios.length === 0
                }
              >
                Pin a Portfolio
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={`w-full max-w-6xl ${className}`}>
      <Card className="relative gap-0">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-muted-foreground">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Pin className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                <span className="text-base font-semibold text-muted-foreground">
                  {pinnedPortfolio.name}
                </span>
              </div>
              <PinnedPortfolioOverviewActions
                isDropdownOpen={isDropdownOpen}
                onDropdownOpenChange={setIsDropdownOpen}
                onChangePinnedPortfolio={handleChangePinnedPortfolio}
                onAddPinnedPortfolio={handleAddPinnedPortfolio}
              />
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="space-y-3">
            {/* Portfolio Value */}
            <div>
              <div className="flex items-end justify-between">
                <p className="text-2xl font-bold">
                  $
                  {pinnedPortfolio.totalValue.toLocaleString("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                </p>
                <div
                  className={`flex items-center space-x-1 ${
                    isPositive ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {isPositive ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  <span className="text-sm font-medium">
                    {isPositive ? "+" : ""}
                    {pinnedPortfolio.dayChangePercent.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Top Holdings Preview */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-xs text-muted-foreground">Top:</span>
                <div className="flex space-x-1">
                  {pinnedPortfolio.topHoldings.map(symbol => (
                    <Badge
                      key={symbol}
                      variant="secondary"
                      className="text-xs px-2 py-0.5"
                    >
                      {symbol}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-6 px-2"
                type="button"
              >
                <Eye className="h-3 w-3 mr-1" />
                View
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Portfolio Selection Dialogs */}
      <PortfolioSelectDialog
        open={isChangeDialogOpen}
        onOpenChange={setIsChangeDialogOpen}
        portfolios={availablePortfolios}
        selectedPortfolioId={pinnedPortfolio?.id}
        onSelect={handlePortfolioSelect}
        title="Change Pinned Portfolio"
        description="Select a portfolio to pin to your dashboard"
        isLoading={isPortfoliosLoading || isSettingPinned}
        isError={isPortfoliosError || isPinError}
      />

      <PortfolioSelectDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        portfolios={availablePortfolios}
        onSelect={handlePortfolioSelect}
        title="Add Pinned Portfolio"
        description="Select a portfolio to add to your dashboard"
        isLoading={isPortfoliosLoading || isSettingPinned}
        isError={isPortfoliosError || isPinError}
      />

      {/* Global network status indicator */}
      <NetworkStatusIndicator
        isOnline={networkStatus.isOnline}
        onRetryConnection={handleRetryAll}
      />
    </div>
  );
}

// Component with error boundary
export function PinnedPortfolioOverview({
  className,
}: PinnedPortfolioOverviewProps) {
  return (
    <ErrorBoundary
      title="Portfolio Overview Error"
      description="There was an error loading your portfolio overview. This might be a temporary issue."
      onError={(error, errorInfo) => {
        console.error("PinnedPortfolioOverview error:", error, errorInfo);

        // TODO: Report to error monitoring service
        // Sentry.captureException(error, { extra: errorInfo });
      }}
      resetKeys={[className || ""]} // Reset on prop changes
      showErrorDetails={process.env.NODE_ENV === "development"}
      fallback={
        <PortfolioErrorFallback
          onRetry={() => window.location.reload()}
          className={className}
        />
      }
    >
      <PinnedPortfolioOverviewContent className={className} />
    </ErrorBoundary>
  );
}
