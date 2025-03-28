# Numisma Type System Documentation

## Overview

The Numisma type system provides a comprehensive, type-safe foundation for the application. This documentation covers the core concepts, usage patterns, and best practices for working with the enhanced type system.

## Core Concepts

### 1. Base Types and Enums

The foundation of our type system is built on base types and enums defined in `base.ts`:

```typescript
// Core enums
enum AssetType {
  crypto = "crypto",
  stock = "stock",
  forex = "forex",
  commodity = "commodity",
}

enum AssetLocationType {
  exchange = "exchange",
  dex = "dex",
  coldStorage = "cold_storage",
  defi = "defi",
  staking = "staking",
  lending = "lending",
}

// Date handling
enum DateStatus {
  genesis = "genesis",
  actual = "actual",
  estimated = "estimated",
  unknown = "unknown",
}

// Position management
enum PositionLifecycle {
  planned = "planned",
  active = "active",
  closed = "closed",
}

enum CapitalTier {
  C1 = "C1",
  C2 = "C2",
  C3 = "C3",
}

// Order management
enum OrderStatus {
  submitted = "submitted",
  filled = "filled",
  cancelled = "cancelled",
  partiallyFilled = "partially_filled",
  expired = "expired",
}

enum OrderType {
  trigger = "trigger",
  market = "market",
  limit = "limit",
  trailingStop = "trailing_stop",
  oco = "oco",
}

enum OrderPurpose {
  entry = "entry",
  exit = "exit",
  adjustment = "adjustment",
}

// Trade management
enum TradeSide {
  long = "long",
  short = "short",
}

enum PositionStatus {
  active = "active",
  closed = "closed",
  partial = "partial",
}

enum PreTrackingStatus {
  preTracking = "pre_tracking",
  tracking = "tracking",
}
```

### 2. Relationship Types

The type system provides type-safe relationship handling:

```typescript
// Type-safe foreign key
type ForeignKey<T> = string & { readonly brand: unique symbol };

// Relationship types
type OneToOne<T> = {
  id: ForeignKey<T>;
  data?: T;
};

type OneToMany<T> = {
  ids: ForeignKey<T>[];
  data?: T[];
};

type ManyToMany<T> = {
  items: T[];
  add: (item: T) => void;
  remove: (item: T) => void;
};

// Cascade behavior
enum CascadeBehavior {
  Cascade = "Cascade",
  Restrict = "Restrict",
  SetNull = "SetNull",
  NoAction = "NoAction",
}

// Relationship options
interface RelationOptions {
  onDelete?: CascadeBehavior;
  onUpdate?: CascadeBehavior;
}
```

### 3. Utility Types

Common operations are supported through utility types:

```typescript
// Pagination
interface PaginationParams {
  page: number;
  limit: number;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// Filtering
interface FilterParams {
  field: string;
  operator: string;
  value: any;
}

interface QueryParams {
  filters?: FilterParams[];
  sort?: { field: string; direction: "asc" | "desc" }[];
  pagination?: PaginationParams;
}

// Operation results
interface OperationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface BatchOperationResult<T> {
  success: boolean;
  results: OperationResult<T>[];
  errors?: string[];
}
```

## Usage Examples

### 1. Working with Assets

```typescript
// Creating a new asset
const newAsset: Asset = {
  id: "asset_123",
  name: "Bitcoin",
  ticker: "BTC",
  assetType: AssetType.crypto,
  locationType: AssetLocationType.exchange,
  description: "The first cryptocurrency",
  network: "Bitcoin",
  marketData: {
    currentPrice: 50000,
    priceChangePercentage24h: 2.5,
    marketCap: 1000000000000,
    volume24h: 50000000000,
    lastUpdated: new Date(),
  },
};

// Type guard usage
if (isAsset(newAsset)) {
  // TypeScript knows this is a valid Asset
  console.log(newAsset.ticker);
}
```

### 2. Managing Positions

