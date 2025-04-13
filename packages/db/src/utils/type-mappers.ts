/**
 * Type mappers for converting between Prisma database models and domain models
 *
 * This file provides utility functions and type definitions for safely converting
 * between database representation (@prisma/client) and domain model (@numisma/types).
 */

import {
  DateOrGenesis,
  WalletType,
  PositionLifecycle,
  CapitalTier,
  OrderStatus,
  OrderType,
  OrderPurpose,
  AssetLocationType,
  TradeSide,
  PositionStatus,
  TimeFrame,
  AssetType,
  Position,
  Portfolio,
  Market,
} from "@numisma/types";

import {
  Asset as PrismaAsset,
  Market as PrismaMarket,
  Position as PrismaPosition,
  Portfolio as PrismaPortfolio,
  WalletLocation as PrismaWalletLocation,
  Order as PrismaOrder,
  StopLossOrder as PrismaStopLossOrder,
  TakeProfitOrder as PrismaTakeProfitOrder,
  PositionDetails as PrismaPositionDetails,
  PositionStatus as PrismaPositionStatus,
  OrderStatus as PrismaOrderStatus,
  OrderType as PrismaOrderType,
  TradeSide as PrismaTradeSide,
  AssetLocationType as PrismaAssetLocationType,
  Prisma,
} from "@prisma/client";

/**
 * Type guard to check if a value is a valid WalletType
 */
export function isWalletType(value: string): value is WalletType {
  return Object.values(WalletType).includes(value as WalletType);
}

/**
 * Type guard to check if a value is a valid PositionLifecycle
 */
export function isPositionLifecycle(value: string): value is PositionLifecycle {
  return Object.values(PositionLifecycle).includes(value as PositionLifecycle);
}

/**
 * Type guard to check if a value is a valid CapitalTier
 */
export function isCapitalTier(value: string): value is CapitalTier {
  return Object.values(CapitalTier).includes(value as CapitalTier);
}

/**
 * Type guard to check if a value is a valid OrderStatus
 */
export function isOrderStatus(value: string): value is OrderStatus {
  return Object.values(OrderStatus).includes(value as OrderStatus);
}

/**
 * Type guard to check if a value is a valid OrderType
 */
export function isOrderType(value: string): value is OrderType {
  return Object.values(OrderType).includes(value as OrderType);
}

/**
 * Type guard to check if a value is a valid OrderPurpose
 */
export function isOrderPurpose(value: string): value is OrderPurpose {
  return Object.values(OrderPurpose).includes(value as OrderPurpose);
}

/**
 * Type guard to check if a value is a valid AssetLocationType
 */
export function isAssetLocationType(value: string): value is AssetLocationType {
  return Object.values(AssetLocationType).includes(value as AssetLocationType);
}

/**
 * Type guard to check if a value is a valid TradeSide
 */
export function isTradeSide(value: string): value is TradeSide {
  return Object.values(TradeSide).includes(value as TradeSide);
}

/**
 * Type guard to check if a value is a valid PositionStatus
 */
export function isPositionStatus(value: string): value is PositionStatus {
  return Object.values(PositionStatus).includes(value as PositionStatus);
}

/**
 * Type guard to check if a value is a valid TimeFrame
 */
export function isTimeFrame(value: string): value is TimeFrame {
  return Object.values(TimeFrame).includes(value as TimeFrame);
}

/**
 * Convert a Prisma OrderStatus to domain OrderStatus
 */
export function mapOrderStatus(status: PrismaOrderStatus): OrderStatus {
  const statusMap: Record<PrismaOrderStatus, OrderStatus> = {
    submitted: OrderStatus.SUBMITTED,
    filled: OrderStatus.FILLED,
    cancelled: OrderStatus.CANCELLED,
    partially_filled: OrderStatus.PARTIALLY_FILLED,
    expired: OrderStatus.EXPIRED,
  };
  return statusMap[status];
}

/**
 * Convert a domain OrderStatus to Prisma OrderStatus
 */
