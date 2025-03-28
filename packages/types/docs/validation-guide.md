# Numisma Validation Guide

## Overview

This guide outlines the validation patterns used in the Numisma codebase. It provides examples, best practices, and guidance for both human developers and AI models working with the codebase.

## Core Concepts

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

### 2. Type Guards

```typescript
// Example of type guard implementation
function isAsset(data: unknown): data is Asset {
  // @ai-guidance: Type guards should:
  // 1. Check all required fields
  // 2. Validate field types
  // 3. Handle optional fields
  // 4. Consider performance

  if (!data || typeof data !== "object") {
    return false;
  }

  const asset = data as Partial<Asset>;
  return (
    typeof asset.id === "string" &&
    typeof asset.name === "string" &&
    typeof asset.ticker === "string" &&
    Object.values(AssetType).includes(asset.assetType as AssetType) &&
    Object.values(AssetLocationType).includes(
      asset.locationType as AssetLocationType
    )
  );
}
```

### 3. Business Rule Validation

```typescript
// Example of business rule validation
class BusinessRuleValidator {
  // @ai-guidance: Business rule validation should:
  // 1. Check business constraints
  // 2. Validate relationships
  // 3. Handle edge cases
  // 4. Provide clear error messages

  static validatePosition(data: Position): OperationResult<Position> {
    // Risk level validation
    if (data.riskLevel < 1 || data.riskLevel > 10) {
      return {
        success: false,
        error: "Risk level must be between 1 and 10",
        metadata: {
          validationErrors: ["Invalid risk level"],
        },
      };
    }

    // Investment validation
    if (data.positionDetails.initialInvestment <= 0) {
      return {
        success: false,
        error: "Initial investment must be greater than 0",
        metadata: {
          validationErrors: ["Invalid initial investment"],
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

## Validation Examples

### 1. Asset Validation

```typescript
// Example of comprehensive asset validation
class AssetValidator {
  // @ai-guidance: Asset validation should:
  // 1. Validate basic structure
  // 2. Check business rules
  // 3. Validate relationships
  // 4. Handle edge cases

