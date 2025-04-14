/**
 * Entity mappers for converting between Prisma database models and domain models
 *
 * This file handles the mapping of complete entities between database
 * representation (@prisma/client) and domain models (@numisma/types).
 */

import {
  Position,
  Market,
  Asset,
  Portfolio,
  AssetLocationType,
  AssetType,
  WalletLocation,
  Order,
  StopLossOrder,
  TakeProfitOrder,
  PositionDetails,
  Thesis,
  JournalEntry,
  OrderPurpose,
} from "@numisma/types";

import {
  Position as PrismaPosition,
  Market as PrismaMarket,
  Asset as PrismaAsset,
  Portfolio as PrismaPortfolio,
  WalletLocation as PrismaWalletLocation,
  Order as PrismaOrder,
  StopLossOrder as PrismaStopLossOrder,
  TakeProfitOrder as PrismaTakeProfitOrder,
  PositionDetails as PrismaPositionDetails,
  Thesis as PrismaThesis,
  JournalEntry as PrismaJournalEntry,
  Prisma,
} from "@prisma/client";

import {
  mapOrderStatus,
  mapOrderType,
  mapTradeSide,
  mapPositionStatus,
  mapAssetLocationType,
  stringToWalletType,
  stringToPositionLifecycle,
  stringToCapitalTier,
  stringToTimeFrame,
  dateToDateOrGenesis,
  dateOrGenesisToDate,
  mapPortfolioToPrisma,
} from "./type-mappers";

/**
 * Maps a Prisma Asset to a domain Asset model
 */
export function mapAssetToDomain(
  asset: PrismaAsset,
  options?: {
    includeMarketData?: boolean;
  }
): Asset {
  return {
    id: asset.id,
    name: asset.name,
    ticker: asset.ticker,
    assetType: stringToAssetType(asset.assetType),
    description: asset.description || undefined,
    network: asset.network || undefined,
    contractAddress: asset.contractAddress || undefined,
    iconUrl: asset.iconUrl || undefined,
    category: asset.category || undefined,
    marketData:
      options?.includeMarketData && asset.marketData
        ? (asset.marketData as any)
        : undefined,
    locationType: AssetLocationType.EXCHANGE, // Default to EXCHANGE as per schema
    wallet: "", // Empty string as default since it's required in the Asset type
  };
}

/**
 * Helper function to safely convert asset type strings to AssetType enum
 */
function stringToAssetType(assetType: string): AssetType {
  if (Object.values(AssetType).includes(assetType as AssetType)) {
    return assetType as AssetType;
  }
  return AssetType.CRYPTO; // Default if not recognized
}

/**
 * Maps a domain Asset to a Prisma Asset model for creation/updates
 */
export function mapAssetToPrisma(
  asset: Omit<Asset, "id">
): Prisma.AssetCreateInput {
  return {
    name: asset.name,
    ticker: asset.ticker,
    assetType: asset.assetType as string,
    description: asset.description,
    network: asset.network,
    contractAddress: asset.contractAddress,
    iconUrl: asset.iconUrl,
    category: asset.category,
    marketData: asset.marketData ? (asset.marketData as any) : undefined,
  };
}

/**
 * Maps a Prisma Market to a domain Market model
 */
export function mapMarketToDomain(
  market: PrismaMarket & {
    baseAsset?: PrismaAsset;
    quoteAsset?: PrismaAsset;
  }
): Market {
  return {
    id: market.id,
    baseAsset: market.baseAsset
      ? mapAssetToDomain(market.baseAsset)
      : (undefined as any), // TODO: Fix this typing in domain model
    quoteAsset: market.quoteAsset
      ? mapAssetToDomain(market.quoteAsset)
      : (undefined as any), // TODO: Fix this typing in domain model
    pairNotation: market.pairNotation,
    exchange: market.exchange || undefined,
    isTradable: market.isTradable,
  };
}

/**
 * Maps a Prisma WalletLocation to a domain WalletLocation model
 */
export function mapWalletLocationToDomain(
  walletLocation: PrismaWalletLocation
): WalletLocation {
  return {
    id: walletLocation.id,
    name: walletLocation.name,
    locationType: mapAssetLocationType(walletLocation.locationType),
    exchangeName: walletLocation.exchangeName || undefined,
    accountType: walletLocation.accountType || undefined,
    storageType: walletLocation.storageType || undefined,
    storageName: walletLocation.storageName || undefined,
    userId: walletLocation.userId,
  };
}

/**
 * Maps a Prisma Order to a domain Order model
 */