export function mapToPrismaOrderStatus(status: OrderStatus): PrismaOrderStatus {
  const statusMap: Record<OrderStatus, PrismaOrderStatus> = {
    [OrderStatus.SUBMITTED]: "submitted",
    [OrderStatus.FILLED]: "filled",
    [OrderStatus.CANCELLED]: "cancelled",
    [OrderStatus.PARTIALLY_FILLED]: "partially_filled",
    [OrderStatus.EXPIRED]: "expired",
  };
  return statusMap[status];
}

/**
 * Convert a Prisma OrderType to domain OrderType
 */
export function mapOrderType(type: PrismaOrderType): OrderType {
  const typeMap: Record<PrismaOrderType, OrderType> = {
    trigger: OrderType.TRIGGER,
    market: OrderType.MARKET,
    limit: OrderType.LIMIT,
    trailing_stop: OrderType.TRAILING_STOP,
    oco: OrderType.OCO,
  };
  return typeMap[type];
}

/**
 * Convert a domain OrderType to Prisma OrderType
 */
export function mapToPrismaOrderType(type: OrderType): PrismaOrderType {
  const typeMap: Record<OrderType, PrismaOrderType> = {
    [OrderType.TRIGGER]: "trigger",
    [OrderType.MARKET]: "market",
    [OrderType.LIMIT]: "limit",
    [OrderType.TRAILING_STOP]: "trailing_stop",
    [OrderType.OCO]: "oco",
  };
  return typeMap[type];
}

/**
 * Convert a Prisma AssetLocationType to domain AssetLocationType
 */
export function mapAssetLocationType(
  type: PrismaAssetLocationType
): AssetLocationType {
  const typeMap: Record<PrismaAssetLocationType, AssetLocationType> = {
    exchange: AssetLocationType.EXCHANGE,
    dex: AssetLocationType.DEX,
    cold_storage: AssetLocationType.COLD_STORAGE,
    defi: AssetLocationType.DEFI,
    staking: AssetLocationType.STAKING,
    lending: AssetLocationType.LENDING,
  };
  return typeMap[type];
}

/**
 * Convert a domain AssetLocationType to Prisma AssetLocationType
 */
export function mapToPrismaAssetLocationType(
  type: AssetLocationType
): PrismaAssetLocationType {
  const typeMap: Record<AssetLocationType, PrismaAssetLocationType> = {
    [AssetLocationType.EXCHANGE]: "exchange",
    [AssetLocationType.DEX]: "dex",
    [AssetLocationType.COLD_STORAGE]: "cold_storage",
    [AssetLocationType.DEFI]: "defi",
    [AssetLocationType.STAKING]: "staking",
    [AssetLocationType.LENDING]: "lending",
  };
  return typeMap[type];
}

/**
 * Convert a Prisma TradeSide to domain TradeSide
 */
export function mapTradeSide(side: PrismaTradeSide): TradeSide {
  const sideMap: Record<PrismaTradeSide, TradeSide> = {
    long: TradeSide.LONG,
    short: TradeSide.SHORT,
  };
  return sideMap[side];
}

/**
 * Convert a domain TradeSide to Prisma TradeSide
 */
export function mapToPrismaTradeSide(side: TradeSide): PrismaTradeSide {
  const sideMap: Record<TradeSide, PrismaTradeSide> = {
    [TradeSide.LONG]: "long",
    [TradeSide.SHORT]: "short",
  };
  return sideMap[side];
}

/**
 * Convert a Prisma PositionStatus to domain PositionStatus
 */
export function mapPositionStatus(
  status: PrismaPositionStatus
): PositionStatus {
  const statusMap: Record<PrismaPositionStatus, PositionStatus> = {
    active: PositionStatus.ACTIVE,
    closed: PositionStatus.CLOSED,
    partial: PositionStatus.PARTIAL,
  };
  return statusMap[status];
}

/**
 * Convert a domain PositionStatus to Prisma PositionStatus
 */
