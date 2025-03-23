/**
 * PositionsList.tsx - Displays a grid of position cards with key metrics
 *
 * This component renders a responsive grid of position cards with
 * current values, P&L calculations, and risk indicators. It handles
 * click interactions to navigate to detailed position views.
 *
 * @ai-guidance This component follows the presentational component pattern.
 * It receives all data via props and delegates complex calculations to
 * utility functions. Keep this separation when suggesting modifications.
 */

"use client";

import React, { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Position } from "../types";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "./ui/card";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  ArrowUpDown,
  Search,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";
import { calculatePositionValue, calculateUnrealizedPnL } from "@/utilities";

/**
 * Props for the PositionsList component
 *
 * @property positions - Array of positions to display
 * @property currentPrices - Current market prices for calculation
 * @property className - Optional CSS class for styling
 */
interface PositionsListProps {
  positions: Position[];
  currentPrices: Record<string, number>;
  className?: string;
}

/**
 * Component that displays a responsive grid of trading position cards
 *
 * Features:
 * - Responsive grid layout that adapts to screen size
 * - Sorting by name, asset, value, and P&L
 * - Filtering by name, asset, or strategy
 * - Visual risk indicators and P&L status
 * - Click-through to position details
 * - Interactive hover states and animations
 *
 * @component
 */
export const PositionsList: React.FC<PositionsListProps> = ({
  positions,
  currentPrices,
  className = "",
}) => {
  const router = useRouter();
  // State for sorting and filtering
  const [sortField, setSortField] = useState<string>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [filter, setFilter] = useState<string>("");

  /**
   * Toggles sort direction or changes sort field
   *
   * @param field - The field to sort by
   */
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const handlePositionClick = (position: Position) => {
    router.push(`/dashboard/positions/${position.id}`);
  };

  /**
   * Filtered and sorted positions with memoization for performance
   */
  const filteredAndSortedPositions = useMemo(() => {
    // First apply filtering
    const filtered = positions.filter(position => {
      const searchTerm = filter.toLowerCase();
      return (
        position.name.toLowerCase().includes(searchTerm) ||
        position.asset.ticker.toLowerCase().includes(searchTerm) ||
        position.strategy.toLowerCase().includes(searchTerm)
      );
    });

    // Then apply sorting
    return [...filtered].sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case "name":
          comparison = a.name.localeCompare(b.name);
          break;
        case "asset":
          comparison = a.asset.ticker.localeCompare(b.asset.ticker);
          break;
        case "strategy":
          comparison = a.strategy.localeCompare(b.strategy);
          break;
        case "risk":
          comparison = a.riskLevel - b.riskLevel;
          break;
        case "value": {
          const valueA = calculatePositionValue(a, currentPrices);
          const valueB = calculatePositionValue(b, currentPrices);
          comparison = valueA - valueB;
          break;
        }
        case "pnl": {
          const priceA = currentPrices[a.asset.ticker] || 0;
          const priceB = currentPrices[b.asset.ticker] || 0;
          const pnlA = calculateUnrealizedPnL(a, priceA);
          const pnlB = calculateUnrealizedPnL(b, priceB);
          comparison = pnlA - pnlB;
          break;
        }
        default:
          comparison = 0;
      }

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [positions, filter, sortField, sortDirection, currentPrices]);

  /**
   * Gets appropriate color class based on risk level
   */
  const getRiskBadgeVariant = (riskLevel: number) => {
    if (riskLevel <= 3) return "secondary";
    if (riskLevel <= 7) return "default";
    return "destructive";
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Search and sort controls */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Filter positions..."
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSort("name")}
            className="flex items-center gap-1"
          >
            Name
            <ArrowUpDown className="h-4 w-4" />
            {sortField === "name" && (
              <span className="text-xs">
                {sortDirection === "asc" ? "↑" : "↓"}
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSort("value")}
            className="flex items-center gap-1"
          >
            Value
            <ArrowUpDown className="h-4 w-4" />
            {sortField === "value" && (
              <span className="text-xs">
                {sortDirection === "asc" ? "↑" : "↓"}
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleSort("pnl")}
            className="flex items-center gap-1"
          >
            P&L
            <ArrowUpDown className="h-4 w-4" />
            {sortField === "pnl" && (
              <span className="text-xs">
                {sortDirection === "asc" ? "↑" : "↓"}
              </span>
            )}
          </Button>
        </div>
      </div>

      {/* Positions grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filteredAndSortedPositions.length === 0 ? (
          <div className="col-span-full text-center text-muted-foreground py-8">
            No positions found. {filter && "Try adjusting your filter."}
          </div>
        ) : (
          filteredAndSortedPositions.map(position => {
            // Calculate financial metrics
            const currentPrice = currentPrices[position.asset.ticker] || 0;
            const value = calculatePositionValue(position, currentPrices);
            const pnl = calculateUnrealizedPnL(position, currentPrice);

            // Calculate percentage return
            const totalInvested = position.positionDetails.orders
              .filter(o => o.status === "filled")
              .reduce((sum, order) => sum + (order.totalCost || 0), 0);
            const pnlPercentage =
              totalInvested > 0 ? (pnl / totalInvested) * 100 : 0;

            return (
              <Card
                key={position.id}
                className="group cursor-pointer transition-all hover:shadow-md hover:scale-[1.02]"
                onClick={() => handlePositionClick(position)}
              >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-lg font-semibold">
                    {position.name}
                  </CardTitle>
                  <Badge variant={getRiskBadgeVariant(position.riskLevel)}>
                    {position.riskLevel}/10
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Asset</span>
                    <span className="font-medium">{position.asset.ticker}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Strategy
                    </span>
                    <span className="font-medium">{position.strategy}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Value</span>
                    <span className="font-medium">
                      $
                      {value.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">P&L</span>
                    <div className="flex items-center gap-1">
                      {pnl >= 0 ? (
                        <TrendingUp className="h-4 w-4 text-green-500" />
                      ) : (
                        <TrendingDown className="h-4 w-4 text-red-500" />
                      )}
                      <span
                        className={`font-medium ${
                          pnl >= 0 ? "text-green-500" : "text-red-500"
                        }`}
                      >
                        {pnl >= 0 ? "+" : ""}$
                        {Math.abs(pnl).toLocaleString(undefined, {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Return
                    </span>
                    <span
                      className={`font-medium ${
                        pnlPercentage >= 0 ? "text-green-500" : "text-red-500"
                      }`}
                    >
                      {pnlPercentage >= 0 ? "+" : ""}
                      {pnlPercentage.toFixed(2)}%
                    </span>
                  </div>
                </CardContent>
                <CardFooter className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <AlertTriangle className="h-4 w-4" />
                    <span>
                      {position.positionDetails.stopLoss?.length || 0} stop
                      losses
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="opacity-0 group-hover:opacity-100"
                  >
                    View Details →
                  </Button>
                </CardFooter>
              </Card>
            );
          })
        )}
      </div>

      {/* Summary information */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredAndSortedPositions.length} of {positions.length}{" "}
        positions
      </div>
    </div>
  );
};
