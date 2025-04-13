/**
 * Asset repository implementation
 */

import { PrismaClient, Asset as PrismaAsset } from "@prisma/client";
import {
  Asset,
  AssetType,
  AssetLocationType,
  OperationResult,
  PaginationParams,
  PaginatedResult,
  FilterParams,
  QueryParams,
  isOperationResult,
  isPaginationParams,
  isFilterParams,
  isQueryParams,
} from "@numisma/types";
import { assetSchema } from "../schema/asset";
import { handleDatabaseError } from "../utils";
import { mapAssetToDomain, mapAssetToPrisma } from "../utils/entity-mappers";

export class AssetRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find an asset by its ID
   */
  async findById(id: string): Promise<OperationResult<Asset>> {
    try {
      const asset = await this.prisma.asset.findUnique({
        where: { id },
      });

      if (!asset) {
        return {
          success: false,
          error: `Asset with ID ${id} not found`,
        };
      }

      return {
        success: true,
        data: mapAssetToDomain(asset),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Find assets by ticker
   */
  async findByTicker(ticker: string): Promise<OperationResult<Asset[]>> {
    try {
      const assets = await this.prisma.asset.findMany({
        where: { ticker },
      });

      return {
        success: true,
        data: assets.map(asset => mapAssetToDomain(asset)),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Create a new asset
   */
  async create(asset: Omit<Asset, "id">): Promise<OperationResult<Asset>> {
    try {
      // Validate with Zod schema
      const validationResult = assetSchema.safeParse(asset);
      if (!validationResult.success) {
        return {
          success: false,
          error: "Invalid asset data",
          metadata: { validationErrors: validationResult.error.errors },
        };
      }

      // Convert to Prisma model using mapper
      const prismaData = mapAssetToPrisma(asset);
      const createdAsset = await this.prisma.asset.create({
        data: prismaData,
      });

      return {
        success: true,
        data: mapAssetToDomain(createdAsset),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Update an existing asset
   */
  async update(
    id: string,
    data: Partial<Omit<Asset, "id">>
  ): Promise<OperationResult<Asset>> {
    try {
      // Validate with Zod schema
      const validationResult = assetSchema.safeParse(data);
      if (!validationResult.success) {
        return {
          success: false,
          error: "Invalid asset data",
          metadata: { validationErrors: validationResult.error.errors },
        };
      }

      const updatedAsset = await this.prisma.asset.update({
        where: { id },
        data,
      });

      return {
        success: true,
        data: mapAssetToDomain(updatedAsset),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Delete an asset
   */
  async delete(id: string): Promise<OperationResult<void>> {
    try {
      await this.prisma.asset.delete({
        where: { id },
      });

      return {
        success: true,
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * List all assets with optional filtering and pagination
   */
  async findMany(
    params: QueryParams
  ): Promise<OperationResult<PaginatedResult<Asset>>> {
    try {
      if (!isQueryParams(params)) {
        return {
          success: false,
          error: "Invalid query parameters",
        };
      }

      const { filters, pagination } = params;
      const where = this.buildWhereClause(filters);
      const { skip, take } = this.buildPaginationParams(pagination);

      const [assets, total] = await Promise.all([
        this.prisma.asset.findMany({
          where,
          skip,
          take,
          orderBy: pagination?.sortBy
            ? {
                [pagination.sortBy]: pagination.sortOrder || "asc",
              }
            : undefined,
        }),
        this.prisma.asset.count({ where }),
      ]);

      return {
        success: true,
        data: {
          items: assets.map(asset => mapAssetToDomain(asset)),
          total,
          page: pagination?.page || 1,
          limit: pagination?.limit || 10,
          totalPages: Math.ceil(total / (pagination?.limit || 10)),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Build where clause from filter parameters
   */
  private buildWhereClause(filters?: FilterParams[]) {
    if (!filters) return {};

    return filters.reduce(
      (acc, filter) => {
        if (!isFilterParams(filter)) return acc;

        const { field, operator, value } = filter;
        switch (operator) {
          case "eq":
            acc[field] = value;
            break;
          case "neq":
            acc[field] = { not: value };
            break;
          case "gt":
            acc[field] = { gt: value };
            break;
          case "gte":
            acc[field] = { gte: value };
            break;
          case "lt":
            acc[field] = { lt: value };
            break;
          case "lte":
            acc[field] = { lte: value };
            break;
          case "contains":
            acc[field] = { contains: value };
            break;
          case "startsWith":
            acc[field] = { startsWith: value };
            break;
          case "endsWith":
            acc[field] = { endsWith: value };
            break;
          case "in":
            acc[field] = { in: value };
            break;
          case "nin":
            acc[field] = { notIn: value };
            break;
        }
        return acc;
      },
      {} as Record<string, any>
    );
  }

  /**
   * Build pagination parameters
   */
  private buildPaginationParams(pagination?: PaginationParams) {
    if (!pagination || !isPaginationParams(pagination)) {
      return { skip: 0, take: 10 };
    }

    const { page, limit } = pagination;
    return {
      skip: (page - 1) * limit,
      take: limit,
    };
  }
}