export function mapToPrismaPositionStatus(
  status: PositionStatus
): PrismaPositionStatus {
  const statusMap: Record<PositionStatus, PrismaPositionStatus> = {
    [PositionStatus.ACTIVE]: "active",
    [PositionStatus.CLOSED]: "closed",
    [PositionStatus.PARTIAL]: "partial",
  };
  return statusMap[status];
}

/**
 * Convert a string to WalletType with type safety
 */
export function stringToWalletType(value: string): WalletType {
  if (isWalletType(value)) {
    return value;
  }
  // Default to hot if the value is invalid
  console.warn(`Invalid WalletType value: ${value}, defaulting to 'hot'`);
  return WalletType.HOT;
}

/**
 * Convert a string to PositionLifecycle with type safety
 */
export function stringToPositionLifecycle(value: string): PositionLifecycle {
  if (isPositionLifecycle(value)) {
    return value;
  }
  // Default to PLANNED if the value is invalid
  console.warn(
    `Invalid PositionLifecycle value: ${value}, defaulting to 'PLANNED'`
  );
  return PositionLifecycle.PLANNED;
}

/**
 * Convert a string to CapitalTier with type safety
 */
export function stringToCapitalTier(value: string): CapitalTier {
  if (isCapitalTier(value)) {
    return value;
  }
  // Default to C1 if the value is invalid
  console.warn(`Invalid CapitalTier value: ${value}, defaulting to 'C1'`);
  return CapitalTier.C1;
}

/**
 * Convert a string to TimeFrame with type safety
 * Maps fractal field to TimeFrame enum if possible
 */
export function stringToTimeFrame(value: string): TimeFrame {
  // Normalize value to match TimeFrame enum format (e.g., "1D" -> "1D")
  const normalizedValue = value.replace(/_/g, "").toUpperCase();

  if (isTimeFrame(normalizedValue as TimeFrame)) {
    return normalizedValue as TimeFrame;
  }

  // Map legacy fractal values if needed
  const fractialToTimeFrame: Record<string, TimeFrame> = {
    "1m": TimeFrame.ONE_MINUTE,
    "5m": TimeFrame.FIVE_MINUTES,
    "15m": TimeFrame.FIFTEEN_MINUTES,
    "30m": TimeFrame.THIRTY_MINUTES,
    "1h": TimeFrame.ONE_HOUR,
    "4h": TimeFrame.FOUR_HOURS,
    "1d": TimeFrame.ONE_DAY,
    "3d": TimeFrame.THREE_DAYS,
    "1w": TimeFrame.ONE_WEEK,
    "1M": TimeFrame.ONE_MONTH,
  };

  const timeFrame = fractialToTimeFrame[value.toLowerCase()];
  if (timeFrame) {
    return timeFrame;
  }

  // Default to 1D if the value is invalid
  console.warn(`Invalid TimeFrame value: ${value}, defaulting to '1D'`);
  return TimeFrame.ONE_DAY;
}

/**
 * Convert a Date | null to DateOrGenesis safely
 */
export function dateToDateOrGenesis(date: Date | null): DateOrGenesis {
  if (date === null) {
    return "genesis";
  }
  return date;
}

/**
 * Convert a DateOrGenesis to Date | null safely
 */
export function dateOrGenesisToDate(date: DateOrGenesis): Date | null {
  if (date === "genesis") {
    return null;
  }

  if (typeof date === "string" && date !== "genesis") {
    return new Date(date);
  }

  return date;
}

/**
 * TODO: Implement this function properly
 * Convert a string to AssetType with type safety
 */
export function stringToAssetType(value: string): AssetType {
  return value as AssetType; // Temporary implementation, needs proper validation
}

/**
 * Convert domain Position to Prisma Position for create operations
 */
