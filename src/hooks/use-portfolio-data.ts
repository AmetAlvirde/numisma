"use client";

import { trpc } from "@/trpc/react";
import { useRetryWithBackoff } from "./use-network-status";
import { useCallback, useMemo } from "react";

/**
 * Hook for user portfolios with comprehensive error handling
 */
export function useUserPortfolios() {
  const { retry, networkStatus } = useRetryWithBackoff();

  const query = trpc.portfolio.getUserPortfolios.useQuery(undefined, {
    // Caching strategy
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,

    // Retry logic
    retry: (failureCount, error) => {
      // Don't retry if offline
      if (!networkStatus.isOnline) return false;

      // Don't retry client errors
      const errorWithData = error as unknown as {
        data?: { httpStatus?: number };
      };
      if (
        errorWithData?.data?.httpStatus &&
        errorWithData.data.httpStatus >= 400 &&
        errorWithData.data.httpStatus < 500
      ) {
        return false;
      }

      // Retry up to 3 times for server errors
      return failureCount < 3;
    },

    retryDelay: attemptIndex =>
      Math.min(1000 * Math.pow(2, attemptIndex), 30000),

    // Network-aware settings
    enabled: networkStatus.isOnline,
  });

  const retryQuery = useCallback(async () => {
    try {
      await retry(() => query.refetch(), {
        maxAttempts: 3,
        baseDelay: 1000,
        onRetry: (attempt, error) => {
          console.log(
            `Retrying portfolio query, attempt ${attempt}:`,
            error.message
          );
        },
      });
    } catch (error) {
      console.error(
        "Failed to retry portfolio query after multiple attempts:",
        error
      );
    }
  }, [retry, query]);

  // Error context
  const errorContext = useMemo(() => {
    if (!query.error) return null;

    const error = query.error as {
      data?: { code?: string; httpStatus?: number };
      message?: string;
    };
    return {
      code: error?.data?.code,
      httpStatus: error?.data?.httpStatus,
      isNetworkError: !networkStatus.isOnline,
      isServerError: error?.data?.httpStatus && error.data.httpStatus >= 500,
      isClientError:
        error?.data?.httpStatus &&
        error.data.httpStatus >= 400 &&
        error.data.httpStatus < 500,
      canRetry:
        !error?.data?.httpStatus ||
        (error.data.httpStatus && error.data.httpStatus >= 500),
      suggestion: getSuggestionForError(error, networkStatus.isOnline),
    };
  }, [query.error, networkStatus.isOnline]);

  return {
    portfolios: query.data ?? [],
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    errorContext,
    refetch: query.refetch,
    retryQuery,
    isFetching: query.isFetching,
    networkStatus,
  };
}

/**
 * Hook for pinned portfolio with comprehensive error handling
 */
