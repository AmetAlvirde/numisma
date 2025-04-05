// src/components/financial/portfolio-summary-position-breakdown.tsx
import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { BarChart3, ArrowUp, ArrowDown, Plus } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export interface PortfolioSummaryPositionBreakdownProps {
  spotPositions: {
    count: number;
    totalValue: number;
    change24h: number;
  };
  futuresPositions: {
    count: number;
    totalValue: number;
    change24h: number;
  };
}

export const PortfolioSummaryPositionBreakdown: React.FC<
  PortfolioSummaryPositionBreakdownProps
> = ({ spotPositions, futuresPositions }) => {
  return (
    <Card className="shadow-lg border border-divider bg-card">
      <CardHeader className="pb-2 sm:pb-3 border-b border-divider">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2 text-gold-primary">
            <BarChart3 className="h-4 w-4 sm:h-5 sm:w-5 text-gold-primary/70" />
            Position Breakdown
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-3 sm:mb-4 bg-interactive">
            <TabsTrigger
              value="all"
              className="data-[state=active]:bg-gold-dark data-[state=active]:text-white text-xs sm:text-sm"
            >
              All
            </TabsTrigger>
            <TabsTrigger
              value="spot"
              className="data-[state=active]:bg-gold-dark data-[state=active]:text-white text-xs sm:text-sm"
            >
              Spot
            </TabsTrigger>
            <TabsTrigger
              value="futures"
              className="data-[state=active]:bg-gold-dark data-[state=active]:text-white text-xs sm:text-sm"
            >
              Futures
            </TabsTrigger>
          </TabsList>
          <TabsContent value="all" className="space-y-3 sm:space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="rounded-lg p-3 sm:p-4 text-center border border-blue-primary/30 border-l-4 border-l-blue-primary bg-blue-primary/10">
                <div className="text-xs sm:text-sm font-medium mb-1 text-blue-primary">
                  Spot Positions
                </div>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-text-primary">
                  {spotPositions.count}
                </div>
                <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                  {spotPositions.totalValue}
                </div>
                <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                  {spotPositions.change24h > 0 ? (
                    <>
                      <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                      <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                      <span>{spotPositions.change24h}% (24h)</span>
                    </>
                  ) : (
                    <>
                      <ArrowDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5 text-danger" />
                      <span className="text-danger">
                        {spotPositions.change24h}% (24h)
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-lg p-3 sm:p-4 text-center border border-gold-primary/30 border-l-4 border-l-gold-primary bg-gold-primary/10">
                <div className="text-xs sm:text-sm font-medium mb-1 text-gold-primary">
                  Futures Positions
                </div>
                <div className="text-2xl sm:text-3xl font-bold font-mono text-text-primary">
                  {futuresPositions.count}
                </div>
                <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                  {futuresPositions.totalValue}
                </div>
                <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                  {futuresPositions.change24h > 0 ? (
                    <>
                      <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                      <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                      <span>{futuresPositions.change24h}% (24h)</span>
                    </>
                  ) : (
                    <>
                      <ArrowDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5 text-danger" />
                      <span className="text-danger">
                        {futuresPositions.change24h}% (24h)
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>
          <TabsContent value="spot">
            <div className="rounded-lg p-3 sm:p-4 text-center border border-blue-primary/30 border-l-4 border-l-blue-primary bg-blue-primary/10">
              <div className="text-xs sm:text-sm font-medium mb-1 text-blue-primary">
                Spot Positions
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-mono text-text-primary">
                {spotPositions.count}
              </div>
              <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                {spotPositions.totalValue}
              </div>
              <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                {spotPositions.change24h > 0 ? (
                  <>
                    <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                    <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                    <span>{spotPositions.change24h}% (24h)</span>
                  </>
                ) : (
                  <>
                    <ArrowDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5 text-danger" />
                    <span className="text-danger">
                      {spotPositions.change24h}% (24h)
                    </span>
                  </>
                )}
              </div>
            </div>
          </TabsContent>
          <TabsContent value="futures">
            <div className="rounded-lg p-3 sm:p-4 text-center border border-gold-primary/30 border-l-4 border-l-gold-primary bg-gold-primary/10">
              <div className="text-xs sm:text-sm font-medium mb-1 text-gold-primary">
                Futures Positions
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-mono text-text-primary">
                {futuresPositions.count}
              </div>
              <div className="text-base sm:text-lg font-semibold mt-1 font-mono text-gold-primary">
                {futuresPositions.totalValue}
              </div>
              <div className="text-xs sm:text-sm mt-1 flex items-center justify-center text-success">
                {futuresPositions.change24h > 0 ? (
                  <>
                    <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                    <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                    <span>{futuresPositions.change24h}% (24h)</span>
                  </>
                ) : (
                  <>
                    <ArrowDown className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5 text-danger" />
                    <span className="text-danger">
                      {futuresPositions.change24h}% (24h)
                    </span>
                  </>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
};

PortfolioSummaryPositionBreakdown.displayName =
  "PortfolioSummaryPositionBreakdown";
