/**
 * Position repository implementation
 */

import { PrismaClient, Position as PrismaPosition } from "@prisma/client";
import { Position, DateOrGenesis } from "@numisma/types";
import { positionSchema } from "../schema/position";
import {
  dateOrGenesisToDate,
  databaseDateToDateOrGenesis,
  handleDatabaseError,
} from "../utils";

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
  ): Promise<Position | null> {
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

      return position ? this.mapToDomainModel(position) : null;
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Find positions by portfolio ID
   */
  async findByPortfolioId(portfolioId: string): Promise<Position[]> {
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

      return portfolioPositions.map(pp => this.mapToDomainModel(pp.position));
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Find positions by lifecycle status
   */
  async findByLifecycle(
    lifecycle: string,
    userId: string
  ): Promise<Position[]> {
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

      return positions.map(this.mapToDomainModel);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Create a new position
   */
  async create(position: Omit<Position, "id">): Promise<Position> {
    // Validate with Zod schema
    positionSchema.omit({ id: true }).parse(position);

    try {
      // Create position details first
      const positionDetails = await this.prisma.positionDetails.create({
        data: {
          side: position.positionDetails.side,
          fractal: position.positionDetails.fractal,
          initialInvestment: position.positionDetails.initialInvestment,
          currentInvestment: position.positionDetails.currentInvestment,
          recoveredAmount: position.positionDetails.recoveredAmount || 0,
          dateOpened: dateOrGenesisToDate(position.positionDetails.dateOpened),
          closedPercentage: position.positionDetails.closedPercentage || 0,
        },
      });

      // Create the position
      const createdPosition = await this.prisma.position.create({
        data: {
          name: position.name,
          marketId: position.marketId,
          walletLocationId: position.walletLocationId,
          walletType: position.walletType,
          lifecycle: position.lifecycle,
          capitalTier: position.capitalTier,
          riskLevel: position.riskLevel,
          strategy: position.strategy,
          positionDetailsId: positionDetails.id,
          // Create lifecycle history entry
          lifecycleHistory: {
            create: {
              from: "new", // Assuming default starting state
              to: position.lifecycle,
              timestamp: new Date(),
              userId: position.userId || "system",
              notes: "Initial position creation",
            },
          },
          // Create capital tier history entry
          capitalTierHistory: {
            create: {
              from: position.capitalTier, // Same as initial value since it's new
              to: position.capitalTier,
              timestamp: new Date(),
              amountSecured: position.positionDetails.initialInvestment,
              notes: "Initial capital allocation",
            },
          },
          // Create initial thesis if provided
          thesis: position.thesis
            ? {
                create: {
                  reasoning: position.thesis.reasoning,
                  invalidation: position.thesis.invalidation,
                  fulfillment: position.thesis.fulfillment,
                  notes: position.thesis.notes,
                },
              }
            : undefined,
          // Create initial metrics
          metrics: {
            create: {
              realizedPnL: 0,
              unrealizedPnL: 0,
              roi: 0,
              maxDrawdown: 0,
              duration: "0d",
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
          thesis: true,
        },
      });

      // Create initial orders if provided
      if (
        position.positionDetails.orders &&
        position.positionDetails.orders.length > 0
      ) {
        for (const order of position.positionDetails.orders) {
          await this.prisma.order.create({
            data: {
              positionDetailsId: positionDetails.id,
              dateOpen: dateOrGenesisToDate(order.dateOpen),
              dateFilled: dateOrGenesisToDate(order.dateFilled),
              averagePrice: order.averagePrice,
              totalCost: order.totalCost,
              status: order.status,
              type: order.type,
              purpose: order.purpose,
              fee: order.fee,
              feeUnit: order.feeUnit,
              filled: order.filled,
              unit: order.unit,
              capitalTierImpact: order.capitalTierImpact,
              notes: order.notes,
            },
          });
        }
      }

      return this.mapToDomainModel(createdPosition);
    } catch (error) {
      throw handleDatabaseError(error);
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

      return this.mapToDomainModel(updatedPosition);
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

  /**
   * Map a Prisma position to the domain model
   */
  private mapToDomainModel(
    position: PrismaPosition & {
      market?: any;
      walletLocation?: any;
      positionDetails?: any;
      metrics?: any;
      thesis?: any;
      journalEntries?: any[];
      lifecycleHistory?: any[];
      capitalTierHistory?: any[];
    }
  ): Position {
    // Map market data if included
    const market = position.market
      ? {
          id: position.market.id,
          baseAsset: {
            id: position.market.baseAsset.id,
            name: position.market.baseAsset.name,
            ticker: position.market.baseAsset.ticker,
            assetType: position.market.baseAsset.assetType,
            description: position.market.baseAsset.description || undefined,
          },
          quoteAsset: {
            id: position.market.quoteAsset.id,
            name: position.market.quoteAsset.name,
            ticker: position.market.quoteAsset.ticker,
            assetType: position.market.quoteAsset.assetType,
            description: position.market.quoteAsset.description || undefined,
          },
          marketSymbol: position.market.marketSymbol,
          pairNotation: position.market.pairNotation,
          exchange: position.market.exchange || undefined,
          isTradable: position.market.isTradable,
        }
      : undefined;

    // Map wallet location data if included
    const walletLocation = position.walletLocation
      ? {
          id: position.walletLocation.id,
          name: position.walletLocation.name,
          locationType: position.walletLocation.locationType,
          exchangeName: position.walletLocation.exchangeName || undefined,
          accountType: position.walletLocation.accountType || undefined,
          storageType: position.walletLocation.storageType || undefined,
          storageName: position.walletLocation.storageName || undefined,
          userId: position.walletLocation.userId,
        }
      : undefined;

    // Map position details
    const positionDetails = position.positionDetails
      ? {
          id: position.positionDetails.id,
          side: position.positionDetails.side,
          fractal: position.positionDetails.fractal,
          initialInvestment: position.positionDetails.initialInvestment,
          currentInvestment: position.positionDetails.currentInvestment,
          recoveredAmount: position.positionDetails.recoveredAmount,
          dateOpened: databaseDateToDateOrGenesis(
            position.positionDetails.dateOpened
          ),
          closedPercentage: position.positionDetails.closedPercentage,
          // Map orders if included
          orders: position.positionDetails.orders
            ? position.positionDetails.orders.map((order: any) => ({
                id: order.id,
                dateOpen: databaseDateToDateOrGenesis(order.dateOpen),
                dateFilled: databaseDateToDateOrGenesis(order.dateFilled),
                averagePrice: order.averagePrice,
                totalCost: order.totalCost,
                status: order.status,
                type: order.type,
                purpose: order.purpose,
                fee: order.fee,
                feeUnit: order.feeUnit,
                filled: order.filled,
                unit: order.unit,
                capitalTierImpact: order.capitalTierImpact,
                notes: order.notes,
              }))
            : undefined,
          stopLoss: position.positionDetails.stopLossOrders
            ? position.positionDetails.stopLossOrders.map((order: any) => ({
                id: order.id,
                dateOpen: databaseDateToDateOrGenesis(order.dateOpen),
                dateFilled: databaseDateToDateOrGenesis(order.dateFilled),
                averagePrice: order.averagePrice,
                totalCost: order.totalCost,
                status: order.status,
                type: order.type,
                fee: order.fee,
                feeUnit: order.feeUnit,
                filled: order.filled,
                trigger: order.trigger,
                estimatedCost: order.estimatedCost,
                unit: order.unit,
                size: order.size,
              }))
            : undefined,
          takeProfit: position.positionDetails.takeProfitOrders
            ? position.positionDetails.takeProfitOrders.map((order: any) => ({
                id: order.id,
                dateOpen: databaseDateToDateOrGenesis(order.dateOpen),
                dateFilled: databaseDateToDateOrGenesis(order.dateFilled),
                averagePrice: order.averagePrice,
                totalCost: order.totalCost,
                status: order.status,
                type: order.type,
                fee: order.fee,
                feeUnit: order.feeUnit,
                filled: order.filled,
                trigger: order.trigger,
                estimatedCost: order.estimatedCost,
                unit: order.unit,
                size: order.size,
              }))
            : undefined,
        }
      : undefined;

    // Map metrics if included
    const metrics = position.metrics
      ? {
          id: position.metrics.id,
          realizedPnL: position.metrics.realizedPnL,
          unrealizedPnL: position.metrics.unrealizedPnL,
          roi: position.metrics.roi,
          maxDrawdown: position.metrics.maxDrawdown,
          duration: position.metrics.duration,
        }
      : undefined;

    // Map thesis if included
    const thesis = position.thesis
      ? {
          id: position.thesis.id,
          reasoning: position.thesis.reasoning,
          invalidation: position.thesis.invalidation || undefined,
          fulfillment: position.thesis.fulfillment || undefined,
          notes: position.thesis.notes || undefined,
        }
      : undefined;

    // Map journal entries if included
    const journalEntries = position.journalEntries
      ? position.journalEntries.map((entry: any) => ({
          id: entry.id,
          thought: entry.thought,
          attachments: entry.attachments,
          timestamp: entry.timestamp,
          userId: entry.userId,
        }))
      : undefined;

    // Map lifecycle history if included
    const lifecycleHistory = position.lifecycleHistory
      ? position.lifecycleHistory.map((history: any) => ({
          id: history.id,
          from: history.from,
          to: history.to,
          timestamp: history.timestamp,
          userId: history.userId,
          notes: history.notes || undefined,
          relatedOrderIds: history.relatedOrderIds,
        }))
      : undefined;

    // Map capital tier history if included
    const capitalTierHistory = position.capitalTierHistory
      ? position.capitalTierHistory.map((history: any) => ({
          id: history.id,
          from: history.from,
          to: history.to,
          timestamp: history.timestamp,
          amountSecured: history.amountSecured,
          relatedOrderId: history.relatedOrderId || undefined,
          notes: history.notes || undefined,
        }))
      : undefined;

    return {
      id: position.id,
      name: position.name,
      marketId: position.marketId,
      market,
      walletLocationId: position.walletLocationId,
      walletLocation,
      walletType: position.walletType,
      lifecycle: position.lifecycle,
      capitalTier: position.capitalTier,
      riskLevel: position.riskLevel,
      strategy: position.strategy,
      positionDetails,
      metrics,
      journalEntries,
      lifecycleHistory,
      capitalTierHistory,
      portfolio: position.portfolioPositions?.[0]?.portfolioId || "",
      thesis: position.thesis
        ? {
            reasoning: position.thesis.reasoning,
            invalidation: position.thesis.invalidation || undefined,
            fulfillment: position.thesis.fulfillment || undefined,
            notes: position.thesis.notes || undefined,
            technicalAnalysis: position.thesis.technicalAnalysis || undefined,
            fundamentalAnalysis:
              position.thesis.fundamentalAnalysis || undefined,
            timeHorizon: position.thesis.timeHorizon || undefined,
            riskRewardRatio: position.thesis.riskRewardRatio || undefined,
          }
        : undefined,
      tags: position.tags || [],
      userId: position.userId,
      dateCreated: position.createdAt,
      dateUpdated: position.updatedAt,
      currentValue: position.metrics?.currentValue,
      isHidden: position.isHidden || false,
      alertsEnabled: position.alertsEnabled || false,
    };
  }
}
