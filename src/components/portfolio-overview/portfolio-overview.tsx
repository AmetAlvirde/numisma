import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Star,
  TrendingUp,
  TrendingDown,
  Eye,
  MoreHorizontal,
} from "lucide-react";

interface PortfolioOverviewProps {
  className?: string;
}

export function PortfolioOverview({ className }: PortfolioOverviewProps) {
  // Mock data - in a real app, this would come from your data source
  const pinnedPortfolio = {
    id: "1",
    name: "Growth Portfolio",
    totalValue: 145672.89,
    dayChange: 2847.32,
    dayChangePercent: 1.99,
    topHoldings: ["AAPL", "GOOGL", "TSLA"],
  };

  const isPositive = pinnedPortfolio.dayChange > 0;

  return (
    <div className={`w-full max-w-6xl ${className}`}>
      <Card className="relative">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center space-x-2">
              <Star className="h-4 w-4 fill-yellow-400 text-yellow-400" />
              <span className="text-base font-semibold text-muted-foreground">
                {pinnedPortfolio.name}
              </span>
            </div>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
              <MoreHorizontal className="h-3 w-3" />
            </Button>
          </div>

          <div className="space-y-3">
            {/* Portfolio Value */}
            <div>
              <div className="flex items-end justify-between">
                <p className="text-2xl font-bold">
                  $
                  {pinnedPortfolio.totalValue.toLocaleString("en-US", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                </p>
                <div
                  className={`flex items-center space-x-1 ${
                    isPositive ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {isPositive ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  <span className="text-sm font-medium">
                    {isPositive ? "+" : ""}
                    {pinnedPortfolio.dayChangePercent.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Top Holdings Preview */}
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <span className="text-xs text-muted-foreground">Top:</span>
                <div className="flex space-x-1">
                  {pinnedPortfolio.topHoldings.map((symbol, index) => (
                    <Badge
                      key={symbol}
                      variant="secondary"
                      className="text-xs px-2 py-0.5"
                    >
                      {symbol}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button variant="ghost" size="sm" className="text-xs h-6 px-2">
                <Eye className="h-3 w-3 mr-1" />
                View
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
