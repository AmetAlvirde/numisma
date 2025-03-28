/**
 * Market repository implementation
 */

import { PrismaClient, Market as PrismaMarket } from "@prisma/client";
import {
  Market,
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
import { marketSchema } from "../schema/market";
import { handleDatabaseError } from "../utils";

export class MarketRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Find a market by its ID
   */
  async findById(id: string): Promise<OperationResult<Market>> {
    try {
      const market = await this.prisma.market.findUnique({
        where: { id },
        include: {
          baseAsset: true,
          quoteAsset: true,
        },
      });

      if (!market) {
        return {
          success: false,
          error: `Market with ID ${id} not found`,
        };
      }

      return {
        success: true,
        data: this.mapToDomainModel(market),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Find a market by symbol and exchange
   */
  async findBySymbolAndExchange(
    marketSymbol: string,
    exchange?: string
  ): Promise<OperationResult<Market>> {
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

      if (!market) {
        return {
          success: false,
          error: `Market with symbol ${marketSymbol}${exchange ? ` and exchange ${exchange}` : ""} not found`,
        };
      }

      return {
        success: true,
        data: this.mapToDomainModel(market),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Create a new market
   */
  async create(
    market: Omit<Market, "id" | "baseAsset" | "quoteAsset"> & {
      baseAssetId: string;
      quoteAssetId: string;
    }
  ): Promise<OperationResult<Market>> {
    try {
      // Validate with Zod schema
      const validationResult = marketSchema.safeParse({
        ...market,
        baseAsset: { id: market.baseAssetId },
        quoteAsset: { id: market.quoteAssetId },
      });
      if (!validationResult.success) {
        return {
          success: false,
          error: "Invalid market data",
          metadata: { validationErrors: validationResult.error.errors },
        };
      }

      const createdMarket = await this.prisma.market.create({
        data: {
          baseAssetId: market.baseAssetId,
          quoteAssetId: market.quoteAssetId,
          marketSymbol: market.pairNotation.replace("/", ""),
          pairNotation: market.pairNotation,
          exchange: market.exchange,
          isTradable: market.isTradable ?? true,
        },
        include: {
          baseAsset: true,
          quoteAsset: true,
        },
      });

      return {
        success: true,
        data: this.mapToDomainModel(createdMarket),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * Update an existing market
   */
  async update(
    id: string,
    data: Partial<
      Omit<Market, "id" | "baseAsset" | "quoteAsset"> & {
        baseAssetId?: string;
        quoteAssetId?: string;
      }
    >
  ): Promise<OperationResult<Market>> {
    try {
      // Validate with Zod schema
      const validationResult = marketSchema.safeParse({
        ...data,
        baseAsset: data.baseAssetId ? { id: data.baseAssetId } : undefined,
        quoteAsset: data.quoteAssetId ? { id: data.quoteAssetId } : undefined,
      });
      if (!validationResult.success) {
        return {
          success: false,
          error: "Invalid market data",
          metadata: { validationErrors: validationResult.error.errors },
        };
      }

      const updatedMarket = await this.prisma.market.update({
        where: { id },
        data: {
          ...data,
          marketSymbol: data.pairNotation
            ? data.pairNotation.replace("/", "")
            : undefined,
        },
        include: {
          baseAsset: true,
          quoteAsset: true,
        },
      });

      return {
        success: true,
        data: this.mapToDomainModel(updatedMarket),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  /**
   * List markets with optional filtering and pagination
   */
  async findMany(
    params: QueryParams
  ): Promise<OperationResult<PaginatedResult<Market>>> {
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

      const [markets, total] = await Promise.all([
        this.prisma.market.findMany({
          where,
          include: {
            baseAsset: true,
            quoteAsset: true,
          },
          skip,
          take,
          orderBy: pagination?.sortBy
            ? {
                [pagination.sortBy]: pagination.sortOrder || "asc",
              }
            : {
                pairNotation: "asc",
              },
        }),
        this.prisma.market.count({ where }),
      ]);

      return {
        success: true,
        data: {
          items: markets.map(this.mapToDomainModel),
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
   * Map a Prisma market to the domain model
   */
  private mapToDomainModel(
    market: PrismaMarket & {
      baseAsset: {
        id: string;
        name: string;
        ticker: string;
        assetType: string;
        description: string | null;
      };
      quoteAsset: {
        id: string;
        name: string;
        ticker: string;
        assetType: string;
        description: string | null;
      };
    }
  ): Market {
    return {
      id: market.id,
      baseAsset: this.mapToAssetModel(market.baseAsset),
      quoteAsset: this.mapToAssetModel(market.quoteAsset),
      pairNotation: market.pairNotation,
      exchange: market.exchange || undefined,
      isTradable: market.isTradable,
    };
  }

  /**
   * Map a Prisma asset to the domain model
   */
  private mapToAssetModel(asset: {
    id: string;
    name: string;
    ticker: string;
    assetType: string;
    description: string | null;
  }): Asset {
    return {
      id: asset.id,
      name: asset.name,
      ticker: asset.ticker,
      assetType: asset.assetType as AssetType,
      description: asset.description || undefined,
      locationType: AssetLocationType.EXCHANGE, // Default to EXCHANGE as per schema
      wallet: "", // Empty string as default since it's required in the Asset type
    };
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
