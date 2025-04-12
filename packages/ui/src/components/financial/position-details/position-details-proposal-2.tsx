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
  ArrowUp,
  ArrowDown,
  Clock,
  Pencil,
  BookOpen,
  AlertTriangle,
  X,
  RefreshCw,
  ChevronLeft,
  BarChart4,
  ListOrdered,
  LineChart,
  BookMarked,
  Hash,
  Calendar,
  ArrowLeftRight,
  Target,
  Scale,
} from "lucide-react";

import { PositionDetailsComponentProps } from "./mock-data";

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

// Component for Position Header
const PositionHeader: React.FC<{
  position: PositionDetailsComponentProps["position"];
  onBack?: () => void;
}> = ({ position, onBack }) => {
  const { name, asset, positionDetails, currentValue } = position;
  const { currentReturn, unrealizedProfitLoss, side } = positionDetails;

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-4 w-full">
      <div className="flex items-center">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="mr-2">
            <ChevronLeft className="h-4 w-4 mr-1" />
            <span className="text-sm">Back</span>
          </Button>
        )}
        <Avatar className="h-12 w-12 mr-3 border border-divider">
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
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">
            {name}
          </h1>
          <div className="flex items-center text-sm">
            <span className="text-text-secondary">
              {asset.ticker} • {side.toLowerCase()}
            </span>
            <Badge
              className="ml-2 text-xs"
              variant={
                side.toLowerCase() === "long" ? "success" : "destructive"
              }
            >
              {side}
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
              (unrealizedProfitLoss || 0) >= 0 ? "text-success" : "text-danger"
            )}
          >
            {formatCurrency(unrealizedProfitLoss || 0)}
          </span>
        </div>
      </div>
    </div>
  );
};

