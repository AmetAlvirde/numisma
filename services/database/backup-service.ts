/**
 * backup-service.ts - Service for handling data backup and restore operations
 */

import { statePersistence } from "./state-persistence";
import type { Portfolio, Position, Asset, Order } from "@/types/numisma-types";

interface BackupMetadata {
  version: string;
  timestamp: string;
  userId: string;
  dataVersion: string;
  portfolioCount: number;
  positionCount: number;
  assetCount: number;
  orderCount: number;
}

interface BackupData {
  metadata: BackupMetadata;
  data: {
    portfolios: Portfolio[];
    positions: Position[];
    assets: Asset[];
    orders: Order[];
  };
}

interface PortfolioImportData {
  portfolio: Portfolio;
  positions: Position[];
  portfolioPositions: Array<{
    portfolioId: string;
    positionId: string;
    addedAt: string;
    addedBy: string;
    isHidden: boolean;
    displayOrder: number;
  }>;
  historicalValuations: Array<{
    id: string;
    portfolioId: string;
    timestamp: string;
    totalValue: number;
    valueCurrency: string;
    initialInvestment: number;
    profitLoss: number;
    percentageReturn: number;
    positionValuations: Array<{
      id: string;
      positionId: string;
      value: number;
      marketPrice: number;
      quantity: number;
      costBasis: number;
      profitLoss: number;
      percentageReturn: number;
    }>;
    isRetroactive: boolean;
    marketContext?: {
      btcPrice: number;
      ethPrice: number;
      totalMarketCap: number;
      fearGreedIndex: number;
    };
  }>;
}

export class BackupService {
  private static readonly CURRENT_VERSION = "1.0.0";
  private static readonly DATA_VERSION = "1.0.0";

  /**
   * Create a backup of user data
   */
  async createBackup(userId: string): Promise<string> {
    try {
      // Load all user data
      const data = await statePersistence.loadUserData(userId);

      // Create backup metadata
      const metadata: BackupMetadata = {
        version: BackupService.CURRENT_VERSION,
        timestamp: new Date().toISOString(),
        userId,
        dataVersion: BackupService.DATA_VERSION,
        portfolioCount: data.portfolios.length,
        positionCount: data.positions.length,
        assetCount: data.assets.length,
        orderCount: data.orders.length,
      };

      // Create backup data
      const backupData: BackupData = {
        metadata,
        data,
      };

      // Convert to JSON and compress
      const jsonData = JSON.stringify(backupData);
      return this.compress(jsonData);
    } catch (error) {
      console.error("Failed to create backup:", error);
      throw error;
    }
  }

  /**
   * Get metadata from a backup file
   */
  async getBackupMetadata(jsonData: string): Promise<BackupMetadata> {
    try {
      const parsedData = JSON.parse(this.decompress(jsonData));

      // Check if this is a portfolio import format
      if (this.isPortfolioImportFormat(parsedData)) {
        return {
          version: BackupService.CURRENT_VERSION,
          timestamp: new Date().toISOString(),
          userId: parsedData.portfolio.userId,
          dataVersion: BackupService.DATA_VERSION,
          portfolioCount: 1,
          positionCount: parsedData.positions.length,
          assetCount: this.extractUniqueAssets(parsedData.positions).length,
          orderCount: this.extractOrders(parsedData.positions).length,
        };
      }

      // Otherwise, treat as a backup format
      const data = parsedData as BackupData;
      return data.metadata;
    } catch (error) {
      console.error("Failed to get backup metadata:", error);
      throw error;
    }
  }

  /**
   * Check if data is in portfolio import format
   */
  private isPortfolioImportFormat(data: any): data is PortfolioImportData {
    return (
      data &&
      typeof data === "object" &&
      "portfolio" in data &&
      "positions" in data &&
      "portfolioPositions" in data
    );
  }

