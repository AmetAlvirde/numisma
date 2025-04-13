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
  position: Omit<Position, "id"> & {
    market?: { id: string };
    walletLocation?: { id: string };
  }
): Prisma.PositionCreateInput {
  // Extract the basic properties we need from the position object
  const {
    name,
    lifecycle,
    capitalTier,
    tags,
    isHidden,
    market,
    walletLocation,
    positionDetails,
    thesis,
  } = position;

  // Position may not have all optional fields, so we build the data object carefully
  const data: Prisma.PositionCreateInput = {
    name,
    lifecycle: lifecycle,
    capitalTier: capitalTier,
    walletType: position.walletType || WalletType.HOT,
    riskLevel: position.riskLevel || 5,
    strategy: position.strategy || "",
    isHidden: isHidden || false,
  };

  // Add tags if provided
  if (tags && tags.length > 0) {
    data.tags = tags;
  }

  // Handle Market relationship
  if (market?.id) {
    data.market = { connect: { id: market.id } };
  }

  // Handle WalletLocation relationship
  if (walletLocation?.id) {
    data.walletLocation = { connect: { id: walletLocation.id } };
  }

  // Handle PositionDetails with nested create
  if (positionDetails) {
    data.positionDetails = {
      create: {
        status: mapToPrismaPositionStatus(
          positionDetails.status || PositionStatus.ACTIVE
        ),
        side: mapToPrismaTradeSide(positionDetails.side || TradeSide.LONG),
        timeFrame: positionDetails.timeFrame || TimeFrame.ONE_DAY,

        // Handle dates with proper DateOrGenesis conversion
        ...(positionDetails.dateOpened
          ? { dateOpened: dateOrGenesisToDate(positionDetails.dateOpened) }
          : {}),
        ...(positionDetails.dateClosed
          ? { dateClosed: dateOrGenesisToDate(positionDetails.dateClosed) }
          : {}),

        // Handle numeric properties
        ...(positionDetails.averageEntryPrice !== undefined
          ? { averageEntryPrice: positionDetails.averageEntryPrice }
          : {}),
        ...(positionDetails.averageExitPrice !== undefined
          ? { averageExitPrice: positionDetails.averageExitPrice }
          : {}),
        ...(positionDetails.totalSize !== undefined
          ? { totalSize: positionDetails.totalSize }
          : {}),
        ...(positionDetails.totalCost !== undefined
          ? { totalCost: positionDetails.totalCost }
          : {}),
        ...(positionDetails.realizedProfitLoss !== undefined
          ? { realizedProfitLoss: positionDetails.realizedProfitLoss }
          : {}),
        ...(positionDetails.unrealizedProfitLoss !== undefined
          ? { unrealizedProfitLoss: positionDetails.unrealizedProfitLoss }
          : {}),
        ...(positionDetails.currentReturn !== undefined
          ? { currentReturn: positionDetails.currentReturn }
          : {}),
        ...(positionDetails.targetPrice !== undefined
          ? { targetPrice: positionDetails.targetPrice }
          : {}),
        ...(positionDetails.stopPrice !== undefined
          ? { stopPrice: positionDetails.stopPrice }
          : {}),
        ...(positionDetails.riskRewardRatio !== undefined
          ? { riskRewardRatio: positionDetails.riskRewardRatio }
          : {}),
        isLeveraged: positionDetails.isLeveraged || false,
        ...(positionDetails.leverage !== undefined
          ? { leverage: positionDetails.leverage }
          : {}),

        // Handle orders if provided
        ...(positionDetails.orders && positionDetails.orders.length > 0
          ? {
              orders: {
                create: positionDetails.orders.map(order => ({
                  dateOpen: dateOrGenesisToDate(order.dateOpen || new Date()),
                  status: mapToPrismaOrderStatus(order.status),
                  type: mapToPrismaOrderType(order.type),
                  purpose: order.purpose,
                  ...(order.averagePrice !== undefined
                    ? { averagePrice: order.averagePrice }
                    : {}),
                  ...(order.totalCost !== undefined
                    ? { totalCost: order.totalCost }
                    : {}),
                  ...(order.fee !== undefined ? { fee: order.fee } : {}),
                  ...(order.feeUnit !== undefined
                    ? { feeUnit: order.feeUnit }
                    : {}),
                  ...(order.filled !== undefined
                    ? { filled: order.filled }
                    : {}),
                  ...(order.unit !== undefined
                    ? { unit: order.unit as string }
                    : {}),
                  ...(order.trigger !== undefined
                    ? { trigger: order.trigger }
                    : {}),
                  ...(order.estimatedCost !== undefined
                    ? { estimatedCost: order.estimatedCost }
                    : {}),
                  ...(order.exchangeOrderId !== undefined
                    ? { exchangeOrderId: order.exchangeOrderId }
                    : {}),
                  isAutomated: order.isAutomated || false,
                  isHidden: order.isHidden || false,
                  ...(order.parentOrderId !== undefined
                    ? { parentOrderId: order.parentOrderId }
                    : {}),
                  ...(order.notes !== undefined ? { notes: order.notes } : {}),
                })),
              },
            }
          : {}),

        // Handle stop loss orders if provided
        ...(positionDetails.stopLoss && positionDetails.stopLoss.length > 0
          ? {
              stopLossOrders: {
                create: positionDetails.stopLoss.map(order => ({
                  dateOpen: dateOrGenesisToDate(order.dateOpen || new Date()),
                  status: mapToPrismaOrderStatus(order.status),
                  type: mapToPrismaOrderType(order.type),
                  size: order.size,
                  ...(order.unit !== undefined
                    ? { unit: order.unit as string }
                    : {}),
                  ...(order.trigger !== undefined
                    ? { trigger: order.trigger }
                    : {}),
                  isTrailing: order.isTrailing || false,
                  ...(order.trailingDistance !== undefined
                    ? { trailingDistance: order.trailingDistance }
                    : {}),
                  ...(order.trailingUnit !== undefined
                    ? { trailingUnit: order.trailingUnit as string }
                    : {}),
                  ...(order.estimatedCost !== undefined
                    ? { estimatedCost: order.estimatedCost }
                    : {}),
                  ...(order.filled !== undefined
                    ? { filled: order.filled }
                    : {}),
                  ...(order.maxSlippage !== undefined
                    ? { maxSlippage: order.maxSlippage }
                    : {}),
                  ...(order.fee !== undefined ? { fee: order.fee } : {}),
                  ...(order.feeUnit !== undefined
                    ? { feeUnit: order.feeUnit }
                    : {}),
                  ...(order.averagePrice !== undefined
                    ? { averagePrice: order.averagePrice }
                    : {}),
                  ...(order.totalCost !== undefined
                    ? { totalCost: order.totalCost }
                    : {}),
                  ...(order.strategy !== undefined
                    ? { strategy: order.strategy as string }
                    : {}),
                })),
              },
            }
          : {}),

        // Handle take profit orders if provided
        ...(positionDetails.takeProfit && positionDetails.takeProfit.length > 0
          ? {
              takeProfitOrders: {
                create: positionDetails.takeProfit.map(order => ({
                  dateOpen: dateOrGenesisToDate(order.dateOpen || new Date()),
                  status: mapToPrismaOrderStatus(order.status),
                  type: mapToPrismaOrderType(order.type),
                  size: order.size,
                  ...(order.unit !== undefined
                    ? { unit: order.unit as string }
                    : {}),
                  ...(order.trigger !== undefined
                    ? { trigger: order.trigger }
                    : {}),
                  ...(order.targetPercentage !== undefined
                    ? { targetPercentage: order.targetPercentage }
                    : {}),
                  ...(order.estimatedCost !== undefined
                    ? { estimatedCost: order.estimatedCost }
                    : {}),
                  ...(order.filled !== undefined
                    ? { filled: order.filled }
                    : {}),
                  ...(order.maxSlippage !== undefined
                    ? { maxSlippage: order.maxSlippage }
                    : {}),
                  ...(order.fee !== undefined ? { fee: order.fee } : {}),
                  ...(order.feeUnit !== undefined
                    ? { feeUnit: order.feeUnit }
                    : {}),
                  ...(order.averagePrice !== undefined
                    ? { averagePrice: order.averagePrice }
                    : {}),
                  ...(order.totalCost !== undefined
                    ? { totalCost: order.totalCost }
                    : {}),
                  ...(order.tier !== undefined ? { tier: order.tier } : {}),
                  moveStopToBreakeven: order.moveStopToBreakeven || false,
                })),
              },
            }
          : {}),
      },
    };
  }

  // Handle thesis with nested create
  if (thesis) {
    data.thesis = {
      create: {
        reasoning: thesis.reasoning,
        ...(thesis.invalidation !== undefined
          ? { invalidation: thesis.invalidation }
          : {}),
        ...(thesis.fulfillment !== undefined
          ? { fulfillment: thesis.fulfillment }
          : {}),
        ...(thesis.notes !== undefined ? { notes: thesis.notes } : {}),
        ...(thesis.technicalAnalysis !== undefined
          ? { technicalAnalysis: thesis.technicalAnalysis }
          : {}),
        ...(thesis.fundamentalAnalysis !== undefined
          ? { fundamentalAnalysis: thesis.fundamentalAnalysis }
          : {}),
        ...(thesis.timeHorizon !== undefined
          ? { timeHorizon: thesis.timeHorizon }
          : {}),
        ...(thesis.riskRewardRatio !== undefined
          ? { riskRewardRatio: thesis.riskRewardRatio }
          : {}),
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
