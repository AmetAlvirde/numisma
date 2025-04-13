/**
 * Portfolio repository implementation
 */

import { PrismaClient, Portfolio as PrismaPortfolio } from "@prisma/client";
import { Portfolio, DateOrGenesis, OperationResult } from "@numisma/types";
import { portfolioSchema } from "../schema/portfolio";
import { handleDatabaseError, dateOrGenesisToDate } from "../utils";
import { mapPortfolioToDomain } from "../utils/entity-mappers";

export class PortfolioRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find a portfolio by its ID with optional related data
   */
  async findById(
    id: string,
    options?: {
      includePositions?: boolean;
    }
  ): Promise<OperationResult<Portfolio>> {
    try {
      const portfolio = await this.prisma.portfolio.findUnique({
        where: { id },
        include: {
          portfolioPositions: options?.includePositions
            ? {
                include: {
                  position: true,
                },
              }
            : false,
          valuations: {
            orderBy: {
              timestamp: "desc",
            },
            take: 1,
          },
        },
      });

      if (!portfolio) {
        return {
          success: false,
          error: `Portfolio with ID ${id} not found`,
        };
      }

      return {
        success: true,
        data: mapPortfolioToDomain(portfolio),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Find portfolios by user ID
   */
  async findByUserId(userId: string): Promise<OperationResult<Portfolio[]>> {
    try {
      const portfolios = await this.prisma.portfolio.findMany({
        where: { userId },
        include: {
          portfolioPositions: true,
          valuations: {
            orderBy: {
              timestamp: "desc",
            },
            take: 1,
          },
        },
      });

      return {
        success: true,
        data: portfolios.map(portfolio => mapPortfolioToDomain(portfolio)),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Create a new portfolio
   */
  async create(
    portfolio: Omit<Portfolio, "id">
  ): Promise<OperationResult<Portfolio>> {
    try {
      // Validate with Zod schema
      const validationResult = portfolioSchema.safeParse(portfolio);
      if (!validationResult.success) {
        return {
          success: false,
          error: "Invalid portfolio data",
          metadata: { validationErrors: validationResult.error.errors },
        };
      }

      // Convert to Prisma model
      const data = {
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

      const createdPortfolio = await this.prisma.portfolio.create({
        data,
        include: {
          portfolioPositions: true,
        },
      });

      return {
        success: true,
        data: mapPortfolioToDomain(createdPortfolio),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Update an existing portfolio
   */
  async update(
    id: string,
    data: Partial<Omit<Portfolio, "id">>
  ): Promise<OperationResult<Portfolio>> {
    try {
      // Validate with Zod schema
      const validationResult = portfolioSchema.partial().safeParse(data);
      if (!validationResult.success) {
        return {
          success: false,
          error: "Invalid portfolio data",
          metadata: { validationErrors: validationResult.error.errors },
        };
      }

      // Create a partial update with only the fields that are provided
      const updateData: any = {};

      // Copy all provided fields except for dates that need special handling
      Object.entries(data).forEach(([key, value]) => {
        if (key !== "dateCreated") {
          updateData[key] = value;
        }
      });

      // Handle dateCreated if it exists
      if (data.dateCreated) {
        updateData.dateCreated = dateOrGenesisToDate(data.dateCreated);
      }

      const updatedPortfolio = await this.prisma.portfolio.update({
        where: { id },
        data: updateData,
        include: {
          portfolioPositions: true,
        },
      });

      return {
        success: true,
        data: mapPortfolioToDomain(updatedPortfolio),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Delete a portfolio
   */
  async delete(id: string): Promise<OperationResult<void>> {
    try {
      await this.prisma.portfolio.delete({
        where: { id },
      });

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Add a position to a portfolio
   */
  async addPosition(
    portfolioId: string,
    positionId: string,
    userId: string,
    displayOrder?: number
  ): Promise<OperationResult<void>> {
    try {
      // Check if there's already an entry for this portfolio and position
      const existingEntry = await this.prisma.portfolioPosition.findUnique({
        where: {
          portfolioId_positionId: {
            portfolioId,
            positionId,
          },
        },
      });

      if (existingEntry) {
        // Update existing entry if it exists but is hidden
        if (existingEntry.isHidden) {
          await this.prisma.portfolioPosition.update({
            where: {
              id: existingEntry.id,
            },
            data: {
              isHidden: false,
              addedAt: new Date(),
              addedBy: userId,
            },
          });
        }
        return { success: true };
      }

      // If no display order is provided, calculate the next available one
      let finalDisplayOrder = displayOrder;
      if (finalDisplayOrder === undefined) {
        const highestOrder = await this.prisma.portfolioPosition.findFirst({
          where: {
            portfolioId,
          },
          orderBy: {
            displayOrder: "desc",
          },
          select: {
            displayOrder: true,
          },
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
          displayOrder: finalDisplayOrder,
        },
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Remove a position from a portfolio
   */
  async removePosition(
    portfolioId: string,
    positionId: string
  ): Promise<OperationResult<void>> {
    try {
      await this.prisma.portfolioPosition.updateMany({
        where: {
          portfolioId,
          positionId,
        },
        data: {
          isHidden: true,
        },
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Update the display order of a position in a portfolio
   */
  async updatePositionOrder(
    portfolioId: string,
    positionId: string,
    displayOrder: number
  ): Promise<OperationResult<void>> {
    try {
      await this.prisma.portfolioPosition.updateMany({
        where: {
          portfolioId,
          positionId,
        },
        data: {
          displayOrder,
        },
      });

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }
}
