"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  Target,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";

// Position types based on the PositionDetails interface
export type PositionStatus = "active" | "closed" | "partial";
export type TradeSide = "long" | "short";
export type TimeFrame = "15m" | "1H" | "4H" | "1D" | "1W" | "1M";

export interface TimeInPosition {
  hours: number;
  minutes: number;
  totalMinutes: number;
}

export interface DistanceToLevel {
  percentage: number;
  price: number;
  direction: "approaching" | "moving_toward" | "safe" | "danger";
}

export interface RecentEvent {
  timestamp: Date;
  type: "price_alert" | "news" | "technical" | "volume" | "fundamental";
  description: string;
  impact: "positive" | "negative" | "neutral";
}

export interface PositionCardData {
  id: string;
  symbol: string;
  status: PositionStatus;
  side: TradeSide;
  timeFrame: TimeFrame;
  dateOpened: Date;
  currentReturn?: number;
  unrealizedProfitLoss?: number;
  riskRewardRatio?: number;
  targetPrice?: number;
  stopPrice?: number;
  totalSize?: number;
  // Enhanced information
  currentPrice?: number;
  entryPrice?: number;
  timeInPosition?: TimeInPosition;
  distanceToLevels?: {
    toTarget?: DistanceToLevel;
    toStop?: DistanceToLevel;
  };
  recentEvents?: RecentEvent[];
}

interface PositionCardProps {
  position: PositionCardData;
}

