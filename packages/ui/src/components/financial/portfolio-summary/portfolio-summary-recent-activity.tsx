// src/components/financial/portfolio-summary/portfolio-summary-recent-activity.tsx
import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Clock,
  ArrowUp,
  // ArrowDown,
  Plus,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/*
 * Recent Activity, previously Overnight Activity (which is the main use case
 * for this component)
 *
 */

export type RecentActivity = {
  id: string;
  type: "order_filled" | "alert" | "notification";
  title: string;
  description: string;
  value?: number;
  changePercentage?: number;
  timestamp: string;
};

export interface PortfolioSummaryRecentActivityProps {
  recentActivity: RecentActivity[];
  onViewAllActivity: () => void;
}

export const PortfolioSummaryRecentActivity: React.FC<
  PortfolioSummaryRecentActivityProps
> = ({ recentActivity, onViewAllActivity }) => {
  return (
    <Card className="shadow-lg border border-divider bg-card">
      <CardHeader className="pb-2 sm:pb-3 border-b border-divider">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base sm:text-lg flex items-center gap-2 text-gold-primary">
            <Clock className="h-4 w-4 sm:h-5 sm:w-5 text-gold-primary/70" />
            Recent Activity
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 sm:space-y-4 p-3 sm:p-4">
        {recentActivity.map(activity => (
          <div
            key={activity.id}
            className={cn(
              "rounded-lg p-2 sm:p-3 flex items-start justify-between border border-l-4",
              activity.type === "order_filled" &&
                "border-success/20 bg-success/10 border-l-success",
              activity.type === "alert" &&
                "border-warning/20 bg-warning/10 border-l-warning"
            )}
          >
            <div className="flex gap-2 sm:gap-3">
              {activity.type === "order_filled" && (
                <CheckCircle2 className="h-4 w-4 sm:h-5 sm:w-5 mt-0.5 text-success" />
              )}
              {activity.type === "alert" && (
                <AlertCircle className="h-4 w-4 sm:h-5 sm:w-5 mt-0.5 text-warning" />
              )}
              <div>
                <div className="font-medium text-text-primary text-sm sm:text-base">
                  {activity.title}
                </div>
                <div className="text-xs sm:text-sm text-text-secondary">
                  {activity.description}
                </div>
              </div>
            </div>
            <div className="text-right">
              {activity.type === "order_filled" && (
                <div className="font-medium font-mono text-gold-primary text-sm sm:text-base">
                  {activity.value}
                </div>
              )}

              {activity.type === "alert" && (
                <>
                  <div className="flex items-center justify-end font-medium font-mono text-success text-sm sm:text-base">
                    <ArrowUp className="h-3 w-3 sm:h-3.5 sm:w-3.5 mr-0.5" />
                    <Plus className="h-2.5 w-2.5 sm:h-3 sm:w-3 mr-0.5" />
                    {activity.changePercentage}%
                  </div>
                </>
              )}

              <div className="text-xs text-text-secondary">
                {activity.timestamp}
              </div>
            </div>
          </div>
        ))}

        <Button
          variant="ghost"
          className="w-full justify-center text-gold-primary hover:bg-gold-primary/10 transition-colors text-sm sm:text-base"
          onClick={onViewAllActivity}
        >
          View all activity
          <ChevronRight className="ml-1 h-3 w-3 sm:h-4 sm:w-4" />
        </Button>
      </CardContent>
    </Card>
  );
};

PortfolioSummaryRecentActivity.displayName = "PortfolioSummaryRecentActivity";
