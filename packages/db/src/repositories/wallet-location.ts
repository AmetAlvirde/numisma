/**
 * Wallet Location repository implementation
 */

import { PrismaClient, WalletLocation as PrismaWalletLocation } from '@prisma/client';
import { WalletLocation } from '@numisma/types';
import { walletLocationSchema } from '../schema/wallet-location';
import { handleDatabaseError } from '../utils';

export class WalletLocationRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find a wallet location by its ID
   */
  async findById(id: string): Promise<WalletLocation | null> {
    try {
      const walletLocation = await this.prisma.walletLocation.findUnique({
        where: { id },
      });
      
      return walletLocation ? this.mapToDomainModel(walletLocation) : null;
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Find wallet locations by user ID
   */
  async findByUserId(userId: string): Promise<WalletLocation[]> {
    try {
      const walletLocations = await this.prisma.walletLocation.findMany({
        where: { userId },
      });
      
      return walletLocations.map(this.mapToDomainModel);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Find wallet locations by type
   */
  async findByType(locationType: string, userId: string): Promise<WalletLocation[]> {
    try {
      const walletLocations = await this.prisma.walletLocation.findMany({
        where: { 
          locationType,
          userId,
        },
      });
      
      return walletLocations.map(this.mapToDomainModel);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Create a new wallet location
   */
  async create(walletLocation: Omit<WalletLocation, 'id'>): Promise<WalletLocation> {
    // Validate with Zod schema
    walletLocationSchema.omit({ id: true }).parse(walletLocation);
    
    try {
      const createdWalletLocation = await this.prisma.walletLocation.create({
        data: {
          name: walletLocation.name,
          locationType: walletLocation.locationType,
          exchangeName: walletLocation.exchangeName,
          accountType: walletLocation.accountType,
          storageType: walletLocation.storageType,
          storageName: walletLocation.storageName,
          userId: walletLocation.userId,
        },
      });
      
      return this.mapToDomainModel(createdWalletLocation);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Update an existing wallet location
   */
  async update(id: string, data: Partial<Omit<WalletLocation, 'id'>>): Promise<WalletLocation> {
    // Validate with Zod schema
    walletLocationSchema.partial().omit({ id: true }).parse(data);
    
    try {
      const updatedWalletLocation = await this.prisma.walletLocation.update({
        where: { id },
        data,
      });
      
      return this.mapToDomainModel(updatedWalletLocation);
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Delete a wallet location
   */
  async delete(id: string): Promise<void> {
    try {
      await this.prisma.walletLocation.delete({
        where: { id },
      });
    } catch (error) {
      throw handleDatabaseError(error);
    }
  }

  /**
   * Map a Prisma wallet location to the domain model
   */
  private mapToDomainModel(walletLocation: PrismaWalletLocation): WalletLocation {
    return {
      id: walletLocation.id,
      name: walletLocation.name,
      locationType: walletLocation.locationType,
      exchangeName: walletLocation.exchangeName || undefined,
      accountType: walletLocation.accountType || undefined,
      storageType: walletLocation.storageType || undefined,
      storageName: walletLocation.storageName || undefined,
      userId: walletLocation.userId,
    };
  }
}
