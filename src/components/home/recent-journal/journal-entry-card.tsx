"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  Clock,
  TrendingUp,
  TrendingDown,
  Minus,
  Paperclip,
  Lightbulb,
} from "lucide-react";
import { useState } from "react";

// Assuming DateOrGenesis is either Date or string like "genesis"
type DateOrGenesis = Date | string;

export interface JournalEntryData {
  /** Unique identifier for the journal entry */
  id: string;
  /** Reference to the position this entry belongs to */
  positionId: string;
  /** The actual journal content/thought */
  thought: string;
  /** Optional file attachments (charts, screenshots, etc.) */
  attachments?: string[];
  /** When the journal entry was created */
  timestamp: DateOrGenesis;
  /** User who created the journal entry */
  userId: string;
  /** Tags for organization and filtering */
  tags?: string[];
  /** Market sentiment at time of entry (bullish, bearish, neutral) */
  sentiment?: "bullish" | "bearish" | "neutral";
  /** Whether this entry contains a significant lesson/insight */
  isKeyLearning?: boolean;
}

interface JournalEntryCardProps {
  entry: JournalEntryData;
}

export function JournalEntryCard({ entry }: JournalEntryCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const {
    positionId,
    thought,
    attachments = [],
    timestamp,
    tags = [],
    sentiment,
    isKeyLearning = false,
  } = entry;

  // Handle timestamp formatting
  const getTimeAgo = (timestamp: DateOrGenesis): string => {
    if (typeof timestamp === "string") {
      return timestamp === "genesis" ? "Genesis" : timestamp;
    }

    const now = new Date();
    const diffMs = now.getTime() - timestamp.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "1 day ago";
    return `${diffDays} days ago`;
  };

  // Sentiment styling
  const getSentimentIcon = (sentiment?: string) => {
    switch (sentiment) {
      case "bullish":
        return <TrendingUp className="h-4 w-4 text-green-600" />;
      case "bearish":
        return <TrendingDown className="h-4 w-4 text-red-600" />;
      case "neutral":
        return <Minus className="h-4 w-4 text-gray-600" />;
      default:
        return null;
    }
  };

  const getSentimentColor = (sentiment?: string) => {
    switch (sentiment) {
      case "bullish":
        return "bg-green-100 text-green-800 border-green-200";
      case "bearish":
        return "bg-red-100 text-red-800 border-red-200";
      case "neutral":
        return "bg-gray-100 text-gray-800 border-gray-200";
      default:
        return "bg-gray-100 text-gray-800 border-gray-200";
    }
  };

  // Truncate thought for preview
  const shouldTruncate = thought.length > 150;
  const displayThought = isExpanded
    ? thought
    : shouldTruncate
    ? `${thought.slice(0, 150)}...`
    : thought;

  return (
    <Card
      className={`hover:shadow-md transition-shadow duration-200 ${
        isKeyLearning ? "ring-2 ring-yellow-200 bg-yellow-50" : ""
      }`}
    >
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium text-sm text-muted-foreground">
                {positionId}
              </span>
              {isKeyLearning && (
                <Badge
                  variant="outline"
                  className="bg-yellow-100 text-yellow-800 border-yellow-200"
                >
                  <Lightbulb className="h-3 w-3 mr-1" />
                  Key Learning
                </Badge>
              )}
            </div>
            <div className="flex items-center space-x-2">
              {sentiment && (
                <Badge
                  variant="outline"
                  className={`text-xs ${getSentimentColor(sentiment)}`}
                >
                  <span className="flex items-center space-x-1">
                    {getSentimentIcon(sentiment)}
                    <span>{sentiment}</span>
                  </span>
                </Badge>
              )}
            </div>
          </div>

          {/* Thought content */}
          <div className="space-y-2">
            <p className="text-sm leading-relaxed text-gray-700">
              {displayThought}
            </p>
            {shouldTruncate && (
              <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="text-xs text-blue-600 hover:text-blue-800 font-medium"
              >
                {isExpanded ? "Show less" : "Read more"}
              </button>
            )}
          </div>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map((tag, index) => (
                <Badge key={index} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-1">
                <Clock className="h-3 w-3" />
                <span>{getTimeAgo(timestamp)}</span>
              </div>
              {attachments.length > 0 && (
                <div className="flex items-center space-x-1">
                  <Paperclip className="h-3 w-3" />
                  <span>
                    {attachments.length} attachment
                    {attachments.length > 1 ? "s" : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
