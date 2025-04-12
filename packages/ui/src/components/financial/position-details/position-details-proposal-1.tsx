import React from "react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar } from "@/components/ui/avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ArrowUp,
  ArrowDown,
  Clock,
  Pencil,
  BookOpen,
  AlertTriangle,
  X,
  RefreshCw,
  Tag,
  BarChart3,
  ChevronLeft,
  ChevronDown,
  Calendar,
  CheckCircle2,
  Wallet,
  Building2,
  ArrowLeftRight,
} from "lucide-react";

import { PositionDetailsComponentProps } from "@/components/financial/position-details/mock-data";
// import {
//   CapitalTier,
//   PositionLifecycle,
//   PositionStatus,
//   OrderStatus,
//   OrderPurpose,
// } from "@/types";

// Helper functions for formatting
const formatCurrency = (value: number): string => {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value);
};

const formatPercentage = (value: number): string => {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
};

const formatDate = (date: Date | null | undefined): string => {
  if (!date) return "N/A";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(date);
};

// Component for Position Header with key information
const PositionHeader: React.FC<{
  position: PositionDetailsComponentProps["position"];
  onBack?: () => void;
}> = ({ position, onBack }) => {
  const {
    name,
    asset,
    positionDetails,
    riskLevel,
    lifecycle,
    capitalTier,
    currentValue,
  } = position;
  const { currentReturn, unrealizedProfitLoss } = positionDetails;

  // Determine status color based on lifecycle
  const lifecycleColor = {
    [PositionLifecycle.ACTIVE]: "bg-success/20 border-success/50 text-success",
    [PositionLifecycle.PLANNED]: "bg-info/20 border-info/50 text-info",
    [PositionLifecycle.CLOSED]:
      "bg-text-tertiary/20 border-text-tertiary/50 text-text-tertiary",
    [PositionLifecycle.CANCELLED]: "bg-danger/20 border-danger/50 text-danger",
  }[lifecycle];

  // Determine capital tier color and label
  const capitalTierInfo = {
    [CapitalTier.C1]: {
      color: "bg-gold-primary/20 border-gold-primary/50 text-gold-primary",
      label: "Fresh Capital",
    },
    [CapitalTier.C2]: {
      color: "bg-blue-primary/20 border-blue-primary/50 text-blue-primary",
      label: "Realized Profits",
    },
    [CapitalTier.C3]: {
      color: "bg-success/20 border-success/50 text-success",
      label: "Compound Growth C2",
    },
    [CapitalTier.C4]: {
      color: "bg-success/20 border-success/50 text-success",
      label: "Compound Growth C3",
    },
    [CapitalTier.C5]: {
      color: "bg-success/20 border-success/50 text-success",
      label: "Compound Growth C4",
    },
  }[capitalTier];

  // Risk level color and label
  const getRiskLevelInfo = (level: number) => {
    if (level <= 3)
      return {
        color: "bg-success/20 border-success/50 text-success",
        label: "Conservative",
      };
    if (level <= 7)
      return {
        color: "bg-warning/20 border-warning/50 text-warning",
        label: "Balanced",
      };
    return {
      color: "bg-danger/20 border-danger/50 text-danger",
      label: "Speculative",
    };
  };

  const riskLevelInfo = getRiskLevelInfo(riskLevel);

  return (
    <div className="flex flex-col w-full bg-card border border-divider rounded-lg overflow-hidden shadow-lg">
      <div className="p-4 border-b border-divider">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center">
            {onBack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onBack}
                className="mr-2"
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                <span className="text-sm">Back</span>
              </Button>
            )}
            <h1 className="text-lg sm:text-xl font-bold text-text-primary">
              {name}
            </h1>
          </div>
          <div className="flex items-center space-x-2">
            <Badge variant="outline" className={lifecycleColor}>
              {lifecycle}
            </Badge>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center">
            <Avatar className="h-10 w-10 mr-3">
              {asset.iconUrl ? (
                <img
                  src={asset.iconUrl}
                  alt={asset.ticker}
                  className="object-cover"
                />
              ) : (
                <div className="bg-blue-primary/20 h-full w-full flex items-center justify-center text-blue-primary font-bold">
                  {asset.ticker.slice(0, 2)}
                </div>
              )}
            </Avatar>
            <div>
              <div className="flex items-center">
                <span className="text-lg font-bold text-text-primary">
                  {asset.ticker}
                </span>
                <span className="ml-2 text-sm text-text-secondary">
                  {asset.name}
                </span>
              </div>
              <div className="flex items-center text-sm space-x-2">
                <Badge
                  variant="outline"
                  className="bg-interactive/20 border-interactive/50 text-text-secondary text-xs"
                >
                  <Building2 className="h-3 w-3 mr-1" />
                  {asset.exchange || "Unknown Exchange"}
                </Badge>
                <Badge
                  variant="outline"
                  className="bg-interactive/20 border-interactive/50 text-text-secondary text-xs"
                >
                  <Wallet className="h-3 w-3 mr-1" />
                  {asset.wallet}
                </Badge>
              </div>
            </div>
          </div>

          <div className="flex flex-col items-end">
            <div className="text-xl sm:text-2xl font-bold font-mono">
              {formatCurrency(currentValue || 0)}
            </div>
            <div className="flex items-center">
              {(currentReturn || 0) >= 0 ? (
                <ArrowUp className="h-4 w-4 text-success mr-1" />
              ) : (
                <ArrowDown className="h-4 w-4 text-danger mr-1" />
              )}
              <span
                className={cn(
                  "font-medium",
                  (currentReturn || 0) >= 0 ? "text-success" : "text-danger"
                )}
              >
                {formatPercentage(currentReturn || 0)}
              </span>
              <span className="mx-1 text-text-tertiary">|</span>
              <span
                className={cn(
                  "font-mono",
                  (unrealizedProfitLoss || 0) >= 0
                    ? "text-success"
                    : "text-danger"
                )}
              >
                {formatCurrency(unrealizedProfitLoss || 0)}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="p-3 bg-card/70 border-b border-divider">
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className={capitalTierInfo.color}>
            <Tag className="h-3 w-3 mr-1" />
            <span>{capitalTierInfo.label}</span>
          </Badge>
          <Badge variant="outline" className={riskLevelInfo.color}>
            <AlertTriangle className="h-3 w-3 mr-1" />
            <span>
              Risk: {riskLevel}/10 ({riskLevelInfo.label})
            </span>
          </Badge>
          <Badge
            variant="outline"
            className="bg-interactive/20 border-blue-primary/50 text-blue-light"
          >
            <Clock className="h-3 w-3 mr-1" />
            <span>{positionDetails.timeFrame} Timeframe</span>
          </Badge>
          <Badge
            variant="outline"
            className="bg-interactive/20 border-blue-primary/50 text-blue-light"
          >
            <Calendar className="h-3 w-3 mr-1" />
            <span>Opened: {formatDate(positionDetails.dateOpened)}</span>
          </Badge>
          {positionDetails.isLeveraged && (
            <Badge
              variant="outline"
              className="bg-warning/20 border-warning/50 text-warning"
            >
              <ArrowLeftRight className="h-3 w-3 mr-1" />
              <span>{positionDetails.leverage}x Leverage</span>
            </Badge>
          )}
        </div>
      </div>

      <div className="px-4 py-2 flex justify-end space-x-2 bg-background/50">
        <Button size="sm" variant="outline">
          <Pencil className="h-4 w-4 mr-1" />
          <span className="text-xs">Edit</span>
        </Button>
        <Button size="sm" variant="outline">
          <BookOpen className="h-4 w-4 mr-1" />
          <span className="text-xs">Journal</span>
        </Button>
        {position.positionDetails.status === PositionStatus.ACTIVE && (
          <Button
            size="sm"
            variant="outline"
            className="text-danger hover:text-danger hover:bg-danger/10"
          >
            <X className="h-4 w-4 mr-1" />
            <span className="text-xs">Close</span>
          </Button>
        )}
      </div>
    </div>
  );
};