  static validate(data: unknown): OperationResult<Asset> {
    // Type guard check
    if (!isAsset(data)) {
      return {
        success: false,
        error: "Invalid asset data structure",
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

    // Market data validation
    if (data.marketData) {
      const marketDataResult = this.validateMarketData(data.marketData);
      if (!marketDataResult.success) {
        return marketDataResult;
      }
    }

    return {
      success: true,
      data,
    };
  }

  private static validateMarketData(
    marketData: Record<string, unknown>
  ): OperationResult<Asset> {
    // @ai-guidance: Market data validation should:
    // 1. Check required fields
    // 2. Validate data types
    // 3. Handle missing data
    // 4. Consider performance

    if (
      !marketData.currentPrice ||
      typeof marketData.currentPrice !== "number"
    ) {
      return {
        success: false,
        error: "Invalid market data",
        metadata: {
          validationErrors: ["Missing or invalid current price"],
        },
      };
    }

    return {
      success: true,
      data: {} as Asset, // This is a placeholder, actual data would be passed through
    };
  }
}
```

### 2. Market Validation

```typescript
// Example of market validation
class MarketValidator {
  // @ai-guidance: Market validation should:
  // 1. Validate market structure
  // 2. Check asset relationships
  // 3. Validate exchange rules
  // 4. Handle edge cases

  static validate(data: unknown): OperationResult<Market> {
    // Type guard check
    if (!isMarket(data)) {
      return {
        success: false,
        error: "Invalid market data structure",
        metadata: {
          validationErrors: ["Market structure is invalid"],
        },
      };
    }

    // Asset validation
    const baseAssetResult = AssetValidator.validate(data.baseAsset);
    if (!baseAssetResult.success) {
      return {
        success: false,
        error: "Invalid base asset",
        metadata: {
          validationErrors: ["Base asset validation failed"],
        },
      };
    }

    const quoteAssetResult = AssetValidator.validate(data.quoteAsset);
    if (!quoteAssetResult.success) {
      return {
        success: false,
        error: "Invalid quote asset",
        metadata: {
          validationErrors: ["Quote asset validation failed"],
        },
      };
    }

    // Exchange validation
    if (data.exchange) {
      const exchangeResult = this.validateExchange(data.exchange);
      if (!exchangeResult.success) {
        return exchangeResult;
      }
    }

    return {
      success: true,
      data,
    };
  }

  private static validateExchange(exchange: string): OperationResult<Market> {
    // @ai-guidance: Exchange validation should:
    // 1. Check exchange format
    // 2. Validate against supported exchanges
    // 3. Handle special cases
    // 4. Consider performance

    const supportedExchanges = ["binance", "coinbase", "kraken"];
    if (!supportedExchanges.includes(exchange.toLowerCase())) {
      return {
        success: false,
        error: "Unsupported exchange",
        metadata: {
          validationErrors: ["Exchange not supported"],
        },
      };
    }

    return {
      success: true,
      data: {} as Market, // This is a placeholder, actual data would be passed through
    };
  }
}
```

### 3. Position Validation

```typescript
// Example of position validation
class PositionValidator {
  // @ai-guidance: Position validation should:
  // 1. Validate position structure
  // 2. Check market relationship
  // 3. Validate investment details
  // 4. Handle edge cases

  static validate(data: unknown): OperationResult<Position> {
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

    // Market validation
    const marketResult = MarketValidator.validate(data.market);
    if (!marketResult.success) {
      return {
        success: false,
        error: "Invalid market",
        metadata: {
          validationErrors: ["Market validation failed"],
        },
      };
    }

    // Investment validation
    const investmentResult = this.validateInvestment(data.positionDetails);
    if (!investmentResult.success) {
      return investmentResult;
    }

    // Date validation
    const dateResult = this.validateDates(data);
    if (!dateResult.success) {
      return dateResult;
    }

    return {
      success: true,
      data,
    };
  }

  private static validateInvestment(
    details: PositionDetails
  ): OperationResult<Position> {
    // @ai-guidance: Investment validation should:
    // 1. Check investment amounts
    // 2. Validate percentages
    // 3. Handle edge cases
    // 4. Consider performance

    if (details.initialInvestment <= 0) {
      return {
        success: false,
        error: "Initial investment must be greater than 0",
        metadata: {
          validationErrors: ["Invalid initial investment"],
        },
      };
    }

    if (details.closedPercentage < 0 || details.closedPercentage > 100) {
      return {
        success: false,
        error: "Closed percentage must be between 0 and 100",
        metadata: {
          validationErrors: ["Invalid closed percentage"],
        },
      };
    }

    return {
      success: true,
      data: {} as Position, // This is a placeholder, actual data would be passed through
    };
  }

  private static validateDates(data: Position): OperationResult<Position> {
    // @ai-guidance: Date validation should:
    // 1. Check date consistency
    // 2. Validate date status
    // 3. Handle timezone implications
    // 4. Consider edge cases

    if (data.dateOpened && !data.dateOpenedStatus) {
      return {
        success: false,
        error: "Date status is required when date is provided",
        metadata: {
          validationErrors: ["Missing date status"],
        },
      };
    }

    if (
      data.dateOpened &&
      data.dateClosed &&
      data.dateOpened > data.dateClosed
    ) {
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
}
```

## Best Practices

### 1. Validation Layers

```typescript
// Example of layered validation
class ValidationPipeline {
  // @ai-guidance: Validation pipeline should:
  // 1. Apply validations in order
  // 2. Stop on first failure
  // 3. Collect all errors
  // 4. Consider performance

  static async validate<T>(
    data: unknown,
    validators: ((data: unknown) => OperationResult<T>)[]
  ): Promise<OperationResult<T>> {
    const errors: string[] = [];

    for (const validator of validators) {
      const result = validator(data);
      if (!result.success) {
        errors.push(result.error as string);
        if (result.metadata?.validationErrors) {
          errors.push(...result.metadata.validationErrors);
        }
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: "Validation failed",
        metadata: {
          validationErrors: errors,
        },
      };
    }

    return {
      success: true,
      data: data as T,
    };
  }
}
```

### 2. Error Handling

```typescript
// Example of validation error handling
class ValidationErrorHandler {
  // @ai-guidance: Error handling should:
  // 1. Categorize errors
  // 2. Provide context
  // 3. Include metadata
  // 4. Handle edge cases

  static handleError(error: unknown): OperationResult<never> {
    if (error instanceof z.ZodError) {
      return {
        success: false,
        error: "Schema validation failed",
        metadata: {
          validationErrors: error.errors.map(e => e.message),
        },
      };
    }

    if (error instanceof TypeError) {
      return {
        success: false,
        error: "Type validation failed",
        metadata: {
          validationErrors: [error.message],
        },
      };
    }

    return {
      success: false,
      error: "Validation failed",
      metadata: {
        validationErrors: [
          error instanceof Error ? error.message : "Unknown error",
        ],
      },
    };
  }
}
```

### 3. Performance Optimization

```typescript
// Example of validation optimization
class ValidationOptimizer {
  // @ai-guidance: Validation optimization should:
  // 1. Cache results
  // 2. Skip unnecessary checks
  // 3. Use efficient algorithms
  // 4. Consider memory usage

  private static cache = new Map<string, boolean>();

  static optimizeValidation<T>(
    data: unknown,
    validator: (data: unknown) => OperationResult<T>
  ): OperationResult<T> {
    const cacheKey = JSON.stringify(data);
    if (this.cache.has(cacheKey)) {
      return {
        success: this.cache.get(cacheKey) as boolean,
        data: data as T,
      };
    }

    const result = validator(data);
    this.cache.set(cacheKey, result.success);
    return result;
  }
}
```

## Implementation Guidelines

1. **Validation Structure**

   - Use layered validation
   - Apply validations in order
   - Stop on first failure
   - Collect all errors

2. **Error Handling**

   - Use OperationResult consistently
   - Provide meaningful error messages
   - Include relevant metadata
   - Handle edge cases

3. **Performance**

   - Cache validation results
   - Skip unnecessary checks
   - Use efficient algorithms
   - Consider memory usage

4. **Testing**
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

   - Monitor validation performance
   - Optimize algorithms
   - Implement caching
   - Profile operations

4. **Tooling**
   - Add IDE support
   - Create development tools
   - Improve debugging support
