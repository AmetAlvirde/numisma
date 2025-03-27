"use client";

import React from "react";
import { formatCurrency } from "../../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

// This is a placeholder until we add the full types
interface Position {
  id: string;
  name: string;
  riskLevel: number;
  asset?: {
    name: string;
    ticker: string;
  };
  portfolioId: string;
}

export interface PositionCardProps {
  position: Position;
  currentValue?: number;
  percentageChange?: number;
  onSelect?: (id: string) => void;
}

export const PositionCard: React.FC<PositionCardProps> = ({
  position,
  currentValue,
  percentageChange,
  onSelect,
}) => {
  const handleClick = () => {
    if (onSelect) {
      onSelect(position.id);
    }
  };

  return (
    <Card 
      className="hover:shadow-md transition-shadow cursor-pointer"
      onClick={handleClick}
    >
      <CardHeader>
        <CardTitle>{position.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {position.asset && (
            <div className="text-sm font-medium">
              {position.asset.name} ({position.asset.ticker})
            </div>
          )}
          
          {currentValue !== undefined && (
            <div className="text-lg font-semibold">
              {formatCurrency(currentValue)}
            </div>
          )}
          
          {percentageChange !== undefined && (
            <div className={percentageChange >= 0 ? "text-green-600" : "text-red-600"}>
              {percentageChange >= 0 ? "+" : ""}{percentageChange.toFixed(2)}%
            </div>
          )}
          
          <div className="text-sm text-gray-500">
            Risk Level: {position.riskLevel}/10
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
