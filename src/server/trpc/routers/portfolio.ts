import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc";

/**
 * Portfolio tRPC Router
 *
 * Handles all portfolio-related procedures including:
 * - Fetching user portfolios
 * - Getting pinned portfolio details
 * - Managing portfolio valuations
 * - Portfolio mutations (pin/unpin, updates)
 *
 * Uses shared tRPC instance from ../trpc for consistency and scalability
 */
export const portfolioRouter = router({
  /**
   * Get all portfolios for the authenticated user
   * Returns basic portfolio information including id, name, and totalValue
   */
  getUserPortfolios: protectedProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.session.user.id;

      const portfolios = await ctx.prisma.portfolio.findMany({
        where: {
          userId: userId,
        },
        select: {
          id: true,
          name: true,
          description: true,
          totalValue: true,
          isPinned: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: [
          { isPinned: "desc" }, // Pinned portfolios first
          { updatedAt: "desc" }, // Then by most recently updated
        ],
      });

      return portfolios;
    } catch (error) {
      console.error("Error fetching user portfolios:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch portfolios",
      });
    }
  }),

  /**
   * Get detailed information for the user's pinned portfolio
   * Returns portfolio details including day change calculations and top holdings
   */
  getPinnedPortfolio: protectedProcedure.query(async ({ ctx }) => {
    try {
      const userId = ctx.session.user.id;

      // Find the user's pinned portfolio
      const pinnedPortfolio = await ctx.prisma.portfolio.findFirst({
        where: {
          userId: userId,
          isPinned: true,
        },
        include: {
          historicalValuations: {
            orderBy: {
              timestamp: "desc",
            },
            take: 2, // Get latest and previous day for day change calculation
          },
        },
      });

      if (!pinnedPortfolio) {
        return null; // No pinned portfolio found
      }

      // Calculate day change from historical valuations
      let dayChange = 0;
      let dayChangePercent = 0;

      if (pinnedPortfolio.historicalValuations.length >= 2) {
        const latestValuation = pinnedPortfolio.historicalValuations[0];
        const previousValuation = pinnedPortfolio.historicalValuations[1];

        const currentValue = Number(latestValuation.value);
        const previousValue = Number(previousValuation.value);

        dayChange = currentValue - previousValue;
        dayChangePercent =
          previousValue > 0 ? (dayChange / previousValue) * 100 : 0;
      } else if (pinnedPortfolio.historicalValuations.length === 1) {
        // If only one valuation exists, compare with portfolio totalValue
        const latestValuation = pinnedPortfolio.historicalValuations[0];
        const currentValue = Number(latestValuation.value);
        const portfolioValue = Number(pinnedPortfolio.totalValue);

        dayChange = currentValue - portfolioValue;
        dayChangePercent =
          portfolioValue > 0 ? (dayChange / portfolioValue) * 100 : 0;
      }

      // For now, return simplified top holdings (will be enhanced later)
      const topHoldings: string[] = ["AAPL", "GOOGL", "TSLA"]; // Simplified placeholder

      return {
        id: pinnedPortfolio.id,
        name: pinnedPortfolio.name,
        totalValue: Number(pinnedPortfolio.totalValue),
        dayChange: Number(dayChange.toFixed(2)),
        dayChangePercent: Number(dayChangePercent.toFixed(2)),
        topHoldings,
      };
    } catch (error) {
      console.error("Error fetching pinned portfolio:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Failed to fetch pinned portfolio",
      });
    }
  }),

  /**
   * Get historical valuations for a specific portfolio
   * Returns time-series data with optional date range filtering
   * Optimized for common time periods: week, month, year
   * Weekly data is optimized for high-frequency usage patterns
   */
  getPortfolioValuations: protectedProcedure
    .input(
      z.object({
        portfolioId: z.string().cuid("Invalid portfolio ID"),
        startDate: z.date().optional(),
        endDate: z.date().optional(),
        dateStatus: z.enum(["ACTIVE", "HISTORICAL", "PROJECTED"]).optional(),
        timePeriod: z
          .enum(["week", "month", "year", "custom"])
          .default("month"),
        limit: z.number().int().min(1).max(1000).optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const userId = ctx.session.user.id;
        const { portfolioId, startDate, endDate, dateStatus, timePeriod } =
          input;

        // Optimize limit based on time period for better performance
        const optimizedLimit =
          input.limit ??
          (() => {
            switch (timePeriod) {
              case "week":
                return 50; // ~7-14 days of data (daily/twice daily)
              case "month":
                return 100; // ~30-60 days of data
              case "year":
                return 365; // ~365 days of data
              case "custom":
                return 100; // Default for custom ranges
              default:
                return 100;
            }
          })();

        // Auto-set date ranges for predefined periods if not provided
        let effectiveStartDate = startDate;
        let effectiveEndDate = endDate;

        if (!startDate && !endDate && timePeriod !== "custom") {
          const now = new Date();
          effectiveEndDate = now;

          switch (timePeriod) {
            case "week":
              effectiveStartDate = new Date(
                now.getTime() - 7 * 24 * 60 * 60 * 1000
              );
              break;
            case "month":
              effectiveStartDate = new Date(
                now.getTime() - 30 * 24 * 60 * 60 * 1000
              );
              break;
            case "year":
              effectiveStartDate = new Date(
                now.getTime() - 365 * 24 * 60 * 60 * 1000
              );
              break;
          }
        }

        // First verify that the portfolio belongs to the authenticated user
        const portfolio = await ctx.prisma.portfolio.findFirst({
          where: {
            id: portfolioId,
            userId: userId,
          },
          select: {
            id: true,
            name: true,
          },
        });

        if (!portfolio) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Portfolio not found or access denied",
          });
        }

        // Build the where clause for historical valuations
        const whereClause: {
          portfolioId: string;
          timestamp?: {
            gte?: Date;
            lte?: Date;
          };
          dateStatus?: "ACTIVE" | "HISTORICAL" | "PROJECTED";
        } = {
          portfolioId: portfolioId,
        };

        // Add date range filtering using effective dates
        if (effectiveStartDate || effectiveEndDate) {
          whereClause.timestamp = {};
          if (effectiveStartDate) {
            whereClause.timestamp.gte = effectiveStartDate;
          }
          if (effectiveEndDate) {
            whereClause.timestamp.lte = effectiveEndDate;
          }
        }

        // Add date status filtering if provided
        if (dateStatus) {
          whereClause.dateStatus = dateStatus;
        }

        // Query historical valuations
        const valuations = await ctx.prisma.historicalValuation.findMany({
          where: whereClause,
          select: {
            id: true,
            value: true,
            timestamp: true,
            dateStatus: true,
            createdAt: true,
          },
          orderBy: {
            timestamp: "desc", // Most recent first
          },
          take: optimizedLimit,
        });

        // Calculate basic aggregations
        const values = valuations.map(v => Number(v.value));
        const aggregations = {
          count: valuations.length,
          latest: values[0] || 0,
          oldest: values[values.length - 1] || 0,
          highest: values.length > 0 ? Math.max(...values) : 0,
          lowest: values.length > 0 ? Math.min(...values) : 0,
          average:
            values.length > 0
              ? values.reduce((sum, val) => sum + val, 0) / values.length
              : 0,
        };

        // Calculate period change if we have data
        let periodChange = 0;
        let periodChangePercent = 0;
        if (values.length >= 2) {
          const latestValue = values[0];
          const oldestValue = values[values.length - 1];
          periodChange = latestValue - oldestValue;
          periodChangePercent =
            oldestValue > 0 ? (periodChange / oldestValue) * 100 : 0;
        }

        return {
          portfolio: {
            id: portfolio.id,
            name: portfolio.name,
          },
          valuations: valuations.map(valuation => ({
            id: valuation.id,
            value: Number(valuation.value),
            timestamp: valuation.timestamp,
            dateStatus: valuation.dateStatus,
            createdAt: valuation.createdAt,
          })),
          aggregations: {
            ...aggregations,
            periodChange: Number(periodChange.toFixed(2)),
            periodChangePercent: Number(periodChangePercent.toFixed(2)),
          },
          metadata: {
            totalCount: valuations.length,
            hasMoreData: valuations.length === optimizedLimit,
            requestedLimit: optimizedLimit,
            timePeriod: timePeriod,
            dateRange: {
              requested: {
                start: effectiveStartDate,
                end: effectiveEndDate,
              },
              actual: {
                start: valuations[valuations.length - 1]?.timestamp || null,
                end: valuations[0]?.timestamp || null,
              },
            },
            performance: {
              optimizedForTimePeriod: timePeriod,
              recordsReturned: valuations.length,
              isOptimalRange: timePeriod !== "custom" && !startDate && !endDate,
            },
          },
        };
      } catch (error) {
        console.error("Error fetching portfolio valuations:", error);

        // Re-throw TRPCError as-is
        if (error instanceof TRPCError) {
          throw error;
        }

        // Handle other errors
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch portfolio valuations",
        });
      }
    }),

  /**
   * Update portfolio settings
   * Allows updating basic portfolio information like name and description
   */
  updatePortfolio: protectedProcedure
    .input(
      z.object({
        portfolioId: z.string().cuid("Invalid portfolio ID"),
        name: z.string().min(1, "Portfolio name is required").optional(),
        description: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = ctx.session.user.id;
        const { portfolioId, name, description } = input;

        // First verify that the portfolio belongs to the authenticated user
        const existingPortfolio = await ctx.prisma.portfolio.findFirst({
          where: {
            id: portfolioId,
            userId: userId,
          },
        });

        if (!existingPortfolio) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Portfolio not found or access denied",
          });
        }

        // Build update data object with only provided fields
        const updateData: {
          name?: string;
          description?: string;
          updatedAt: Date;
        } = {
          updatedAt: new Date(),
        };

        if (name !== undefined) {
          updateData.name = name;
        }
        if (description !== undefined) {
          updateData.description = description;
        }

        // Update the portfolio
        const updatedPortfolio = await ctx.prisma.portfolio.update({
          where: {
            id: portfolioId,
          },
          data: updateData,
          select: {
            id: true,
            name: true,
            description: true,
            totalValue: true,
            isPinned: true,
            updatedAt: true,
          },
        });

        return updatedPortfolio;
      } catch (error) {
        console.error("Error updating portfolio:", error);

        // Re-throw TRPCError as-is
        if (error instanceof TRPCError) {
          throw error;
        }

        // Handle other errors
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update portfolio",
        });
      }
    }),

  /**
   * Set which portfolio is pinned for the user
   * Ensures only one portfolio can be pinned at a time per user
   */
  setPinnedPortfolio: protectedProcedure
    .input(
      z.object({
        portfolioId: z.string().cuid("Invalid portfolio ID"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        const userId = ctx.session.user.id;
        const { portfolioId } = input;

        // First verify that the portfolio belongs to the authenticated user
        const targetPortfolio = await ctx.prisma.portfolio.findFirst({
          where: {
            id: portfolioId,
            userId: userId,
          },
        });

        if (!targetPortfolio) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Portfolio not found or access denied",
          });
        }

        // Use a transaction to ensure atomicity
        await ctx.prisma.$transaction(async prisma => {
          // First, unpin all portfolios for this user
          await prisma.portfolio.updateMany({
            where: {
              userId: userId,
              isPinned: true,
            },
            data: {
              isPinned: false,
              updatedAt: new Date(),
            },
          });

          // Then pin the selected portfolio
          await prisma.portfolio.update({
            where: {
              id: portfolioId,
            },
            data: {
              isPinned: true,
              updatedAt: new Date(),
            },
          });
        });

        // Return the updated portfolio
        const pinnedPortfolio = await ctx.prisma.portfolio.findUnique({
          where: {
            id: portfolioId,
          },
          select: {
            id: true,
            name: true,
            description: true,
            totalValue: true,
            isPinned: true,
            updatedAt: true,
          },
        });

        return pinnedPortfolio;
      } catch (error) {
        console.error("Error setting pinned portfolio:", error);

        // Re-throw TRPCError as-is
        if (error instanceof TRPCError) {
          throw error;
        }

        // Handle other errors
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to set pinned portfolio",
        });
      }
    }),
});

export type PortfolioRouter = typeof portfolioRouter;