```typescript
// Creating a new position
const newPosition: Position = {
  id: "pos_123",
  name: "BTC Long",
  riskLevel: 5,
  portfolioId: "portfolio_123" as ForeignKey<Portfolio>,
  walletType: "hot",
  capitalTier: CapitalTier.C1,
  strategy: "trend_following",
  lifecycle: PositionLifecycle.planned,
  thesis: "Strong technical indicators",
  journal: [],
  asset: newAsset,
  positionDetails: {
    side: TradeSide.long,
    status: PositionStatus.active,
    timeFrame: "1D",
    initialInvestment: 10000,
    currentInvestment: 10000,
    dateOpened: new Date(),
    dateOpenedStatus: DateStatus.actual,
  },
  tags: ["crypto", "long"],
  userId: "user_123",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  currentValue: 10500,
  isHidden: false,
  alertsEnabled: true,
  preTrackingStatus: PreTrackingStatus.tracking,
};

// Type guard usage
if (isPosition(newPosition)) {
  // TypeScript knows this is a valid Position
  console.log(newPosition.name);
}
```

### 3. Working with Orders

```typescript
// Creating a new order
const newOrder: Order = {
  id: "order_123",
  positionId: "pos_123" as ForeignKey<Position>,
  dateOpen: new Date(),
  averagePrice: 50000,
  totalCost: 10000,
  status: OrderStatus.submitted,
  type: OrderType.limit,
  purpose: OrderPurpose.entry,
  fee: 0.1,
  feeUnit: "BTC",
  filled: 0.2,
  unit: "BTC",
  trigger: 49000,
  estimatedCost: 9800,
  exchangeOrderId: "binance_123",
  isAutomated: false,
  isHidden: false,
  parentOrderId: null,
  notes: "Initial entry order",
};

// Type guard usage
if (isOrder(newOrder)) {
  // TypeScript knows this is a valid Order
  console.log(newOrder.status);
}
```

## Best Practices

### 1. Type Safety

- Always use type guards when working with external data
- Leverage TypeScript's type inference where possible
- Use strict null checks to handle optional fields properly
- Avoid type assertions unless absolutely necessary

```typescript
// Good
if (isAsset(data)) {
  // TypeScript knows this is safe
  console.log(data.ticker);
}

// Bad
const asset = data as Asset; // Avoid type assertions
```

### 2. Relationship Handling

- Use `ForeignKey<T>` for all relationship IDs
- Leverage relationship types for type-safe operations
- Handle cascade behavior explicitly
- Use type guards for relationship validation

```typescript
// Good
const position: Position = {
  portfolioId: "portfolio_123" as ForeignKey<Portfolio>,
  // ... other fields
};

// Bad
const position: Position = {
  portfolioId: "portfolio_123", // Missing type safety
  // ... other fields
};
```

### 3. Date Handling

- Use `DateStatus` enum for all date fields
- Handle genesis dates appropriately
- Use type guards for date validation
- Consider timezone implications

```typescript
// Good
const position: Position = {
  dateOpened: new Date(),
  dateOpenedStatus: DateStatus.actual,
  // ... other fields
};

// Bad
const position: Position = {
  dateOpened: new Date(), // Missing status
  // ... other fields
};
```

### 4. Error Handling

- Use `OperationResult` and `BatchOperationResult` for all operations
- Handle errors explicitly
- Provide meaningful error messages
- Use type guards for error validation

```typescript
// Good
async function createPosition(
  data: unknown
): Promise<OperationResult<Position>> {
  if (!isPosition(data)) {
    return {
      success: false,
      error: "Invalid position data",
    };
  }

  try {
    // Create position logic
    return {
      success: true,
      data: createdPosition,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}
```

### 5. Performance Considerations

- Use type guards efficiently
- Cache type guard results when appropriate
- Consider performance impact of complex type checks
- Use appropriate data structures for relationships

```typescript
// Good
const cachedGuard = memoize(isAsset);

// Use cached guard
if (cachedGuard(data)) {
  // Type guard result is cached
}
```

## Common Pitfalls

1. **Type Assertions**

   - Avoid using type assertions
   - Use type guards instead
   - Let TypeScript infer types when possible

2. **Optional Fields**

   - Always check for undefined
   - Use nullish coalescing
   - Provide default values when appropriate

3. **Relationship IDs**

   - Always use `ForeignKey<T>`
   - Validate relationship existence
   - Handle cascade behavior

4. **Date Handling**

   - Always include `DateStatus`
   - Handle timezone conversions
   - Consider edge cases

5. **Type Guards**
   - Keep guards simple and efficient
   - Cache results when appropriate
   - Handle all possible cases

## Migration Guide

When migrating existing code to use the new type system:

