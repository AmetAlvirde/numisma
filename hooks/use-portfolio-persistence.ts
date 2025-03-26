/**
 * use-portfolio-persistence.ts - Hook for portfolio data persistence
 *
 * This hook handles saving and loading portfolio data from localStorage
 * and synchronizes it with the portfolio context.
 */

import { useEffect } from "react";
import { usePortfolio } from "@/contexts/portfolio-context";
import type { Portfolio } from "@/types/numisma-types";

const STORAGE_KEY = "numisma_portfolios";

/**
 * Hook for managing portfolio persistence
 */
export function usePortfolioPersistence() {
  const { portfolios, setPortfolios, setLoading, setError } = usePortfolio();

  // Load portfolios from localStorage on mount
  useEffect(() => {
    const loadPortfolios = async () => {
      try {
        setLoading(true);
        const storedData = localStorage.getItem(STORAGE_KEY);

        if (storedData) {
          const parsedData = JSON.parse(storedData);
          setPortfolios(parsedData);
        }
      } catch (error) {
        setError(
          error instanceof Error ? error.message : "Failed to load portfolios"
        );
      } finally {
        setLoading(false);
      }
    };

    loadPortfolios();
  }, [setPortfolios, setLoading, setError]);

  // Save portfolios to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolios));
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to save portfolios"
      );
    }
  }, [portfolios, setError]);

  /**
   * Export portfolios to a JSON file
   */
  const exportPortfolios = () => {
    try {
      const dataStr = JSON.stringify(portfolios, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `numisma-portfolios-${
        new Date().toISOString().split("T")[0]
      }.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to export portfolios"
      );
    }
  };

  /**
   * Import portfolios from a JSON file
   */
  const importPortfolios = async (file: File) => {
    try {
      setLoading(true);
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate that the data is an array of portfolios
      if (!Array.isArray(data)) {
        throw new Error("Invalid portfolio data format");
      }

      // Validate each portfolio
      data.forEach((portfolio: unknown) => {
        if (!isValidPortfolio(portfolio)) {
          throw new Error("Invalid portfolio data format");
        }
      });

      setPortfolios(data);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Failed to import portfolios"
      );
    } finally {
      setLoading(false);
    }
  };

  return {
    exportPortfolios,
    importPortfolios,
  };
}

/**
 * Type guard for portfolio data
 */
function isValidPortfolio(data: unknown): data is Portfolio {
  if (!data || typeof data !== "object") return false;

  const portfolio = data as Partial<Portfolio>;
  return (
    typeof portfolio.id === "string" &&
    typeof portfolio.name === "string" &&
    typeof portfolio.dateCreated === "string" &&
    typeof portfolio.currentValue === "number" &&
    typeof portfolio.initialInvestment === "number" &&
    typeof portfolio.profitLoss === "number" &&
    typeof portfolio.returnPercentage === "number" &&
    typeof portfolio.isPublic === "boolean" &&
    Array.isArray(portfolio.positionIds) &&
    Array.isArray(portfolio.tags) &&
    typeof portfolio.status === "string" &&
    typeof portfolio.userId === "string" &&
    typeof portfolio.baseCurrency === "string"
  );
}
