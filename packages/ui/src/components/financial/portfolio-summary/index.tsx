// src/components/financial/portfolio-summary-card/portfolio-summary-card.tsx
import React from "react";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  Clock,
  Eye,
  RefreshCw,
  BarChart3,
  DollarSign,
  Plus,
  // Minus, -> icon for negative changePercentage
} from "lucide-react";

export interface PortfolioSummaryProps
  extends React.HTMLAttributes<HTMLDivElement> {
  // Core data
  portfolioName: string;
  totalValue: number;
  change24h: number;
  positionCounts: {
    spot: number;
    futures: number;
  };
  ordersFilled: number;

  // Activity data
  recentActivity: {
    id: string;
    type: "order_filled" | "alert" | "notification";
    title: string;
    description: string;
    value?: number;
    changePercentage?: number;
    timestamp: string;
  }[];

  // Watchlist data
  watchlist: {
    id: string;
    ticker: string;
    name: string;
    type: "spot" | "futures";
    status: string;
    leverage?: number;
    changePercentage: number;
    currentPrice: number;
  }[];

  // Exchange data
  exchanges: {
    name: string;
    spotCount: number;
    futuresCount: number;
    totalValue: number;
  }[];

  // Position breakdown
  spotPositions: {
    count: number;
    totalValue: number;
    change24h: number;
  };
  futuresPositions: {
    count: number;
    totalValue: number;
    change24h: number;
  };

  // Callbacks
  onRefresh: () => void;
  onViewAllActivity: () => void;
  onFullAnalysis: () => void;

  // Optional
  className?: string;
  isLoading?: boolean;
}

export const PortfolioSummary = React.forwardRef<
  HTMLDivElement,
  PortfolioSummaryProps
