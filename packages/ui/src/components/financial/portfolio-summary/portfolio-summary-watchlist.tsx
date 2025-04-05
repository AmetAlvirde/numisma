// src/components/financial/portfolio-summary-watchlist.tsx
import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Eye, ArrowUp, ArrowDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type PortfolioSummaryWatchlistProps = {
  watchlist: {
    id: string;
    ticker: string;
    name: string;
    type: "spot" | "futures";
    status: string;
    leverage?: number;
    changePercentage: number;
    currentPrice: number;
  }[];
};

export const PortfolioSummaryWatchlist: React.FC<
  PortfolioSummaryWatchlistProps
> = ({ watchlist }) => {
  return (
    <Card className="shadow-lg border border-divider bg-card">
      <CardHeader className="pb-2 sm:pb-3 border-b border-divider">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2 text-gold-primary">
            <Eye className="h-4 w-4 sm:h-5 sm:w-5 text-gold-primary opacity-70" />
            Today's Watchlist
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-4">
        {watchlist.map(watchlistItem => (
          <div
            key={watchlistItem.id}
            className="rounded-lg p-3 sm:p-4 flex items-start justify-between border border-divider border-l-4 border-l-interactive bg-card/70"
          >
            <div>
              <div className="flex items-center gap-1 sm:gap-2">
                <div className="font-mono text-xs px-1 sm:px-1.5 py-0.5 rounded bg-interactive/50 text-secondary">
                  {watchlistItem.ticker}
                </div>
                <div className="font-medium text-text-primary text-sm sm:text-base">
                  {watchlistItem.name}
                </div>
                <Badge
                  variant="outline"
                  className="ml-1 text-xs bg-interactive/20 border-blue-primary/50 uppercase text-blue-light"
                >
                  {watchlistItem.type}
                </Badge>
              </div>
              <div className="text-xs sm:text-sm mt-1 text-text-secondary">
                {watchlistItem.status}
              </div>

              {watchlistItem.leverage && (
                <div className="flex items-center gap-1 text-xs mt-1 text-warning">
                  <span className="inline-flex items-center">
                    <span className="font-medium font-mono">
                      {watchlistItem.leverage}x
                    </span>{" "}
                    leverage
                  </span>
                </div>
              )}
            </div>
            <div className="text-right">
              <div
                className={cn(
                  "flex items-center justify-end font-medium font-mono text-sm sm:text-base",
                  watchlistItem.changePercentage > 0 && "text-success",
                  watchlistItem.changePercentage < 0 && "text-danger"
                )}
              >
                {watchlistItem.changePercentage > 0 ? (
                  <>
                    <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                    <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                    {watchlistItem.changePercentage}%
                  </>
                ) : (
                  <>
                    <ArrowDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                    {/* TODO: props send changePercentage as negative, maybe
												it should send absolute value and we handle the sign here? */}
                    {/* <Minus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" /> */}
                    {watchlistItem.changePercentage}%
                  </>
                )}
              </div>
              <div className="font-medium mt-1 font-mono text-gold-primary text-sm sm:text-base">
                {watchlistItem.currentPrice}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

PortfolioSummaryWatchlist.displayName = "PortfolioSummaryWatchlist";