// Component for Position Overview tab
const PositionOverview: React.FC<{
  position: PositionDetailsComponentProps["position"];
}> = ({ position }) => {
  const {
    positionDetails,
    asset,
    riskLevel,
    lifecycle,
    capitalTier,
    strategy,
  } = position;
  const {
    averageEntryPrice,
    totalSize,
    totalCost,
    unrealizedProfitLoss,
    currentReturn,
    riskRewardRatio,
    stopPrice,
    targetPrice,
    timeFrame,
    dateOpened,
    isLeveraged,
    leverage,
  } = positionDetails;

  const currentPrice = asset.marketData?.currentPrice || 0;

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
    <div className="space-y-6 py-2">
      {/* Price and Risk display */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center">
              <LineChart className="h-4 w-4 mr-2 text-gold-primary" />
              Price Information
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">Current Price</p>
                <div className="flex items-center">
                  <span className="text-base font-medium font-mono">
                    {formatCurrency(currentPrice)}
                  </span>
                </div>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">Entry Price</p>
                <span className="text-base font-medium font-mono">
                  {formatCurrency(averageEntryPrice || 0)}
                </span>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">Stop Price</p>
                <span className="text-base font-medium font-mono text-danger">
                  {formatCurrency(stopPrice || 0)}
                </span>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">Target Price</p>
                <span className="text-base font-medium font-mono text-success">
                  {formatCurrency(targetPrice || 0)}
                </span>
              </div>
            </div>

            <Separator />

            <div className="space-y-2">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center">
              <Scale className="h-4 w-4 mr-2 text-gold-primary" />
              Risk Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">Risk Level</p>
                <div className="flex items-center">
                  <span className="text-base font-medium">{riskLevel}/10</span>
                  <Badge
                    className="ml-2 text-xs"
                    variant={
                      riskLevel <= 3
                        ? "outline"
                        : riskLevel <= 7
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {riskLevel <= 3
                      ? "Conservative"
                      : riskLevel <= 7
                        ? "Balanced"
                        : "Speculative"}
                  </Badge>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">R:R Ratio</p>
                <div className="flex items-center">
                  <span className="text-base font-medium">
                    {riskRewardRatio?.toFixed(2) || "N/A"}:1
                  </span>
                  <Badge
                    className="ml-2 text-xs"
                    variant={
                      (riskRewardRatio || 0) >= 2
                        ? "success"
                        : (riskRewardRatio || 0) >= 1
                          ? "outline"
                          : "destructive"
                    }
                  >
                    {(riskRewardRatio || 0) >= 2
                      ? "Excellent"
                      : (riskRewardRatio || 0) >= 1
                        ? "Acceptable"
                        : "Poor"}
                  </Badge>
                </div>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">Lifecycle</p>
                <Badge variant="outline">{lifecycle}</Badge>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">Capital Tier</p>
                <Badge variant="outline">{capitalTier}</Badge>
              </div>
            </div>

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">Strategy</p>
                <p className="text-xs">{strategy}</p>
              </div>

              <div className="space-y-1">
                <p className="text-xs text-text-tertiary">Timeframe</p>
                <div className="flex items-center">
                  <Badge variant="outline" className="text-xs">
                    <Clock className="h-3 w-3 mr-1" />
                    {timeFrame}
                  </Badge>
                  {isLeveraged && (
                    <Badge
                      variant="outline"
                      className="ml-2 text-xs text-warning"
                    >
                      <ArrowLeftRight className="h-3 w-3 mr-1" />
                      {leverage}x
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Position Performance Metrics */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center">
            <BarChart4 className="h-4 w-4 mr-2 text-gold-primary" />
            Position Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-1">
              <p className="text-xs text-text-tertiary">Position Size</p>
              <p className="text-base font-medium">
                {totalSize} {asset.ticker}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-text-tertiary">Position Cost</p>
              <p className="text-base font-medium font-mono">
                {formatCurrency(totalCost || 0)}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-text-tertiary">Current Value</p>
              <p className="text-base font-medium font-mono">
                {formatCurrency(currentPrice * (totalSize || 0))}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-text-tertiary">Date Opened</p>
              <p className="text-sm">{formatDate(dateOpened)}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-text-tertiary">Unrealized P/L</p>
              <p
                className={cn(
                  "text-base font-medium font-mono",
                  (unrealizedProfitLoss || 0) >= 0
                    ? "text-success"
                    : "text-danger"
                )}
              >
                {formatCurrency(unrealizedProfitLoss || 0)}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-text-tertiary">Return</p>
              <p
                className={cn(
                  "text-base font-medium",
                  (currentReturn || 0) >= 0 ? "text-success" : "text-danger"
                )}
              >
                {formatPercentage(currentReturn || 0)}
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-text-tertiary">Exchange</p>
              <p className="text-sm">{asset.exchange || "Unknown"}</p>
            </div>

            <div className="space-y-1">
              <p className="text-xs text-text-tertiary">Wallet</p>
              <p className="text-sm">{asset.wallet}</p>
            </div>
          </div>

          {position.tags && position.tags.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs text-text-tertiary">Tags</p>
                <div className="flex flex-wrap gap-2">
                  {position.tags.map((tag, index) => (
                    <Badge key={index} variant="outline" className="text-xs">
                      <Hash className="h-3 w-3 mr-1" />
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

// Component for Orders Tab
const OrdersTab: React.FC<{
  position: PositionDetailsComponentProps["position"];
}> = ({ position }) => {
  const { positionDetails } = position;
  const { orders, stopLoss, takeProfit } = positionDetails;

  return (
    <div className="space-y-6 py-2">
      <Tabs defaultValue="all" className="w-full">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="all">All Orders</TabsTrigger>
          <TabsTrigger value="entry">Entry</TabsTrigger>
          <TabsTrigger value="sl">Stop Loss</TabsTrigger>
          <TabsTrigger value="tp">Take Profit</TabsTrigger>
        </TabsList>

        {/* All Orders */}
        <TabsContent value="all" className="mt-4">
          <div className="space-y-4">
            {orders.length === 0 &&
            (!stopLoss || stopLoss.length === 0) &&
            (!takeProfit || takeProfit.length === 0) ? (
              <p className="text-center text-text-tertiary py-8">
                No orders found for this position.
              </p>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-6">
                  {orders.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium">Entry/Exit Orders</h3>
                      {orders.map(order => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          position={position}
                        />
                      ))}
                    </div>
                  )}

                  {stopLoss && stopLoss.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-danger">
                        Stop Loss Orders
                      </h3>
                      {stopLoss.map(order => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          position={position}
                          type="stop"
                        />
                      ))}
                    </div>
                  )}

                  {takeProfit && takeProfit.length > 0 && (
                    <div className="space-y-3">
                      <h3 className="text-sm font-medium text-success">
                        Take Profit Orders
                      </h3>
                      {takeProfit.map(order => (
                        <OrderCard
                          key={order.id}
                          order={order}
                          position={position}
                          type="take-profit"
                        />
                      ))}
                    </div>
                  )}
                </div>
              </ScrollArea>
            )}
          </div>
        </TabsContent>

        {/* Entry Orders */}
        <TabsContent value="entry" className="mt-4">
          <div className="space-y-4">
            {orders.length === 0 ? (
              <p className="text-center text-text-tertiary py-8">
                No entry orders found for this position.
              </p>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {orders.map(order => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      position={position}
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </TabsContent>

        {/* Stop Loss */}
        <TabsContent value="sl" className="mt-4">
          <div className="space-y-4">
            {!stopLoss || stopLoss.length === 0 ? (
              <p className="text-center text-text-tertiary py-8">
                No stop loss orders found for this position.
              </p>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {stopLoss.map(order => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      position={position}
                      type="stop"
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </TabsContent>

        {/* Take Profit */}
        <TabsContent value="tp" className="mt-4">
          <div className="space-y-4">
            {!takeProfit || takeProfit.length === 0 ? (
              <p className="text-center text-text-tertiary py-8">
                No take profit orders found for this position.
              </p>
            ) : (
              <ScrollArea className="h-[400px]">
                <div className="space-y-3">
                  {takeProfit.map(order => (
                    <OrderCard
                      key={order.id}
                      order={order}
                      position={position}
                      type="take-profit"
                    />
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

// Component for single order card
const OrderCard: React.FC<{
  order: any;
  position: PositionDetailsComponentProps["position"];
  type?: "entry" | "exit" | "stop" | "take-profit";
}> = ({ order, position, type = "entry" }) => {
  const currentPrice = position.asset.marketData?.currentPrice || 0;

  // Handle different order types
  const isStopLoss = type === "stop";
  const isTakeProfit = type === "take-profit";

  // Set card style based on order type
  const cardClassName = cn(
    "p-3 border border-divider rounded-lg",
    isStopLoss ? "bg-danger/5" : isTakeProfit ? "bg-success/5" : "bg-card"
  );

  // Calculate price distance (difference between trigger and current price)
  const priceDistance = order.trigger
    ? ((order.trigger - currentPrice) / currentPrice) * 100
    : null;

  return (
    <div className={cardClassName}>
      <div className="flex justify-between items-center mb-2">
        <Badge
          variant={
            isStopLoss ? "destructive" : isTakeProfit ? "success" : "outline"
          }
        >
          {order.status}
        </Badge>

        {(isStopLoss || isTakeProfit) && (
          <Badge variant="outline">
            {order.size * 100}% of Position{" "}
            {isTakeProfit && `(Target ${order.tier || 1})`}
          </Badge>
        )}

        {!isStopLoss && !isTakeProfit && (
          <span className="text-xs text-text-tertiary">
            {formatDate(order.dateOpen)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <span className="text-text-tertiary">
            {isStopLoss || isTakeProfit ? "Trigger: " : "Price: "}
          </span>
          <span
            className={cn(
              "font-mono",
              isStopLoss ? "text-danger" : isTakeProfit ? "text-success" : ""
            )}
          >
            {formatCurrency(order.trigger || order.averagePrice || 0)}
          </span>
        </div>

        {(isStopLoss || isTakeProfit) && priceDistance !== null && (
          <div>
            <span className="text-text-tertiary">Distance: </span>
            <span className={isStopLoss ? "text-danger" : "text-success"}>
              {formatPercentage(isStopLoss ? -priceDistance : priceDistance)}
            </span>
          </div>
        )}

        {!isStopLoss && !isTakeProfit && (
          <div>
            <span className="text-text-tertiary">Size: </span>
            <span>
              {order.filled} {position.asset.ticker}
            </span>
          </div>
        )}

        {!isStopLoss && !isTakeProfit && order.totalCost && (
          <div>
            <span className="text-text-tertiary">Cost: </span>
            <span className="font-mono">{formatCurrency(order.totalCost)}</span>
          </div>
        )}

        <div>
          <span className="text-text-tertiary">Type: </span>
          <span>
            {order.type} {order.isTrailing && "Trailing"}
          </span>
        </div>

        {isTakeProfit && order.targetPercentage && (
          <div>
            <span className="text-text-tertiary">Gain: </span>
            <span className="text-success">
              {formatPercentage(order.targetPercentage)}
            </span>
          </div>
        )}
      </div>

      {order.moveStopToBreakeven && (
        <div className="mt-2">
          <Badge variant="outline" className="text-xs">
            Moves Stop to Breakeven
          </Badge>
        </div>
      )}
    </div>
  );
};

// Component for Thesis Tab
const ThesisTab: React.FC<{
  position: PositionDetailsComponentProps["position"];
  onEditThesis?: () => void;
}> = ({ position, onEditThesis }) => {
  if (!position.thesis) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <BookMarked className="h-12 w-12 text-text-tertiary opacity-20" />
        <p className="text-text-tertiary">
          No thesis has been added for this position yet.
        </p>
        <Button variant="outline" size="sm" onClick={onEditThesis}>
          <Pencil className="h-4 w-4 mr-1" />
          Add Thesis
        </Button>
      </div>
    );
  }

  const { thesis } = position;

  return (
    <div className="space-y-6 py-2">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Trading Thesis</h3>
        <Button variant="outline" size="sm" onClick={onEditThesis}>
          <Pencil className="h-4 w-4 mr-1" />
          Edit
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Primary Reasoning</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm">{thesis.reasoning}</p>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="border-danger/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-danger flex items-center">
              <AlertTriangle className="h-4 w-4 mr-2" />
              Invalidation (Stop Loss Criteria)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{thesis.invalidation}</p>
          </CardContent>
        </Card>

        <Card className="border-success/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-success flex items-center">
              <Target className="h-4 w-4 mr-2" />
              Fulfillment (Take Profit Criteria)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{thesis.fulfillment}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Technical Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {thesis.technicalAnalysis || "No technical analysis provided."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Fundamental Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {thesis.fundamentalAnalysis ||
                "No fundamental analysis provided."}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center">
              <Clock className="h-4 w-4 mr-2" />
              Time Horizon
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {thesis.timeHorizon || "No time horizon specified."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center">
              <Scale className="h-4 w-4 mr-2" />
              Risk/Reward Ratio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">
              {thesis.riskRewardRatio || "Not specified"}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

// Component for Journal Tab
const JournalTab: React.FC<{
  position: PositionDetailsComponentProps["position"];
  onAddJournalEntry?: () => void;
}> = ({ position, onAddJournalEntry }) => {
  const { journal } = position;

  if (!journal || journal.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <BookOpen className="h-12 w-12 text-text-tertiary opacity-20" />
        <p className="text-text-tertiary">
          No journal entries have been added for this position yet.
        </p>
        <Button variant="outline" size="sm" onClick={onAddJournalEntry}>
          <Pencil className="h-4 w-4 mr-1" />
          Add Journal Entry
        </Button>
      </div>
    );
  }

  const getSentimentColor = (sentiment?: string) => {
    switch (sentiment) {
      case "bullish":
        return "bg-success/20 border-success/50 text-success";
      case "bearish":
        return "bg-danger/20 border-danger/50 text-danger";
      case "neutral":
        return "bg-interactive/20 border-interactive/50 text-text-secondary";
      default:
        return "bg-interactive/20 border-interactive/50 text-text-secondary";
    }
  };

  return (
    <div className="space-y-6 py-2">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">
          Journal Entries ({journal.length})
        </h3>
        <Button variant="outline" size="sm" onClick={onAddJournalEntry}>
          <Pencil className="h-4 w-4 mr-1" />
          Add Entry
        </Button>
      </div>

      <ScrollArea className="h-[500px]">
        <div className="space-y-4">
          {journal.map(entry => (
            <Card
              key={entry.id}
              className={cn(
                entry.isKeyLearning ? "border-gold-primary/20" : ""
              )}
            >
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={getSentimentColor(entry.sentiment)}
                    >
                      {entry.sentiment || "neutral"}
                    </Badge>
                    {entry.isKeyLearning && (
                      <Badge
                        variant="outline"
                        className="bg-gold-primary/10 text-gold-primary border-gold-primary/20"
                      >
                        Key Learning
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-text-tertiary">
                    {formatDate(entry.timestamp as Date)}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-line">{entry.thought}</p>

                {entry.attachments && entry.attachments.length > 0 && (
                  <div className="mt-4 pt-2 border-t border-divider">
                    <p className="text-xs text-text-tertiary mb-2">
                      Attachments:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {entry.attachments.map((attachment, index) => (
                        <Button key={index} variant="outline" size="sm" asChild>
                          <a
                            href={attachment}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs"
                          >
                            View attachment {index + 1}
                          </a>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

// Main PositionDetails component with tabbed interface
export const PositionDetailsProposal2: React.FC<
  PositionDetailsComponentProps
> = ({
  position,
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
        "w-full max-w-5xl mx-auto p-2 sm:p-4 bg-background text-text-primary",
        className
      )}
    >
      <div className="space-y-6">
        <PositionHeader position={position} onBack={onBackToPortfolio} />

        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="w-full grid grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="overview" className="flex items-center">
              <BarChart4 className="h-4 w-4 mr-2 hidden sm:block" />
              Overview
            </TabsTrigger>
            <TabsTrigger value="orders" className="flex items-center">
              <ListOrdered className="h-4 w-4 mr-2 hidden sm:block" />
              Orders
            </TabsTrigger>
            <TabsTrigger value="thesis" className="flex items-center">
              <BookMarked className="h-4 w-4 mr-2 hidden sm:block" />
              Thesis
            </TabsTrigger>
            <TabsTrigger value="journal" className="flex items-center">
              <BookOpen className="h-4 w-4 mr-2 hidden sm:block" />
              Journal
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <PositionOverview position={position} />
          </TabsContent>

          <TabsContent value="orders">
            <OrdersTab position={position} />
          </TabsContent>

          <TabsContent value="thesis">
            <ThesisTab position={position} onEditThesis={onEditThesis} />
          </TabsContent>

          <TabsContent value="journal">
            <JournalTab
              position={position}
              onAddJournalEntry={onAddJournalEntry}
            />
          </TabsContent>
        </Tabs>

        <div className="flex justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={onEditPosition}
            className="flex items-center"
          >
            <Pencil className="h-4 w-4 mr-1" />
            <span>Edit Position</span>
          </Button>

          <div className="flex space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRefreshData}
              className="flex items-center"
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              <span>Refresh</span>
            </Button>

            {position.positionDetails.status === "ACTIVE" && (
              <Button
                variant="destructive"
                size="sm"
                onClick={onClosePosition}
                className="flex items-center"
              >
                <X className="h-4 w-4 mr-1" />
                <span>Close Position</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

PositionDetailsProposal2.displayName = "PositionDetailsProposal2";