1. Update imports to use new types
2. Add type guards for external data
3. Update relationship handling
4. Add date status fields
5. Update error handling
6. Add validation layer
7. Update tests

## Testing

When testing code that uses the new type system:

1. Test type guards thoroughly
2. Test relationship handling
3. Test date handling
4. Test error cases
5. Test edge cases
6. Test performance

## Future Considerations

1. **Type System Evolution**

   - Plan for TypeScript version upgrades
   - Consider new type features
   - Maintain backward compatibility

2. **Performance Optimization**

   - Monitor type guard performance
   - Optimize relationship handling
   - Consider caching strategies

3. **Documentation Updates**

   - Keep documentation current
   - Add more examples
   - Document new features

4. **Tooling Support**
   - IDE integration
   - Development tools
   - Debugging support

## Advanced Usage Examples

### 1. Working with Complex Relationships

```typescript
// Example of a position with complex relationships
const position: Position = {
  id: "pos_123",
  name: "BTC Long March 2025",
  portfolioId: "portfolio_123" as ForeignKey<Portfolio>,
  asset: {
    id: "asset_123",
    name: "Bitcoin",
    ticker: "BTC",
    assetType: AssetType.crypto,
    locationType: AssetLocationType.exchange,
    wallet: "hot_wallet_123",
  },
  positionDetails: {
    side: TradeSide.long,
    status: PositionStatus.active,
    timeFrame: "1D",
    initialInvestment: 10000,
    currentInvestment: 10000,
    dateOpened: new Date(),
    dateOpenedStatus: DateStatus.actual,
  },
  // ... other fields
};

// @ai-guidance: When working with complex relationships, always ensure that:
// 1. All required fields are present
// 2. Relationship IDs are properly typed with ForeignKey<T>
// 3. Nested objects follow the same type constraints
// 4. Date fields include proper DateStatus
```

### 2. Batch Operations

```typescript
// Example of batch creating assets
async function createAssets(
  assets: Omit<Asset, "id">[]
): Promise<BatchOperationResult<Asset>> {
  const results: OperationResult<Asset>[] = [];

  for (const asset of assets) {
    try {
      // Validate asset data
      if (!isAsset(asset)) {
        results.push({
          success: false,
          error: "Invalid asset data",
        });
        continue;
      }

      // Create asset in database
      const created = await prisma.asset.create({
        data: asset,
      });

      results.push({
        success: true,
        data: created,
      });
    } catch (error) {
      results.push({
        success: false,
        error: error.message,
      });
    }
  }

  return {
    success: results.every(r => r.success),
    results,
    errors: results.filter(r => !r.success).map(r => r.error as string),
  };
}

// @ai-guidance: Batch operations should:
// 1. Handle each item independently
// 2. Continue processing on individual failures
// 3. Provide detailed error information
// 4. Maintain type safety throughout
```

### 3. Advanced Filtering

```typescript
// Example of complex filtering
const filters: FilterParams[] = [
  {
    field: "assetType",
    operator: "eq",
    value: AssetType.crypto,
  },
  {
    field: "currentValue",
    operator: "gt",
    value: 10000,
  },
  {
    field: "tags",
    operator: "contains",
    value: "long_term",
  },
];

const query: QueryParams = {
  filters,
  pagination: {
    page: 1,
    limit: 10,
  },
  sort: [
    {
      field: "dateCreated",
      direction: "desc",
    },
  ],
};

// @ai-guidance: When implementing filters:
// 1. Use type-safe operators
// 2. Validate filter values against field types
// 3. Consider performance implications
// 4. Handle edge cases (null, undefined)
```

### 4. Validation Best Practices

```typescript
// Example of comprehensive validation
function validatePosition(data: unknown): OperationResult<Position> {
  // Type guard check
  if (!isPosition(data)) {
    return {
      success: false,
      error: "Invalid position data structure",
      metadata: {
        validationErrors: ["Position structure is invalid"],
      },
    };
  }

  // Business rule validation
  if (data.riskLevel < 1 || data.riskLevel > 10) {
    return {
      success: false,
      error: "Risk level must be between 1 and 10",
      metadata: {
        validationErrors: ["Invalid risk level"],
      },
    };
  }

  // Date validation
  if (data.dateOpened && !data.dateOpenedStatus) {
    return {
      success: false,
      error: "Date status is required when date is provided",
      metadata: {
        validationErrors: ["Missing date status"],
      },
    };
  }

  return {
    success: true,
    data,
  };
}

// @ai-guidance: Validation should:
// 1. Use type guards first
// 2. Apply business rules
// 3. Validate relationships
// 4. Check date consistency
// 5. Provide detailed error messages
```

