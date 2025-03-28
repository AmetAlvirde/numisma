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
