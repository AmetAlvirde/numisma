# Numisma Database & Types Diagnostic Report

## Overview

This document analyzes the consistency between the Prisma schema (`db/prisma/schema.prisma`) and TypeScript types (`types/src/index.ts`) in the Numisma project. The goal is to identify inconsistencies and provide recommendations for achieving type safety across the codebase.

## Key Findings

### 1. Core Domain Model Alignment

#### Strengths

- Both files maintain a similar high-level structure for core entities (Position, Portfolio, Asset)
- Basic type definitions are generally consistent (e.g., PositionStatus, OrderStatus)
- Both implement similar relationship patterns

#### Issues

- Some enums in Prisma don't have direct TypeScript type equivalents
- Inconsistent handling of optional fields
- Different approaches to handling dates and time periods

### 2. Specific Inconsistencies

#### Asset Model

- Prisma: Has `marketData` as Json type
- TypeScript: Has detailed `marketData` structure with specific fields
- Recommendation: Create a proper type for market data and use it in both places

#### Position Model

- Prisma: Uses string for `lifecycle` and `capitalTier`
- TypeScript: Has more specific types for these fields
- Recommendation: Create proper enums for these fields

#### Portfolio Model

- Prisma: Has `dateCreated` as DateTime
- TypeScript: Uses `DateOrGenesis` type
- Recommendation: Standardize date handling approach

### 3. Type Safety Issues

#### Missing Type Definitions

- Several Prisma models lack corresponding TypeScript interfaces
- Some TypeScript types don't have corresponding Prisma models
- Inconsistent handling of optional fields

#### Enum Handling

- Prisma enums don't always match TypeScript type unions
- Some TypeScript type unions could be better represented as Prisma enums

### 4. Data Model Gaps

#### Missing Models in Prisma

- No direct equivalent for some TypeScript interfaces (e.g., TradingInsight)
- Some TypeScript types have more detailed structures than their Prisma counterparts

#### Missing Types in TypeScript

- Some Prisma models lack corresponding TypeScript interfaces
- Inconsistent handling of relationships

## Recommendations

### 1. Schema vs Types Priority

**Recommendation**: Types should drive the schema, with the following rationale:

Pros:

- TypeScript types provide better documentation and type safety
- Types can be more flexible and easier to maintain
- Better IDE support and developer experience
- Easier to version control and review changes

Cons:

- May require more complex Prisma schema configurations
- Some TypeScript features might not map directly to database concepts
- May need additional type transformations for database operations

### 2. Required Changes

#### Phase 1: Core Type Alignment

1. Create proper enums for all status fields
2. Standardize date handling approach
3. Align optional field handling
4. Create consistent relationship types

#### Phase 2: Model Completion

1. Add missing TypeScript interfaces for Prisma models
2. Add missing Prisma models for TypeScript types
3. Standardize naming conventions
4. Implement proper type guards

#### Phase 3: Advanced Features

1. Implement proper validation types
2. Add proper error handling types
3. Create utility types for common operations
4. Implement proper type transformations

### 3. Specific Action Items

1. Create proper enums for:

   - Position lifecycle
   - Capital tier
   - Asset location type
   - Order status
   - Portfolio status

2. Standardize date handling:

   - Create proper DateOrGenesis type in Prisma
   - Implement proper date transformation utilities
   - Add proper validation for date fields

3. Align optional fields:

   - Review all optional fields in both files
   - Create consistent rules for optionality
   - Implement proper null handling

4. Create proper relationship types:
   - Implement proper foreign key types
   - Create proper relationship utility types
   - Add proper cascade delete types

## Implementation Plan

### Phase 1: Foundation (Week 1)

1. Create proper enums
2. Standardize date handling
3. Align optional fields
4. Create basic relationship types

### Phase 2: Model Completion (Week 2)

1. Add missing interfaces
2. Add missing models
3. Standardize naming
4. Implement type guards

### Phase 3: Advanced Features (Week 3)

1. Implement validation types
2. Add error handling
3. Create utility types
4. Implement transformations

## Conclusion

The current state shows good alignment in core concepts but needs significant work in type safety and consistency. The recommended approach is to let TypeScript types drive the schema, with careful consideration of database constraints and performance implications.

The implementation plan is designed to be incremental and maintainable, with clear phases and deliverables. Each phase builds on the previous one, ensuring a solid foundation for the type system.

## Next Steps

1. Review and approve the diagnostic findings
2. Prioritize the implementation phases
3. Create detailed tickets for each action item
4. Begin implementation with Phase 1

## Detailed Analysis of Key Decisions

### 1. DateOrGenesis Type Analysis

#### Current Implementation

- TypeScript uses `DateOrGenesis = Date | string | "genesis"`
- Prisma uses `DateTime` with nullable fields
- Genesis concept represents positions that existed before tracking began

#### Considerations

##### Pros of Keeping DateOrGenesis

- Explicitly represents the "pre-tracking" state
- Makes it clear when a position existed before system tracking
- Helps with historical data migration
- Provides semantic meaning beyond just null

##### Cons of DateOrGenesis

- Adds complexity to type system
- Requires special handling in database layer
- May complicate queries and filtering
- Could be confusing for new developers

##### Alternative Approaches

1. **Nullable DateTime with Status Flag**

```typescript
interface Position {
  dateOpened: Date | null;
  isPreTracking: boolean;
}
```

Pros:

- Simpler type system
- Clear database representation
- Easy to query
- Standard practice

Cons:

- Loses semantic meaning of "genesis"
- Requires two fields to represent one concept
- Less explicit in type system

