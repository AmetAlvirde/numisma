/**
 * position-components.ts - Component-specific types for position-related components
 *
 * This file contains types that adapt the core numisma types for specific component needs,
 * without modifying the core types themselves.
 */

import { Position, PositionStatus } from "./numisma-types";

/**
 * Extended position type for components that need additional fields
 * or have different optionality requirements than the core type
 */
export interface ComponentPosition extends Omit<Position, "positionDetails"> {
  positionDetails: ComponentPositionDetails;
}

/**
 * Extended position details type for components
 */
export interface ComponentPositionDetails {
  status: PositionStatus;
  side: "long" | "short";
  fractal: string;
  currentInvestment: number;
  initialInvestment: number;
  closedPercentage: number;
  recoveredAmount: number;
  orders: any[];
  stopLoss: any[];
  takeProfit: any[];
}

/**
 * Props for the PositionStatusBadge component
 */
export interface PositionStatusBadgeProps {
  status: PositionStatus;
}

/**
 * Props for the PositionCard component
 */
export interface PositionCardProps {
  position: ComponentPosition;
}

/**
 * Props for the PositionsTable component
 */
export interface PositionsTableProps {
  positions: ComponentPosition[];
}
