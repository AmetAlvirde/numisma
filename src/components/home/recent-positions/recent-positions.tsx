"use client";

import { PositionCard, PositionCardData } from "./position-card";

interface RecentPositionsProps {
  className?: string;
}

// Mock data for recent positions - sorted by priority (recent, approaching targets, high-performing)
const getMockPositions = (): PositionCardData[] => {
  const now = new Date();

  return [
    {
      id: "1",
      symbol: "AAPL",
      status: "active",
      side: "short",
      timeFrame: "1D",
      dateOpened: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
      currentReturn: -3.2,
      unrealizedProfitLoss: -1250,
      riskRewardRatio: 1.5,
      targetPrice: 255.5,
      stopPrice: 260.0,
      totalSize: 10000,
      // Enhanced information
      currentPrice: 258.75,
      entryPrice: 251.2,
      timeInPosition: {
        hours: 26,
        minutes: 15,
        totalMinutes: 1575,
      },
      distanceToLevels: {
        toTarget: {
          percentage: 1.24,
          price: 3.25,
          direction: "approaching",
        },
        toStop: {
          percentage: 0.48,
          price: 1.25,
          direction: "approaching",
        },
      },
      recentEvents: [
        {
          timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
          type: "price_alert",
          description: "Broke below key support at $259",
          impact: "positive",
        },
        {
          timestamp: new Date(now.getTime() - 8 * 60 * 60 * 1000), // 8 hours ago
          type: "news",
          description: "Earnings miss reported",
          impact: "positive",
        },
      ],
    },
    {
      id: "2",
      symbol: "BTC",
      status: "active",
      side: "long",
      timeFrame: "4H",
      dateOpened: new Date(now.getTime() - 0.5 * 24 * 60 * 60 * 1000), // 12 hours ago
      currentReturn: 1.8,
      unrealizedProfitLoss: 890,
      riskRewardRatio: 3.0,
      targetPrice: 52000,
      stopPrice: 47500,
      totalSize: 50000,
      // Enhanced information
      currentPrice: 49890,
      entryPrice: 49000,
      timeInPosition: {
        hours: 12,
        minutes: 30,
        totalMinutes: 750,
      },
      distanceToLevels: {
        toTarget: {
          percentage: 4.23,
          price: 2110,
          direction: "moving_toward",
        },
        toStop: {
          percentage: 5.03,
          price: 2390,
          direction: "safe",
        },
      },
      recentEvents: [
        {
          timestamp: new Date(now.getTime() - 1 * 60 * 60 * 1000), // 1 hour ago
          type: "technical",
          description: "Broke above $49,500 resistance",
          impact: "positive",
        },
        {
          timestamp: new Date(now.getTime() - 4 * 60 * 60 * 1000), // 4 hours ago
          type: "volume",
          description: "Volume spike detected",
          impact: "positive",
        },
      ],
    },
  ];
};

export function RecentPositions({ className }: RecentPositionsProps) {
  const positions = getMockPositions();

  // Sort positions by priority:
  // 1. Recently opened (last 2 days)
  // 2. High performing (>3% return)
  // 3. Approaching targets or stops
  const sortedPositions = positions.sort((a, b) => {
    const aDaysAgo = Math.floor(
      (Date.now() - a.dateOpened.getTime()) / (1000 * 60 * 60 * 24)
    );
    const bDaysAgo = Math.floor(
      (Date.now() - b.dateOpened.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Recently opened positions (last 2 days) get priority
    if (aDaysAgo <= 2 && bDaysAgo > 2) return -1;
    if (bDaysAgo <= 2 && aDaysAgo > 2) return 1;

    // High performing positions (>3% return) get priority
    const aHighPerforming = Math.abs(a.currentReturn || 0) > 3;
    const bHighPerforming = Math.abs(b.currentReturn || 0) > 3;

    if (aHighPerforming && !bHighPerforming) return -1;
    if (bHighPerforming && !aHighPerforming) return 1;

    // Otherwise sort by return (highest first)
    return (b.currentReturn || 0) - (a.currentReturn || 0);
  });

  // Show only top 6 positions
  const displayPositions = sortedPositions.slice(0, 6);

  return (
    <div className={`w-full max-w-6xl ${className}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayPositions.map(position => (
          <PositionCard key={position.id} position={position} />
        ))}
      </div>
    </div>
  );
}
