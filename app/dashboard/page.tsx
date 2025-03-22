"use client";

import { PositionsList } from "@/components/PositionsList";
import { useEffect, useState } from "react";
import { Position } from "@/types";

export default function DashboardPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>(
    {}
  );

  useEffect(() => {
    // Fetch positions from the JSON file
    fetch("/api/positions")
      .then(res => res.json())
      .then(data => setPositions(data))
      .catch(error => console.error("Error fetching positions:", error));

    // TODO: Fetch current prices from your price source
    // For now, using mock data
    setCurrentPrices({
      BTC: 65000,
      ETH: 3500,
      SOL: 120,
    });
  }, []);

  const handlePositionClick = (position: Position) => {
    // TODO: Implement position click handler
    console.log("Position clicked:", position);
  };

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
      <PositionsList
        positions={positions}
        currentPrices={currentPrices}
        onPositionClick={handlePositionClick}
      />
    </div>
  );
}
