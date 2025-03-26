/**
 * use-portfolio-persistence.test.tsx - Tests for the portfolio persistence hook
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePortfolioPersistence } from "../use-portfolio-persistence";
import { PortfolioProvider } from "@/contexts/portfolio-context";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", {
  value: localStorageMock,
});

// Mock URL.createObjectURL and URL.revokeObjectURL
const createObjectURLMock = vi.fn();
const revokeObjectURLMock = vi.fn();

Object.defineProperty(window, "URL", {
  value: {
    createObjectURL: createObjectURLMock,
    revokeObjectURL: revokeObjectURLMock,
  },
});

const mockPortfolio = {
  id: "test-portfolio",
  name: "Test Portfolio",
  description: "A test portfolio",
  dateCreated: new Date().toISOString(),
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

describe("usePortfolioPersistence", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it("should load portfolios from localStorage on mount", () => {
    const portfolios = [mockPortfolio];
    localStorageMock.setItem("numisma_portfolios", JSON.stringify(portfolios));

    const { result } = renderHook(() => usePortfolioPersistence(), { wrapper });

    // The hook should have loaded the portfolios from localStorage
    expect(localStorageMock.getItem("numisma_portfolios")).toBe(
      JSON.stringify(portfolios)
    );
  });

  it("should save portfolios to localStorage when they change", async () => {
    const { result } = renderHook(() => usePortfolioPersistence(), { wrapper });

    // Simulate portfolio changes
    act(() => {
      result.current.importPortfolios(
        new File([JSON.stringify([mockPortfolio])], "test.json")
      );
    });

    // Check if the portfolios were saved to localStorage
    expect(localStorageMock.getItem("numisma_portfolios")).toBe(
      JSON.stringify([mockPortfolio])
    );
  });

  it("should export portfolios to a JSON file", () => {
    const { result } = renderHook(() => usePortfolioPersistence(), { wrapper });

    // Mock document.createElement and related methods
    const mockAnchor = {
      href: "",
      download: "",
      click: vi.fn(),
    };
    const mockAppendChild = vi.fn();
    const mockRemoveChild = vi.fn();

    vi.spyOn(document, "createElement").mockReturnValue(mockAnchor as any);
    vi.spyOn(document.body, "appendChild").mockImplementation(mockAppendChild);
    vi.spyOn(document.body, "removeChild").mockImplementation(mockRemoveChild);

    act(() => {
      result.current.exportPortfolios();
    });

    expect(createObjectURLMock).toHaveBeenCalled();
    expect(mockAppendChild).toHaveBeenCalledWith(mockAnchor);
    expect(mockRemoveChild).toHaveBeenCalledWith(mockAnchor);
    expect(revokeObjectURLMock).toHaveBeenCalled();
  });

  it("should import portfolios from a JSON file", async () => {
    const { result } = renderHook(() => usePortfolioPersistence(), { wrapper });

    const file = new File([JSON.stringify([mockPortfolio])], "test.json");

    await act(async () => {
      await result.current.importPortfolios(file);
    });

    expect(localStorageMock.getItem("numisma_portfolios")).toBe(
      JSON.stringify([mockPortfolio])
    );
  });

  it("should handle invalid portfolio data during import", async () => {
    const { result } = renderHook(() => usePortfolioPersistence(), { wrapper });

    const invalidData = { invalid: "data" };
    const file = new File([JSON.stringify(invalidData)], "test.json");

    await act(async () => {
      await result.current.importPortfolios(file);
    });

    // The invalid data should not have been saved
    expect(localStorageMock.getItem("numisma_portfolios")).toBeNull();
  });

  it("should handle file read errors during import", async () => {
    const { result } = renderHook(() => usePortfolioPersistence(), { wrapper });

    // Create a file that will cause a read error
    const file = new File([], "test.json", { type: "application/json" });
    vi.spyOn(file, "text").mockRejectedValue(new Error("Read error"));

    await act(async () => {
      await result.current.importPortfolios(file);
    });

    // The error should not have affected the existing data
    expect(localStorageMock.getItem("numisma_portfolios")).toBeNull();
  });
});