// Component for performance metrics
const PerformanceMetrics: React.FC<{
  position: PositionDetailsComponentProps["position"];
}> = ({ position }) => {
  const { positionDetails, asset } = position;
  const {
    averageEntryPrice,
    totalSize,
    totalCost,
    unrealizedProfitLoss,
    currentReturn,
    riskRewardRatio,
    stopPrice,
    targetPrice,
  } = positionDetails;

  const currentPrice = asset.marketData?.currentPrice || 0;
  const priceChange = asset.marketData?.priceChangePercentage24h || 0;

  // Calculate distance to stop and target
  const distanceToStop = stopPrice
    ? ((currentPrice - stopPrice) / currentPrice) * 100
    : 0;
  const distanceToTarget = targetPrice
    ? ((targetPrice - currentPrice) / currentPrice) * 100
    : 0;

  // Calculate position between stop, entry and target for the progress bar
  const calculateProgressValue = () => {
    if (!stopPrice || !targetPrice) return 50;

    const totalRange = targetPrice - stopPrice;
    const currentDistance = currentPrice - stopPrice;

    return Math.max(0, Math.min(100, (currentDistance / totalRange) * 100));
  };

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center">
          <BarChart3 className="h-4 w-4 mr-2 text-gold-primary" />
          Performance Metrics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <p className="text-xs text-text-tertiary">Current Price</p>
            <div className="flex items-center">
              <span className="text-base font-medium font-mono">
                {formatCurrency(currentPrice)}
              </span>
              <Badge
                variant="outline"
                className={cn(
                  "ml-2 text-xs",
                  priceChange >= 0 ? "text-success" : "text-danger"
                )}
              >
                {formatPercentage(priceChange)}
              </Badge>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-text-tertiary">Entry Price</p>
            <span className="text-base font-medium font-mono">
              {formatCurrency(averageEntryPrice || 0)}
            </span>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-text-tertiary">Position Size</p>
            <div className="flex items-center">
              <span className="text-base font-medium">
                {totalSize} {asset.ticker}
              </span>
            </div>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-text-tertiary">Position Cost</p>
            <span className="text-base font-medium font-mono">
              {formatCurrency(totalCost || 0)}
            </span>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-text-tertiary">Unrealized P/L</p>
            <span
              className={cn(
                "text-base font-medium font-mono",
                (unrealizedProfitLoss || 0) >= 0
                  ? "text-success"
                  : "text-danger"
              )}
            >
              {formatCurrency(unrealizedProfitLoss || 0)}
            </span>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-text-tertiary">Return</p>
            <span
              className={cn(
                "text-base font-medium",
                (currentReturn || 0) >= 0 ? "text-success" : "text-danger"
              )}
            >
              {formatPercentage(currentReturn || 0)}
            </span>
          </div>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-danger">
              Stop Loss: {formatCurrency(stopPrice || 0)}
            </span>
            <span className="text-success">
              Target: {formatCurrency(targetPrice || 0)}
            </span>
          </div>
          <Progress value={calculateProgressValue()} className="h-2" />
          <div className="flex justify-between text-xs">
            <span className="text-text-tertiary">
              Distance to Stop: {formatPercentage(distanceToStop)}
            </span>
            <span className="text-text-tertiary">
              Distance to Target: {formatPercentage(distanceToTarget)}
            </span>
          </div>
        </div>

        <Separator />

        <div className="space-y-1 text-center">
          <p className="text-xs text-text-tertiary">Risk-to-Reward Ratio</p>
          <div className="text-lg font-bold">
            {riskRewardRatio?.toFixed(2) || "N/A"}:1
          </div>
          <Badge
            className={cn(
              "text-xs mt-1",
              (riskRewardRatio || 0) >= 2
                ? "bg-success"
                : (riskRewardRatio || 0) >= 1
                  ? "bg-warning"
                  : "bg-danger"
            )}
          >
            {(riskRewardRatio || 0) >= 2
              ? "Excellent"
              : (riskRewardRatio || 0) >= 1
                ? "Acceptable"
                : "Poor"}
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
};

