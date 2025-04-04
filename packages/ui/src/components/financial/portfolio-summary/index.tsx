// src/components/financial/portfolio-summary-card/portfolio-summary-card.tsx
import React from "react";
// import { cn, formatCurrency, formatPercentage } from "@/lib/utils"
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
  Minus,
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
  (
    {
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
      className,
      ...props
    },
    ref
  ) => {
    return (
      <div className="w-full max-w-3xl mx-auto space-y-4 p-2 sm:p-4 font-mono bg-background text-text-primary">
        {/* Portfolio Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sm:gap-4 mb-2">
          <div>
            <p className="text-xs sm:text-sm text-text-secondary">
              Good Morning
            </p>
            <h1 className="text-xl sm:text-2xl font-bold text-gold-primary">
              {portfolioName}
            </h1>
          </div>
          <div className="flex flex-col items-end">
            <p className="text-xl sm:text-2xl font-bold text-gold-primary">
              08:01 PM
            </p>
            <p className="text-xs sm:text-sm text-text-secondary">
              Mon, Mar 31
            </p>
          </div>
        </div>

        {/* Portfolio Summary Card */}
        <Card className="overflow-hidden shadow-xl border border-divider bg-card">
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
                  <span className="flex items-center text-success text-xs sm:text-sm">
                    <Plus className="h-3 w-3 mr-0.5" />
                    <span>{change24h}%</span>
                  </span>
                </div>
                <div className="flex items-center gap-1 text-success">
                  <ArrowUp className="h-4 w-4 sm:h-5 sm:w-5" />
                  <span className="text-2xl sm:text-3xl font-bold font-mono">
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
                  <span className="font-medium font-mono">4</span>
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

        {/* Overnight Activity */}
        <Card className="shadow-lg border border-divider bg-card">
          <CardHeader className="pb-2 sm:pb-3 border-b border-divider">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base sm:text-lg flex items-center gap-2 text-gold-primary">
                <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-gold-primary/70" />
                Overnight Activity
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-4">
            <div className="rounded-lg p-2 sm:p-3 flex items-start justify-between border border-success/20 border-l-4 border-l-success bg-success/10">
              <div className="flex gap-2 sm:gap-3">
                <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 mt-0.5 text-success" />
                <div>
                  <div className="font-medium text-text-primary text-sm sm:text-base">
                    ETH order filled
                  </div>
                  <div className="text-xs sm:text-sm text-text-secondary">
                    0.42 ETH @ <span className="font-mono">$2,840</span> on
                    Binance
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium font-mono text-gold-primary text-sm sm:text-base">
                  $1,192.80
                </div>
                <div className="text-xs text-text-secondary">03:24 AM</div>
              </div>
            </div>

            <div className="rounded-lg p-2 sm:p-3 flex items-start justify-between border border-warning/20 order-l-4 border-l-warning bg-warning/10">
              <div className="flex gap-2 sm:gap-3">
                <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 mt-0.5 text-warning" />
                <div>
                  <div className="font-medium text-text-primary text-sm sm:text-base">
                    BTC above alert
                  </div>
                  <div className="text-xs sm:text-sm text-text-secondary">
                    Crossed <span className="font-mono">$62,500</span> threshold
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end font-medium font-mono text-success text-sm sm:text-base">
                  <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                  <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                  3.8%
                </div>
                <div className="text-xs text-text-secondary">05:12 AM</div>
              </div>
            </div>

            <div className="rounded-lg p-2 sm:p-3 flex items-start justify-between border border-success/20 border-l-4 border-l-success bg-success/10">
              <div className="flex gap-2 sm:gap-3">
                <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 mt-0.5 text-success" />
                <div>
                  <div className="font-medium text-text-primary text-sm sm:text-base">
                    SOL order filled
                  </div>
                  <div className="text-xs sm:text-sm text-text-secondary">
                    3.5 SOL @ <span className="font-mono">$142</span> on BingX
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-medium font-mono text-gold-primary text-sm sm:text-base">
                  $497.00
                </div>
                <div className="text-xs text-text-secondary">11:42 PM</div>
              </div>
            </div>

            <Button
              variant="ghost"
              className="w-full justify-center text-gold-primary hover:bg-gold-primary/10 transition-colors text-sm sm:text-base"
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
            <div className="rounded-lg p-3 sm:p-4 flex items-start justify-between border border-divider border-l-4 border-l-warning bg-card/70">
              <div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <div className="font-mono text-xs px-1 sm:px-1.5 py-0.5 rounded bg-warning/20 text-warning">
                    BTC
                  </div>
                  <div className="font-medium text-text-primary text-sm sm:text-base">
                    Bitcoin
                  </div>
                  <Badge
                    variant="outline"
                    className="ml-1 text-xs bg-interactive/20 border-gold-primary/50 text-blue-light"
                  >
                    FUTURES
                  </Badge>
                </div>
                <div className="text-xs sm:text-sm mt-1 text-text-secondary">
                  Approaching take-profit zone
                </div>
                <div className="flex items-center gap-1 text-xs mt-1 text-warning">
                  <span className="inline-flex items-center">
                    <span className="font-medium font-mono">5x</span> leverage
                  </span>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end font-medium font-mono text-success text-sm sm:text-base">
                  <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                  <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                  3.8%
                </div>
                <div className="font-medium mt-1 font-mono text-gold-primary text-sm sm:text-base">
                  $62,584
                </div>
              </div>
            </div>

            <div className="rounded-lg p-3 sm:p-4 flex items-start justify-between border border-divider border-l-4 border-l-blue-primary bg-card/70">
              <div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <div className="font-mono text-xs px-1 sm:px-1.5 py-0.5 rounded bg-blue-primary/20 text-blue-primary">
                    ETH
                  </div>
                  <div className="font-medium text-text-primary text-sm sm:text-base">
                    Ethereum
                  </div>
                  <Badge
                    variant="outline"
                    className="ml-1 text-xs bg-interactive/20 border-blue-primary/50 text-blue-light"
                  >
                    SPOT
                  </Badge>
                </div>
                <div className="text-xs sm:text-sm mt-1 text-text-secondary">
                  New position (filled overnight)
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end font-medium font-mono text-success text-sm sm:text-base">
                  <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                  <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                  2.4%
                </div>
                <div className="font-medium mt-1 font-mono text-gold-primary text-sm sm:text-base">
                  $2,850
                </div>
              </div>
            </div>

            <div className="rounded-lg p-3 sm:p-4 flex items-start justify-between border border-divider border-l-4 border-l-purple-500 bg-card/70">
              <div>
                <div className="flex items-center gap-1 sm:gap-2">
                  <div className="font-mono text-xs px-1 sm:px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                    SOL
                  </div>
                  <div className="font-medium text-text-primary text-sm sm:text-base">
                    Solana
                  </div>
                  <Badge
                    variant="outline"
                    className="ml-1 text-xs bg-interactive/20 border-blue-primary/50 text-blue-light"
                  >
                    SPOT
                  </Badge>
                </div>
                <div className="text-xs sm:text-sm mt-1 text-text-secondary">
                  Near stop-loss level
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center justify-end font-medium font-mono text-danger text-sm sm:text-base">
                  <ArrowDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                  <Minus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                  1.2%
                </div>
                <div className="font-medium mt-1 font-mono text-gold-primary text-sm sm:text-base">
                  $138.45
                </div>
              </div>
            </div>
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
              <div className="rounded-lg p-3 sm:p-4 bg-card/70 border border-divider">
                <div className="font-medium mb-2 text-text-primary text-sm sm:text-base">
                  Binance
                </div>
                <div className="flex gap-2 mb-2">
                  <Badge
                    variant="secondary"
                    className="bg-interactive/70 text-blue-light text-xs"
                  >
                    <span className="font-mono">3</span> Spot
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-interactive text-blue-light text-xs"
                  >
                    <span className="font-mono">1</span> Futures
                  </Badge>
                </div>
                <div className="text-base sm:text-lg font-bold font-mono text-success">
                  $3,845.20
                </div>
              </div>

              <div className="rounded-lg p-3 sm:p-4 bg-card/70 border border-divider">
                <div className="font-medium mb-2 text-text-primary text-sm sm:text-base">
                  BingX
                </div>
                <div className="flex gap-2 mb-2">
                  <Badge
                    variant="secondary"
                    className="bg-interactive/70 text-blue-light text-xs"
                  >
                    <span className="font-mono">3</span> Spot
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-interactive/70 text-blue-light text-xs"
                  >
                    <span className="font-mono">2</span> Futures
                  </Badge>
                </div>
                <div className="text-base sm:text-lg font-bold font-mono text-success">
                  $2,842.12
                </div>
              </div>

              <div className="rounded-lg p-3 sm:p-4 bg-card/70 border border-divider">
                <div className="font-medium mb-2 text-text-primary text-sm sm:text-base">
                  Bitget
                </div>
                <div className="flex gap-2 mb-2">
                  <Badge
                    variant="secondary"
                    className="bg-interactive/70 text-blue-light text-xs"
                  >
                    <span className="font-mono">6</span> Spot
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-interactive text-blue-light text-xs"
                  >
                    <span className="font-mono">1</span> Futures
                  </Badge>
                </div>
                <div className="text-base sm:text-lg font-bold font-mono text-success">
                  $3,918.22
                </div>
              </div>

              <div className="rounded-lg p-3 sm:p-4 bg-card/70 border border-divider">
                <div className="font-medium mb-2 text-text-primary text-sm sm:text-base">
                  Bitso
                </div>
                <div className="flex gap-2 mb-2">
                  <Badge
                    variant="secondary"
                    className="bg-interactive text-blue-light text-xs"
                  >
                    <span className="font-mono">2</span> Spot
                  </Badge>
                  <Badge
                    variant="secondary"
                    className="bg-interactive bg-opacity-80 text-text-tertiary border-text-tertiary border-opacity-30 text-xs"
                  >
                    <span className="font-mono">0</span> Futures
                  </Badge>
                </div>
                <div className="text-base sm:text-lg font-bold font-mono text-success">
                  $879.55
                </div>
              </div>
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
                      12
                    </div>
                    <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                      $8,422.50
                    </div>
                    <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                      <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                      <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                      <span>2.1% (24h)</span>
                    </div>
                  </div>

                  <div className="rounded-lg p-3 sm:p-4 text-center border border-gold-primary/30 border-l-4 border-l-gold-primary bg-gold-primary/10">
                    <div className="text-xs sm:text-sm font-medium mb-1 text-gold-primary">
                      Futures Positions
                    </div>
                    <div className="text-2xl sm:text-3xl font-bold font-mono text-text-primary">
                      4
                    </div>
                    <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                      $4,030.39
                    </div>
                    <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                      <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                      <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                      <span>3.4% (24h)</span>
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
                    12
                  </div>
                  <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                    $8,422.50
                  </div>
                  <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                    <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                    <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                    <span>2.1% (24h)</span>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="futures">
                <div className="rounded-lg p-3 sm:p-4 text-center border border-gold-primary/30 border-l-4 border-l-gold-primary bg-gold-primary/10">
                  <div className="text-xs sm:text-sm font-medium mb-1 text-gold-primary">
                    Futures Positions
                  </div>
                  <div className="text-2xl sm:text-3xl font-bold font-mono text-text-primary">
                    4
                  </div>
                  <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                    $4,030.39
                  </div>
                  <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                    <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                    <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                    <span>3.4% (24h)</span>
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
              <Button className="w-full flex items-center justify-center gap-2 transition-colors bg-gold-dark hover:bg-gold-primary text-white focus:ring-2 focus:ring-gold-primary focus:ring-offset-2 focus:outline-none text-sm sm:text-base">
                <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                Refresh Data
              </Button>
              <Button
                variant="outline"
                className="w-full flex items-center justify-center gap-2 transition-colors bg-card border-divider text-gold-primary hover:bg-interactive focus:ring-2 focus:ring-gold-primary focus:ring-offset-2 focus:outline-none text-sm sm:text-base"
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
              // onClick={handleRefresh}
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
PortfolioSummary.displayName = "PortfolioSummaryCard";