export function mapPositionToPrisma(
  position: Omit<Position, "id">
): Prisma.PositionCreateInput {
  // Extract the properties we need from the position object
  const {
    name,
    lifecycle,
    capitalTier,
    dateCreated,
    marketId,
    walletLocationId,
    positionDetails,
    thesis,
    comment,
    tags,
    isHidden,
    isModel,
  } = position;

  // Position may not have all optional fields, so we build the data object carefully
  const data: Prisma.PositionCreateInput = {
    name,
    lifecycle,
    capitalTier,
    dateCreated: dateOrGenesisToDate(dateCreated) ?? new Date(),
    dateModified: new Date(),
    tags: tags || [],
    isHidden: isHidden || false,
    isModel: isModel || false,
    comment,
  };

  // Add optional fields conditionally
  if ("tradeSide" in position && position.tradeSide) {
    data.tradeSide = mapToPrismaTradeSide(position.tradeSide);
  }

  if ("status" in position && position.status) {
    data.status = mapToPrismaPositionStatus(position.status);
  }

  if ("direction" in position && position.direction) {
    data.direction = position.direction;
  }

  if ("dateOpened" in position && position.dateOpened) {
    data.dateOpened = dateOrGenesisToDate(position.dateOpened);
  }

  if ("dateClosed" in position && position.dateClosed) {
    data.dateClosed = dateOrGenesisToDate(position.dateClosed);
  }

  if ("timeFrame" in position && position.timeFrame) {
    data.timeFrame = position.timeFrame;
  }

  if ("averageEntry" in position && position.averageEntry !== undefined) {
    data.averageEntry = position.averageEntry;
  }

  if ("averageExit" in position && position.averageExit !== undefined) {
    data.averageExit = position.averageExit;
  }

  if ("invested" in position && position.invested !== undefined) {
    data.invested = position.invested;
  }

  if ("roi" in position && position.roi !== undefined) {
    data.roi = position.roi;
  }

  // Add relationships
  if (marketId) {
    data.market = { connect: { id: marketId } };
  }

  if (walletLocationId) {
    data.walletLocation = { connect: { id: walletLocationId } };
  }

  if (positionDetails) {
    data.positionDetails = {
      create: {
        targetSize: positionDetails.targetSize,
        currentSize: positionDetails.currentSize,
        targetEntry: positionDetails.targetEntry,
        targetExit: positionDetails.targetExit,
        targetProfit: positionDetails.targetProfit,
        maxLoss: positionDetails.maxLoss,
        riskRewardRatio: positionDetails.riskRewardRatio,
        expectedReturn: positionDetails.expectedReturn,
      },
    };
  }

  if (thesis) {
    data.thesis = {
      create: {
        summary: thesis.summary,
        analysis: thesis.analysis,
        keyPoints: thesis.keyPoints || [],
        timeframeReason: thesis.timeframeReason,
        entryReason: thesis.entryReason,
        exitReason: thesis.exitReason,
        supportingLinks: thesis.supportingLinks || [],
        dateCreated: dateOrGenesisToDate(thesis.dateCreated) ?? new Date(),
      },
    };
  }

  return data;
}

/**
 * Convert domain Portfolio to Prisma Portfolio for create operations
 */
export function mapPortfolioToPrisma(
  portfolio: Omit<Portfolio, "id">
): Prisma.PortfolioCreateInput {
  return {
    name: portfolio.name,
    description: portfolio.description,
    dateCreated: dateOrGenesisToDate(portfolio.dateCreated) ?? new Date(),
    status: portfolio.status,
    userId: portfolio.userId,
    tags: portfolio.tags || [],
    notes: portfolio.notes,
    color: portfolio.color,
    sortOrder: portfolio.sortOrder || 0,
    isPinned: portfolio.isPinned || false,
  };
}

/**
 * TODO: Implement this function properly
 * Convert domain Market to Prisma Market for create operations
 */
export function mapMarketToPrisma(
  market: Omit<Market, "id" | "baseAsset" | "quoteAsset"> & {
    baseAssetId: string;
    quoteAssetId: string;
  }
): Prisma.MarketCreateInput {
  // This is a stub that needs proper implementation
  return {
    baseAsset: { connect: { id: market.baseAssetId } },
    quoteAsset: { connect: { id: market.quoteAssetId } },
    marketSymbol: market.pairNotation.replace("/", ""),
    pairNotation: market.pairNotation,
    exchange: market.exchange,
    isTradable: market.isTradable ?? true,
  };
}
