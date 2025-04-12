import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
// import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  // AlertTriangle,
  X,
  RefreshCw,
  ChevronLeft,
  Timer,
  BarChart4,
  LineChart,
  History,
  Hourglass,
} from "lucide-react";

import { PositionDetailsComponentProps } from "./mock-data";

// Helper functions
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

const formatTimeAgo = (date: Date | null | undefined): string => {
  if (!date) return "N/A";

  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

  if (diffInDays === 0) return "Today";
  if (diffInDays === 1) return "Yesterday";
  if (diffInDays < 30) return `${diffInDays} days ago`;
  if (diffInDays < 365) return `${Math.floor(diffInDays / 30)} months ago`;
  return `${Math.floor(diffInDays / 365)} years ago`;
};

// Position Header with Timeline Visual
const PositionHeader: React.FC<{
  position: PositionDetailsComponentProps["position"];
  onBack?: () => void;
}> = ({ position, onBack }) => {
  const { name, asset, positionDetails, currentValue, lifecycle, dateCreated } =
    position;
  const { currentReturn, unrealizedProfitLoss, side, dateOpened, timeFrame } =
    positionDetails;

  // Calculate position age
  const getPositionAge = () => {
    if (!dateOpened) return "Not started";

    const now = new Date();
    const diffInMs = now.getTime() - dateOpened.getTime();
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));

    if (diffInDays < 1) return "< 1 day";
    if (diffInDays === 1) return "1 day";
    if (diffInDays < 30) return `${diffInDays} days`;
    if (diffInDays < 365) return `${Math.floor(diffInDays / 30)} months`;
    return `${Math.floor(diffInDays / 365)} years`;
  };

  // Timeline status steps
  const timelineSteps = [
    { status: "PLANNED", label: "Planned", completed: true },
    {
      status: "ACTIVE",
      label: "Active",
      completed: lifecycle === "ACTIVE" || lifecycle === "CLOSED",
    },
    { status: "CLOSED", label: "Closed", completed: lifecycle === "CLOSED" },
  ];

  return (
    <div className="w-full">
      <div className="flex items-center mb-4">
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
          <div className="flex items-center text-sm gap-2">
            <span className="text-text-secondary">{asset.ticker}</span>
            <Badge
              variant="outline"
              className={cn(
                side.toLowerCase() === "long"
                  ? "bg-success/10 text-success"
                  : "bg-danger/10 text-danger"
              )}
            >
              {side}
            </Badge>
            <Badge
              variant="outline"
              className="bg-interactive/10 text-blue-primary"
            >
              <Clock className="h-3 w-3 mr-1" />
              {timeFrame}
            </Badge>
          </div>
        </div>

        <div className="ml-auto text-right">
          <div className="text-xl sm:text-2xl font-bold font-mono">
            {formatCurrency(currentValue || 0)}
          </div>
          <div className="flex items-center justify-end">
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

      {/* Timeline View */}
      <Card className="mb-4 overflow-hidden">
        <CardHeader className="py-2 px-4 bg-interactive/5 border-b border-divider">
          <div className="flex justify-between items-center">
            <CardTitle className="text-sm flex items-center">
              <History className="h-4 w-4 mr-2 text-gold-primary" />
              Position Timeline
            </CardTitle>
            <div className="flex items-center text-xs text-text-tertiary">
              <Clock className="h-3 w-3 mr-1" />
              <span>Created: {formatDate(dateCreated)}</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center mb-4">
            <div className="flex-1">
              <div className="flex items-center justify-between mb-2">
                {timelineSteps.map((step, index) => (
                  <div key={index} className="flex flex-col items-center">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium border",
                        step.completed
                          ? "bg-success text-white border-success"
                          : "bg-background text-text-tertiary border-divider"
                      )}
                    >
                      {index + 1}
                    </div>
                    <span
                      className={cn(
                        "text-xs mt-1",
                        step.completed ? "text-success" : "text-text-tertiary"
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="relative">
                <div className="absolute top-0 left-0 right-0 h-1 bg-divider rounded"></div>
                <div
                  className="absolute top-0 left-0 h-1 bg-success rounded"
                  style={{
                    width:
                      lifecycle === "PLANNED"
                        ? "0%"
                        : lifecycle === "ACTIVE"
                          ? "50%"
                          : "100%",
                  }}
                ></div>
              </div>
            </div>
            <div className="ml-6 px-4 py-2 rounded-lg border border-divider text-center">
              <div className="text-xs text-text-tertiary">Position Age</div>
              <div className="flex items-center text-sm font-medium text-text-primary">
                <Hourglass className="h-3 w-3 mr-1 text-gold-primary" />
                {getPositionAge()}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
            <div className="p-2 rounded-lg border border-divider">
              <div className="text-xs text-text-tertiary mb-1">Exchange</div>
              <div className="text-sm font-medium">
                {asset.exchange || "Unknown"} • {asset.wallet}
              </div>
            </div>

            <div className="p-2 rounded-lg border border-divider">
              <div className="text-xs text-text-tertiary mb-1">Date Opened</div>
              <div className="text-sm font-medium">
                {formatDate(dateOpened)}
              </div>
            </div>

            <div className="p-2 rounded-lg border border-divider">
              <div className="text-xs text-text-tertiary mb-1">Strategy</div>
              <div className="text-sm font-medium">{position.strategy}</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

// Position Performance Card
const PerformanceCard: React.FC<{
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

  // Calculate progress on risk/reward scale
  const calculateProgressValue = () => {
    if (!stopPrice || !targetPrice || !averageEntryPrice) return 50;

    // Total range from stop to target
    const totalRange = targetPrice - stopPrice;

    // Current position between stop and target
    const currentPosition = currentPrice - stopPrice;

    // Calculate percentage
    return Math.max(0, Math.min(100, (currentPosition / totalRange) * 100));
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center">
          <BarChart4 className="h-4 w-4 mr-2 text-gold-primary" />
          Performance Metrics
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-text-tertiary">Current Price</span>
              <div className="flex items-center">
                <span
                  className={cn(
                    "text-xs",
                    priceChange >= 0 ? "text-success" : "text-danger"
                  )}
                >
                  {formatPercentage(priceChange)} (24h)
                </span>
              </div>
            </div>
            <div className="text-base font-medium font-mono">
              {formatCurrency(currentPrice)}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs text-text-tertiary">Entry Price</span>
              <span className="text-xs text-text-tertiary">
                {formatDate(positionDetails.dateOpened as Date)}
              </span>
            </div>
            <div className="text-base font-medium font-mono">
              {formatCurrency(averageEntryPrice || 0)}
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <div className="flex justify-between mb-2">
            <div className="flex flex-col">
              <span className="text-xs text-danger">Stop Loss</span>
              <span className="text-sm font-medium font-mono text-danger">
                {formatCurrency(stopPrice || 0)}
              </span>
            </div>
            <div className="flex flex-col items-center">
              <span className="text-xs text-text-tertiary">Current</span>
              <span className="text-sm font-medium font-mono">
                {formatCurrency(currentPrice)}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-xs text-success">Target</span>
              <span className="text-sm font-medium font-mono text-success">
                {formatCurrency(targetPrice || 0)}
              </span>
            </div>
          </div>

          <Progress value={calculateProgressValue()} className="h-2" />

          <div className="flex justify-between mt-1 text-xs text-text-tertiary">
            <span>{formatPercentage(distanceToStop)} away</span>
            <span>{formatPercentage(distanceToTarget)} to target</span>
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs text-text-tertiary mb-1">Position Size</div>
            <div className="text-base font-medium">
              {totalSize} {asset.ticker}
            </div>
            <div className="text-xs text-text-tertiary mt-1">
              Cost: {formatCurrency(totalCost || 0)}
            </div>
          </div>

          <div>
            <div className="text-xs text-text-tertiary mb-1">Profit/Loss</div>
            <div
              className={cn(
                "text-base font-medium font-mono",
                (unrealizedProfitLoss || 0) >= 0
                  ? "text-success"
                  : "text-danger"
              )}
            >
              {formatCurrency(unrealizedProfitLoss || 0)}
            </div>
            <div
              className={cn(
                "text-xs mt-1",
                (currentReturn || 0) >= 0 ? "text-success" : "text-danger"
              )}
            >
              {formatPercentage(currentReturn || 0)}
            </div>
          </div>
        </div>

        <Separator />

        <div className="flex justify-between items-center">
          <div>
            <div className="text-xs text-text-tertiary mb-1">
              Risk/Reward Ratio
            </div>
            <div className="text-sm font-medium">
              {riskRewardRatio?.toFixed(2) || "N/A"}:1
            </div>
          </div>

          <div>
            <Badge
              className={cn(
                "text-xs",
                (riskRewardRatio || 0) >= 2
                  ? "bg-success text-white"
                  : (riskRewardRatio || 0) >= 1
                    ? "bg-warning text-white"
                    : "bg-danger text-white"
              )}
            >
              {(riskRewardRatio || 0) >= 2
                ? "Excellent R:R"
                : (riskRewardRatio || 0) >= 1
                  ? "Acceptable R:R"
                  : "Poor R:R"}
            </Badge>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Position Activity Timeline
const ActivityTimeline: React.FC<{
  position: PositionDetailsComponentProps["position"];
}> = ({ position }) => {
  // Combine all position events into a single timeline
  const getTimelineEvents = () => {
    const events = [];

    // Creation event
    events.push({
      id: "creation",
      type: "creation",
      date: position.dateCreated,
      title: "Position Created",
      description: `Created ${position.name} position with ${position.strategy} strategy`,
    });

    // Entry orders
    position.positionDetails.orders.forEach(order => {
      if (order.dateOpen) {
        events.push({
          id: order.id,
          type: "entry",
          date: order.dateOpen,
          title: "Entry Order Filled",
          description: `${order.filled} ${position.asset.ticker} @ ${formatCurrency(order.averagePrice || 0)}`,
          data: order,
        });
      }
    });

    // Journal entries
    if (position.journal) {
      position.journal.forEach(entry => {
        if (entry.timestamp && typeof entry.timestamp !== "string") {
          events.push({
            id: entry.id,
            type: "journal",
            date: entry.timestamp,
            title: `Journal Entry${entry.isKeyLearning ? " (Key Learning)" : ""}`,
            description:
              entry.thought.length > 100
                ? entry.thought.substring(0, 100) + "..."
                : entry.thought,
            sentiment: entry.sentiment,
            data: entry,
          });
        }
      });
    }

    // Sort events by date (newest first)
    return events.sort((a, b) => b.date.getTime() - a.date.getTime());
  };

  const timelineEvents = getTimelineEvents();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center">
          <Timer className="h-4 w-4 mr-2 text-gold-primary" />
          Position Timeline
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[300px]">
          <div className="p-4">
            {timelineEvents.length === 0 ? (
              <p className="text-center text-text-tertiary py-4">
                No activity found for this position.
              </p>
            ) : (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute top-0 bottom-0 left-4 w-px bg-divider"></div>

                <div className="space-y-6">
                  {timelineEvents.map((event, index) => (
                    <div key={event.id} className="relative pl-10">
                      {/* Timeline dot */}
                      <div
                        className={cn(
                          "absolute left-0 top-0 w-8 h-8 rounded-full border-4 flex items-center justify-center",
                          event.type === "creation"
                            ? "border-gold-primary bg-gold-primary/20"
                            : event.type === "entry"
                              ? "border-blue-primary bg-blue-primary/20"
                              : event.type === "journal" &&
                                  event.sentiment === "bullish"
                                ? "border-success bg-success/20"
                                : event.type === "journal" &&
                                    event.sentiment === "bearish"
                                  ? "border-danger bg-danger/20"
                                  : "border-interactive bg-interactive/20"
                        )}
                      >
                        {event.type === "creation" && (
                          <Clock className="h-4 w-4 text-gold-primary" />
                        )}
                        {event.type === "entry" && (
                          <ArrowUp className="h-4 w-4 text-blue-primary" />
                        )}
                        {event.type === "journal" && (
                          <BookOpen className="h-4 w-4 text-interactive" />
                        )}
                      </div>

                      <div className="mb-1 flex items-center justify-between">
                        <h4 className="text-sm font-medium">{event.title}</h4>
                        <span className="text-xs text-text-tertiary">
                          {formatTimeAgo(event.date)}
                        </span>
                      </div>

                      <p className="text-sm text-text-secondary mb-1">
                        {event.description}
                      </p>

                      <div className="text-xs text-text-tertiary">
                        {formatDate(event.date)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
};

// Price Chart Component (placeholder)
const PriceChart: React.FC<{
  position: PositionDetailsComponentProps["position"];
}> = ({ position }) => {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center">
          <LineChart className="h-4 w-4 mr-2 text-gold-primary" />
          Price Chart
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center justify-center h-[300px] bg-interactive/5">
        <div className="text-text-tertiary text-sm">
          Price chart would be displayed here
        </div>
        <div className="text-text-tertiary text-xs mt-2">
          Integration with charting library required
        </div>
      </CardContent>
    </Card>
  );
};

// Thesis Summary
const ThesisSummary: React.FC<{
  position: PositionDetailsComponentProps["position"];
  onEdit?: () => void;
}> = ({ position, onEdit }) => {
  if (!position.thesis) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
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

  const { thesis } = position;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
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
          <h4 className="text-xs font-medium text-text-tertiary mb-1">
            Reasoning
          </h4>
          <p className="text-sm text-text-secondary">{thesis.reasoning}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="text-xs font-medium text-danger mb-1">
              Invalidation
            </h4>
            <p className="text-sm text-text-secondary">{thesis.invalidation}</p>
          </div>
          <div>
            <h4 className="text-xs font-medium text-success mb-1">
              Fulfillment
            </h4>
            <p className="text-sm text-text-secondary">{thesis.fulfillment}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

// Main component with strong focus on timeline
export const PositionDetailsProposal3: React.FC<
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
        "w-full max-w-5xl mx-auto p-2 sm:p-4 bg-background text-text-primary space-y-6",
        className
      )}
    >
      <PositionHeader position={position} onBack={onBackToPortfolio} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PerformanceCard position={position} />
        <ActivityTimeline position={position} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <PriceChart position={position} />
        <ThesisSummary position={position} onEdit={onEditThesis} />
      </div>

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
            onClick={onAddJournalEntry}
            className="flex items-center"
          >
            <BookOpen className="h-4 w-4 mr-1" />
            <span>Add Journal Entry</span>
          </Button>

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
  );
};

PositionDetailsProposal3.displayName = "PositionDetailsProposal3";
