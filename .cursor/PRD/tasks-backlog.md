# Tasks Backlog: Connect Home Page to Database

## Goal

Replace mock data in the home page with real database data using tRPC and react-query.

## Current State Analysis

- ✅ Home page layout and components are working with mock data
- ✅ tRPC is already configured with basic setup
- ✅ Prisma is configured with User/Session/Account models
- ❌ Portfolio-related models are missing from schema
- ❌ No tRPC procedures for portfolio data
- ❌ Components still use mock data

## Step-by-Step Implementation Plan

### Phase 1: Database Schema Setup

#### ✅ Task 1.1: Add Simplified Portfolio Models to Prisma Schema (COMPLETED)

**What:** Add Portfolio and HistoricalValuation models (focusing on Portfolio only, not Position)
**Why:** Need database tables to store portfolio data for home page
**Steps:**

1. Add Portfolio model with core fields: id, name, description, totalValue, isPinned, userId
2. Add HistoricalValuation model for time-series data (optimized for weekly/monthly/yearly scope)
3. Add DateStatus enum for temporal data tracking
4. Add User relationship to Portfolio (userId foreign key)
5. Keep models simple initially, can extend later

**Verification:**

- Schema file validates without errors
- Portfolio-User relationship is properly defined
- Foreign keys are correctly specified
- Models support monthly to yearly historical data efficiently

#### ✅ Task 1.2: Create and Run Database Migration (COMPLETED)

**What:** Generate and execute Prisma migration for new models
**Why:** Apply schema changes to actual database
**Steps:**

1. Generate migration: `npx prisma migrate dev --name add_portfolio_models`
2. Verify migration files are created correctly
3. Check database tables are created with correct structure

**Verification:**

- Migration runs without errors
- New tables exist in database
- Table structure matches schema definitions
- Foreign key constraints are properly created

#### ✅ Task 1.3: Seed Database with Sample Portfolio Data (COMPLETED)

**What:** Create seed script to populate database with realistic portfolio data
**Why:** Need test data to verify queries work correctly
**Steps:**

1. Create `prisma/seed.ts` file
2. Add sample user to own sample portfolios
3. Create 2-3 sample portfolios with realistic data
4. Add sample historical valuations
5. Run seed script

**Verification:**

- Seed script runs without errors
- Sample data appears in database
- Relationships are properly connected
- Data structure matches expected format

#### 📋 Task 1.4: Create Data Migration Strategy (TO DO LATER)

**What:** Plan and implement migration of existing portfolio data to new schema
**Why:** User wants to migrate existing data to the new database structure
**Steps:**

1. Analyze existing data format and structure
2. Create migration script to transform existing data
3. Map existing portfolio data to new Portfolio model
4. Handle historical valuations if they exist
5. Test migration with backup data first

**Verification:**

- Migration script runs without data loss
- Existing data is properly transformed
- Data integrity is maintained
- Rollback strategy is available

### Phase 2: tRPC Backend Procedures

#### ✅ Task 2.1: Create Portfolio tRPC Router (COMPLETED)

**What:** Create dedicated router for portfolio-related procedures
**Why:** Organize portfolio endpoints separately from main router
**Steps:**

1. Create `src/server/trpc/routers/portfolio.ts`
2. Define basic router structure
3. Export router for integration

**Verification:**

- File compiles without TypeScript errors
- Router structure follows tRPC patterns
- Exports are properly typed

#### ✅ Task 2.2: Implement getUserPortfolios Procedure (COMPLETED)

**What:** Create procedure to fetch all portfolios for authenticated user
**Why:** Home page needs list of user's portfolios
**Steps:**

1. Add authentication check
2. Query portfolios by userId
3. Include basic portfolio info (id, name, totalValue)
4. Add proper error handling

**Verification:**

- Procedure compiles without errors
- Returns properly typed data
- Authentication is enforced
- Error cases are handled

#### ✅ Task 2.3: Implement getPinnedPortfolio Procedure (COMPLETED)

**What:** Create procedure to fetch the user's pinned portfolio with detailed info
**Why:** PinnedPortfolioOverview component needs detailed portfolio data
**Steps:**

1. Query portfolio marked as pinned for user
2. Calculate current total value from latest valuation
3. Calculate day change from historical data (using periodic refresh approach)
4. Include top holdings information (simplified for now)
5. Handle case where no pinned portfolio exists