  /**
   * Restore data from a backup file
   */
  async restoreBackup(jsonData: string): Promise<void> {
    try {
      console.log("Starting restoreBackup");
      const parsedData = JSON.parse(this.decompress(jsonData));
      console.log("Data parsed successfully");

      // Check if this is a portfolio import format
      if (this.isPortfolioImportFormat(parsedData)) {
        console.log("Detected portfolio import format");
        await this.restorePortfolioImport(parsedData);
        return;
      }

      // Otherwise, treat as a backup format
      console.log("Treating as backup format");
      const data = parsedData as BackupData;
      await statePersistence.importUserData(JSON.stringify(data.data));
    } catch (error) {
      console.error("Failed to restore backup:", error);
      throw error;
    }
  }

  /**
   * Restore data from portfolio import format
   */
  private async restorePortfolioImport(
    data: PortfolioImportData
  ): Promise<void> {
    try {
      console.log("Starting restorePortfolioImport");
      // Transform the data into the expected format
      const transformedData = {
        portfolios: [
          {
            ...data.portfolio,
            positionIds: data.portfolioPositions.map(pp => pp.positionId),
            displayMetadata: data.portfolio.displayMetadata || {},
            tags: data.portfolio.tags || [],
            status: data.portfolio.status || "active",
            baseCurrency: data.portfolio.baseCurrency || "USD",
            currentValue: data.portfolio.currentValue || 0,
            initialInvestment: data.portfolio.initialInvestment || 0,
            profitLoss: data.portfolio.profitLoss || 0,
            returnPercentage: data.portfolio.returnPercentage || 0,
            isPublic: data.portfolio.isPublic || false,
          },
        ],
        positions: data.positions.map(position => ({
          ...position,
          portfolio: data.portfolio.id, // Ensure portfolio reference is set
          userId: data.portfolio.userId, // Ensure userId is set
        })),
        assets: this.extractUniqueAssets(data.positions),
        orders: this.extractOrders(data.positions),
        portfolioPositions: data.portfolioPositions,
        historicalValuations:
          data.historicalValuations?.map(hv => ({
            ...hv,
            portfolioId: data.portfolio.id, // Ensure portfolio reference is set
            positionValuations: hv.positionValuations.map(pv => ({
              ...pv,
              id: pv.id || `${hv.id}-${pv.positionId}`, // Ensure each position valuation has a unique ID
            })),
          })) || [],
      };

      console.log("Data transformed, calling importUserData");
      console.log(
        "Historical valuations count:",
        transformedData.historicalValuations.length
      );
      await statePersistence.importUserData(JSON.stringify(transformedData));
      console.log("Import completed successfully");
    } catch (error) {
      console.error("Failed to restore portfolio import:", error);
      if (error instanceof Error) {
        console.error("Error stack:", error.stack);
      }
      throw error;
    }
  }

  /**
   * Extract unique assets from positions
   */
  private extractUniqueAssets(positions: Position[]): Asset[] {
    const uniqueAssets = new Map<string, Asset>();
    positions.forEach(position => {
      if (!uniqueAssets.has(position.asset.ticker)) {
        uniqueAssets.set(position.asset.ticker, position.asset);
      }
    });
    return Array.from(uniqueAssets.values());
  }

  /**
   * Extract orders from positions
   */
  private extractOrders(positions: Position[]): Order[] {
    return positions.flatMap(position => position.positionDetails.orders);
  }

  /**
   * Decompress JSON data
   */
  private decompress(jsonData: string): string {
    try {
      // First try to parse as base64
      try {
        return atob(jsonData);
      } catch {
        // If not base64, return as is
        return jsonData;
      }
    } catch (error) {
      console.error("Failed to decompress data:", error);
      throw error;
    }
  }

  /**
   * Compress JSON data
   */
  private compress(jsonData: string): string {
    // For now, just base64 encode the data
    return btoa(jsonData);
  }
}

// Export a singleton instance
export const backupService = new BackupService();