## Repository Pattern Documentation

### 1. Base Repository Structure

```typescript
// Example of a base repository pattern
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

  // @ai-guidance: Base repositories should:
  // 1. Provide common CRUD operations
  // 2. Handle errors consistently
  // 3. Map database models to domain models
  // 4. Support pagination and filtering
}

// Example of extending the base repository
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
}
```

### 2. Query Building

```typescript
// Example of query building
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

### 3. Error Handling

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

## Validation Examples

### 1. Schema Validation

```typescript
// Example of comprehensive schema validation
const assetSchema = z.object({
  name: z.string().min(1, "Name is required"),
  ticker: z.string().min(1, "Ticker is required"),
  assetType: z.nativeEnum(AssetType),
  locationType: z.nativeEnum(AssetLocationType),
  description: z.string().optional(),
  network: z.string().optional(),
  contractAddress: z.string().optional(),
  iconUrl: z.string().url().optional(),
  category: z.string().optional(),
  marketData: z.record(z.unknown()).optional(),
});

// @ai-guidance: Schema validation should:
// 1. Use proper Zod types
// 2. Include meaningful error messages
// 3. Handle optional fields
// 4. Validate complex types
```

### 2. Relationship Validation

```typescript
// Example of relationship validation
function validateRelationships(data: unknown): OperationResult<Position> {
  if (!isPosition(data)) {
    return {
      success: false,
      error: "Invalid position data",
    };
  }

  // Validate portfolio relationship
  if (!data.portfolioId) {
    return {
      success: false,
      error: "Portfolio ID is required",
      metadata: {
        validationErrors: ["Missing portfolio relationship"],
      },
    };
  }

  // Validate asset relationship
  if (!data.asset) {
    return {
      success: false,
      error: "Asset is required",
      metadata: {
        validationErrors: ["Missing asset relationship"],
      },
    };
  }

  return {
    success: true,
    data,
  };
}

// @ai-guidance: Relationship validation should:
// 1. Check required relationships
// 2. Validate relationship types
// 3. Handle optional relationships
// 4. Provide clear error messages
```

### 3. Date Validation

```typescript
// Example of date validation
function validateDates(data: unknown): OperationResult<Position> {
  if (!isPosition(data)) {
    return {
      success: false,
      error: "Invalid position data",
    };
  }

  // Validate date consistency
  if (data.dateOpened && !data.dateOpenedStatus) {
    return {
      success: false,
      error: "Date status is required when date is provided",
      metadata: {
        validationErrors: ["Missing date status"],
      },
    };
  }

  // Validate date order
  if (data.dateOpened && data.dateClosed && data.dateOpened > data.dateClosed) {
    return {
      success: false,
      error: "Close date cannot be before open date",
      metadata: {
        validationErrors: ["Invalid date order"],
      },
    };
  }

  return {
    success: true,
    data,
  };
}

// @ai-guidance: Date validation should:
// 1. Check date status consistency
// 2. Validate date order
// 3. Handle timezone implications
// 4. Consider edge cases
```

## Best Practices Summary

1. **Type Safety**

   - Use type guards consistently
   - Avoid type assertions
   - Leverage TypeScript's type system

2. **Error Handling**

   - Use OperationResult consistently
   - Provide meaningful error messages
   - Include relevant metadata

3. **Validation**

   - Validate early and often
   - Use Zod schemas
   - Handle edge cases

4. **Repository Pattern**

   - Follow consistent patterns
   - Handle errors properly
   - Support pagination and filtering

5. **Documentation**
   - Document complex logic
   - Include examples
   - Provide AI guidance

## Next Steps

1. **Testing**

   - Add unit tests for type guards
   - Test validation logic
   - Test error handling

2. **Performance**

   - Monitor type guard performance
   - Optimize validation
   - Cache results when appropriate

3. **Documentation**

   - Keep documentation up to date
   - Add more examples
   - Document new features

4. **Tooling**
   - Add IDE support
   - Create development tools
   - Improve debugging support
