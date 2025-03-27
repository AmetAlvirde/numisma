"use client";

import React from "react";
import { Portfolio } from "@numisma/types";
import { formatCurrency } from "../../lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export interface PortfolioCardProps {
  portfolio: Portfolio;
  totalValue?: number;
  onSelect?: (id: string) => void;
}

export const PortfolioCard: React.FC<PortfolioCardProps> = ({
  portfolio,
  totalValue,
  onSelect,
}) => {
  const handleClick = () => {
    if (onSelect) {
      onSelect(portfolio.id);
    }
  };

  return (
    <Card 
      className="hover:shadow-md transition-shadow cursor-pointer"
      onClick={handleClick}
    >
      <CardHeader>
        <CardTitle>{portfolio.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <div className="text-sm text-gray-500">
            {portfolio.description || "No description"}
          </div>
          {totalValue !== undefined && (
            <div className="text-lg font-semibold">
              {formatCurrency(totalValue)}
            </div>
          )}
          <div className="text-sm">
            {portfolio.positionIds.length} positions
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
