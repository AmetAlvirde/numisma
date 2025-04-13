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
} from "@numisma/types";
import { positionSchema } from "../schema/position";
import {
  dateOrGenesisToDate,
  databaseDateToDateOrGenesis,
  handleDatabaseError,
} from "../utils";
import { mapPositionToDomain } from "../utils/entity-mappers";

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
        data: mapPositionToDomain(position),
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
        data: portfolioPositions.map(pp => mapPositionToDomain(pp.position)),
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
        data: positions.map(position => mapPositionToDomain(position)),
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
      const data: Prisma.PositionCreateInput = {
        name: position.name,
        lifecycle: position.lifecycle,
        capitalTier: position.capitalTier,
        dateCreated: dateOrGenesisToDate(position.dateCreated) ?? new Date(),
        dateModified: new Date(),
        tags: position.tags || [],
        isHidden: position.isHidden || false,
        comment: position.comment,
      };

      // Add relationships
      if ("marketId" in position && position.marketId) {
        data.market = { connect: { id: position.marketId } };
      }

      if ("walletLocationId" in position && position.walletLocationId) {
        data.walletLocation = { connect: { id: position.walletLocationId } };
      }

      // Add position details if provided
      if ("positionDetails" in position && position.positionDetails) {
        data.positionDetails = {
          create: {
            targetSize: position.positionDetails.targetSize,
            currentSize: position.positionDetails.currentSize,
            targetEntry: position.positionDetails.targetEntry,
            targetExit: position.positionDetails.targetExit,
            targetProfit: position.positionDetails.targetProfit,
            maxLoss: position.positionDetails.maxLoss,
            riskRewardRatio: position.positionDetails.riskRewardRatio,
            expectedReturn: position.positionDetails.expectedReturn,
          },
        };
      }

      // Add thesis if provided
      if ("thesis" in position && position.thesis) {
        data.thesis = {
          create: {
            summary: position.thesis.summary,
            analysis: position.thesis.analysis,
            keyPoints: position.thesis.keyPoints || [],
            timeframeReason: position.thesis.timeframeReason,
            entryReason: position.thesis.entryReason,
            exitReason: position.thesis.exitReason,
            supportingLinks: position.thesis.supportingLinks || [],
            dateCreated:
              dateOrGenesisToDate(position.thesis.dateCreated) ?? new Date(),
          },
        };
      }

      // Create position
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
          positionDetails: true,
        },
      });

      return {
        success: true,
        data: mapPositionToDomain(createdPosition),
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
    data: Partial<Omit<Position, "id">>
  ): Promise<Position> {
    // Validate with Zod schema
    positionSchema.partial().omit({ id: true }).parse(data);

    try {
      // First get the current position to compare changes
      const currentPosition = await this.prisma.position.findUnique({
        where: { id },
        include: {
          positionDetails: true,
        },
      });

      if (!currentPosition) {
        throw new Error(`Position with ID ${id} not found`);
      }

      // Handle lifecycle change if needed
      if (data.lifecycle && data.lifecycle !== currentPosition.lifecycle) {
        await this.prisma.lifecycleHistory.create({
          data: {
            positionId: id,
            from: currentPosition.lifecycle,
            to: data.lifecycle,
            timestamp: new Date(),
            userId: data.userId || "system",
            notes:
              data.lifecycleNotes ||
              `Updated lifecycle from ${currentPosition.lifecycle} to ${data.lifecycle}`,
          },
        });
      }

      // Handle capital tier change if needed
      if (
        data.capitalTier &&
        data.capitalTier !== currentPosition.capitalTier
      ) {
        await this.prisma.capitalTierHistory.create({
          data: {
            positionId: id,
            from: currentPosition.capitalTier,
            to: data.capitalTier,
            timestamp: new Date(),
            amountSecured: data.capitalTierAmount || 0,
            notes:
              data.capitalTierNotes ||
              `Updated capital tier from ${currentPosition.capitalTier} to ${data.capitalTier}`,
          },
        });
      }

      // Update position details if provided
      if (data.positionDetails) {
        await this.prisma.positionDetails.update({
          where: { id: currentPosition.positionDetailsId },
          data: {
            side: data.positionDetails.side,
            fractal: data.positionDetails.fractal,
            initialInvestment: data.positionDetails.initialInvestment,
            currentInvestment: data.positionDetails.currentInvestment,
            recoveredAmount: data.positionDetails.recoveredAmount,
            dateOpened: data.positionDetails.dateOpened
              ? dateOrGenesisToDate(data.positionDetails.dateOpened)
              : undefined,
            closedPercentage: data.positionDetails.closedPercentage,
          },
        });
      }

      // Update thesis if provided
      if (data.thesis) {
        // Check if thesis exists
        const thesis = await this.prisma.thesis.findUnique({
          where: { positionId: id },
        });

        if (thesis) {
          await this.prisma.thesis.update({
            where: { positionId: id },
            data: {
              reasoning: data.thesis.reasoning,
              invalidation: data.thesis.invalidation,
              fulfillment: data.thesis.fulfillment,
              notes: data.thesis.notes,
            },
          });
        } else {
          await this.prisma.thesis.create({
            data: {
              positionId: id,
              reasoning: data.thesis.reasoning,
              invalidation: data.thesis.invalidation,
              fulfillment: data.thesis.fulfillment,
              notes: data.thesis.notes,
            },
          });
        }
      }

      // Update the position itself
      const updatedPosition = await this.prisma.position.update({
        where: { id },
        data: {
          name: data.name,
          marketId: data.marketId,
          walletLocationId: data.walletLocationId,
          walletType: data.walletType,
          lifecycle: data.lifecycle,
          capitalTier: data.capitalTier,
          riskLevel: data.riskLevel,
          strategy: data.strategy,
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
          thesis: true,
        },
      });

      return mapPositionToDomain(updatedPosition);
    } catch (error) {
      throw handleDatabaseError(error);
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
