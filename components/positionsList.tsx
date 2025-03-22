/**
 * PositionsList.tsx - Displays a tabular list of positions with key metrics
 *
 * This component renders a sortable, filterable table of positions with
 * current values, P&L calculations, and risk indicators. It handles
 * click interactions to navigate to detailed position views.
 *
 * @ai-guidance This component follows the presentational component pattern.
 * It receives all data via props and delegates complex calculations to
 * utility functions. Keep this separation when suggesting modifications.
 */

import React, { useState, useMemo } from "react";
import { Position } from "../types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Badge } from "./ui/badge";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import { ArrowUpDown, Search } from "lucide-react";
import { calculatePositionValue, calculateUnrealizedPnL } from "@/utilities";

/**
 * Props for the PositionsList component
 *
 * @property positions - Array of positions to display
 * @property currentPrices - Current market prices for calculation
 * @property onPositionClick - Callback when position row is clicked
 * @property className - Optional CSS class for styling
 */
interface PositionsListProps {
  positions: Position[];
  currentPrices: Record<string, number>;
  onPositionClick: (position: Position) => void;
  className?: string;
}

/**
 * Component that displays a sortable, filterable list of trading positions
 *
 * Features:
 * - Sorting by name, asset, value, and P&L
 * - Filtering by name, asset, or strategy
 * - Visual risk indicators
 * - Click-through to position details
 *
 * @component
 */
export const PositionsList: React.FC<PositionsListProps> = ({
  positions,
  currentPrices,
  onPositionClick,
  className = "",
}) => {
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
      // Toggle direction if already sorting by this field
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      // Set new field and default to ascending
      setSortField(field);
      setSortDirection("asc");
    }
  };

  /**
   * Filtered and sorted positions with memoization for performance
   * This prevents recalculation on every render
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

      // Apply sort direction
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [positions, filter, sortField, sortDirection, currentPrices]);

  /**
   * Renders the header with sort button for a specific column
   *
   * @param label - Display label for the column
   * @param field - Data field for sorting
   */
  const renderSortableHeader = (label: string, field: string) => (
    <TableHead>
      <Button
        variant="ghost"
        onClick={() => handleSort(field)}
        className="flex items-center p-0 h-auto font-medium"
      >
        {label}
        <ArrowUpDown className="ml-1 h-4 w-4" />
      </Button>
    </TableHead>
  );

  /**
   * Gets appropriate color class based on risk level
   *
   * @param riskLevel - Risk level (1-10)
   * @returns Badge variant for visual indication
   */
  const getRiskBadgeVariant = (riskLevel: number) => {
    if (riskLevel <= 3) return "secondary";
    if (riskLevel <= 7) return "default";
    return "destructive";
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Search filter input */}
      <div className="relative">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Filter positions..."
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="pl-8"
        />
      </div>

      {/* Positions table */}
      <Table>
        <TableHeader>
          <TableRow>
            {renderSortableHeader("Name", "name")}
            {renderSortableHeader("Asset", "asset")}
            {renderSortableHeader("Strategy", "strategy")}
            {renderSortableHeader("Risk", "risk")}
            {renderSortableHeader("Value", "value")}
            {renderSortableHeader("P&L", "pnl")}
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredAndSortedPositions.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-muted-foreground py-8"
              >
                No positions found. {filter && "Try adjusting your filter."}
              </TableCell>
            </TableRow>
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
                <TableRow
                  key={position.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => onPositionClick(position)}
                >
                  <TableCell className="font-medium">{position.name}</TableCell>
                  <TableCell>{position.asset.ticker}</TableCell>
                  <TableCell>{position.strategy}</TableCell>
                  <TableCell>
                    <Badge variant={getRiskBadgeVariant(position.riskLevel)}>
                      {position.riskLevel}/10
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    $
                    {value.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </TableCell>
                  <TableCell
                    className={`text-right ${
                      pnl >= 0 ? "text-green-600" : "text-red-600"
                    }`}
                  >
                    {pnl >= 0 ? "+" : ""}$
                    {Math.abs(pnl).toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{" "}
                    <span className="text-xs">
                      ({pnlPercentage >= 0 ? "+" : ""}
                      {pnlPercentage.toFixed(2)}%)
                    </span>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      {/* Summary information */}
      <div className="text-sm text-muted-foreground">
        Showing {filteredAndSortedPositions.length} of {positions.length}{" "}
        positions
      </div>
    </div>
  );
};