// Component for Order panels
const OrdersPanel: React.FC<{
  position: PositionDetailsComponentProps["position"];
}> = ({ position }) => {
  const { positionDetails } = position;
  const { orders, stopLoss, takeProfit } = positionDetails;

  const currentPrice = position.asset.marketData?.currentPrice || 0;

  const entryOrders = orders.filter(
    order => order.purpose === OrderPurpose.ENTRY
  );
  const exitOrders = orders.filter(
    order => order.purpose === OrderPurpose.EXIT
  );

  const getOrderStatusColor = (status: OrderStatus) => {
    switch (status) {
      case OrderStatus.FILLED:
        return "text-success";
      case OrderStatus.SUBMITTED:
        return "text-info";
      case OrderStatus.PARTIALLY_FILLED:
        return "text-warning";
      case OrderStatus.CANCELLED:
        return "text-danger";
      case OrderStatus.EXPIRED:
        return "text-text-tertiary";
      default:
        return "text-text-secondary";
    }
  };

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="entry">
          <TabsList className="grid grid-cols-4 w-full mb-4">
            <TabsTrigger value="entry">Entry</TabsTrigger>
            <TabsTrigger value="exit">Exit</TabsTrigger>
            <TabsTrigger value="sl">Stop Loss</TabsTrigger>
            <TabsTrigger value="tp">Take Profit</TabsTrigger>
          </TabsList>

          <TabsContent value="entry" className="space-y-3">
            {entryOrders.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-4">
                No entry orders found.
              </p>
            ) : (
              <ScrollArea className="h-[200px]">
                <div className="space-y-3">
                  {entryOrders.map(order => (
                    <div
                      key={order.id}
                      className="p-3 border border-divider rounded-lg"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <Badge
                          variant="outline"
                          className={`${getOrderStatusColor(order.status)} bg-background/50`}
                        >
                          {order.status}
                        </Badge>
                        <div className="text-xs text-text-tertiary">
                          {formatDate(order.dateOpen)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-text-tertiary">Price: </span>
                          <span className="font-mono">
                            {formatCurrency(order.averagePrice || 0)}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-tertiary">Size: </span>
                          <span>
                            {order.filled} {position.asset.ticker}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-tertiary">Cost: </span>
                          <span className="font-mono">
                            {formatCurrency(order.totalCost || 0)}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-tertiary">Type: </span>
                          <span>{order.type}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="exit" className="space-y-3">
            {exitOrders.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-4">
                No exit orders found.
              </p>
            ) : (
              <ScrollArea className="h-[200px]">
                <div className="space-y-3">
                  {exitOrders.map(order => (
                    <div
                      key={order.id}
                      className="p-3 border border-divider rounded-lg"
                    >
                      {/* Similar structure to entry orders */}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="sl" className="space-y-3">
            {!stopLoss || stopLoss.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-4">
                No stop loss orders found.
              </p>
            ) : (
              <ScrollArea className="h-[200px]">
                <div className="space-y-3">
                  {stopLoss.map(order => (
                    <div
                      key={order.id}
                      className="p-3 border border-divider rounded-lg bg-danger/5"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <Badge
                          variant="outline"
                          className={`${getOrderStatusColor(order.status)} bg-background/50`}
                        >
                          {order.status}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-danger bg-danger/10 border-danger/20"
                        >
                          {order.size * 100}% of Position
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-text-tertiary">Trigger: </span>
                          <span className="font-mono text-danger">
                            {formatCurrency(order.trigger || 0)}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-tertiary">Distance: </span>
                          <span className="text-danger">
                            {formatPercentage(
                              ((currentPrice - (order.trigger || 0)) /
                                currentPrice) *
                                100
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-tertiary">Type: </span>
                          <span>
                            {order.isTrailing ? "Trailing Stop" : "Stop Loss"}
                          </span>
                        </div>
                        {order.isTrailing && (
                          <div>
                            <span className="text-text-tertiary">Trail: </span>
                            <span>{order.trailingDistance}% distance</span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>

          <TabsContent value="tp" className="space-y-3">
            {!takeProfit || takeProfit.length === 0 ? (
              <p className="text-sm text-text-tertiary text-center py-4">
                No take profit orders found.
              </p>
            ) : (
              <ScrollArea className="h-[200px]">
                <div className="space-y-3">
                  {takeProfit.map(order => (
                    <div
                      key={order.id}
                      className="p-3 border border-divider rounded-lg bg-success/5"
                    >
                      <div className="flex justify-between items-center mb-2">
                        <Badge
                          variant="outline"
                          className={`${getOrderStatusColor(order.status)} bg-background/50`}
                        >
                          {order.status}
                        </Badge>
                        <Badge
                          variant="outline"
                          className="text-success bg-success/10 border-success/20"
                        >
                          {order.size * 100}% of Position (Target{" "}
                          {order.tier || 1})
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-text-tertiary">Trigger: </span>
                          <span className="font-mono text-success">
                            {formatCurrency(order.trigger || 0)}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-tertiary">Distance: </span>
                          <span className="text-success">
                            {formatPercentage(
                              (((order.trigger || 0) - currentPrice) /
                                currentPrice) *
                                100
                            )}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-tertiary">
                            Potential Gain:{" "}
                          </span>
                          <span className="text-success">
                            {formatPercentage(order.targetPercentage || 0)}
                          </span>
                        </div>
                        <div>
                          <span className="text-text-tertiary">Type: </span>
                          <span>{order.type}</span>
                        </div>
                      </div>
                      {order.moveStopToBreakeven && (
                        <Badge
                          variant="outline"
                          className="text-xs mt-2 bg-info/10 text-info border-info/20"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Moves Stop to Breakeven on Hit
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

// Component for Thesis details
const ThesisDetails: React.FC<{
  position: PositionDetailsComponentProps["position"];
  onEdit?: () => void;
}> = ({ position, onEdit }) => {
  if (!position.thesis) {
    return (
      <Card className="shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center">
              <BookOpen className="h-4 w-4 mr-2 text-gold-primary" />
              Trading Thesis
            </span>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4 mr-1" />
              Add Thesis
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-tertiary text-center py-4">
            No thesis has been added for this position.
          </p>
        </CardContent>
      </Card>
    );
  }

  const {
    reasoning,
    invalidation,
    fulfillment,
    technicalAnalysis,
    fundamentalAnalysis,
    timeHorizon,
    riskRewardRatio,
  } = position.thesis;

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center">
            <BookOpen className="h-4 w-4 mr-2 text-gold-primary" />
            Trading Thesis
          </span>
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil className="h-4 w-4 mr-1" />
            Edit
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h4 className="text-sm font-medium mb-1">Reasoning</h4>
          <p className="text-sm text-text-secondary">{reasoning}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-medium mb-1 text-danger">
              Invalidation (Stop Loss Criteria)
            </h4>
            <p className="text-sm text-text-secondary">{invalidation}</p>
          </div>

          <div>
            <h4 className="text-sm font-medium mb-1 text-success">
              Fulfillment (Take Profit Criteria)
            </h4>
            <p className="text-sm text-text-secondary">{fulfillment}</p>
          </div>
        </div>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="flex items-center w-full justify-center"
            >
              <span>Show More Details</span>
              <ChevronDown className="h-4 w-4 ml-1" />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium mb-1">Technical Analysis</h4>
                <p className="text-sm text-text-secondary">
                  {technicalAnalysis}
                </p>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-1">
                  Fundamental Analysis
                </h4>
                <p className="text-sm text-text-secondary">
                  {fundamentalAnalysis}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <h4 className="text-sm font-medium mb-1">Time Horizon</h4>
                <p className="text-sm text-text-secondary">{timeHorizon}</p>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-1">Risk/Reward Ratio</h4>
                <p className="text-sm text-text-secondary">{riskRewardRatio}</p>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
};

// Component for Journal Entries
const JournalEntries: React.FC<{
  position: PositionDetailsComponentProps["position"];
  onAdd?: () => void;
}> = ({ position, onAdd }) => {
  const { journal } = position;

  if (!journal || journal.length === 0) {
    return (
      <Card className="shadow-md">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center">
              <BookOpen className="h-4 w-4 mr-2 text-gold-primary" />
              Journal Entries
            </span>
            <Button variant="ghost" size="sm" onClick={onAdd}>
              <Pencil className="h-4 w-4 mr-1" />
              Add Entry
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-tertiary text-center py-4">
            No journal entries have been added for this position.
          </p>
        </CardContent>
      </Card>
    );
  }

  const getSentimentColor = (sentiment?: string) => {
    switch (sentiment) {
      case "bullish":
        return "text-success";
      case "bearish":
        return "text-danger";
      case "neutral":
        return "text-text-secondary";
      default:
        return "text-text-secondary";
    }
  };

  return (
    <Card className="shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center justify-between">
          <span className="flex items-center">
            <BookOpen className="h-4 w-4 mr-2 text-gold-primary" />
            Journal Entries ({journal.length})
          </span>
          <Button variant="ghost" size="sm" onClick={onAdd}>
            <Pencil className="h-4 w-4 mr-1" />
            Add Entry
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px]">
          <div className="space-y-4">
            {journal.map(entry => (
              <div
                key={entry.id}
                className={cn(
                  "p-3 border border-divider rounded-lg",
                  entry.isKeyLearning
                    ? "bg-gold-primary/5 border-gold-primary/20"
                    : ""
                )}
              >
                <div className="flex justify-between items-center mb-2">
                  <div className="flex items-center">
                    <Badge
                      variant="outline"
                      className={cn(
                        "bg-interactive/10 border-interactive/30",
                        getSentimentColor(entry.sentiment)
                      )}
                    >
                      {entry.sentiment || "neutral"}
                    </Badge>
                    {entry.isKeyLearning && (
                      <Badge
                        variant="outline"
                        className="ml-2 bg-gold-primary/10 text-gold-primary border-gold-primary/20"
                      >
                        Key Learning
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-text-tertiary">
                    {formatDate(entry.timestamp as Date)}
                  </span>
                </div>

                <p className="text-sm text-text-secondary">{entry.thought}</p>

                {entry.attachments && entry.attachments.length > 0 && (
                  <div className="mt-2">
                    <p className="text-xs text-text-tertiary mb-1">
                      Attachments:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {entry.attachments.map((attachment, index) => (
                        <a
                          key={index}
                          href={attachment}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-primary underline"
                        >
                          View attachment {index + 1}
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

// Main PositionDetails component
export const PositionDetailsProposal1: React.FC<
  PositionDetailsComponentProps
> = ({
  position,
  relatedPortfolioName,
  onEditPosition,
  onAddJournalEntry,
  onEditThesis,
  onClosePosition,
  onRefreshData,
  onBackToPortfolio,
  className,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <div className="w-full h-full flex items-center justify-center p-8">
        <div className="flex flex-col items-center">
          <RefreshCw className="h-8 w-8 animate-spin text-blue-primary mb-4" />
          <p className="text-text-secondary">Loading position details...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "w-full max-w-5xl mx-auto space-y-4 p-2 sm:p-4 font-mono bg-background text-text-primary",
        className
      )}
    >
      <PositionHeader position={position} onBack={onBackToPortfolio} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PerformanceMetrics position={position} />
        <OrdersPanel position={position} />
      </div>

      <ThesisDetails position={position} onEdit={onEditThesis} />

      <JournalEntries position={position} onAdd={onAddJournalEntry} />

      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={onRefreshData}
          className="flex items-center"
        >
          <RefreshCw className="h-4 w-4 mr-1" />
          <span>Refresh Data</span>
        </Button>
      </div>
    </div>
  );
};

PositionDetailsProposal1.displayName = "PositionDetailsProposal1";
