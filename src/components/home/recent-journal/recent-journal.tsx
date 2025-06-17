"use client";

import { JournalEntryCard, JournalEntryData } from "./journal-entry-card";

interface RecentJournalProps {
  className?: string;
}

// Mock data for recent journal entries
const getMockJournalEntries = (): JournalEntryData[] => {
  const now = new Date();

  return [
    {
      id: "1",
      positionId: "AAPL",
      thought:
        "Noticed strong resistance at the 200 EMA on the daily chart. Market seems to be respecting this level consistently. Might be a good short opportunity if we see a rejection here with volume confirmation.",
      attachments: ["chart_screenshot.png"],
      timestamp: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
      userId: "user1",
      tags: ["technical-analysis", "resistance"],
      sentiment: "bearish",
      isKeyLearning: false,
    },
    {
      id: "2",
      positionId: "BTC",
      thought:
        "Amazing lesson learned today: Always wait for confirmation before entering a trade. Jumped in too early on what looked like a breakout, but it was just a fake move. Market humbled me quickly. Need to be more patient with entries.",
      attachments: [],
      timestamp: new Date(now.getTime() - 6 * 60 * 60 * 1000), // 6 hours ago
      userId: "user1",
      tags: ["psychology", "patience", "entry-timing"],
      sentiment: "neutral",
      isKeyLearning: true,
    },
    // {
    //   id: "3",
    //   positionId: "TSLA",
    //   thought:
    //     "Bullish divergence forming on the RSI while price is making lower lows. This is typically a sign of potential reversal. Volume is also picking up on the recent bounce.",
    //   attachments: ["rsi_divergence.png", "volume_analysis.png"],
    //   timestamp: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    //   userId: "user1",
    //   tags: ["divergence", "rsi", "reversal"],
    //   sentiment: "bullish",
    //   isKeyLearning: false,
    // },
    // {
    //   id: "4",
    //   positionId: "SPY",
    //   thought:
    //     "Fed meeting today. Expecting volatility around 2 PM EST. Positioned light ahead of the announcement. Risk management is key during high-impact news events.",
    //   attachments: [],
    //   timestamp: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    //   userId: "user1",
    //   tags: ["fed", "news", "volatility"],
    //   sentiment: "neutral",
    //   isKeyLearning: false,
    // },
  ];
};

export function RecentJournal({ className }: RecentJournalProps) {
  const entries = getMockJournalEntries();

  // Sort entries by priority:
  // 1. Key learnings first
  // 2. Recent entries (last 24 hours)
  // 3. Entries with attachments
  // 4. By timestamp (newest first)
  const sortedEntries = entries.sort((a, b) => {
    // Key learnings get highest priority
    if (a.isKeyLearning && !b.isKeyLearning) return -1;
    if (b.isKeyLearning && !a.isKeyLearning) return 1;

    // Recent entries (last 24 hours) get priority
    const aRecent =
      typeof a.timestamp !== "string" &&
      Date.now() - a.timestamp.getTime() < 24 * 60 * 60 * 1000;
    const bRecent =
      typeof b.timestamp !== "string" &&
      Date.now() - b.timestamp.getTime() < 24 * 60 * 60 * 1000;

    if (aRecent && !bRecent) return -1;
    if (bRecent && !aRecent) return 1;

    // Entries with attachments get slight priority
    const aHasAttachments = (a.attachments?.length || 0) > 0;
    const bHasAttachments = (b.attachments?.length || 0) > 0;

    if (aHasAttachments && !bHasAttachments) return -1;
    if (bHasAttachments && !aHasAttachments) return 1;

    // Sort by timestamp (newest first)
    if (typeof a.timestamp === "string" && typeof b.timestamp === "string") {
      return a.timestamp.localeCompare(b.timestamp);
    }
    if (typeof a.timestamp === "string") return 1;
    if (typeof b.timestamp === "string") return -1;

    return b.timestamp.getTime() - a.timestamp.getTime();
  });

  // Show only top 6 entries
  const displayEntries = sortedEntries.slice(0, 6);

  return (
    <div className={`w-full max-w-6xl ${className}`}>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {displayEntries.map(entry => (
          <JournalEntryCard key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  );
}
