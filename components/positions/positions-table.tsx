/**
 * positions-table.tsx - Table component for displaying positions
 *
 * This component displays positions in a table format with sorting capabilities
 * and essential position information.
 */

"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PositionsTableProps } from "@/types/position-components";
import { PositionStatusBadge } from "./position-status-badge";
import { formatCurrency, formatPercentage } from "@/utilities/format";
import { ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";

type SortField = "name" | "value" | "priceChange" | "riskLevel";
type SortDirection = "asc" | "desc";

// Map of common crypto pairs to their quote currency codes
const QUOTE_CURRENCY_MAP: Record<string, string> = {
  USDT: "USD",
  USDC: "USD",
  DAI: "USD",
  EUR: "EUR",
  GBP: "GBP",
  JPY: "JPY",
};

export function PositionsTable({ positions }: PositionsTableProps) {
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  const sortedPositions = [...positions].sort((a, b) => {
    const multiplier = sortDirection === "asc" ? 1 : -1;

    switch (sortField) {
      case "name":
        return multiplier * a.name.localeCompare(b.name);
      case "value":
        return (
          multiplier *
          ((a.positionDetails.currentInvestment || 0) -
            (b.positionDetails.currentInvestment || 0))
        );
      case "priceChange":
        const aChange = a.asset.marketData?.priceChangePercentage24h || 0;
        const bChange = b.asset.marketData?.priceChangePercentage24h || 0;
        return multiplier * (aChange - bChange);
      case "riskLevel":
        return multiplier * (a.riskLevel - b.riskLevel);
      default:
        return 0;
    }
  });

  // Helper function to get the quote currency code
  const getQuoteCurrency = (pair: string): string => {
    const quoteCurrency = pair.split("/")[1];
    return QUOTE_CURRENCY_MAP[quoteCurrency] || "USD"; // Default to USD if not found
  };

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Button
                variant="ghost"
                onClick={() => handleSort("name")}
                className="flex items-center gap-1"
              >
                Name
                {sortField === "name" && <ArrowUpDown className="h-4 w-4" />}
              </Button>
            </TableHead>
            <TableHead>Status</TableHead>
            <TableHead>
              <Button
                variant="ghost"
                onClick={() => handleSort("value")}
                className="flex items-center gap-1"
              >
                Value
                {sortField === "value" && <ArrowUpDown className="h-4 w-4" />}
              </Button>
            </TableHead>
            <TableHead>
              <Button
                variant="ghost"
                onClick={() => handleSort("priceChange")}
                className="flex items-center gap-1"
              >
                24h Change
                {sortField === "priceChange" && (
                  <ArrowUpDown className="h-4 w-4" />
                )}
              </Button>
            </TableHead>
            <TableHead>Side</TableHead>
            <TableHead>Time Frame</TableHead>
            <TableHead>
              <Button
                variant="ghost"
                onClick={() => handleSort("riskLevel")}
                className="flex items-center gap-1"
              >
                Risk
                {sortField === "riskLevel" && (
                  <ArrowUpDown className="h-4 w-4" />
                )}
              </Button>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedPositions.map(position => (
            <TableRow key={position.id}>
              <TableCell className="font-medium">{position.name}</TableCell>
              <TableCell>
                <PositionStatusBadge status={position.lifecycle} />
              </TableCell>
              <TableCell>
                {formatCurrency(
                  position.positionDetails.currentInvestment || 0,
                  {
                    currency: getQuoteCurrency(position.asset.pair),
                  }
                )}
              </TableCell>
              <TableCell
                className={
                  position.asset.marketData?.priceChangePercentage24h
                    ? position.asset.marketData.priceChangePercentage24h >= 0
                      ? "text-green-600"
                      : "text-red-600"
                    : ""
                }
              >
                {position.asset.marketData?.priceChangePercentage24h
                  ? formatPercentage(
                      position.asset.marketData.priceChangePercentage24h,
                      {
                        signDisplay: "always",
                      }
                    )
                  : "N/A"}
              </TableCell>
              <TableCell className="capitalize">
                {position.positionDetails.side}
              </TableCell>
              <TableCell>{position.positionDetails.fractal}</TableCell>
              <TableCell>{position.riskLevel}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
