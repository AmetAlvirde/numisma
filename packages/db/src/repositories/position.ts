/**
 * Position repository implementation
 *
 * TODO: Refactor this repository to use type mappers from entity-mappers.ts
 * The refactoring process should follow these steps:
 *
 * 1. Analyze and update the entity-mappers.ts file to handle all Position-related
 *    entities correctly (with proper type safety)
 * 2. Fix any TODOs in the mapper files related to Position entities
 * 3. Create the proper typed mapPositionToPrisma function for create/update operations
 * 4. Gradually replace direct mappings with the type-safe mappers
 * 5. Test each method individually to ensure type safety and data consistency
 *
 * Example migration pattern:
 *
 * // Step 1: Import the mappers
 * import { mapPositionToDomain, mapPositionToPrisma } from "../utils/entity-mappers";
 *
 * // Step 2: Replace the mapToDomainModel method with the imported mapper
 * // Old: return this.mapToDomainModel(position);
 * // New: return mapPositionToDomain(position);
 *
 * // Step 3: Update create/update methods to use the to-prisma mappers
 * // Old: directly using position properties for Prisma data
 * // New: const prismaData = mapPositionToPrisma(position);
 */

import {
  PrismaClient,
  Position as PrismaPosition,
  Prisma,
} from "@prisma/client";
import {
  Position,
  DateOrGenesis,
  OperationResult,
  PaginatedResult,
  PositionStatus,
  TradeSide,
  TimeFrame,
} from "@numisma/types";
import { positionSchema } from "../schema/position";
import {
  dateOrGenesisToDate,
  databaseDateToDateOrGenesis,
  handleDatabaseError,
} from "../utils";
import { mapPositionToDomain } from "../utils/entity-mappers";
import {
  mapToPrismaPositionStatus,
  mapToPrismaTradeSide,
} from "../utils/type-mappers";

/**
 * Type for Prisma Position entities with all related data.
 * This allows proper handling of null vs undefined across mappers.
 */
type PrismaPositionWithRelations = PrismaPosition & {
  market?: {
    baseAsset?: any;
    quoteAsset?: any;
  } & any;
  walletLocation?: any;
  positionDetails?: {
    orders?: any[];
    stopLossOrders?: any[];
    takeProfitOrders?: any[];
  } & any;
  thesis?: any;
  journalEntries?: any[];
  lifecycleHistory?: any[];
  capitalTierHistory?: any[];
  portfolioPositions?: any[];
};

