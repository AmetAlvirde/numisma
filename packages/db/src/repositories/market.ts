/**
 * Market repository implementation
 */

import { PrismaClient, Market as PrismaMarket } from '@prisma/client';
import { Market } from '@numisma/types';
import { marketSchema } from '../schema/market';
import { handleDatabaseError } from '../utils';

export class MarketRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find a market by its ID
   */
  async findById(id: string): Promise<Market | null> {
    try {
      const market = await this.prisma.market.findUnique({
        where: { id },
        include: {
          baseAsset: true,
          quoteAsset: true,
        },
      });
      
      return market ? this.mapToDomainModel(market) : null;
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Find a market by symbol and exchange
   */
  async findBySymbolAndExchange(marketSymbol: string, exchange?: string): Promise<Market | null> {
    try {
      const market = await this.prisma.market.findFirst({
        where: {
          marketSymbol,
          exchange: exchange || null,
        },
        include: {
          baseAsset: true,
          quoteAsset: true,
        },
      });
      
      return market ? this.mapToDomainModel(market) : null;
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Create a new market
   */
  async create(market: Omit<Market, 'id' | 'baseAsset' | 'quoteAsset'> & { 
    baseAssetId: string;
    quoteAssetId: string;
  }): Promise<Market> {
    // Validate with Zod schema
    marketSchema.omit({ 
      id: true, 
      baseAsset: true, 
      quoteAsset: true 
    }).extend({
      baseAssetId: marketSchema.shape.baseAssetId,
      quoteAssetId: marketSchema.shape.quoteAssetId,
    }).parse(market);
    
    try {
      const createdMarket = await this.prisma.market.create({
        data: {
          baseAssetId: market.baseAssetId,
          quoteAssetId: market.quoteAssetId,
          marketSymbol: market.marketSymbol,
          pairNotation: market.pairNotation,
          exchange: market.exchange,
          isTradable: market.isTradable ?? true,
        },
        include: {
          baseAsset: true,
          quoteAsset: true,
        },
      });
      
      return this.mapToDomainModel(createdMarket);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Update an existing market
   */
  async update(id: string, data: Partial<Omit<Market, 'id' | 'baseAsset' | 'quoteAsset'> & {
    baseAssetId?: string;
    quoteAssetId?: string;
  }>): Promise<Market> {
    try {
      const updatedMarket = await this.prisma.market.update({
        where: { id },
        data,
        include: {
          baseAsset: true,
          quoteAsset: true,
        },
      });
      
      return this.mapToDomainModel(updatedMarket);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * List markets with optional filtering and pagination
   */
  async findMany(params: {
    baseAssetId?: string;
    quoteAssetId?: string;
    exchange?: string;
    skip?: number;
    take?: number;
  }): Promise<Market[]> {
    const { baseAssetId, quoteAssetId, exchange, skip, take } = params;
    
    try {
      const markets = await this.prisma.market.findMany({
        where: {
          baseAssetId: baseAssetId,
          quoteAssetId: quoteAssetId,
          exchange: exchange,
        },
        include: {
          baseAsset: true,
          quoteAsset: true,
        },
        skip,
        take,
        orderBy: {
          marketSymbol: 'asc',
        },
      });
      
      return markets.map(this.mapToDomainModel);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Map a Prisma market to the domain model
   */
  private mapToDomainModel(market: PrismaMarket & {
    baseAsset: { id: string; name: string; ticker: string; assetType: string; description: string | null };
    quoteAsset: { id: string; name: string; ticker: string; assetType: string; description: string | null };
  }): Market {
    return {
      id: market.id,
      baseAsset: {
        id: market.baseAsset.id,
        name: market.baseAsset.name,
        ticker: market.baseAsset.ticker,
        assetType: market.baseAsset.assetType,
        description: market.baseAsset.description || undefined,
      },
      quoteAsset: {
        id: market.quoteAsset.id,
        name: market.quoteAsset.name,
        ticker: market.quoteAsset.ticker,
        assetType: market.quoteAsset.assetType,
        description: market.quoteAsset.description || undefined,
      },
      marketSymbol: market.marketSymbol,
      pairNotation: market.pairNotation,
      exchange: market.exchange || undefined,
      isTradable: market.isTradable,
    };
  }
}
