"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Clock } from "lucide-react";

// Position types based on the PositionDetails interface
export type PositionStatus = "active" | "closed" | "partial";
export type TradeSide = "long" | "short";
export type TimeFrame = "15m" | "1H" | "4H" | "1D" | "1W" | "1M";

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
}

interface PositionCardProps {
  position: PositionCardData;
}

export function PositionCard({ position }: PositionCardProps) {
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

  return (
    <Card className="hover:shadow-md transition-shadow duration-200">
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
            </div>
            <Badge
              variant="outline"
              className={`text-xs ${getStatusColor(status)}`}
            >
              {status.toUpperCase()}
            </Badge>
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

          {/* Details */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center space-x-3">
              <span className="font-medium">{timeFrame}</span>
              {riskRewardRatio && <span>R:R {riskRewardRatio.toFixed(1)}</span>}
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
                {daysAgo === 0
                  ? "Today"
                  : daysAgo === 1
                  ? "1 day ago"
                  : `${daysAgo} days ago`}
              </span>
            </div>
          </div>

          {/* Price levels */}
          {(targetPrice || stopPrice) && (
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
