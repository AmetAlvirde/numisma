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
  historicalValuations: Array<any>; // We'll ignore this for now
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
   * Restore data from a backup
   */
  async restoreBackup(backupData: string): Promise<void> {
    try {
      let parsedData: any;

      // Try to parse as raw JSON first
      try {
        parsedData = JSON.parse(backupData);
      } catch (e) {
        // If that fails, try to decompress
        const jsonData = this.decompress(backupData);
        parsedData = JSON.parse(jsonData);
      }

      // Check if this is a portfolio import format
      if (this.isPortfolioImportFormat(parsedData)) {
        await this.restorePortfolioImport(parsedData);
        return;
      }

      // Otherwise, treat as a backup format
      const backup = parsedData as BackupData;
      this.validateBackup(backup);
      await statePersistence.importUserData(JSON.stringify(backup.data));
    } catch (error) {
      console.error("Failed to restore backup:", error);
      throw error;
    }
  }

  /**
   * Check if the data is in portfolio import format
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
   * Restore data from portfolio import format
   */
  private async restorePortfolioImport(
    data: PortfolioImportData
  ): Promise<void> {
    // Transform the data into the expected format
    const transformedData = {
      portfolios: [data.portfolio],
      positions: data.positions,
      assets: this.extractUniqueAssets(data.positions),
      orders: this.extractOrders(data.positions),
    };

    await statePersistence.importUserData(JSON.stringify(transformedData));
  }

  /**
   * Extract unique assets from positions
   */
  private extractUniqueAssets(positions: Position[]): Asset[] {
    const assetMap = new Map<string, Asset>();
    positions.forEach(position => {
      if (!assetMap.has(position.asset.ticker)) {
        assetMap.set(position.asset.ticker, position.asset);
      }
    });
    return Array.from(assetMap.values());
  }

  /**
   * Extract orders from positions
   */
  private extractOrders(positions: Position[]): Order[] {
    return positions.flatMap(position =>
      position.positionDetails.orders.map(order => ({
        ...order,
        positionId: position.id,
      }))
    );
  }

  /**
   * Validate backup data
   */
  private validateBackup(backup: BackupData): void {
    // Check version compatibility
    if (backup.metadata.version !== BackupService.CURRENT_VERSION) {
      throw new Error(
        `Incompatible backup version: ${backup.metadata.version}. Expected: ${BackupService.CURRENT_VERSION}`
      );
    }

    if (backup.metadata.dataVersion !== BackupService.DATA_VERSION) {
      throw new Error(
        `Incompatible data version: ${backup.metadata.dataVersion}. Expected: ${BackupService.DATA_VERSION}`
      );
    }

    // Validate data counts
    if (backup.data.portfolios.length !== backup.metadata.portfolioCount) {
      throw new Error("Portfolio count mismatch");
    }
    if (backup.data.positions.length !== backup.metadata.positionCount) {
      throw new Error("Position count mismatch");
    }
    if (backup.data.assets.length !== backup.metadata.assetCount) {
      throw new Error("Asset count mismatch");
    }
    if (backup.data.orders.length !== backup.metadata.orderCount) {
      throw new Error("Order count mismatch");
    }

    // Validate data integrity
    this.validateDataIntegrity(backup.data);
  }

  /**
   * Validate data integrity
   */
  private validateDataIntegrity(data: BackupData["data"]): void {
    // Check portfolio references
    const portfolioIds = new Set(data.portfolios.map(p => p.id));
    for (const position of data.positions) {
      if (!portfolioIds.has(position.portfolio)) {
        throw new Error(
          `Invalid portfolio reference in position: ${position.id}`
        );
      }
    }

    // Check position references
    const positionIds = new Set(data.positions.map(p => p.id));
    for (const order of data.orders) {
      if (!positionIds.has(order.positionId)) {
        throw new Error(`Invalid position reference in order: ${order.id}`);
      }
    }

    // Check asset references
    const assetTickers = new Set(data.assets.map(a => a.ticker));
    for (const position of data.positions) {
      if (!assetTickers.has(position.asset.ticker)) {
        throw new Error(`Invalid asset reference in position: ${position.id}`);
      }
    }
  }

  /**
   * Compress data using base64 encoding with Unicode support
   */
  private compress(data: string): string {
    try {
      // Convert string to UTF-8 bytes
      const bytes = new TextEncoder().encode(data);
      // Convert bytes to base64
      return btoa(String.fromCharCode(...bytes));
    } catch (error) {
      console.error("Compression failed:", error);
      throw new Error("Failed to compress backup data");
    }
  }

  /**
   * Decompress data using base64 decoding with Unicode support
   */
  private decompress(data: string): string {
    try {
      // First try to decode as regular base64
      try {
        return atob(data);
      } catch (e) {
        // If that fails, try the Unicode-aware approach
        const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
        return new TextDecoder().decode(bytes);
      }
    } catch (error) {
      console.error("Decompression failed:", error);
      throw new Error("Failed to decompress backup data");
    }
  }

  /**
   * Get backup metadata without restoring
   */
  async getBackupMetadata(backupData: string): Promise<BackupMetadata> {
    try {
      // First try to parse as raw JSON
      const parsedData = JSON.parse(backupData);

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
          orderCount: parsedData.positions.reduce(
            (count, pos) => count + pos.positionDetails.orders.length,
            0
          ),
        };
      }

      // Otherwise, treat as a backup format
      const backup = parsedData as BackupData;
      return backup.metadata;
    } catch (error) {
      console.error("Failed to get backup metadata:", error);
      throw new Error("Invalid backup file format");
    }
  }
}

// Export a singleton instance
export const backupService = new BackupService();
