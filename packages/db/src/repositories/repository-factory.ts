/**
 * Repository factory for dependency injection
 *
 * This file provides a factory for creating repositories with a shared
 * Prisma client instance, making it easier to manage dependencies and
 * enabling more testable code.
 */

import { PrismaClient } from "../../generated/client";
import { prisma as defaultPrisma } from "../prisma";

// Import repositories
import { AssetRepository } from "./asset";
import { MarketRepository } from "./market";
import { PortfolioRepository } from "./portfolio";
import { PositionRepository } from "./position";
import { WalletLocationRepository } from "./wallet-location";

/**
 * Repository factory that creates repository instances with a shared Prisma client
 */
export class RepositoryFactory {
  private prisma: PrismaClient;

  /**
   * Create a new repository factory
   *
   * @param prisma Optional Prisma client instance (useful for testing with mocks)
   */
  constructor(prisma: PrismaClient = defaultPrisma) {
    this.prisma = prisma;
  }

  /**
   * Create an asset repository
   */
  createAssetRepository(): AssetRepository {
    return new AssetRepository(this.prisma);
  }

  /**
   * Create a market repository
   */
  createMarketRepository(): MarketRepository {
    return new MarketRepository(this.prisma);
  }

  /**
   * Create a portfolio repository
   */
  createPortfolioRepository(): PortfolioRepository {
    return new PortfolioRepository(this.prisma);
  }

  /**
   * Create a position repository
   */
  createPositionRepository(): PositionRepository {
    return new PositionRepository(this.prisma);
  }

  /**
   * Create a wallet location repository
   */
  createWalletLocationRepository(): WalletLocationRepository {
    return new WalletLocationRepository(this.prisma);
  }

  // Additional repository factory methods can be added here
}