export function usePinnedPortfolio() {
  const { retry, networkStatus } = useRetryWithBackoff();

  const query = trpc.portfolio.getPinnedPortfolio.useQuery(undefined, {
    // More frequent updates for pinned portfolio
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: networkStatus.isOnline ? 5 * 60 * 1000 : false,

    // Retry logic
    retry: (failureCount, error) => {
      if (!networkStatus.isOnline) return false;

      const errorWithData = error as unknown as {
        data?: { httpStatus?: number };
      };
      if (
        errorWithData?.data?.httpStatus &&
        errorWithData.data.httpStatus >= 400 &&
        errorWithData.data.httpStatus < 500
      ) {
        return false;
      }

      return failureCount < 3;
    },

    retryDelay: attemptIndex =>
      Math.min(1000 * Math.pow(2, attemptIndex), 30000),

    // Network-aware settings
    enabled: networkStatus.isOnline,
  });

  const retryQuery = useCallback(async () => {
    try {
      await retry(() => query.refetch(), {
        maxAttempts: 3,
        baseDelay: 1000,
        onRetry: (attempt, error) => {
          console.log(
            `Retrying pinned portfolio query, attempt ${attempt}:`,
            error.message
          );
        },
      });
    } catch (error) {
      console.error(
        "Failed to retry pinned portfolio query after multiple attempts:",
        error
      );
    }
  }, [retry, query]);

  // Error context
  const errorContext = useMemo(() => {
    if (!query.error) return null;

    const error = query.error as {
      data?: { code?: string; httpStatus?: number };
      message?: string;
    };
    return {
      code: error?.data?.code,
      httpStatus: error?.data?.httpStatus,
      isNetworkError: !networkStatus.isOnline,
      isServerError: error?.data?.httpStatus && error.data.httpStatus >= 500,
      isClientError:
        error?.data?.httpStatus &&
        error.data.httpStatus >= 400 &&
        error.data.httpStatus < 500,
      canRetry:
        !error?.data?.httpStatus ||
        (error.data.httpStatus && error.data.httpStatus >= 500),
      suggestion: getSuggestionForError(error, networkStatus.isOnline),
    };
  }, [query.error, networkStatus.isOnline]);

  return {
    pinnedPortfolio: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    errorContext,
    refetch: query.refetch,
    retryQuery,
    isFetching: query.isFetching,
    hasPinnedPortfolio: !!query.data,
    networkStatus,
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
 * Hook for portfolio mutations with better error handling
 */
export function useSetPinnedPortfolio() {
  const utils = trpc.useUtils();
  const { retry, networkStatus } = useRetryWithBackoff();

  const mutation = trpc.portfolio.setPinnedPortfolio.useMutation({
    // Optimistic updates
    onMutate: async input => {
      await utils.portfolio.getUserPortfolios.cancel();
      await utils.portfolio.getPinnedPortfolio.cancel();

      const previousUserPortfolios =
        utils.portfolio.getUserPortfolios.getData();
      const previousPinnedPortfolio =
        utils.portfolio.getPinnedPortfolio.getData();

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

      if (previousUserPortfolios) {
        const newPinnedPortfolio = previousUserPortfolios.find(
          p => p.id === input.portfolioId
        );
        if (newPinnedPortfolio) {
          utils.portfolio.getPinnedPortfolio.setData(undefined, {
            id: newPinnedPortfolio.id,
            name: newPinnedPortfolio.name,
            totalValue: Number(newPinnedPortfolio.totalValue),
            dayChange: previousPinnedPortfolio?.dayChange ?? 0,
            dayChangePercent: previousPinnedPortfolio?.dayChangePercent ?? 0,
            topHoldings: previousPinnedPortfolio?.topHoldings ?? [],
          });
        } else {
          utils.portfolio.getPinnedPortfolio.setData(undefined, null);
        }
      }

      return { previousUserPortfolios, previousPinnedPortfolio };
    },

    onError: (err, _input, context) => {
      // Revert optimistic updates
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
      await Promise.all([
        utils.portfolio.getUserPortfolios.invalidate(),
        utils.portfolio.getPinnedPortfolio.invalidate(),
      ]);
    },
  });

  const setPinnedPortfolioWithRetry = useCallback(
    async (input: { portfolioId: string }) => {
      if (!networkStatus.isOnline) {
        throw new Error("Cannot update portfolio while offline");
      }

      try {
        await retry(() => mutation.mutateAsync(input), {
          maxAttempts: 2, // Fewer retries for mutations
          baseDelay: 1000,
          onRetry: (attempt, error) => {
            console.log(
              `Retrying set pinned portfolio, attempt ${attempt}:`,
              error.message
            );
          },
          shouldRetry: (error, attempt) => {
            // Only retry server errors for mutations
            const errorWithData = error as unknown as {
              data?: { httpStatus?: number };
            };
            return (
              attempt < 2 &&
              (!errorWithData?.data?.httpStatus ||
                errorWithData.data.httpStatus >= 500)
            );
          },
        });
      } catch (error) {
        console.error("Failed to set pinned portfolio after retries:", error);
        throw error;
      }
    },
    [retry, mutation, networkStatus.isOnline]
  );

  // Error context
  const errorContext = useMemo(() => {
    if (!mutation.error) return null;

    const error = mutation.error as {
      data?: { code?: string; httpStatus?: number };
      message?: string;
    };
    return {
      code: error?.data?.code,
      httpStatus: error?.data?.httpStatus,
      isNetworkError: !networkStatus.isOnline,
      isServerError: error?.data?.httpStatus && error.data.httpStatus >= 500,
      isClientError:
        error?.data?.httpStatus &&
        error.data.httpStatus >= 400 &&
        error.data.httpStatus < 500,
      canRetry:
        !error?.data?.httpStatus ||
        (error.data.httpStatus && error.data.httpStatus >= 500),
      suggestion: getSuggestionForError(error, networkStatus.isOnline),
    };
  }, [mutation.error, networkStatus.isOnline]);

  return {
    setPinnedPortfolio: mutation.mutate,
    setPinnedPortfolioAsync: mutation.mutateAsync,
    setPinnedPortfolioWithRetry,
    isLoading: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
    errorContext,
    isSuccess: mutation.isSuccess,
    data: mutation.data,
    reset: mutation.reset,
    networkStatus,
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

// Helper function to provide user-friendly error suggestions
function getSuggestionForError(
  error: { data?: { code?: string; httpStatus?: number }; message?: string },
  isOnline: boolean
): string {
  if (!isOnline) {
    return "Check your internet connection and try again.";
  }

  if (error?.data?.code === "UNAUTHORIZED") {
    return "Please sign in to access your portfolios.";
  }

  if (error?.data?.code === "FORBIDDEN") {
    return "You don't have permission to access this portfolio.";
  }

  if (error?.data?.code === "NOT_FOUND") {
    return "The portfolio you're looking for doesn't exist or has been deleted.";
  }

  if (error?.data?.httpStatus && error.data.httpStatus >= 500) {
    return "Our servers are experiencing issues. Please try again in a moment.";
  }

  if (error?.data?.code === "TIMEOUT") {
    return "The request took too long. Please check your connection and try again.";
  }

  return "An unexpected error occurred. Please try refreshing the page.";
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