export function mapOrderToDomain(order: PrismaOrder): Order {
  return {
    id: order.id,
    positionId: order.positionDetailsId as any, // Note: domain model expects positionId, but Prisma uses positionDetailsId
    dateOpen: order.dateOpen,
    averagePrice: order.averagePrice || undefined,
    totalCost: order.totalCost || undefined,
    status: mapOrderStatus(order.status),
    type: mapOrderType(order.type),
    purpose: order.purpose as any, // TODO: Create proper purpose enum mapping
    fee: order.fee || undefined,
    feeUnit: order.feeUnit || undefined,
    filled: order.filled || undefined,
    unit: (order.unit as any) || undefined,
    trigger: undefined, // Not in the Prisma model but in domain model
    estimatedCost: undefined, // Not in the Prisma model but in domain model
    exchangeOrderId: order.exchangeOrderId || undefined,
    isAutomated: order.isAutomated,
    isHidden: order.isHidden,
    parentOrderId: order.parentOrderId || undefined,
    notes: order.notes || undefined,
  };
}

/**
 * Maps a Prisma StopLossOrder to a domain StopLossOrder model
 */
export function mapStopLossOrderToDomain(
  order: PrismaStopLossOrder
): StopLossOrder {
  return {
    id: order.id,
    positionId: order.positionDetailsId as any, // Note: domain model expects positionId, but Prisma uses positionDetailsId
    dateOpen: order.dateOpen,
    averagePrice: order.averagePrice || undefined,
    totalCost: order.totalCost || undefined,
    status: order.status as any, // TODO: Create proper status enum mapping
    type: order.type as any, // TODO: Create proper type enum mapping
    purpose: OrderPurpose.STOP_LOSS,
    fee: order.fee || undefined,
    feeUnit: order.feeUnit || undefined,
    filled: order.filled || undefined,
    trigger: order.trigger || undefined,
    estimatedCost: order.estimatedCost || undefined,
    unit: order.unit as any, // TODO: Create proper unit enum mapping
    size: order.size,
    isTrailing: order.isTrailing,
    trailingDistance: order.trailingDistance || undefined,
    trailingUnit: (order.trailingUnit as any) || undefined,
    maxSlippage: order.maxSlippage || undefined,
    strategy: (order.strategy as any) || undefined,
  };
}

/**
 * Maps a Prisma TakeProfitOrder to a domain TakeProfitOrder model
 */
export function mapTakeProfitOrderToDomain(
  order: PrismaTakeProfitOrder
): TakeProfitOrder {
  return {
    id: order.id,
    positionId: order.positionDetailsId as any, // Note: domain model expects positionId, but Prisma uses positionDetailsId
    dateOpen: order.dateOpen,
    averagePrice: order.averagePrice || undefined,
    totalCost: order.totalCost || undefined,
    status: order.status as any, // TODO: Create proper status enum mapping
    type: order.type as any, // TODO: Create proper type enum mapping
    purpose: OrderPurpose.TAKE_PROFIT,
    fee: order.fee || undefined,
    feeUnit: order.feeUnit || undefined,
    filled: order.filled || undefined,
    trigger: order.trigger || undefined,
    estimatedCost: order.estimatedCost || undefined,
    unit: order.unit as any, // TODO: Create proper unit enum mapping
    size: order.size,
    targetPercentage: order.targetPercentage || undefined,
    maxSlippage: order.maxSlippage || undefined,
    tier: order.tier || undefined,
    moveStopToBreakeven: order.moveStopToBreakeven,
  };
}

/**
 * Maps a Prisma PositionDetails to a domain PositionDetails model
 */
export function mapPositionDetailsToDomain(
  details: PrismaPositionDetails & {
    orders?: PrismaOrder[];
    stopLossOrders?: PrismaStopLossOrder[];
    takeProfitOrders?: PrismaTakeProfitOrder[];
  }
): PositionDetails {
  return {
    status: mapPositionStatus(details.status),
    side: mapTradeSide(details.side),
    timeFrame: stringToTimeFrame(details.timeFrame),
    dateOpened: details.dateOpened,
    dateClosed: undefined, // Not in the Prisma model but in domain model
    orders: details.orders ? details.orders.map(mapOrderToDomain) : [],
    stopLoss: details.stopLossOrders
      ? details.stopLossOrders.map(mapStopLossOrderToDomain)
      : undefined,
    takeProfit: details.takeProfitOrders
      ? details.takeProfitOrders.map(mapTakeProfitOrderToDomain)
      : undefined,
    averageEntryPrice: details.averageEntryPrice || undefined,
    averageExitPrice: details.averageExitPrice || undefined,
    totalSize: details.totalSize || undefined,
    totalCost: details.totalCost || undefined,
    realizedProfitLoss: details.realizedProfitLoss || undefined,
    isLeveraged: details.isLeveraged,
    leverage: details.leverage || undefined,
    unrealizedProfitLoss: details.unrealizedProfitLoss || undefined,
    currentReturn: details.currentReturn || undefined,
    targetPrice: details.targetPrice || undefined,
    stopPrice: details.stopPrice || undefined,
    riskRewardRatio: details.riskRewardRatio || undefined,
  };
}

