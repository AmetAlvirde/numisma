/**
 * portfolio-context.test.tsx - Tests for the portfolio context
 */

import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { PortfolioProvider, usePortfolio } from "../portfolio-context";
import type { Portfolio } from "@/types/numisma-types";

const mockPortfolio: Portfolio = {
  id: "test-portfolio",
  name: "Test Portfolio",
  description: "A test portfolio",
  dateCreated: new Date(),
  currentValue: 1000,
  initialInvestment: 1000,
  profitLoss: 0,
  returnPercentage: 0,
  isPublic: false,
  positionIds: [],
  tags: ["test"],
  status: "active",
  userId: "test-user",
  baseCurrency: "USD",
};

function wrapper({ children }: { children: React.ReactNode }) {
  return <PortfolioProvider>{children}</PortfolioProvider>;
}

describe("PortfolioContext", () => {
  it("should initialize with empty state", () => {
    const { result } = renderHook(() => usePortfolio(), { wrapper });

    expect(result.current.portfolios).toEqual([]);
    expect(result.current.selectedPortfolioId).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("should add a portfolio", () => {
    const { result } = renderHook(() => usePortfolio(), { wrapper });

    act(() => {
      result.current.addPortfolio(mockPortfolio);
    });

    expect(result.current.portfolios).toHaveLength(1);
    expect(result.current.portfolios[0]).toEqual(mockPortfolio);
  });

  it("should update a portfolio", () => {
    const { result } = renderHook(() => usePortfolio(), { wrapper });

    // First add a portfolio
    act(() => {
      result.current.addPortfolio(mockPortfolio);
    });

    // Then update it
    const updatedPortfolio = {
      ...mockPortfolio,
      name: "Updated Portfolio",
    };

    act(() => {
      result.current.updatePortfolio(updatedPortfolio);
    });

    expect(result.current.portfolios).toHaveLength(1);
    expect(result.current.portfolios[0].name).toBe("Updated Portfolio");
  });

  it("should delete a portfolio", () => {
    const { result } = renderHook(() => usePortfolio(), { wrapper });

    // First add a portfolio
    act(() => {
      result.current.addPortfolio(mockPortfolio);
    });

    // Then delete it
    act(() => {
      result.current.deletePortfolio(mockPortfolio.id);
    });

    expect(result.current.portfolios).toHaveLength(0);
  });

  it("should select a portfolio", () => {
    const { result } = renderHook(() => usePortfolio(), { wrapper });

    // First add a portfolio
    act(() => {
      result.current.addPortfolio(mockPortfolio);
    });

    // Then select it
    act(() => {
      result.current.selectPortfolio(mockPortfolio.id);
    });

    expect(result.current.selectedPortfolioId).toBe(mockPortfolio.id);
  });

  it("should handle loading state", () => {
    const { result } = renderHook(() => usePortfolio(), { wrapper });

    act(() => {
      result.current.setLoading(true);
    });

    expect(result.current.isLoading).toBe(true);

    act(() => {
      result.current.setLoading(false);
    });

    expect(result.current.isLoading).toBe(false);
  });

  it("should handle error state", () => {
    const { result } = renderHook(() => usePortfolio(), { wrapper });

    const errorMessage = "Test error message";

    act(() => {
      result.current.setError(errorMessage);
    });

    expect(result.current.error).toBe(errorMessage);

    act(() => {
      result.current.setError(null);
    });

    expect(result.current.error).toBeNull();
  });

  it("should clear selected portfolio when deleting it", () => {
    const { result } = renderHook(() => usePortfolio(), { wrapper });

    // Add and select a portfolio
    act(() => {
      result.current.addPortfolio(mockPortfolio);
      result.current.selectPortfolio(mockPortfolio.id);
    });

    // Delete the selected portfolio
    act(() => {
      result.current.deletePortfolio(mockPortfolio.id);
    });

    expect(result.current.selectedPortfolioId).toBeNull();
  });
});
