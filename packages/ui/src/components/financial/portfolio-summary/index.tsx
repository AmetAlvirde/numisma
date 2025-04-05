// src/components/financial/portfolio-summary-card/portfolio-summary-card.tsx
import React from "react";
import {
  PortfolioSummaryCard,
  PortfolioSummaryCardProps,
} from "@/components/financial/portfolio-summary/portfolio-summary-card";
import {
  PortfolioSummaryRecentActivity,
  PortfolioSummaryRecentActivityProps,
} from "@/components/financial/portfolio-summary/portfolio-summary-recent-activity";
import {
  PortfolioSummaryWatchlist,
  PortfolioSummaryWatchlistProps,
} from "@/components/financial/portfolio-summary/portfolio-summary-watchlist";
import {
  PortfolioSummaryExchangeOverview,
  PortfolioSummaryExchangeOverviewProps,
} from "@/components/financial/portfolio-summary/portfolio-summary-exchange-overview";
import {
  PortfolioSummaryPositionBreakdown,
  PortfolioSummaryPositionBreakdownProps,
} from "@/components/financial/portfolio-summary/portfolio-summary-position-breakdown";
import {
  PortfolioSummaryQuickActions,
  PortfolioSummaryQuickActionsProps,
} from "@/components/financial/portfolio-summary/portfolio-summary-quick-actions";

export interface PortfolioSummaryProps
  extends React.HTMLAttributes<HTMLDivElement>,
    PortfolioSummaryCardProps,
    PortfolioSummaryRecentActivityProps,
    PortfolioSummaryWatchlistProps,
    PortfolioSummaryExchangeOverviewProps,
    PortfolioSummaryPositionBreakdownProps,
    PortfolioSummaryQuickActionsProps {
  //optional
  className?: string;
  isLoading?: boolean;
}

export const PortfolioSummary: React.FC<PortfolioSummaryProps> = ({
  portfolioName,
  totalValue,
  change24h,
  positionCounts,
  ordersFilled,
  recentActivity,
  watchlist,
  exchanges,
  spotPositions,
  futuresPositions,
  onRefresh,
  onViewAllActivity,
  onFullAnalysis,
}) => {
  return (
    <div className="w-full max-w-2xl mx-auto space-y-4 p-2 sm:p-4 font-mono bg-background text-text-primary">
      <PortfolioSummaryCard
        portfolioName={portfolioName}
        totalValue={totalValue}
        change24h={change24h}
        positionCounts={positionCounts}
        ordersFilled={ordersFilled}
      />

      <PortfolioSummaryRecentActivity
        recentActivity={recentActivity}
        onViewAllActivity={onViewAllActivity}
      />

      <PortfolioSummaryWatchlist watchlist={watchlist} />

      <PortfolioSummaryExchangeOverview exchanges={exchanges} />

      <PortfolioSummaryPositionBreakdown
        spotPositions={spotPositions}
        futuresPositions={futuresPositions}
      />

      <PortfolioSummaryQuickActions
        onRefresh={onRefresh}
        onFullAnalysis={onFullAnalysis}
      />
    </div>
  );
};

PortfolioSummary.displayName = "PortfolioSummary";
