/**
 * app/dashboard/test/page.tsx - Test page for dashboard components
 *
 * This page serves as a testing ground for all dashboard components,
 * allowing us to verify their functionality and appearance.
 */

"use client";

import { DashboardLayout } from "@/components/dashboard/dashboard-layout";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { DashboardContent } from "@/components/dashboard/dashboard-content";
import { DashboardFooter } from "@/components/dashboard/dashboard-footer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardTestPage() {
  // Mock user data for testing
  const userData = {
    name: "John Doe",
    email: "john@example.com",
    avatarUrl: "https://github.com/shadcn.png",
  };

  // Mock logout handler
  const handleLogout = () => {
    console.log("Logout clicked");
  };

  return (
    <DashboardLayout userName={userData.name} avatarUrl={userData.avatarUrl}>
      <div className="container py-6 lg:py-8">
        <div className="space-y-6">
          <h1 className="text-3xl font-bold">Dashboard Test Page</h1>

          {/* Test Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Portfolio Overview</CardTitle>
              </CardHeader>
              <CardContent>
                <p>Test content for portfolio overview card.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                <p>Test content for recent activity card.</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <p>Test content for performance card.</p>
              </CardContent>
            </Card>
          </div>

          {/* Test Content */}
          <div className="space-y-4">
            <h2 className="text-2xl font-semibold">Test Content</h2>
            <p>
              This is a test page to verify the dashboard layout and components.
              Scroll down to test the scrolling behavior.
            </p>
            {Array.from({ length: 20 }).map((_, i) => (
              <p key={i}>
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do
                eiusmod tempor incididunt ut labore et dolore magna aliqua.
              </p>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
