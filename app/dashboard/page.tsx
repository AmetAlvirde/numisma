/**
 * app/dashboard/page.tsx - Main dashboard page
 *
 * This page serves as the main dashboard for the application,
 * displaying portfolio information and key metrics.
 */

"use client";

import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { PortfolioSummaryCard } from "@/components/dashboard/portfolio-summary-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  // TODO: Get actual user data from auth context
  const userData = {
    name: "John Doe",
    email: "john@example.com",
    avatarUrl: "https://github.com/shadcn.png",
  };

  // TODO: Get actual portfolio ID from user context or URL params
  const portfolioId = "cycle-portfolio-123";

  return (
    <DashboardLayout userName={userData.name} avatarUrl={userData.avatarUrl}>
      <DashboardContent>
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">Dashboard</h1>

          {/* Portfolio Summary */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <PortfolioSummaryCard portfolioId={portfolioId} />
          </div>

          {/* Asset Allocation */}
          <Card>
            <CardHeader>
              <CardTitle>Asset Allocation</CardTitle>
            </CardHeader>
            <CardContent>
              <p>Asset allocation visualization will go here.</p>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <p>Recent activity list will go here.</p>
            </CardContent>
          </Card>
        </div>
      </DashboardContent>
    </DashboardLayout>
  );
}
