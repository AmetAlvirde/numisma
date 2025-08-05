"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Pin,
  TrendingUp,
  TrendingDown,
  Eye,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { PortfolioSelectDialog } from "./portfolio-select-dialog";
import { PinnedPortfolioOverviewActions } from "./pinned-portfolio-overview-actions";
import {
  usePinnedPortfolio,
  useUserPortfolios,
  useSetPinnedPortfolio,
} from "@/hooks/use-portfolio-data";
import { useState, useCallback, useMemo } from "react";

interface PinnedPortfolioOverviewProps {
  className?: string;
}

export function PinnedPortfolioOverview({
  className,
}: PinnedPortfolioOverviewProps) {
  // State for dialog management
  const [isChangeDialogOpen, setIsChangeDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  // Real data hooks
  const {
    pinnedPortfolio,
    isLoading: isPinnedLoading,
    isError: isPinnedError,
    error: pinnedError,
    hasPinnedPortfolio,
  } = usePinnedPortfolio();

  const {
    portfolios: rawPortfolios,
    isLoading: isPortfoliosLoading,
    isError: isPortfoliosError,
  } = useUserPortfolios();

  // Convert Decimal totalValue to number for dialog compatibility
  const availablePortfolios = useMemo(() => {
    return rawPortfolios.map(portfolio => ({
      ...portfolio,
      totalValue: Number(portfolio.totalValue),
    }));
  }, [rawPortfolios]);

  // Mutation hook for setting pinned portfolio
  const {
    setPinnedPortfolio,
    isLoading: isSettingPinned,
    isError: isPinError,
    error: pinError,
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
    (portfolioId: string) => {
      try {
        const selectedPortfolio = availablePortfolios.find(
          p => p.id === portfolioId
        );

        if (!selectedPortfolio) {
          console.error("Portfolio not found:", portfolioId);
          return;
        }

        if (isChangeDialogOpen) {
          // Set the selected portfolio as pinned
          setPinnedPortfolio(
            { portfolioId },
            {
              onSuccess: () => {
                console.log(
                  "Successfully changed pinned portfolio to:",
                  selectedPortfolio.name
                );
                setIsChangeDialogOpen(false);
              },
              onError: error => {
                console.error("Failed to change pinned portfolio:", error);
                // Keep dialog open on error so user can retry
              },
            }
          );
        } else if (isAddDialogOpen) {
          // For "add" dialog, also pin the selected portfolio
          setPinnedPortfolio(
            { portfolioId },
            {
              onSuccess: () => {
                console.log(
                  "Successfully pinned new portfolio:",
                  selectedPortfolio.name
                );
                setIsAddDialogOpen(false);
              },
              onError: error => {
                console.error("Failed to pin portfolio:", error);
                // Keep dialog open on error so user can retry
              },
            }
          );
        }
      } catch (error) {
        console.error("Error selecting portfolio:", error);
      }
    },
    [
      availablePortfolios,
      isChangeDialogOpen,
      isAddDialogOpen,
      setPinnedPortfolio,
    ]
  );

  // Loading state
  if (isPinnedLoading) {
    return (
      <div className={`w-full max-w-6xl ${className}`}>
        <Card className="relative gap-0">
          <CardContent className="p-6">
            <div className="flex items-center justify-center space-x-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm text-muted-foreground">
                Loading portfolio...
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (isPinnedError) {
    return (
      <div className={`w-full max-w-6xl ${className}`}>
        <Card className="relative gap-0">
          <CardContent className="p-6">
            <div className="flex items-center justify-center space-x-2 text-red-600">
              <AlertCircle className="h-4 w-4" />
              <span className="text-sm">
                Failed to load portfolio:{" "}
                {pinnedError?.message || "Unknown error"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show mutation error as overlay if pinning fails
  const showMutationError = isPinError && pinError;
  if (showMutationError) {
    console.warn("Portfolio mutation error:", pinError.message);
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
              <Button onClick={handleAddPinnedPortfolio} variant="outline">
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
    </div>
  );
}
