"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";
import { usePinnedPortfolio } from "@/hooks/use-portfolio-data";
import type { PinnedPortfolioData } from "@/hooks/use-portfolio-data";

interface PortfolioContextValue {
  pinnedPortfolio: PinnedPortfolioData | null;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  errorContext: ReturnType<typeof usePinnedPortfolio>["errorContext"];
  hasPinnedPortfolio: boolean;
  networkStatus: ReturnType<typeof usePinnedPortfolio>["networkStatus"];
}

const PortfolioContext = createContext<PortfolioContextValue | undefined>(
  undefined
);

interface PortfolioProviderProps {
  children: ReactNode;
}

export function PortfolioProvider({ children }: PortfolioProviderProps) {
  const {
    pinnedPortfolio,
    isLoading,
    isError,
    error,
    errorContext,
    hasPinnedPortfolio,
    networkStatus,
  } = usePinnedPortfolio();

  const value: PortfolioContextValue = {
    pinnedPortfolio,
    isLoading,
    isError,
    error,
    errorContext,
    hasPinnedPortfolio,
    networkStatus,
  };

  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}

/**
 * Hook to access the portfolio context
 * Must be used within a PortfolioProvider
 */
export function usePortfolio() {
  const context = useContext(PortfolioContext);
  if (context === undefined) {
    throw new Error("usePortfolio must be used within a PortfolioProvider");
  }
  return context;
}
