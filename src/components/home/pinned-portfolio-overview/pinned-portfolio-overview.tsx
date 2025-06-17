"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pin, TrendingUp, TrendingDown, Eye } from "lucide-react";
import { useState, useCallback } from "react";
import { PortfolioSelectDialog } from "./portfolio-select-dialog";
import { PinnedPortfolioOverviewActions } from "./pinned-portfolio-overview-actions";
import { mockPortfolioOverview, mockAvailablePortfolios } from "./mock-data";

interface PinnedPortfolioOverviewProps {
  className?: string;
}

export function PinnedPortfolioOverview({
  className,
}: PinnedPortfolioOverviewProps) {
  const [isChangeDialogOpen, setIsChangeDialogOpen] = useState(false);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [pinnedPortfolio, setPinnedPortfolio] = useState(mockPortfolioOverview);

  const isPositive = pinnedPortfolio.dayChange > 0;

  const handleChangePinnedPortfolio = useCallback(() => {
    setIsDropdownOpen(false);
    // Use requestAnimationFrame to ensure dropdown closes before dialog opens
    requestAnimationFrame(() => {
      setIsChangeDialogOpen(true);
    });
  }, []);

  const handleAddPinnedPortfolio = useCallback(() => {
    setIsDropdownOpen(false);
    // Use requestAnimationFrame to ensure dropdown closes before dialog opens
    requestAnimationFrame(() => {
      setIsAddDialogOpen(true);
    });
  }, []);

  const handlePortfolioSelect = useCallback(
    (portfolioId: string) => {
      const selectedPortfolio = mockAvailablePortfolios.find(
        p => p.id === portfolioId
      );
      if (selectedPortfolio) {
        if (isChangeDialogOpen) {
          // Update the current portfolio
          setPinnedPortfolio(prev => ({
            ...selectedPortfolio,
            dayChange: 2847.32, // Mock data
            dayChangePercent: 1.99, // Mock data
            topHoldings: ["AAPL", "GOOGL", "TSLA"], // Mock data
          }));
        } else if (isAddDialogOpen) {
          // TODO: Implement adding a new portfolio card
          console.log("Adding new portfolio:", selectedPortfolio);
        }
      }
    },
    [isChangeDialogOpen, isAddDialogOpen, mockAvailablePortfolios]
  );

  return (
    <div className={`w-full max-w-4xl ${className}`}>
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
        portfolios={mockAvailablePortfolios}
        selectedPortfolioId={pinnedPortfolio.id}
        onSelect={handlePortfolioSelect}
        title="Change Pinned Portfolio"
        description="Select a portfolio to pin to your dashboard"
      />

      <PortfolioSelectDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        portfolios={mockAvailablePortfolios}
        onSelect={handlePortfolioSelect}
        title="Add Pinned Portfolio"
        description="Select a portfolio to add to your dashboard"
      />
    </div>
  );
}
