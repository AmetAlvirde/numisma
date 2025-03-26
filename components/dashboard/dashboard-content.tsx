/**
 * dashboard-content.tsx - Content component for the dashboard
 *
 * This component provides the main content area for the dashboard, including:
 * - A container for page content
 * - Proper spacing and padding
 * - Scrollable area for overflow content
 *
 * The content area is designed to be responsive and follows the Numisma design system.
 */

"use client";

import { ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface DashboardContentProps {
  /** The content to be displayed */
  children: ReactNode;
  /** Whether to show a loading state */
  isLoading?: boolean;
  /** Whether to show an error state */
  error?: string;
}

export function DashboardContent({
  children,
  isLoading = false,
  error,
}: DashboardContentProps) {
  if (isLoading) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[calc(100vh-3.5rem)] items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[calc(100vh-3.5rem)]">
      <div className="container py-6 lg:py-8">{children}</div>
    </ScrollArea>
  );
}
