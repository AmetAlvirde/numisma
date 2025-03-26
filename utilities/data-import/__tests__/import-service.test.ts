/**
 * import-service.test.ts - Tests for the portfolio import service
 */

import { describe, it, expect } from "vitest";
import {
  importFromJson,
  importFromFile,
  importMultipleFromJson,
  importMultipleFromFile,
} from "../import-service";

describe("Import Service", () => {
  const validPortfolioData = {
    id: "test-portfolio",
    name: "Test Portfolio",
    description: "A test portfolio",
    dateCreated: "2024-01-01",
    currentValue: 1000,
    initialInvestment: 1000,
    profitLoss: 0,
    returnPercentage: 0,
    isPublic: false,
    positionIds: [],
    tags: ["test"],
  };

  const invalidPortfolioData = {
    id: "test-portfolio",
    // Missing required fields
    dateCreated: "2024-01-01",
  };

  describe("importFromJson", () => {
    it("should successfully import valid portfolio data", async () => {
      const result = await importFromJson(JSON.stringify(validPortfolioData));

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.id).toBe(validPortfolioData.id);
      expect(result.data?.name).toBe(validPortfolioData.name);
    });

    it("should fail to import invalid portfolio data", async () => {
      const result = await importFromJson(JSON.stringify(invalidPortfolioData));

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toBe("Validation failed");
    });

    it("should handle invalid JSON", async () => {
      const result = await importFromJson("invalid json");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain("JSON");
    });
  });

  describe("importMultipleFromJson", () => {
    it("should successfully import multiple valid portfolios", async () => {
      const portfolios = [
        validPortfolioData,
        { ...validPortfolioData, id: "test-portfolio-2" },
      ];
      const result = await importMultipleFromJson(JSON.stringify(portfolios));

      expect(result.length).toBe(2);
      expect(result.every(r => r.success)).toBe(true);
      expect(result[0].data?.id).toBe(validPortfolioData.id);
      expect(result[1].data?.id).toBe("test-portfolio-2");
    });

    it("should handle mix of valid and invalid portfolios", async () => {
      const portfolios = [validPortfolioData, invalidPortfolioData];
      const result = await importMultipleFromJson(JSON.stringify(portfolios));

      expect(result.length).toBe(2);
      expect(result[0].success).toBe(true);
      expect(result[1].success).toBe(false);
    });

    it("should fail when input is not an array", async () => {
      const result = await importMultipleFromJson(
        JSON.stringify(validPortfolioData)
      );

      expect(result.length).toBe(1);
      expect(result[0].success).toBe(false);
      expect(result[0].error?.message).toBe(
        "Input must be an array of portfolio data"
      );
    });
  });

  // Note: File-based tests would require mocking the File API
  // These tests would be better suited for an integration test suite
});