export function PositionCard({ position }: PositionCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const {
    symbol,
    status,
    side,
    timeFrame,
    dateOpened,
    currentReturn = 0,
    unrealizedProfitLoss = 0,
    riskRewardRatio,
    targetPrice,
    stopPrice,
    totalSize,
    currentPrice,
    entryPrice,
    timeInPosition,
    distanceToLevels,
    recentEvents = [],
  } = position;

  const isPositive = currentReturn >= 0;
  const daysAgo = Math.floor(
    (Date.now() - dateOpened.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Status styling
  const getStatusColor = (status: PositionStatus) => {
    switch (status) {
      case "active":
        return "bg-green-100 text-green-800 border-green-200";
      case "partial":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      case "closed":
        return "bg-gray-100 text-gray-800 border-gray-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  // Side styling
  const getSideColor = (side: TradeSide) => {
    return side === "long"
      ? "bg-blue-100 text-blue-800 border-blue-200"
      : "bg-orange-100 text-orange-800 border-orange-200";
  };

  // Distance direction styling
  const getDirectionColor = (direction: string) => {
    switch (direction) {
      case "approaching":
        return "text-yellow-600";
      case "danger":
        return "text-red-600";
      case "safe":
        return "text-green-600";
      case "moving_toward":
        return "text-blue-600";
      default:
        return "text-gray-600";
    }
  };

  // Event impact styling
  const getImpactColor = (impact: string) => {
    switch (impact) {
      case "positive":
        return "text-green-600";
      case "negative":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  // Format time in position
  const formatTimeInPosition = (time?: TimeInPosition) => {
    if (!time) return "";
    if (time.hours >= 24) {
      const days = Math.floor(time.hours / 24);
      const remainingHours = time.hours % 24;
      return `${days}d ${remainingHours}h`;
    }
    return `${time.hours}h ${time.minutes}m`;
  };

  // Format relative time for events
  const formatRelativeTime = (timestamp: Date) => {
    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMinutes = Math.floor(diffMs / (1000 * 60));

    if (diffHours >= 24) {
      const days = Math.floor(diffHours / 24);
      return `${days}d ago`;
    } else if (diffHours >= 1) {
      return `${diffHours}h ago`;
    } else {
      return `${diffMinutes}m ago`;
    }
  };

  return (
    <Card className="hover:shadow-lg transition-all duration-200 cursor-pointer group">
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <h3 className="font-semibold text-lg">{symbol}</h3>
              <Badge
                variant="outline"
                className={`text-xs ${getSideColor(side)}`}
              >
                {side.toUpperCase()}
              </Badge>
              {currentPrice && entryPrice && (
                <span className="text-xs text-muted-foreground">
                  ${currentPrice.toFixed(2)}
                </span>
              )}
            </div>
            <div className="flex items-center space-x-2">
              <Badge
                variant="outline"
                className={`text-xs ${getStatusColor(status)}`}
              >
                {status.toUpperCase()}
              </Badge>
              {recentEvents.length > 0 && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="p-1 hover:bg-gray-100 rounded"
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Performance */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <div
                className={`flex items-center space-x-1 ${
                  isPositive ? "text-green-600" : "text-red-600"
                }`}
              >
                {isPositive ? (
                  <TrendingUp className="h-4 w-4" />
                ) : (
                  <TrendingDown className="h-4 w-4" />
                )}
                <span className="text-xl font-bold">
                  {isPositive ? "+" : ""}
                  {currentReturn.toFixed(1)}%
                </span>
              </div>
            </div>
            <div
              className={`text-sm font-medium ${
                isPositive ? "text-green-600" : "text-red-600"
              }`}
            >
              {isPositive ? "+" : ""}$
              {Math.abs(unrealizedProfitLoss).toLocaleString("en-US", {
                minimumFractionDigits: 0,
                maximumFractionDigits: 0,
              })}
            </div>
          </div>

          {/* Enhanced Time Information */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center space-x-3">
              <span className="font-medium">{timeFrame}</span>
              {riskRewardRatio && <span>{riskRewardRatio.toFixed(1)}R</span>}
              {totalSize && (
                <span>
                  $
                  {totalSize.toLocaleString("en-US", {
                    maximumFractionDigits: 0,
                  })}
                </span>
              )}
            </div>
            <div className="flex items-center space-x-1">
              <Clock className="h-3 w-3" />
              <span>
                {timeInPosition
                  ? formatTimeInPosition(timeInPosition)
                  : daysAgo === 0
                  ? "Today"
                  : daysAgo === 1
                  ? "1 day ago"
                  : `${daysAgo} days ago`}
              </span>
            </div>
          </div>

          {/* Distance to Key Levels */}
          {distanceToLevels &&
            (distanceToLevels.toTarget || distanceToLevels.toStop) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  {targetPrice && distanceToLevels.toTarget && (
                    <div
                      className={`flex items-center space-x-1 ${getDirectionColor(
                        distanceToLevels.toTarget.direction
                      )}`}
                    >
                      <Target className="h-3 w-3" />
                      <span>
                        Target:{" "}
                        {distanceToLevels.toTarget.percentage.toFixed(1)}% (
                        {distanceToLevels.toTarget.direction === "approaching"
                          ? "close!"
                          : "away"}
                        )
                      </span>
                    </div>
                  )}
                  {stopPrice && distanceToLevels.toStop && (
                    <div
                      className={`flex items-center space-x-1 ${getDirectionColor(
                        distanceToLevels.toStop.direction
                      )}`}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      <span>
                        Stop: {distanceToLevels.toStop.percentage.toFixed(1)}%
                        {distanceToLevels.toStop.direction === "approaching" &&
                          " ⚠️"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

          {/* Progressive Disclosure - Recent Events */}
          {isExpanded && recentEvents.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <h4 className="text-xs font-medium text-muted-foreground">
                Recent Events
              </h4>
              <div className="space-y-1">
                {recentEvents.slice(0, 3).map((event, index) => (
                  <div
                    key={index}
                    className="text-xs flex items-start space-x-2"
                  >
                    <span className="text-muted-foreground min-w-fit">
                      {formatRelativeTime(event.timestamp)}
                    </span>
                    <span className={`flex-1 ${getImpactColor(event.impact)}`}>
                      {event.description}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Price levels - kept for backward compatibility */}
          {(targetPrice || stopPrice) && !distanceToLevels && (
            <div className="flex items-center justify-between text-xs">
              {targetPrice && (
                <div className="text-green-600">
                  Target: ${targetPrice.toFixed(2)}
                </div>
              )}
              {stopPrice && (
                <div className="text-red-600">
                  Stop: ${stopPrice.toFixed(2)}
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
