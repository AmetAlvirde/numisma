import { trpc } from "@/trpc/react";

/**
 * Hook to fetch all portfolios for the authenticated user
 * Returns basic portfolio information including id, name, and totalValue
 */
export function useUserPortfolios() {
  const query = trpc.portfolio.getUserPortfolios.useQuery(undefined, {
    // Cache data for 5 minutes
    staleTime: 5 * 60 * 1000,
    // Keep cache for 10 minutes when unused
    gcTime: 10 * 60 * 1000,
    // Refetch when window gains focus
    refetchOnWindowFocus: true,
    // Retry failed requests up to 3 times
    retry: 3,
  });

  return {
    portfolios: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isFetching: query.isFetching,
  };
}

/**
 * Hook to fetch detailed information for the user's pinned portfolio
 * Returns portfolio details including day change calculations and top holdings
 * Returns null if no pinned portfolio exists
 */
export function usePinnedPortfolio() {
  const query = trpc.portfolio.getPinnedPortfolio.useQuery(undefined, {
    // Cache data for 2 minutes (more frequent updates for pinned portfolio)
    staleTime: 2 * 60 * 1000,
    // Keep cache for 5 minutes when unused
    gcTime: 5 * 60 * 1000,
    // Refetch when window gains focus
    refetchOnWindowFocus: true,
    // Retry failed requests up to 3 times
    retry: 3,
    // Refetch every 5 minutes in the background
    refetchInterval: 5 * 60 * 1000,
  });

  return {
    pinnedPortfolio: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isFetching: query.isFetching,
    // Convenience computed value
    hasPinnedPortfolio: !!query.data,
  };
}

/**
 * Hook to fetch historical valuations for a specific portfolio
 * Supports flexible date range filtering and time period optimization
 */
export function usePortfolioValuations(
  portfolioId: string,
  options?: {
    startDate?: Date;
    endDate?: Date;
    dateStatus?: "ACTIVE" | "HISTORICAL" | "PROJECTED";
    timePeriod?: "week" | "month" | "year" | "custom";
    limit?: number;
    enabled?: boolean;
  }
) {
  const query = trpc.portfolio.getPortfolioValuations.useQuery(
    {
      portfolioId,
      startDate: options?.startDate,
      endDate: options?.endDate,
      dateStatus: options?.dateStatus,
      timePeriod: options?.timePeriod ?? "month",
      limit: options?.limit,
    },
    {
      // Only run query if portfolioId is provided and enabled is true
      enabled: !!portfolioId && (options?.enabled ?? true),
      // Cache data for 3 minutes
      staleTime: 3 * 60 * 1000,
      // Keep cache for 8 minutes when unused
      gcTime: 8 * 60 * 1000,
      // Refetch when window gains focus
      refetchOnWindowFocus: true,
      // Retry failed requests up to 2 times (historical data is less critical)
      retry: 2,
    }
  );

  return {
    valuations: query.data?.valuations ?? [],
    portfolio: query.data?.portfolio ?? null,
    aggregations: query.data?.aggregations ?? null,
    metadata: query.data?.metadata ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
    isFetching: query.isFetching,
  };
}

/**
 * Hook to update portfolio settings
 * Allows updating basic portfolio information like name and description
 */
export function useUpdatePortfolio() {
  const utils = trpc.useUtils();

  const mutation = trpc.portfolio.updatePortfolio.useMutation({
    onSuccess: async updatedPortfolio => {
      // Invalidate relevant queries to refetch fresh data
      await Promise.all([
        utils.portfolio.getUserPortfolios.invalidate(),
        // Also invalidate pinned portfolio if it was the one updated
        updatedPortfolio.isPinned
          ? utils.portfolio.getPinnedPortfolio.invalidate()
          : Promise.resolve(),
      ]);
    },
    onError: error => {
      console.error("Failed to update portfolio:", error);
    },
  });

  return {
    updatePortfolio: mutation.mutate,
    updatePortfolioAsync: mutation.mutateAsync,
    isLoading: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
    data: mutation.data,
    reset: mutation.reset,
  };
}

/**
 * Hook to set which portfolio is pinned
 * Ensures only one portfolio can be pinned at a time per user
 * Now with optimistic updates for instant UI feedback
 */