>(
  ({
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
    onRefresh = () => {},
    onViewAllActivity = () => {},
    onFullAnalysis = () => {},
  }) => {
    return (
      <div className="w-full max-w-2xl mx-auto space-y-4 p-2 sm:p-4 font-mono bg-background text-text-primary">
        {/* Portfolio Summary Card */}
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

        {/* Recent Activity, previously Overnight Activity (which is the main use case for this component) */}
        <Card className="shadow-lg border border-divider bg-card">
          <CardHeader className="pb-2 sm:pb-3 border-b border-divider">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2 text-gold-primary">
                <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-gold-primary/70" />
                Recent Activity
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-4">
            {recentActivity.map(activity => (
              <div
                key={activity.id}
                className={cn(
                  "rounded-lg p-2 sm:p-3 flex items-start justify-between border border-l-4",
                  activity.type === "order_filled" &&
                    "border-success/20 bg-success/10 border-l-success",
                  activity.type === "alert" &&
                    "border-warning/20 bg-warning/10 border-l-warning"
                )}
              >
                <div className="flex gap-2 sm:gap-3">
                  {activity.type === "order_filled" && (
                    <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 mt-0.5 text-success" />
                  )}
                  {activity.type === "alert" && (
                    <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 mt-0.5 text-warning" />
                  )}
                  <div>
                    <div className="font-medium text-text-primary text-sm sm:text-base">
                      {activity.title}
                    </div>
                    <div className="text-xs sm:text-sm text-text-secondary">
                      {activity.description}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  {activity.type === "order_filled" && (
                    <div className="font-medium font-mono text-gold-primary text-sm sm:text-base">
                      {activity.value}
                    </div>
                  )}

                  {activity.type === "alert" && (
                    <>
                      <div className="flex items-center justify-end font-medium font-mono text-success text-sm sm:text-base">
                        <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                        <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                        {activity.changePercentage}%
                      </div>
                    </>
                  )}

                  <div className="text-xs text-text-secondary">
                    {activity.timestamp}
                  </div>
                </div>
              </div>
            ))}

            <Button
              variant="ghost"
              className="w-full justify-center text-gold-primary hover:bg-gold-primary/10 transition-colors text-sm sm:text-base"
              onClick={onViewAllActivity}
            >
              View all activity
              <ChevronRight className="ml-1 h-3 w-3 sm:h-4 sm:w-4" />
            </Button>
          </CardContent>
        </Card>

        {/* Today's Watchlist */}
        <Card className="shadow-lg border border-divider bg-card">
          <CardHeader className="pb-2 sm:pb-3 border-b border-divider">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2 text-gold-primary">
                <Eye className="h-4 w-4 sm:h-5 sm:w-5 text-gold-primary opacity-70" />
                Today's Watchlist
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-4">
            {watchlist.map(watchlistItem => (
              <div className="rounded-lg p-3 sm:p-4 flex items-start justify-between border border-divider border-l-4 border-l-interactive bg-card/70">
                <div>
                  <div className="flex items-center gap-1 sm:gap-2">
                    <div className="font-mono text-xs px-1 sm:px-1.5 py-0.5 rounded bg-interactive/50 text-secondary">
                      {watchlistItem.ticker}
                    </div>
                    <div className="font-medium text-text-primary text-sm sm:text-base">
                      {watchlistItem.name}
                    </div>
                    <Badge
                      variant="outline"
                      className="ml-1 text-xs bg-interactive/20 border-blue-primary/50 uppercase text-blue-light"
                    >
                      {watchlistItem.type}
                    </Badge>
                  </div>
                  <div className="text-xs sm:text-sm mt-1 text-text-secondary">
                    {watchlistItem.status}
                  </div>

                  {watchlistItem.leverage && (
                    <div className="flex items-center gap-1 text-xs mt-1 text-warning">
                      <span className="inline-flex items-center">
                        <span className="font-medium font-mono">
                          {watchlistItem.leverage}x
                        </span>{" "}
                        leverage
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-right">
                  <div
                    className={cn(
                      "flex items-center justify-end font-medium font-mono text-sm sm:text-base",
                      watchlistItem.changePercentage > 0 && "text-success",
                      watchlistItem.changePercentage < 0 && "text-danger"
                    )}
                  >
                    {watchlistItem.changePercentage > 0 ? (
                      <>
                        <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                        <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                        {watchlistItem.changePercentage}%
                      </>
                    ) : (
                      <>
                        <ArrowDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                        {/* TODO: props send changePercentage as negative, maybe
												it should send absolute value and we handle the sign here? */}
                        {/* <Minus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" /> */}
                        {watchlistItem.changePercentage}%
                      </>
                    )}
                  </div>
                  <div className="font-medium mt-1 font-mono text-gold-primary text-sm sm:text-base">
                    {watchlistItem.currentPrice}
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Exchange Overview */}
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
                <div className="rounded-lg p-3 sm:p-4  bg-card/70 border border-divider">
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
                      <span className="font-mono">{exchange.spotCount}</span>{" "}
                      Spot
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

        {/* Position Breakdown */}
        <Card className="shadow-lg border border-divider bg-card">
          <CardHeader className="pb-2 sm:pb-3 border-b border-divider">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2 text-gold-primary">
                <BarChart3 className="h-4 w-4 sm:h-5 sm:w-5 text-gold-primary/70" />
                Position Breakdown
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-4">
            <Tabs defaultValue="all" className="w-full">
              <TabsList className="grid w-full grid-cols-3 mb-3 sm:mb-4 bg-interactive">
                <TabsTrigger
                  value="all"
                  className="data-[state=active]:bg-gold-dark data-[state=active]:text-white text-xs sm:text-sm"
                >
                  All
                </TabsTrigger>
                <TabsTrigger
                  value="spot"
                  className="data-[state=active]:bg-gold-dark data-[state=active]:text-white text-xs sm:text-sm"
                >
                  Spot
                </TabsTrigger>
                <TabsTrigger
                  value="futures"
                  className="data-[state=active]:bg-gold-dark data-[state=active]:text-white text-xs sm:text-sm"
                >
                  Futures
                </TabsTrigger>
              </TabsList>
              <TabsContent value="all" className="space-y-3 sm:space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="rounded-lg p-3 sm:p-4 text-center border border-blue-primary/30 border-l-4 border-l-blue-primary bg-blue-primary/10">
                    <div className="text-xs sm:text-sm font-medium mb-1 text-blue-primary">
                      Spot Positions
                    </div>
                    <div className="text-2xl sm:text-3xl font-bold font-mono text-text-primary">
                      {spotPositions.count}
                    </div>
                    <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                      {spotPositions.totalValue}
                    </div>
                    <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                      {spotPositions.change24h > 0 ? (
                        <>
                          <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                          <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                          <span>{spotPositions.change24h}% (24h)</span>
                        </>
                      ) : (
                        <>
                          <ArrowDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5 text-danger" />
                          <span className="text-danger">
                            {spotPositions.change24h}% (24h)
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg p-3 sm:p-4 text-center border border-gold-primary/30 border-l-4 border-l-gold-primary bg-gold-primary/10">
                    <div className="text-xs sm:text-sm font-medium mb-1 text-gold-primary">
                      Futures Positions
                    </div>
                    <div className="text-2xl sm:text-3xl font-bold font-mono text-text-primary">
                      {futuresPositions.count}
                    </div>
                    <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                      {futuresPositions.totalValue}
                    </div>
                    <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                      {futuresPositions.change24h > 0 ? (
                        <>
                          <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                          <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                          <span>{futuresPositions.change24h}% (24h)</span>
                        </>
                      ) : (
                        <>
                          <ArrowDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5 text-danger" />
                          <span className="text-danger">
                            {futuresPositions.change24h}% (24h)
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="spot">
                <div className="rounded-lg p-3 sm:p-4 text-center border border-blue-primary/30 border-l-4 border-l-blue-primary bg-blue-primary/10">
                  <div className="text-xs sm:text-sm font-medium mb-1 text-blue-primary">
                    Spot Positions
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-text-primary">
                    {spotPositions.count}
                  </div>
                  <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                    {spotPositions.totalValue}
                  </div>
                  <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                    {spotPositions.change24h > 0 ? (
                      <>
                        <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                        <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                        <span>{spotPositions.change24h}% (24h)</span>
                      </>
                    ) : (
                      <>
                        <ArrowDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5 text-danger" />
                        <span className="text-danger">
                          {spotPositions.change24h}% (24h)
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="futures">
                <div className="rounded-lg p-3 sm:p-4 text-center border border-gold-primary/30 border-l-4 border-l-gold-primary bg-gold-primary/10">
                  <div className="text-xs sm:text-sm font-medium mb-1 text-gold-primary">
                    Futures Positions
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-text-primary">
                    {futuresPositions.count}
                  </div>
                  <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                    {futuresPositions.totalValue}
                  </div>
                  <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                    {futuresPositions.change24h > 0 ? (
                      <>
                        <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                        <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                        <span>{futuresPositions.change24h}% (24h)</span>
                      </>
                    ) : (
                      <>
                        <ArrowDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5 text-danger" />
                        <span className="text-danger">
                          {futuresPositions.change24h}% (24h)
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card className="shadow-lg border border-divider bg-card">
          <CardHeader className="pb-2 sm:pb-3 border-b border-divider">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base sm:text-lg text-gold-primary">
                Quick Actions
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="p-3 sm:p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <Button
                className="w-full flex items-center justify-center gap-2 transition-colors bg-gold-dark hover:bg-gold-primary text-white focus:ring-2 focus:ring-gold-primary focus:ring-offset-2 focus:outline-none text-sm sm:text-base"
                onClick={onRefresh}
              >
                <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                Refresh Data
              </Button>
              <Button
                variant="outline"
                className="w-full flex items-center justify-center gap-2 transition-colors bg-card border-divider text-gold-primary hover:bg-interactive focus:ring-2 focus:ring-gold-primary focus:ring-offset-2 focus:outline-none text-sm sm:text-base"
                onClick={onFullAnalysis}
              >
                <BarChart3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                Full Analysis
              </Button>
            </div>
          </CardContent>
          <CardFooter className="flex items-center justify-between px-4 sm:px-6 py-2 sm:py-3 border-t border-divider">
            <div className="flex items-center text-xs sm:text-sm text-text-secondary">
              <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1" />
              Last updated: 08:41 p.m.
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              className="p-1 h-auto transition-colors text-gold-primary hover:bg-gold-primary hover:bg-opacity-10 focus:ring-2 focus:ring-gold-primary focus:outline-none"
            >
              <RefreshCw className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="sr-only">Refresh</span>
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }
);
PortfolioSummary.displayName = "PortfolioSummary";
