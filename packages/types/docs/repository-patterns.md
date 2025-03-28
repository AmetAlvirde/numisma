# Numisma Repository Patterns Guide

## Overview

This guide outlines the repository patterns used in the Numisma database layer. It provides examples, best practices, and guidance for both human developers and AI models working with the codebase.

## Core Concepts

### 1. Repository Factory

```typescript
// Example of repository factory pattern
export class RepositoryFactory {
  private static instance: RepositoryFactory;
  private prisma: PrismaClient;

  private constructor() {
    this.prisma = new PrismaClient();
  }

  static getInstance(): RepositoryFactory {
    if (!RepositoryFactory.instance) {
      RepositoryFactory.instance = new RepositoryFactory();
    }
    return RepositoryFactory.instance;
  }

  // @ai-guidance: Repository factory should:
  // 1. Implement singleton pattern
  // 2. Share Prisma client instance
  // 3. Provide type-safe repository creation
  // 4. Handle initialization errors

  createAssetRepository(): AssetRepository {
    return new AssetRepository(this.prisma);
  }

  createMarketRepository(): MarketRepository {
    return new MarketRepository(this.prisma);
  }

  // ... other repository creation methods
}
```

### 2. Base Repository

```typescript
// Example of base repository implementation
abstract class BaseRepository<T> {
  constructor(protected prisma: PrismaClient) {}

  // Common CRUD operations
  async findById(id: string): Promise<OperationResult<T>> {
    try {
      const item = await this.prisma[this.modelName].findUnique({
        where: { id },
      });

      if (!item) {
        return {
          success: false,
          error: `${this.modelName} with ID ${id} not found`,
        };
      }

      return {
        success: true,
        data: this.mapToDomainModel(item),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }

  // @ai-guidance: Base repository should:
  // 1. Provide common CRUD operations
  // 2. Handle errors consistently
  // 3. Map database models to domain models
  // 4. Support pagination and filtering

  protected abstract get modelName(): string;
  protected abstract mapToDomainModel(data: any): T;
}
```

### 3. Query Building

```typescript
// Example of query building utility
class QueryBuilder {
  static buildWhereClause(filters?: FilterParams[]): Record<string, any> {
    if (!filters) return {};

    return filters.reduce(
      (acc, filter) => {
        if (!isFilterParams(filter)) return acc;

        const { field, operator, value } = filter;

        // @ai-guidance: Query building should:
        // 1. Validate operator types
        // 2. Handle special cases (null, undefined)
        // 3. Support complex queries
        // 4. Consider performance implications

        switch (operator) {
          case "eq":
            acc[field] = value;
            break;
          case "gt":
            acc[field] = { gt: value };
            break;
          // ... other operators
        }
        return acc;
      },
      {} as Record<string, any>
    );
  }

  static buildPaginationParams(pagination?: PaginationParams) {
    if (!pagination || !isPaginationParams(pagination)) {
      return { skip: 0, take: 10 };
    }

    return {
      skip: (pagination.page - 1) * pagination.limit,
      take: pagination.limit,
    };
  }
}
```

## Repository Implementation Examples

### 1. Asset Repository

```typescript
// Example of asset repository implementation
class AssetRepository extends BaseRepository<Asset> {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  protected get modelName(): string {
    return "asset";
  }

  protected mapToDomainModel(data: any): Asset {
    return {
      id: data.id,
      name: data.name,
      ticker: data.ticker,
      assetType: data.assetType as AssetType,
      locationType: data.locationType as AssetLocationType,
      wallet: data.wallet || "",
    };
  }

  // @ai-guidance: Asset repository should:
  // 1. Handle asset-specific operations
  // 2. Validate asset data
  // 3. Support market relationships
  // 4. Handle asset metadata

  async findByTicker(ticker: string): Promise<OperationResult<Asset>> {
    try {
      const asset = await this.prisma.asset.findFirst({
        where: { ticker },
      });

      if (!asset) {
        return {
          success: false,
          error: `Asset with ticker ${ticker} not found`,
        };
      }

      return {
        success: true,
        data: this.mapToDomainModel(asset),
      };
    } catch (error) {
      return {
        success: false,
        error: handleDatabaseError(error).message,
      };
    }
  }
}
```

### 2. Market Repository

