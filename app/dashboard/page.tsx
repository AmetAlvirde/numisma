"use client";

import { PositionsList } from "@/components/PositionsList";
import { useEffect, useState } from "react";
import { Position } from "@/types";

export default function DashboardPage() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({
    BTC: 65000,
    ETH: 3500,
    SOL: 120,
  });

  useEffect(() => {
    // Fetch positions from the JSON file
    fetch("/api/positions")
      .then(res => res.json())
      .then(data => setPositions(data))
      .catch(error => console.error("Error fetching positions:", error));
  }, []);

  return (
    <div className="container mx-auto py-8">
      <h1 className="text-3xl font-bold mb-8">Dashboard</h1>
      <PositionsList positions={positions} currentPrices={currentPrices} />
    </div>
  );
}
