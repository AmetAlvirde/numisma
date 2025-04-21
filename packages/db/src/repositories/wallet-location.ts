/**
 * Wallet Location repository implementation
 */

import {
  PrismaClient,
  WalletLocation as PrismaWalletLocation,
  AssetLocationType as PrismaAssetLocationType,
} from "../../generated/client";
import { WalletLocation, AssetLocationType } from "@numisma/types";
import {
  // walletLocationSchema,
  createWalletLocationSchema,
  updateWalletLocationSchema,
} from "../schema/wallet-location";
import { handleDatabaseError } from "../utils";

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
  async findByType(
    locationType: AssetLocationType,
    userId: string
  ): Promise<WalletLocation[]> {
    try {
      const walletLocations = await this.prisma.walletLocation.findMany({
        where: {
          locationType: this.mapLocationTypeToPrisma(locationType),
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
  async create(
    walletLocation: Omit<WalletLocation, "id">
  ): Promise<WalletLocation> {
    // Validate with Zod schema
    createWalletLocationSchema.parse(walletLocation);

    try {
      const createdWalletLocation = await this.prisma.walletLocation.create({
        data: {
          name: walletLocation.name,
          locationType: this.mapLocationTypeToPrisma(
            walletLocation.locationType
          ),
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
  async update(
    id: string,
    data: Partial<Omit<WalletLocation, "id">>
  ): Promise<WalletLocation> {
    // Validate with Zod schema
    updateWalletLocationSchema.parse(data);

    try {
      // Convert the locationType if it exists
      const prismaData: any = { ...data };
      if (data.locationType) {
        prismaData.locationType = this.mapLocationTypeToPrisma(
          data.locationType
        );
      }

      const updatedWalletLocation = await this.prisma.walletLocation.update({
        where: { id },
        data: prismaData,
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
  private mapToDomainModel(
    walletLocation: PrismaWalletLocation
  ): WalletLocation {
    return {
      id: walletLocation.id,
      name: walletLocation.name,
      locationType: this.mapLocationTypeToDomain(walletLocation.locationType),
      exchangeName: walletLocation.exchangeName || undefined,
      accountType: walletLocation.accountType || undefined,
      storageType: walletLocation.storageType || undefined,
      storageName: walletLocation.storageName || undefined,
      userId: walletLocation.userId,
    };
  }

  /**
   * Map the domain AssetLocationType enum to Prisma enum
   */
  private mapLocationTypeToPrisma(
    locationType: AssetLocationType
  ): PrismaAssetLocationType {
    const mapping: Record<AssetLocationType, PrismaAssetLocationType> = {
      [AssetLocationType.EXCHANGE]: "exchange",
      [AssetLocationType.DEX]: "dex",
      [AssetLocationType.COLD_STORAGE]: "cold_storage",
      [AssetLocationType.DEFI]: "defi",
      [AssetLocationType.STAKING]: "staking",
      [AssetLocationType.LENDING]: "lending",
    };
    return mapping[locationType];
  }

  /**
   * Map the Prisma AssetLocationType enum to domain enum
   */
  private mapLocationTypeToDomain(
    locationType: PrismaAssetLocationType
  ): AssetLocationType {
    const mapping: Record<PrismaAssetLocationType, AssetLocationType> = {
      exchange: AssetLocationType.EXCHANGE,
      dex: AssetLocationType.DEX,
      cold_storage: AssetLocationType.COLD_STORAGE,
      defi: AssetLocationType.DEFI,
      staking: AssetLocationType.STAKING,
      lending: AssetLocationType.LENDING,
    };
    return mapping[locationType];
  }
}
