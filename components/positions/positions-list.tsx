/**
 * positions-list.tsx - Main container component for positions display
 *
 * This component manages the display of positions in either table or card format,
 * handling data fetching, search, filtering, and view toggling.
 */

"use client";

import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PositionsTable } from "./positions-table";
import { PositionsSearch } from "./positions-search";
import { PositionCard } from "./position-card";
import { usePositions } from "@/hooks/positions/use-positions";
import { Skeleton } from "@/components/ui/skeleton";
import { Position } from "@/types/numisma-types";

export function PositionsList() {
  const [view, setView] = useState<"table" | "cards">("table");
  const [searchQuery, setSearchQuery] = useState("");
  const { positions, isLoading, error } = usePositions();

  const filteredPositions = useMemo(() => {
    if (!positions) return [];
    if (!searchQuery) return positions;

    const query = searchQuery.toLowerCase();
    return positions.filter(position => {
      return (
        position.name.toLowerCase().includes(query) ||
        position.asset.ticker.toLowerCase().includes(query) ||
        position.asset.name.toLowerCase().includes(query) ||
        position.positionDetails.side.toLowerCase().includes(query) ||
        position.positionDetails.timeFrame.toLowerCase().includes(query)
      );
    });
  }, [positions, searchQuery]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive p-4">
        <p className="text-destructive">
          Error loading positions: {error.message}
        </p>
      </div>
    );
  }

  if (!positions?.length) {
    return (
      <div className="rounded-lg border p-4 text-center">
        <p className="text-muted-foreground">No positions found</p>
      </div>
    );
  }

  if (!filteredPositions.length) {
    return (
      <div className="rounded-lg border p-4 text-center">
        <p className="text-muted-foreground">No positions match your search</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PositionsSearch onSearch={setSearchQuery} />
      </div>

      <Tabs value={view} onValueChange={v => setView(v as "table" | "cards")}>
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="cards">Cards</TabsTrigger>
        </TabsList>
        <TabsContent value="table" className="mt-0">
          <PositionsTable positions={filteredPositions} />
        </TabsContent>
        <TabsContent value="cards" className="mt-0">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredPositions.map(position => (
              <PositionCard key={position.id} position={position} />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
