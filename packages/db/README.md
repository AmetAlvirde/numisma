# Numisma Database Layer

This package provides repository implementations and database access utilities for the Numisma application.

## Overview

The database layer has been fully refactored to use type-safe mappers, providing better type safety when converting between Prisma models and domain models.

### Key Features

- Type-safe repositories with consistent error handling using OperationResult pattern
- Entity mappers for converting between Prisma database models and domain models
- Type guards and conversion utilities for enums and complex types
- Proper handling of DateOrGenesis for date fields
- Schema validation for all entities using Zod

### Architecture

1. **Exports**

   - Prisma client instance (from `./prisma`)
   - Repository implementations (from `./repositories`)
   - Schema validation functions (from `./schema`)
   - Utility functions including type mappers (from `./utils`)

2. **Type Usage**
   - Domain types: imported from `@numisma/types`
   - Database model types: imported directly from `@prisma/client` (not re-exported to avoid conflicts)
   - Schema validation types: exported from `./schema`
   - Type-safe conversion utilities: provided in `./utils/type-mappers` and `./utils/entity-mappers`

## Implementation Details

### Repositories

All repositories follow a consistent pattern:

- Type-safe CRUD operations
- Error handling with OperationResult
- Schema validation for create/update operations
- Type mapping between Prisma and domain models

Implemented repositories:

- Asset Repository
- Market Repository
- Portfolio Repository
- Position Repository
- Wallet Location Repository

### Type Mappers

The type mapper system provides:

- Enum conversion utilities (WalletType, PositionLifecycle, CapitalTier, etc.)
- Date/Genesis handling with proper null/undefined checks
- Entity mappers for complex types (Position, Portfolio, Market, etc.)

### Error Handling

- All database operations return an OperationResult type
- Database errors are properly mapped to domain errors
- Validation errors are handled consistently

## Development

```bash
# Generate Prisma client
npm run db:generate

# Push schema changes to database
npm run db:push

# Open Prisma Studio
npm run db:studio

# Build the package
npm run build

# Development with watch mode
npm run dev
```

## Resources

- Type definitions are in the `@numisma/types` package
- Prisma schema is in `packages/db/prisma/schema.prisma`
