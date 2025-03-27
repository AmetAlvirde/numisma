/**
 * Asset repository implementation
 */

import { PrismaClient, Asset as PrismaAsset } from '@prisma/client';
import { Asset } from '@numisma/types';
import { assetSchema } from '../schema/asset';
import { handleDatabaseError } from '../utils';

export class AssetRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find an asset by its ID
   */
  async findById(id: string): Promise<Asset | null> {
    try {
      const asset = await this.prisma.asset.findUnique({
        where: { id },
      });
      
      return asset ? this.mapToDomainModel(asset) : null;
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Find assets by ticker
   */
  async findByTicker(ticker: string): Promise<Asset[]> {
    try {
      const assets = await this.prisma.asset.findMany({
        where: { ticker },
      });
      
      return assets.map(this.mapToDomainModel);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Create a new asset
   */
  async create(asset: Omit<Asset, 'id'>): Promise<Asset> {
    // Validate with Zod schema
    assetSchema.omit({ id: true }).parse(asset);
    
    try {
      const createdAsset = await this.prisma.asset.create({
        data: {
          name: asset.name,
          ticker: asset.ticker,
          assetType: asset.assetType,
          description: asset.description,
        },
      });
      
      return this.mapToDomainModel(createdAsset);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Update an existing asset
   */
  async update(id: string, data: Partial<Omit<Asset, 'id'>>): Promise<Asset> {
    // Validate with Zod schema
    assetSchema.partial().omit({ id: true }).parse(data);
    
    try {
      const updatedAsset = await this.prisma.asset.update({
        where: { id },
        data,
      });
      
      return this.mapToDomainModel(updatedAsset);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Delete an asset
   */
  async delete(id: string): Promise<void> {
    try {
      await this.prisma.asset.delete({
        where: { id },
      });
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * List all assets with optional filtering and pagination
   */
  async findMany(params: {
    assetType?: string;
    skip?: number;
    take?: number;
    orderBy?: { [key: string]: 'asc' | 'desc' };
  }): Promise<Asset[]> {
    const { assetType, skip, take, orderBy } = params;
    
    try {
      const assets = await this.prisma.asset.findMany({
        where: assetType ? { assetType } : undefined,
        skip,
        take,
        orderBy,
      });
      
      return assets.map(this.mapToDomainModel);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Map a Prisma asset to the domain model
   */
  private mapToDomainModel(asset: PrismaAsset): Asset {
    return {
      id: asset.id,
      name: asset.name,
      ticker: asset.ticker,
      assetType: asset.assetType,
      description: asset.description || undefined,
    };
  }
}