export function useSetPinnedPortfolio() {
  const utils = trpc.useUtils();

  const mutation = trpc.portfolio.setPinnedPortfolio.useMutation({
    onMutate: async input => {
      // Cancel outgoing refetches so they don't overwrite optimistic update
      await utils.portfolio.getUserPortfolios.cancel();
      await utils.portfolio.getPinnedPortfolio.cancel();

      // Snapshot the previous values
      const previousUserPortfolios =
        utils.portfolio.getUserPortfolios.getData();
      const previousPinnedPortfolio =
        utils.portfolio.getPinnedPortfolio.getData();

      // Optimistically update user portfolios list
      if (previousUserPortfolios) {
        utils.portfolio.getUserPortfolios.setData(
          undefined,
          old =>
            old?.map(portfolio => ({
              ...portfolio,
              isPinned: portfolio.id === input.portfolioId,
            })) ?? []
        );
      }

      // Optimistically update pinned portfolio
      if (previousUserPortfolios) {
        const newPinnedPortfolio = previousUserPortfolios.find(
          p => p.id === input.portfolioId
        );
        if (newPinnedPortfolio) {
          utils.portfolio.getPinnedPortfolio.setData(undefined, {
            id: newPinnedPortfolio.id,
            name: newPinnedPortfolio.name,
            totalValue: Number(newPinnedPortfolio.totalValue),
            // Keep existing calculated fields if they exist, or provide defaults
            dayChange: previousPinnedPortfolio?.dayChange ?? 0,
            dayChangePercent: previousPinnedPortfolio?.dayChangePercent ?? 0,
            topHoldings: previousPinnedPortfolio?.topHoldings ?? [],
          });
        } else {
          // If we can't find the portfolio in the list, clear pinned data
          utils.portfolio.getPinnedPortfolio.setData(undefined, null);
        }
      }

      // Return context object with snapshot
      return { previousUserPortfolios, previousPinnedPortfolio };
    },
    onError: (err, _input, context) => {
      // Revert optimistic updates on error
      if (context?.previousUserPortfolios) {
        utils.portfolio.getUserPortfolios.setData(
          undefined,
          context.previousUserPortfolios
        );
      }
      if (context?.previousPinnedPortfolio !== undefined) {
        utils.portfolio.getPinnedPortfolio.setData(
          undefined,
          context.previousPinnedPortfolio
        );
      }
      console.error("Failed to set pinned portfolio:", err);
    },
    onSettled: async () => {
      // Always refetch after mutation settles (success or error) to ensure data consistency
      await Promise.all([
        utils.portfolio.getUserPortfolios.invalidate(),
        utils.portfolio.getPinnedPortfolio.invalidate(),
      ]);
    },
  });

  return {
    setPinnedPortfolio: mutation.mutate,
    setPinnedPortfolioAsync: mutation.mutateAsync,
    isLoading: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    isSuccess: mutation.isSuccess,
    data: mutation.data,
    reset: mutation.reset,
  };
}

/**
 * Utility hook to invalidate and refetch all portfolio-related queries
 * Useful for forcing data refresh after mutations
 */
export function useInvalidatePortfolioQueries() {
  const utils = trpc.useUtils();

  const invalidateAll = async () => {
    await Promise.all([
      utils.portfolio.getUserPortfolios.invalidate(),
      utils.portfolio.getPinnedPortfolio.invalidate(),
      // Note: getPortfolioValuations has dynamic inputs so we invalidate all instances
      utils.portfolio.getPortfolioValuations.invalidate(),
    ]);
  };

  const invalidateUserPortfolios = () =>
    utils.portfolio.getUserPortfolios.invalidate();

  const invalidatePinnedPortfolio = () =>
    utils.portfolio.getPinnedPortfolio.invalidate();

  const invalidatePortfolioValuations = (portfolioId?: string) => {
    if (portfolioId) {
      // Invalidate specific portfolio valuations
      return utils.portfolio.getPortfolioValuations.invalidate({ portfolioId });
    }
    // Invalidate all portfolio valuations
    return utils.portfolio.getPortfolioValuations.invalidate();
  };

  return {
    invalidateAll,
    invalidateUserPortfolios,
    invalidatePinnedPortfolio,
    invalidatePortfolioValuations,
  };
}

/**
 * Type exports for better TypeScript integration
 */
export type UserPortfolio = NonNullable<
  ReturnType<typeof useUserPortfolios>["portfolios"]
>[0];

export type PinnedPortfolioData = NonNullable<
  ReturnType<typeof usePinnedPortfolio>["pinnedPortfolio"]
>;

export type PortfolioValuation = NonNullable<
  ReturnType<typeof usePortfolioValuations>["valuations"]
>[0];
