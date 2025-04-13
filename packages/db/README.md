# Numisma Database Layer

This package provides repository implementations and database access utilities for the Numisma application.

## Type Mapper Refactoring Status

We're in the process of refactoring the repositories to use type-safe mappers. This will provide better type safety when converting between Prisma models and domain models.

### Current Progress

- ✅ Created initial type mappers for basic enum conversions
- ✅ Created entity mappers for complex entity conversions
- ✅ Updated simpler repositories (Asset, Market) to use the type mappers
- ✅ Converted repositories to use OperationResult pattern for consistent error handling
- ✅ Implemented Portfolio repository with type mappers
- ⚠️ Started Position repository refactoring (partial implementation)
- ❌ Still need to complete Position repository and address type inconsistencies

### Implementation Status

1. **Type Mappers**

   - ✅ Basic enum conversions in type-mappers.ts
   - ✅ Date/Genesis handling utilities
   - ⚠️ Need to finalize mapPositionToPrisma implementation with proper type-safety

2. **Entity Mappers**

   - ✅ Implemented ToPrisma mappers for Asset and Market entities
   - ✅ Implemented ToPrisma mapper for Portfolio entity
   - ⚠️ Need to finish Position entity mapper implementation

3. **Repository Implementations**

   - ✅ Asset Repository (completed)
   - ✅ Market Repository (completed)
   - ✅ Portfolio Repository (completed)
   - ⚠️ Position Repository (in progress)
   - ❌ Additional repositories still need updating

4. **Type Safety Improvements**
   - ✅ Implemented OperationResult pattern for consistent error handling
   - ⚠️ Need to ensure proper handling of null/undefined values
   - ⚠️ Need to fix type inconsistencies between Prisma and domain models

### Known Issues

- The Position/Portfolio entities have complex relationships that need careful mapping
- The DateOrGenesis type needs special handling to convert correctly between Prisma and domain models
- Some enum types are not being properly converted, leading to "any" type casts
- Type inconsistencies between Prisma schema and domain models need to be addressed

### Next Steps

1. **Complete Position Repository Refactoring**

   - Fix type issues with the Position entity and its related entities
   - Complete the mapPositionToPrisma implementation
   - Ensure all Position repository methods use proper type mappers

2. **Address Type Inconsistencies**

   - Ensure proper mapping between Prisma types and domain types
   - Fix null/undefined handling for optional properties
   - Correctly handle DateOrGenesis conversions

3. **Testing**
   - Implement tests to verify proper type conversion
   - Ensure end-to-end type safety for all repositories

### Resources

- Type definitions are in the @numisma/types package
- Prisma schema is in packages/db/prisma/schema.prisma
