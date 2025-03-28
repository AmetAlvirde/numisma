# Database Layer Refactoring Plan

## Overview

This document outlines the plan to establish a solid foundation for our database layer (schema and repositories) that aligns with our type system documentation. Since this is a pre-deployment refactoring, our focus is on getting the implementation right from the start to serve as a reliable foundation for other packages in the monorepo.

## Current State Analysis

### Schema Layer Issues

1. **Type Safety Gaps**

   - Current schemas don't fully leverage our type system's enums and base types
   - Missing proper relationship type handling (OneToOne, OneToMany, ManyToMany)
   - Inconsistent use of ForeignKey types
   - Missing proper cascade behavior definitions

2. **Validation Inconsistencies**

   - Zod schemas don't fully reflect our type system constraints
   - Missing proper date status handling
   - Incomplete validation for relationship fields
   - Inconsistent handling of optional fields

3. **Missing Type System Features**
   - No proper implementation of PaginationParams and PaginatedResult
   - Missing FilterParams and QueryParams integration
   - Incomplete OperationResult and BatchOperationResult handling

### Repository Layer Issues

1. **Type Safety**

   - Repositories don't use proper relationship types
   - Missing proper error handling with OperationResult
   - Inconsistent use of type guards
   - Missing proper cascade behavior implementation

2. **Query Handling**

   - Incomplete implementation of QueryParams
   - Missing proper pagination handling
   - Inconsistent filter implementation
   - Missing proper sorting support

3. **Operation Results**
   - Inconsistent error handling
   - Missing proper batch operation support
   - Incomplete success/failure handling
   - Missing proper type safety in return values

## Refactoring Plan

### Phase 1: Schema Layer Refactoring

1. **Base Types Integration**

   - Update all schemas to use proper enums from type system
   - Implement proper ForeignKey types
   - Add proper relationship type definitions
   - Implement cascade behavior options

2. **Validation Enhancement**

   - Update Zod schemas to match type system constraints
   - Add proper date status validation
   - Implement relationship validation
   - Add proper optional field handling

3. **Type System Features**
   - Implement PaginationParams and PaginatedResult
   - Add FilterParams and QueryParams
   - Implement OperationResult and BatchOperationResult
   - Add proper type guards

### Phase 2: Repository Layer Refactoring

1. **Type Safety Enhancement**

   - Update repositories to use proper relationship types
   - Implement proper error handling with OperationResult
   - Add type guards for all operations
   - Implement proper cascade behavior

2. **Query Handling**

   - Implement proper QueryParams support
   - Add pagination handling
   - Implement proper filtering
   - Add sorting support

3. **Operation Results**
   - Implement proper error handling
   - Add batch operation support
   - Implement proper success/failure handling
   - Add type safety to return values

### Phase 3: Testing and Validation

1. **Type Testing**

   - Add type guard tests
   - Test relationship handling
   - Validate cascade behavior
   - Test error handling

2. **Integration Testing**

   - Test schema validation
   - Test repository operations
   - Test pagination and filtering
   - Test batch operations

3. **Performance Testing**
   - Test type guard performance
   - Test relationship handling performance
   - Test query performance
   - Test batch operations performance

## Implementation Order

1. **Schema Layer**

   - Start with common.ts as it's the foundation
   - Update asset.ts and market.ts as they are core entities
   - Update position.ts and portfolio.ts
   - Update remaining schemas

2. **Repository Layer**

   - Start with repository-factory.ts
   - Update asset.ts and market.ts repositories
   - Update position.ts and portfolio.ts repositories
   - Update remaining repositories

3. **Testing**
   - Add tests for each updated component
   - Validate type safety
   - Test integration points
   - Performance testing

## Success Criteria

1. **Type Safety**

   - All type errors resolved
   - Proper use of type system features
   - Complete type guard coverage
   - No type assertions

2. **Functionality**

   - All features working as expected
   - New type system features implemented
   - Proper error handling
   - Complete test coverage

3. **Performance**

   - Efficient type checking
   - Optimized queries
   - Fast batch operations
   - No unnecessary overhead

4. **Maintainability**

   - Clear documentation
   - Consistent patterns
   - Easy to extend
   - Well-organized code

5. **Integration Readiness**
   - Clean API for other packages
   - Clear usage patterns
   - Proper error handling
   - Type-safe interfaces

## Timeline Estimate

1. **Phase 1 (Schema Layer)**: 2-3 days
2. **Phase 2 (Repository Layer)**: 3-4 days
3. **Phase 3 (Testing)**: 2-3 days
4. **Buffer for Issues**: 2 days

Total estimated time: 9-12 days

## Next Steps

1. Review and approve this plan
2. Set up development environment
3. Create feature branches
4. Begin with Phase 1 implementation
5. Regular progress reviews
6. Continuous testing and validation

## Notes

- This is a pre-deployment refactoring to establish a solid foundation
- Focus on getting the implementation right from the start
- Ensure the database package is ready for other packages to use
- Maintain high code quality and type safety throughout
- Document all patterns and best practices for future reference
