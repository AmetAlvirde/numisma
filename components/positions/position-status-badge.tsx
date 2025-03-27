/**
 * position-status-badge.tsx - Badge component for displaying position status
 *
 * This component displays a colored badge indicating the current status of a position.
 */

"use client";

import { Badge } from "@/components/ui/badge";
import { PositionStatus } from "@/types/numisma-types";
import { PositionStatusBadgeProps } from "@/types/position-components";

const STATUS_CONFIG: Record<
  PositionStatus,
  { label: string; className: string }
> = {
  active: {
    label: "Active",
    className: "bg-green-100 text-green-800 hover:bg-green-100",
  },
  closed: {
    label: "Closed",
    className: "bg-gray-100 text-gray-800 hover:bg-gray-100",
  },
  partial: {
    label: "Partial",
    className: "bg-yellow-100 text-yellow-800 hover:bg-yellow-100",
  },
};

export function PositionStatusBadge({ status }: PositionStatusBadgeProps) {
  const config = STATUS_CONFIG[status] || {
    label: "Unknown",
    className: "bg-gray-100 text-gray-800 hover:bg-gray-100",
  };

  return (
    <Badge variant="secondary" className={config.className}>
      {config.label}
    </Badge>
  );
}
