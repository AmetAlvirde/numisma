// src/components/financial/portfolio-summary-quick-actions.tsx
import React from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, BarChart3, Clock } from "lucide-react";

export interface PortfolioSummaryQuickActionsProps {
  onRefresh: () => void;
  onFullAnalysis: () => void;
}

export const PortfolioSummaryQuickActions: React.FC<
  PortfolioSummaryQuickActionsProps
> = ({ onRefresh, onFullAnalysis }) => {
  return (
    <Card className="shadow-lg border border-divider bg-card">
      <CardHeader className="pb-2 sm:pb-3 border-b border-divider">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base sm:text-lg text-gold-primary">
            Quick Actions
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
          <Button
            className="w-full flex items-center justify-center gap-2 transition-colors bg-gold-dark hover:bg-gold-primary text-white focus:ring-2 focus:ring-gold-primary focus:ring-offset-2 focus:outline-none text-sm sm:text-base"
            onClick={onRefresh}
          >
            <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Refresh Data
          </Button>
          <Button
            variant="outline"
            className="w-full flex items-center justify-center gap-2 transition-colors bg-card border-divider text-gold-primary hover:bg-interactive focus:ring-2 focus:ring-gold-primary focus:ring-offset-2 focus:outline-none text-sm sm:text-base"
            onClick={onFullAnalysis}
          >
            <BarChart3 className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Full Analysis
          </Button>
        </div>
      </CardContent>
      <CardFooter className="flex items-center justify-between px-4 sm:px-6 py-2 sm:py-3 border-t border-divider">
        <div className="flex items-center text-xs sm:text-sm text-text-secondary">
          <Clock className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-1" />
          Last updated: 08:41 p.m.
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="p-1 h-auto transition-colors text-gold-primary hover:bg-gold-primary hover:bg-opacity-10 focus:ring-2 focus:ring-gold-primary focus:outline-none"
        >
          <RefreshCw className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
          <span className="sr-only">Refresh</span>
        </Button>
      </CardFooter>
    </Card>
  );
};

PortfolioSummaryQuickActions.displayName = "PortfolioSummaryQuickActions";
