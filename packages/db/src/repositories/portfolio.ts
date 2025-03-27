/**
 * Portfolio repository implementation
 */

import { PrismaClient, Portfolio as PrismaPortfolio } from '@prisma/client';
import { Portfolio, DateOrGenesis } from '@numisma/types';
import { portfolioSchema } from '../schema/portfolio';
import { dateOrGenesisToDate, databaseDateToDateOrGenesis, handleDatabaseError } from '../utils';

export class PortfolioRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find a portfolio by its ID with optional related data
   */
  async findById(id: string, options?: { 
    includePositions?: boolean 
  }): Promise<Portfolio | null> {
    try {
      const portfolio = await this.prisma.portfolio.findUnique({
        where: { id },
        include: {
          portfolioPositions: options?.includePositions ? {
            include: {
              position: true
            }
          } : false,
          valuations: {
            orderBy: {
              timestamp: 'desc'
            },
            take: 1
          }
        }
      });
      
      return portfolio ? this.mapToDomainModel(portfolio) : null;
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Find portfolios by user ID
   */
  async findByUserId(userId: string): Promise<Portfolio[]> {
    try {
      const portfolios = await this.prisma.portfolio.findMany({
        where: { userId },
        include: {
          portfolioPositions: true,
          valuations: {
            orderBy: {
              timestamp: 'desc'
            },
            take: 1
          }
        }
      });
      
      return portfolios.map(portfolio => this.mapToDomainModel(portfolio));
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Create a new portfolio
   */
  async create(portfolio: Omit<Portfolio, 'id'>): Promise<Portfolio> {
    // Validate with Zod schema
    portfolioSchema.omit({ id: true }).parse(portfolio);
    
    try {
      const createdPortfolio = await this.prisma.portfolio.create({
        data: {
          name: portfolio.name,
          description: portfolio.description,
          dateCreated: dateOrGenesisToDate(portfolio.dateCreated) ?? new Date(),
          status: portfolio.status,
          userId: portfolio.userId,
          tags: portfolio.tags || [],
          notes: portfolio.notes,
          color: portfolio.color,
          sortOrder: portfolio.sortOrder,
          isPinned: portfolio.isPinned
        },
        include: {
          portfolioPositions: true
        }
      });
      
      return this.mapToDomainModel(createdPortfolio);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Update an existing portfolio
   */
  async update(id: string, data: Partial<Omit<Portfolio, 'id'>>): Promise<Portfolio> {
    // Validate with Zod schema
    portfolioSchema.partial().omit({ id: true }).parse(data);
    
    try {
      // Handle dateCreated if it exists
      let updatedData = { ...data };
      if (data.dateCreated) {
        updatedData.dateCreated = dateOrGenesisToDate(data.dateCreated);
      }
      
      const updatedPortfolio = await this.prisma.portfolio.update({
        where: { id },
        data: updatedData,
        include: {
          portfolioPositions: true
        }
      });
      
      return this.mapToDomainModel(updatedPortfolio);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Delete a portfolio
   */
  async delete(id: string): Promise<void> {
    try {
      await this.prisma.portfolio.delete({
        where: { id }
      });
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Add a position to a portfolio
   */
  async addPosition(portfolioId: string, positionId: string, userId: string, displayOrder?: number): Promise<void> {
    try {
      // Check if there's already an entry for this portfolio and position
      const existingEntry = await this.prisma.portfolioPosition.findUnique({
        where: {
          portfolioId_positionId: {
            portfolioId,
            positionId
          }
        }
      });

      if (existingEntry) {
        // Update existing entry if it exists but is hidden
        if (existingEntry.isHidden) {
          await this.prisma.portfolioPosition.update({
            where: {
              id: existingEntry.id
            },
            data: {
              isHidden: false,
              addedAt: new Date(),
              addedBy: userId
            }
          });
        }
        return;
      }

      // If no display order is provided, calculate the next available one
      let finalDisplayOrder = displayOrder;
      if (finalDisplayOrder === undefined) {
        const highestOrder = await this.prisma.portfolioPosition.findFirst({
          where: {
            portfolioId
          },
          orderBy: {
            displayOrder: 'desc'
          },
          select: {
            displayOrder: true
          }
        });

        finalDisplayOrder = highestOrder ? highestOrder.displayOrder + 1 : 1;
      }

      // Create a new entry
      await this.prisma.portfolioPosition.create({
        data: {
          portfolioId,
          positionId,
          addedAt: new Date(),
          addedBy: userId,
          isHidden: false,
          displayOrder: finalDisplayOrder
        }
      });
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Remove a position from a portfolio
   */
  async removePosition(portfolioId: string, positionId: string): Promise<void> {
    try {
      await this.prisma.portfolioPosition.updateMany({
        where: {
          portfolioId,
          positionId
        },
        data: {
          isHidden: true
        }
      });
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Update a position's display order within a portfolio
   */
  async updatePositionOrder(portfolioId: string, positionId: string, displayOrder: number): Promise<void> {
    try {
      await this.prisma.portfolioPosition.updateMany({
        where: {
          portfolioId,
          positionId
        },
        data: {
          displayOrder
        }
      });
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Map a Prisma portfolio to the domain model
   */
  private mapToDomainModel(portfolio: PrismaPortfolio & {
    portfolioPositions?: any[];
    valuations?: any[];
  }): Portfolio {
    // Extract position IDs from portfolioPositions
    const positionIds = portfolio.portfolioPositions 
      ? portfolio.portfolioPositions
          .filter(pp => !pp.isHidden)
          .map(pp => pp.positionId)
      : [];

    return {
      id: portfolio.id,
      name: portfolio.name,
      description: portfolio.description || undefined,
      dateCreated: databaseDateToDateOrGenesis(portfolio.dateCreated),
      status: portfolio.status as 'active' | 'archived',
      userId: portfolio.userId,
      positionIds: positionIds,
      tags: portfolio.tags as string[],
      notes: portfolio.notes || undefined,
      color: portfolio.color || undefined,
      sortOrder: portfolio.sortOrder || undefined,
      isPinned: portfolio.isPinned || false,
      // Include the latest valuation data if available
      latestValuation: portfolio.valuations && portfolio.valuations.length > 0
        ? {
            timestamp: portfolio.valuations[0].timestamp,
            totalValue: portfolio.valuations[0].totalValue,
            profitLoss: portfolio.valuations[0].profitLoss,
            percentageReturn: portfolio.valuations[0].percentageReturn
          }
        : undefined
    };
  }
}