**Verification:**

- Returns complete portfolio data structure
- Calculations are accurate
- Handles edge cases (no pinned portfolio)
- Performance is acceptable

#### ✅ Task 2.4: Implement getPortfolioValuations Procedure (COMPLETED)

**What:** Create procedure to fetch historical valuations for a portfolio
**Why:** Need historical data for charts and performance metrics
**Steps:**

1. Query HistoricalValuation by portfolioId
2. Add optional date range filtering (optimized for monthly/yearly data)
3. Order by timestamp
4. Include basic aggregation options

**Verification:**

- Returns properly structured time-series data
- Date filtering works correctly for weekly/monthly/yearly ranges
- Performance is optimized for 1 week to 1 year of data (especially weekly)
- Data integrity is maintained
- Weekly data queries are optimized for high-frequency usage patterns

#### ✅ Task 2.5: Integrate Portfolio Router with Main App Router (COMPLETED)

**What:** Add portfolio router to main tRPC router
**Why:** Make portfolio procedures available to frontend
**Steps:**

1. Import portfolio router in main router.ts
2. Add to router definition with 'portfolio' namespace
3. Update type exports

**Verification:**

- Main router compiles without errors
- Portfolio procedures are accessible via trpc.portfolio.\*
- TypeScript types are properly generated
- No naming conflicts exist

### Phase 3: Frontend Integration

#### ✅ Task 3.1: Create Portfolio Query Hooks (COMPLETED)

**What:** Create custom hooks using tRPC for portfolio data fetching
**Why:** Encapsulate data fetching logic and provide consistent interface
**Steps:**

1. Create `src/hooks/use-portfolio-data.ts`
2. Implement useUserPortfolios hook
3. Implement usePinnedPortfolio hook
4. Add proper loading/error states
5. Add refetch capabilities

**Verification:**

- Hooks compile without TypeScript errors
- Return types match expected data structures
- Loading states work correctly
- Error handling is implemented

#### ✅ Task 3.2: Update PinnedPortfolioOverview Component (COMPLETED)

**What:** Replace mock data with real tRPC queries in PinnedPortfolioOverview
**Why:** Connect component to actual database data
**Steps:**

1. Replace mock data imports with tRPC hooks
2. Update usePinnedPortfolio hook to use real data
3. Add loading states for data fetching
4. Add error handling and fallback UI
5. Ensure all calculations work with real data

**Verification:**

- Component renders without errors
- Real data displays correctly
- Loading states appear appropriately
- Error states are handled gracefully
- All interactive features still work

#### ✅ Task 3.3: Update Portfolio Selection Dialog (COMPLETED)

**What:** Replace available portfolios mock data with real query
**Why:** Dialog should show actual user portfolios
**Steps:**

1. Use getUserPortfolios query in portfolio-select-dialog
2. Update selection handlers to work with real portfolio IDs
3. Add loading state for portfolio list
4. Handle empty portfolio list case

**Verification:**

- Dialog shows real user portfolios
- Selection updates pinned portfolio correctly
- Loading states work properly
- Empty state is handled appropriately

#### ✅ Task 3.4: Add Portfolio Data Mutations (COMPLETED)

**What:** Create tRPC mutations for updating portfolio data
**Why:** Allow users to pin/unpin portfolios and update settings
**Steps:**

1. Add updatePortfolio mutation to backend
2. Add setPinnedPortfolio mutation
3. Create frontend hooks for mutations
4. Update components to use mutations

**Verification:**

- Mutations execute successfully
- Database is updated correctly
- UI reflects changes immediately
- Optimistic updates work properly

### Phase 4: Data Consistency and Performance

#### 📋 Task 4.1: Add Data Validation (TO DO LATER)

**What:** Add Zod schemas for input validation on tRPC procedures
**Why:** Ensure data integrity and type safety
**Steps:**

1. Create validation schemas for portfolio operations
2. Add input validation to all procedures
3. Add proper error messages for validation failures

**Verification:**

- Invalid inputs are properly rejected
- Error messages are user-friendly
- Valid inputs process correctly
- Type safety is maintained

#### ✅ Task 4.2: Implement Data Caching Strategy (COMPLETED)