export class PositionRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find a position by its ID with optional related data
   */
  async findById(
    id: string,
    options?: {
      includeMarket?: boolean;
      includeWallet?: boolean;
      includeOrders?: boolean;
      includeMetrics?: boolean;
      includeThesis?: boolean;
      includeJournal?: boolean;
    }
  ): Promise<OperationResult<Position>> {
    try {
      const position = await this.prisma.position.findUnique({
        where: { id },
        include: {
          market: options?.includeMarket
            ? {
                include: {
                  baseAsset: true,
                  quoteAsset: true,
                },
              }
            : false,
          walletLocation: options?.includeWallet,
          positionDetails: options?.includeOrders
            ? {
                include: {
                  orders: true,
                  stopLossOrders: true,
                  takeProfitOrders: true,
                },
              }
            : true,
          metrics: options?.includeMetrics,
          thesis: options?.includeThesis,
          journalEntries: options?.includeJournal
            ? {
                orderBy: {
                  timestamp: "desc",
                },
              }
            : false,
          lifecycleHistory: {
            orderBy: {
              timestamp: "desc",
            },
            take: 5,
          },
          capitalTierHistory: {
            orderBy: {
              timestamp: "desc",
            },
            take: 5,
          },
        },
      });

      if (!position) {
        return {
          success: false,
          error: `Position with ID ${id} not found`,
        };
      }

      return {
        success: true,
        data: mapPositionToDomain(position as PrismaPositionWithRelations),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Find positions by portfolio ID
   */
  async findByPortfolioId(
    portfolioId: string
  ): Promise<OperationResult<Position[]>> {
    try {
      const portfolioPositions = await this.prisma.portfolioPosition.findMany({
        where: {
          portfolioId,
          isHidden: false,
        },
        include: {
          position: {
            include: {
              market: {
                include: {
                  baseAsset: true,
                  quoteAsset: true,
                },
              },
              walletLocation: true,
              positionDetails: true,
              metrics: true,
            },
          },
        },
        orderBy: {
          displayOrder: "asc",
        },
      });

      return {
        success: true,
        data: portfolioPositions.map(pp =>
          mapPositionToDomain(pp.position as PrismaPositionWithRelations)
        ),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Find positions by lifecycle status
   */
  async findByLifecycle(
    lifecycle: string,
    userId: string
  ): Promise<OperationResult<Position[]>> {
    try {
      // First get all portfolios for this user
      const portfolios = await this.prisma.portfolio.findMany({
        where: { userId },
        select: { id: true },
      });

      const portfolioIds = portfolios.map(p => p.id);

      // Then get positions in these portfolios with the requested lifecycle
      const positions = await this.prisma.position.findMany({
        where: {
          lifecycle,
          portfolioPositions: {
            some: {
              portfolioId: { in: portfolioIds },
              isHidden: false,
            },
          },
        },
        include: {
          market: {
            include: {
              baseAsset: true,
              quoteAsset: true,
            },
          },
          walletLocation: true,
          positionDetails: true,
          metrics: true,
        },
      });

      return {
        success: true,
        data: positions.map(position =>
          mapPositionToDomain(position as PrismaPositionWithRelations)
        ),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Create a new position
   */
  async create(
    position: Omit<Position, "id">
  ): Promise<OperationResult<Position>> {
    try {
      // Validate with Zod schema
      const validationResult = positionSchema.safeParse(position);
      if (!validationResult.success) {
        return {
          success: false,
          error: "Invalid position data",
          metadata: { validationErrors: validationResult.error.errors },
        };
      }

      // Build Prisma data
      const data = {
        name: position.name,
        lifecycle: position.lifecycle,
        capitalTier: position.capitalTier,
        createdAt: new Date(), // Use createdAt instead of dateCreated
        updatedAt: new Date(), // Use updatedAt instead of dateModified
        riskLevel: position.riskLevel,
        strategy: position.strategy || "",
        walletType: position.walletType,
      } as Prisma.PositionCreateInput;

      // Handle Market relationship - check for marketId property or market object
      if ("marketId" in position && typeof position.marketId === "string") {
        data.market = { connect: { id: position.marketId } };
      } else if (
        "market" in position &&
        position.market &&
        typeof position.market === "object" &&
        "id" in position.market
      ) {
        data.market = { connect: { id: position.market.id as string } };
      }

      // Handle WalletLocation relationship - check for walletLocationId property or walletLocation object
      if (
        "walletLocationId" in position &&
        typeof position.walletLocationId === "string"
      ) {
        data.walletLocation = { connect: { id: position.walletLocationId } };
      } else if (
        "walletLocation" in position &&
        position.walletLocation &&
        typeof position.walletLocation === "object" &&
        "id" in position.walletLocation
      ) {
        data.walletLocation = {
          connect: { id: position.walletLocation.id as string },
        };
      }

      // Handle PositionDetails with nested create
      if (position.positionDetails) {
        const details = position.positionDetails;
        data.positionDetails = {
          create: {
            status: mapToPrismaPositionStatus(
              details.status || PositionStatus.ACTIVE
            ),
            side: mapToPrismaTradeSide(details.side || TradeSide.LONG),
            timeFrame: details.timeFrame || TimeFrame.ONE_DAY,

            // Required fields in Prisma schema
            fractal: "",
            initialInvestment: details.totalCost || 0,
            currentInvestment: details.totalCost || 0,

            // Handle dates with proper DateOrGenesis conversion
            ...(details.dateOpened
              ? {
                  dateOpened: dateOrGenesisToDate(details.dateOpened),
                }
              : {}),
            ...(details.dateClosed
              ? {
                  dateClosed: dateOrGenesisToDate(details.dateClosed),
                }
              : {}),

            // Handle numeric properties
            ...(details.averageEntryPrice !== undefined
              ? {
                  averageEntryPrice: details.averageEntryPrice,
                }
              : {}),
            ...(details.averageExitPrice !== undefined
              ? {
                  averageExitPrice: details.averageExitPrice,
                }
              : {}),
            ...(details.totalSize !== undefined
              ? {
                  totalSize: details.totalSize,
                }
              : {}),
            ...(details.totalCost !== undefined
              ? {
                  totalCost: details.totalCost,
                }
              : {}),
            ...(details.realizedProfitLoss !== undefined
              ? {
                  realizedProfitLoss: details.realizedProfitLoss,
                }
              : {}),
            ...(details.unrealizedProfitLoss !== undefined
              ? {
                  unrealizedProfitLoss: details.unrealizedProfitLoss,
                }
              : {}),
            ...(details.currentReturn !== undefined
              ? {
                  currentReturn: details.currentReturn,
                }
              : {}),
            ...(details.targetPrice !== undefined
              ? {
                  targetPrice: details.targetPrice,
                }
              : {}),
            ...(details.stopPrice !== undefined
              ? {
                  stopPrice: details.stopPrice,
                }
              : {}),
            ...(details.riskRewardRatio !== undefined
              ? {
                  riskRewardRatio: details.riskRewardRatio,
                }
              : {}),
            isLeveraged: details.isLeveraged || false,
            ...(details.leverage !== undefined
              ? {
                  leverage: details.leverage,
                }
              : {}),
          },
        };
      }

      // Handle thesis with nested create
      if (position.thesis) {
        const thesis = position.thesis;
        data.thesis = {
          create: {
            reasoning: thesis.reasoning,
            ...(thesis.invalidation !== undefined
              ? {
                  invalidation: thesis.invalidation,
                }
              : {}),
            ...(thesis.fulfillment !== undefined
              ? {
                  fulfillment: thesis.fulfillment,
                }
              : {}),
            ...(thesis.notes !== undefined
              ? {
                  notes: thesis.notes,
                }
              : {}),
            ...(thesis.technicalAnalysis !== undefined
              ? {
                  technicalAnalysis: thesis.technicalAnalysis,
                }
              : {}),
            ...(thesis.fundamentalAnalysis !== undefined
              ? {
                  fundamentalAnalysis: thesis.fundamentalAnalysis,
                }
              : {}),
            ...(thesis.timeHorizon !== undefined
              ? {
                  timeHorizon: thesis.timeHorizon,
                }
              : {}),
            ...(thesis.riskRewardRatio !== undefined
              ? {
                  riskRewardRatio: thesis.riskRewardRatio,
                }
              : {}),
          },
        };
      }

      // Create the position
      const createdPosition = await this.prisma.position.create({
        data,
        include: {
          market: {
            include: {
              baseAsset: true,
              quoteAsset: true,
            },
          },
          walletLocation: true,
          positionDetails: {
            include: {
              orders: true,
              stopLossOrders: true,
              takeProfitOrders: true,
            },
          },
          thesis: true,
        },
      });

      return {
        success: true,
        data: mapPositionToDomain(
          createdPosition as PrismaPositionWithRelations
        ),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Update an existing position
   */
  async update(
    id: string,
    data: Partial<Omit<Position, "id">> & {
      market?: { id: string };
      walletLocation?: { id: string };
    }
  ): Promise<OperationResult<Position>> {
    try {
      // First check if the position exists
      const existingPosition = await this.prisma.position.findUnique({
        where: { id },
        include: {
          market: true,
          walletLocation: true,
          positionDetails: {
            include: {
              orders: true,
              stopLossOrders: true,
              takeProfitOrders: true,
            },
          },
          thesis: true,
        },
      });

      if (!existingPosition) {
        return {
          success: false,
          error: `Position with ID ${id} not found`,
        };
      }

      // Use the mapper to prepare the update data
      // We need to be careful with updates to avoid overwriting related entities
      // For this reason, we handle market, wallet, orders, etc. separately
      let updateData: Prisma.PositionUpdateInput = {};

      // Update basic fields
      if (data.name !== undefined) updateData.name = data.name;
      if (data.lifecycle !== undefined) updateData.lifecycle = data.lifecycle;
      if (data.capitalTier !== undefined)
        updateData.capitalTier = data.capitalTier;
      if (data.walletType !== undefined)
        updateData.walletType = data.walletType;
      if (data.riskLevel !== undefined) updateData.riskLevel = data.riskLevel;
      if (data.strategy !== undefined) updateData.strategy = data.strategy;

      // Handle market relationship update
      if (
        data.market &&
        typeof data.market === "object" &&
        "id" in data.market
      ) {
        updateData.market = { connect: { id: data.market.id as string } };
      }

      // Handle wallet location relationship update
      if (
        data.walletLocation &&
        typeof data.walletLocation === "object" &&
        "id" in data.walletLocation
      ) {
        updateData.walletLocation = {
          connect: { id: data.walletLocation.id as string },
        };
      }

      // Handle position details update (if exists)
      if (data.positionDetails) {
        // If the position already has details, update them
        if (existingPosition.positionDetailsId) {
          updateData.positionDetails = {
            update: {
              // Update position details fields
              ...(data.positionDetails.status !== undefined && {
                status: mapToPrismaPositionStatus(data.positionDetails.status),
              }),
              ...(data.positionDetails.side !== undefined && {
                side: mapToPrismaTradeSide(data.positionDetails.side),
              }),
              ...(data.positionDetails.timeFrame !== undefined && {
                timeFrame: data.positionDetails.timeFrame,
              }),
              ...(data.positionDetails.dateOpened !== undefined && {
                dateOpened:
                  data.positionDetails.dateOpened !== null
                    ? dateOrGenesisToDate(data.positionDetails.dateOpened)
                    : null,
              }),
              ...(data.positionDetails.dateClosed !== undefined && {
                dateClosed:
                  data.positionDetails.dateClosed !== null
                    ? dateOrGenesisToDate(data.positionDetails.dateClosed)
                    : null,
              }),
              ...(data.positionDetails.averageEntryPrice !== undefined && {
                averageEntryPrice: data.positionDetails.averageEntryPrice,
              }),
              ...(data.positionDetails.averageExitPrice !== undefined && {
                averageExitPrice: data.positionDetails.averageExitPrice,
              }),
              ...(data.positionDetails.totalSize !== undefined && {
                totalSize: data.positionDetails.totalSize,
              }),
              ...(data.positionDetails.totalCost !== undefined && {
                totalCost: data.positionDetails.totalCost,
              }),
              ...(data.positionDetails.realizedProfitLoss !== undefined && {
                realizedProfitLoss: data.positionDetails.realizedProfitLoss,
              }),
              ...(data.positionDetails.unrealizedProfitLoss !== undefined && {
                unrealizedProfitLoss: data.positionDetails.unrealizedProfitLoss,
              }),
              ...(data.positionDetails.currentReturn !== undefined && {
                currentReturn: data.positionDetails.currentReturn,
              }),
              ...(data.positionDetails.targetPrice !== undefined && {
                targetPrice: data.positionDetails.targetPrice,
              }),
              ...(data.positionDetails.stopPrice !== undefined && {
                stopPrice: data.positionDetails.stopPrice,
              }),
              ...(data.positionDetails.riskRewardRatio !== undefined && {
                riskRewardRatio: data.positionDetails.riskRewardRatio,
              }),
              ...(data.positionDetails.isLeveraged !== undefined && {
                isLeveraged: data.positionDetails.isLeveraged,
              }),
              ...(data.positionDetails.leverage !== undefined && {
                leverage: data.positionDetails.leverage,
              }),
            },
          };
        }
        // If no position details exist yet, create them (unlikely)
        else {
          const positionDetails = data.positionDetails;
          updateData.positionDetails = {
            create: {
              status: mapToPrismaPositionStatus(
                positionDetails.status || PositionStatus.ACTIVE
              ),
              side: mapToPrismaTradeSide(
                positionDetails.side || TradeSide.LONG
              ),
              timeFrame: positionDetails.timeFrame || TimeFrame.ONE_DAY,

              // Required fields in Prisma schema
              fractal: "",
              initialInvestment: positionDetails.totalCost || 0,
              currentInvestment: positionDetails.totalCost || 0,

              ...(positionDetails.dateOpened && {
                dateOpened: dateOrGenesisToDate(positionDetails.dateOpened),
              }),
              ...(positionDetails.dateClosed && {
                dateClosed: dateOrGenesisToDate(positionDetails.dateClosed),
              }),
              ...(positionDetails.averageEntryPrice !== undefined && {
                averageEntryPrice: positionDetails.averageEntryPrice,
              }),
              ...(positionDetails.averageExitPrice !== undefined && {
                averageExitPrice: positionDetails.averageExitPrice,
              }),
              ...(positionDetails.totalSize !== undefined && {
                totalSize: positionDetails.totalSize,
              }),
              ...(positionDetails.totalCost !== undefined && {
                totalCost: positionDetails.totalCost,
              }),
              ...(positionDetails.realizedProfitLoss !== undefined && {
                realizedProfitLoss: positionDetails.realizedProfitLoss,
              }),
              ...(positionDetails.unrealizedProfitLoss !== undefined && {
                unrealizedProfitLoss: positionDetails.unrealizedProfitLoss,
              }),
              ...(positionDetails.currentReturn !== undefined && {
                currentReturn: positionDetails.currentReturn,
              }),
              ...(positionDetails.targetPrice !== undefined && {
                targetPrice: positionDetails.targetPrice,
              }),
              ...(positionDetails.stopPrice !== undefined && {
                stopPrice: positionDetails.stopPrice,
              }),
              ...(positionDetails.riskRewardRatio !== undefined && {
                riskRewardRatio: positionDetails.riskRewardRatio,
              }),
              ...(positionDetails.isLeveraged !== undefined && {
                isLeveraged: positionDetails.isLeveraged,
              }),
              ...(positionDetails.leverage !== undefined && {
                leverage: positionDetails.leverage,
              }),
            },
          };
        }
      }

      // Handle thesis update
      if (data.thesis) {
        // If the position already has a thesis, update it
        if (existingPosition.thesis) {
          updateData.thesis = {
            update: {
              ...(data.thesis.reasoning !== undefined && {
                reasoning: data.thesis.reasoning,
              }),
              ...(data.thesis.invalidation !== undefined && {
                invalidation: data.thesis.invalidation,
              }),
              ...(data.thesis.fulfillment !== undefined && {
                fulfillment: data.thesis.fulfillment,
              }),
              ...(data.thesis.notes !== undefined && {
                notes: data.thesis.notes,
              }),
              ...(data.thesis.technicalAnalysis !== undefined && {
                technicalAnalysis: data.thesis.technicalAnalysis,
              }),
              ...(data.thesis.fundamentalAnalysis !== undefined && {
                fundamentalAnalysis: data.thesis.fundamentalAnalysis,
              }),
              ...(data.thesis.timeHorizon !== undefined && {
                timeHorizon: data.thesis.timeHorizon,
              }),
              ...(data.thesis.riskRewardRatio !== undefined && {
                riskRewardRatio: data.thesis.riskRewardRatio,
              }),
            },
          };
        }
        // If no thesis exists yet, create it
        else {
          updateData.thesis = {
            create: {
              reasoning: data.thesis.reasoning,
              ...(data.thesis.invalidation !== undefined && {
                invalidation: data.thesis.invalidation,
              }),
              ...(data.thesis.fulfillment !== undefined && {
                fulfillment: data.thesis.fulfillment,
              }),
              ...(data.thesis.notes !== undefined && {
                notes: data.thesis.notes,
              }),
              ...(data.thesis.technicalAnalysis !== undefined && {
                technicalAnalysis: data.thesis.technicalAnalysis,
              }),
              ...(data.thesis.fundamentalAnalysis !== undefined && {
                fundamentalAnalysis: data.thesis.fundamentalAnalysis,
              }),
              ...(data.thesis.timeHorizon !== undefined && {
                timeHorizon: data.thesis.timeHorizon,
              }),
              ...(data.thesis.riskRewardRatio !== undefined && {
                riskRewardRatio: data.thesis.riskRewardRatio,
              }),
            },
          };
        }
      }

      // Note: Orders, stopLoss, and takeProfit updates would be handled separately using
      // dedicated order repository methods, as they might require creating, updating, or deleting
      // individual orders rather than replacing the entire collection

      // Perform the update
      const updatedPosition = await this.prisma.position.update({
        where: { id },
        data: updateData,
        include: {
          market: {
            include: {
              baseAsset: true,
              quoteAsset: true,
            },
          },
          walletLocation: true,
          positionDetails: {
            include: {
              orders: true,
              stopLossOrders: true,
              takeProfitOrders: true,
            },
          },
          thesis: true,
        },
      });

      return {
        success: true,
        data: mapPositionToDomain(
          updatedPosition as PrismaPositionWithRelations
        ),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Add a journal entry to a position
   */
  async addJournalEntry(
    positionId: string,
    entry: {
      thought: string;
      attachments?: string[];
      userId: string;
    }
  ): Promise<void> {
    try {
      await this.prisma.journalEntry.create({
        data: {
          positionId,
          thought: entry.thought,
          attachments: entry.attachments || [],
          timestamp: new Date(),
          userId: entry.userId,
        },
      });
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Update position metrics
   */
  async updateMetrics(
    positionId: string,
    metrics: {
      realizedPnL: number;
      unrealizedPnL: number;
      roi: number;
      maxDrawdown: number;
      duration: string;
    }
  ): Promise<void> {
    try {
      await this.prisma.positionMetrics.upsert({
        where: { positionId },
        update: metrics,
        create: {
          positionId,
          ...metrics,
        },
      });
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }
}
