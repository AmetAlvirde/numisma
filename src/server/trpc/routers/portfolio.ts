import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../router";

/**
 * Portfolio tRPC Router
 *
 * Handles all portfolio-related procedures including:
 * - Fetching user portfolios
 * - Getting pinned portfolio details
 * - Managing portfolio valuations
 * - Portfolio mutations (pin/unpin, updates)
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
        const whereClause: any = {
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

  // TODO: Add the following procedures in subsequent tasks:
  // - updatePortfolio: Update portfolio settings
  // - setPinnedPortfolio: Set which portfolio is pinned
});

export type PortfolioRouter = typeof portfolioRouter;