**What:** Configure react-query caching for portfolio data
**Why:** Improve performance and reduce unnecessary database queries
**Steps:**

1. ✅ Enhanced QueryClient with global defaults for consistent caching behavior
2. ✅ Added smart retry logic that avoids retrying client errors (4xx)
3. ✅ Implemented optimistic updates for portfolio pinning with instant UI feedback
4. ✅ Added exponential backoff for server error retries
5. ✅ Optimized HTTP batching with increased URL length support

**Verification:**

- ✅ Data caches appropriately with 5min stale time, 10min garbage collection
- ✅ Cache invalidation works correctly with optimistic updates and error rollback
- ✅ Performance improvements through optimistic updates and global defaults
- ✅ Fresh data appears when expected with proper cache management

**Implementation Details:**

- Global QueryClient defaults reduce code duplication across hooks
- Portfolio pinning now provides instant UI feedback via optimistic updates
- Error handling gracefully reverts optimistic changes on failure
- Smart retry logic prevents wasted requests on client errors

#### ✅ Task 4.3: Add Error Boundaries and Fallbacks

**What:** Implement comprehensive error handling throughout the chain
**Why:** Provide graceful degradation when things go wrong
**Steps:**

1. Add error boundaries around portfolio components
2. Create fallback UI components
3. Add retry mechanisms for failed queries
4. Implement offline state handling

**Verification:**

- ✅ Errors are caught and handled gracefully
- ✅ Fallback UI displays appropriately
- ✅ Retry mechanisms work correctly
- ✅ User experience remains smooth during errors

### Phase 5: Testing and Optimization

#### Task 5.1: Add Integration Tests

**What:** Test the complete data flow from database to UI
**Why:** Ensure reliability of the new data integration
**Steps:**

1. Test tRPC procedures with different scenarios
2. Test React components with real data
3. Test error scenarios and edge cases
4. Test performance with larger datasets

**Verification:**

- All tests pass consistently
- Edge cases are properly handled
- Performance meets requirements
- Error scenarios are covered

#### Task 5.2: Performance Optimization

**What:** Optimize queries and data flow for production
**Why:** Ensure good user experience with real data volumes
**Steps:**

1. Analyze query performance
2. Add database indexes if needed
3. Optimize data serialization
4. Implement pagination for large datasets

**Verification:**

- Query times are acceptable
- Memory usage is reasonable
- Large datasets don't cause performance issues
- User interface remains responsive

## Risk Assessment & Mitigation

**High Risk Items:**

1. **Data Migration** - Need to migrate existing data to new schema
   - _Mitigation_: Create comprehensive migration script with rollback capability
2. **Historical Data Performance** - Monthly/yearly data could impact query performance
   - _Mitigation_: Optimize for 1 month to 1 year data ranges, add proper indexing
3. **Authentication Integration** - All portfolio access must be authenticated
   - _Mitigation_: Test authentication thoroughly, ensure no data leaks

**Medium Risk Items:**

1. **TypeScript Type Complexity** - tRPC generates complex types
   - _Mitigation_: Test type generation at each step
2. **State Management Complexity** - Multiple data sources need coordination
   - _Mitigation_: Use react-query patterns consistently

## Success Criteria

✅ **Functional Requirements:**

- Home page displays real portfolio data from database
- All existing UI interactions continue to work
- Data updates reflect with periodic refresh
- Error states are handled gracefully

✅ **Technical Requirements:**

- tRPC procedures are properly typed
- Database queries are performant
- Caching strategy is implemented
- Code is maintainable and follows patterns

✅ **User Experience Requirements:**

- Loading states provide feedback
- Error messages are helpful
- Performance is equivalent to mock data
- No breaking changes to existing functionality

## Implementation Decisions

**Clarifications Received:**

1. **Portfolio Focus**: Focus on Portfolio model only (Position model excluded for now)
2. **Refresh Strategy**: Start with periodic refresh, migrate to real-time later if needed
3. **Data Volume**: Support 1 month to 1 year of historical data per portfolio
4. **Authentication**: All portfolio access requires authentication (no public features)
5. **Data Migration**: Migrate existing data to new schema (migration script required)

**Next Steps:**
Ready to proceed with implementation starting from Phase 1, Task 1.1