2. **Epoch Date Approach**

```typescript
interface Position {
  dateOpened: Date | "EPOCH";
}
```

Pros:

- Single field solution
- Maintains semantic meaning
- Type-safe
- Easy to query

Cons:

- Less explicit about pre-tracking state
- May be confusing for non-technical users

#### Recommendation

After careful analysis, I recommend adopting the **Nullable DateTime with Status Flag** approach because:

1. It follows standard database practices
2. Provides clear querying capabilities
3. Maintains semantic meaning through the status flag
4. Simplifies the type system
5. Better aligns with TypeScript best practices
6. Easier to maintain and understand

### 2. Enum Conversion Strategy

#### Fields to Convert

1. Position Model:

   - `lifecycle` → `PositionLifecycle`
   - `capitalTier` → `CapitalTier`
   - `strategy` → `TradingStrategy`

2. Asset Model:

   - `assetType` → `AssetType`
   - `locationType` → `AssetLocationType`

3. Portfolio Model:

   - `status` → `PortfolioStatus`
   - `riskProfile` → `RiskProfile`

4. Order Model:
   - `status` → `OrderStatus`
   - `type` → `OrderType`
   - `purpose` → `OrderPurpose`

#### Implementation Strategy

1. Create TypeScript enums first
2. Generate Prisma enums from TypeScript
3. Update existing data with migration
4. Add validation layer

### 3. Optional Field Alignment

#### Current State

- TypeScript has explicit optional fields with `?`
- Prisma has inconsistent optionality
- Some fields are nullable in database but required in types

#### Fields to Make Optional

1. Position Model:

   - `description`
   - `notes`
   - `currentValue`
   - `isHidden`
   - `alertsEnabled`

2. Portfolio Model:

   - `description`
   - `notes`
   - `tags`
   - `displayMetadata`
   - `riskProfile`
   - `targetAllocations`
   - `currentValue`
   - `initialInvestment`
   - `profitLoss`
   - `returnPercentage`
   - `isPublic`

3. Asset Model:
   - `description`
   - `network`
   - `contractAddress`
   - `iconUrl`
   - `category`
   - `marketData`

### 4. Type Definition Analysis

#### Clarification on Missing Types

After careful review, I need to correct my earlier assessment. Since we're letting TypeScript drive the model:

1. The "missing types" are actually:

   - Types that exist in TypeScript but need corresponding Prisma models
   - Types that need to be split into multiple models for proper database normalization
   - Types that need to be transformed for database storage

2. Examples:
   - `TradingInsight` needs a database model
   - `MarketData` needs proper database structure
   - `PerformanceMetrics` needs normalization

#### Recommendation

Instead of adding types based on the model, we should:

1. Review all TypeScript types
2. Identify which need database persistence
3. Design appropriate database models
4. Create proper type transformations

### 5. Relationship Handling Analysis

#### Current Differences

1. **Foreign Key Handling**

   - Prisma: Uses explicit foreign key fields with `@relation`
   - TypeScript: Uses ID references without explicit typing
   - Example:

     ```typescript
     // TypeScript
     interface Position {
       portfolioId: string;
     }

     // Prisma
     model Position {
       portfolioId String
       portfolio   Portfolio @relation(fields: [portfolioId], references: [id])
     }
     ```

2. **Cascade Behavior**

   - Prisma: Defines cascade behavior at model level
   - TypeScript: No explicit cascade behavior
   - Example:
     ```prisma
     model Position {
       portfolio   Portfolio @relation(fields: [portfolioId], references: [id], onDelete: Cascade)
     }
     ```

3. **Many-to-Many Relationships**

   - Prisma: Uses junction tables
   - TypeScript: Uses array of IDs
   - Example:

     ```typescript
     // TypeScript
     interface Portfolio {
       positionIds: string[];
     }

     // Prisma
     model PortfolioPosition {
       portfolioId String
       positionId  String
       portfolio   Portfolio @relation(fields: [portfolioId], references: [id])
       position    Position  @relation(fields: [positionId], references: [id])
     }
     ```

#### Recommendation

1. **Type-Safe Foreign Keys**

```typescript
type ForeignKey<T> = string & { readonly brand: unique symbol };
interface Position {
  portfolioId: ForeignKey<Portfolio>;
}
```

2. **Explicit Cascade Types**

```typescript
type CascadeBehavior = "Cascade" | "Restrict" | "SetNull" | "NoAction";
interface RelationOptions {
  onDelete?: CascadeBehavior;
  onUpdate?: CascadeBehavior;
}
```

3. **Many-to-Many Type Helpers**

```typescript
type ManyToMany<T> = {
  items: T[];
  add: (item: T) => void;
  remove: (item: T) => void;
};
```

This approach provides:

- Type safety for relationships
- Clear cascade behavior
- Proper many-to-many handling
- Better IDE support
- Runtime safety

## Updated Implementation Plan

Based on this detailed analysis, I recommend updating the implementation phases:

### Phase 1: Foundation (Week 1)

1. Implement new date handling approach
2. Create and implement all enums
3. Update optional field handling
4. Implement type-safe relationship system

### Phase 2: Model Completion (Week 2)

1. Create database models for TypeScript-only types
2. Implement proper type transformations
3. Add validation layer
4. Create migration scripts

### Phase 3: Advanced Features (Week 3)

1. Implement relationship type system
2. Add cascade behavior types
3. Create utility types for common operations
4. Add comprehensive type guards

## Next Steps

1. Review and approve the detailed analysis
2. Confirm the date handling approach
3. Prioritize enum implementations
4. Begin Phase 1 implementation