/**
 * Maps a Prisma Thesis to a domain Thesis model
 */
export function mapThesisToDomain(thesis: PrismaThesis): Thesis {
  return {
    reasoning: thesis.reasoning,
    invalidation: thesis.invalidation || undefined,
    fulfillment: thesis.fulfillment || undefined,
    notes: thesis.notes || undefined,
    technicalAnalysis: thesis.technicalAnalysis || undefined,
    fundamentalAnalysis: thesis.fundamentalAnalysis || undefined,
    timeHorizon: thesis.timeHorizon || undefined,
    riskRewardRatio: thesis.riskRewardRatio || undefined,
  };
}

/**
 * Maps a Prisma JournalEntry to a domain JournalEntry model
 */
export function mapJournalEntryToDomain(
  entry: PrismaJournalEntry
): JournalEntry {
  return {
    id: entry.id,
    positionId: entry.positionId,
    thought: entry.thought,
    attachments: entry.attachments || undefined,
    timestamp: dateToDateOrGenesis(entry.timestamp),
    userId: entry.userId,
    tags: entry.tags || undefined,
    sentiment: (entry.sentiment as any) || undefined,
    isKeyLearning: entry.isKeyLearning,
  };
}

/**
 * Maps a Prisma Position to a domain Position model
 * This is a complete mapping including all nested objects
 */
export function mapPositionToDomain(
  position: PrismaPosition & {
    market?: PrismaMarket & {
      baseAsset?: PrismaAsset;
      quoteAsset?: PrismaAsset;
    };
    walletLocation?: PrismaWalletLocation;
    positionDetails?: PrismaPositionDetails & {
      orders?: PrismaOrder[];
      stopLossOrders?: PrismaStopLossOrder[];
      takeProfitOrders?: PrismaTakeProfitOrder[];
    };
    thesis?: PrismaThesis;
    journalEntries?: PrismaJournalEntry[];
    portfolioPositions?: any[];
  }
): Position {
  return {
    id: position.id,
    name: position.name,

    // Use portfolioId instead of portfolio property
    portfolioId: position.portfolioPositions?.[0]?.portfolioId || "",

    // Standard properties from Position interface
    walletType: stringToWalletType(position.walletType),
    lifecycle: stringToPositionLifecycle(position.lifecycle),
    capitalTier: stringToCapitalTier(position.capitalTier),
    riskLevel: position.riskLevel,
    strategy: position.strategy,

    // Related entities
    asset: position.market?.baseAsset
      ? mapAssetToDomain(position.market.baseAsset)
      : ({} as Asset), // Required property in Position

    positionDetails: position.positionDetails
      ? mapPositionDetailsToDomain(position.positionDetails)
      : ({} as PositionDetails), // Required property in Position

    thesis: position.thesis ? mapThesisToDomain(position.thesis) : undefined,

    // Fix: Use 'journal' instead of 'journalEntries'
    journal: position.journalEntries
      ? position.journalEntries.map(mapJournalEntryToDomain)
      : undefined,

    // Required metadata
    userId: "", // User ID not directly available in Prisma model
    dateCreated: position.createdAt,
    dateUpdated: position.updatedAt,

    // Optional metadata with defaults
    currentValue: 0,
    isHidden: false,
    alertsEnabled: false,
    tags: [],

    // Pre-tracking status
    preTrackingStatus: {
      isPreTracking: false,
      dateOpened: null,
    },
  };
}

/**
 * Maps a Prisma Portfolio to a domain Portfolio model
 */
export function mapPortfolioToDomain(
  portfolio: PrismaPortfolio & {
    portfolioPositions?: any[];
    valuations?: any[];
  }
): Portfolio {
  return {
    id: portfolio.id,
    name: portfolio.name,
    description: portfolio.description || undefined,
    dateCreated: dateToDateOrGenesis(portfolio.dateCreated),
    status: portfolio.status as any, // Cast to handle type discrepancy
    userId: portfolio.userId,
    positionIds: portfolio.portfolioPositions
      ? portfolio.portfolioPositions.map(pp => (pp as any).positionId)
      : [], // Map to position IDs with safer type handling
    tags: portfolio.tags || [],
    notes: portfolio.notes || undefined,
    baseCurrency: "USD", // Default, not in Prisma model
    displayMetadata: {
      color: portfolio.color || undefined,
      sortOrder: portfolio.sortOrder || undefined,
      isPinned: portfolio.isPinned || undefined,
    },
  };
}
