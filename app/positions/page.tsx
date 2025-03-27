/**
 * positions/page.tsx - Main positions page component
 *
 * This page displays a list of all positions in the portfolio with options
 * to view them in either table or card format, with search and filtering capabilities.
 */

"use client";

import { PositionsList } from "@/components/positions/positions-list";

export default function PositionsPage() {
  return (
    <div className="container mx-auto py-6">
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Positions</h1>
          <p className="text-muted-foreground">
            View and manage your active positions
          </p>
        </div>
        <PositionsList />
      </div>
    </div>
  );
}