```typescript
// Example of market repository implementation
class MarketRepository extends BaseRepository<Market> {
  constructor(prisma: PrismaClient) {
    super(prisma);
  }

  protected get modelName(): string {
    return "market";
  }

  protected mapToDomainModel(data: any): Market {
    return {
      id: data.id,
      baseAsset: this.mapToAssetModel(data.baseAsset),
      quoteAsset: this.mapToAssetModel(data.quoteAsset),
      pairNotation: data.pairNotation,
      exchange: data.exchange || undefined,
      isTradable: data.isTradable,
    };
  }

  // @ai-guidance: Market repository should:
  // 1. Handle market-specific operations
  // 2. Validate market data
  // 3. Support asset relationships
  // 4. Handle exchange-specific logic

  private mapToAssetModel(data: any): Asset {
    return {
      id: data.id,
      name: data.name,
      ticker: data.ticker,
      assetType: data.assetType as AssetType,
      locationType: data.locationType as AssetLocationType,
      wallet: data.wallet || "",
    };
  }

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
          error: `Market with symbol ${marketSymbol}${
            exchange ? ` and exchange ${exchange}` : ""
          } not found`,
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
}
```

## Best Practices

### 1. Error Handling

```typescript
// Example of comprehensive error handling
function handleDatabaseError(error: unknown): OperationResult<never> {
  // @ai-guidance: Error handling should:
  // 1. Categorize different types of errors
  // 2. Provide meaningful error messages
  // 3. Include relevant metadata
  // 4. Handle edge cases

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case "P2002":
        return {
          success: false,
          error: "Unique constraint violation",
          metadata: {
            code: error.code,
            field: error.meta?.target as string[],
          },
        };
      case "P2025":
        return {
          success: false,
          error: "Record not found",
          metadata: {
            code: error.code,
          },
        };
      // ... other error codes
    }
  }

  return {
    success: false,
    error: "An unexpected error occurred",
    metadata: {
      originalError: error,
    },
  };
}
```

### 2. Validation

```typescript
// Example of repository validation
class RepositoryValidator {
  // @ai-guidance: Repository validation should:
  // 1. Validate input data
  // 2. Check business rules
  // 3. Validate relationships
  // 4. Handle edge cases

  static validateAsset(data: unknown): OperationResult<Asset> {
    if (!isAsset(data)) {
      return {
        success: false,
        error: "Invalid asset data",
        metadata: {
          validationErrors: ["Asset structure is invalid"],
        },
      };
    }

    // Business rule validation
    if (!data.name || !data.ticker) {
      return {
        success: false,
        error: "Name and ticker are required",
        metadata: {
          validationErrors: ["Missing required fields"],
        },
      };
    }

    return {
      success: true,
      data,
    };
  }
}
```

### 3. Query Optimization

```typescript
// Example of query optimization
class QueryOptimizer {
  // @ai-guidance: Query optimization should:
  // 1. Use appropriate indexes
  // 2. Limit result sets
  // 3. Use efficient operators
  // 4. Consider caching

  static optimizeQuery(query: QueryParams): QueryParams {
    return {
      ...query,
      pagination: {
        ...query.pagination,
        limit: Math.min(query.pagination?.limit || 10, 100),
      },
      filters: query.filters?.filter(f => f.value !== undefined),
    };
  }
}
```

## Implementation Guidelines

1. **Repository Structure**

   - Follow consistent naming conventions
   - Use proper inheritance
   - Implement required interfaces
   - Document public methods

2. **Error Handling**

   - Use OperationResult consistently
   - Provide meaningful error messages
   - Include relevant metadata
   - Handle edge cases

3. **Validation**

   - Validate input data
   - Check business rules
   - Validate relationships
   - Handle edge cases

4. **Performance**

   - Use appropriate indexes
   - Limit result sets
   - Use efficient operators
   - Consider caching

5. **Testing**
   - Write unit tests
   - Test error cases
   - Test edge cases
   - Test performance

## Next Steps

1. **Documentation**

   - Keep documentation up to date
   - Add more examples
   - Document new features

2. **Testing**

   - Add unit tests
   - Test error handling
   - Test edge cases
   - Test performance

3. **Performance**

   - Monitor query performance
   - Optimize indexes
   - Implement caching
   - Profile operations

4. **Tooling**
   - Add IDE support
   - Create development tools
   - Improve debugging support
