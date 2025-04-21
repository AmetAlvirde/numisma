# Numisma Database Layer

This package provides repository implementations and database access utilities for the Numisma application.

## Setup

### Local Development

1. Create a PostgreSQL database for local development
2. Add database connection string to `.env`:
   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/numisma"
   ```
3. Generate the Prisma client:
   ```bash
   pnpm db:generate
   ```
4. Initialize the database schema:
   ```bash
   pnpm db:push
   ```

### Production Environment

1. Create a `.env.production` file with your production database connection:
   ```
   DATABASE_URL="postgresql://user:password@production-host:5432/numisma"
   ```
2. Apply the schema to production:
   ```bash
   pnpm db:push:prod
   ```

## Available Commands

### Local Development

- `pnpm db:generate` - Generate Prisma client
- `pnpm db:push` - Push schema changes to local database
- `pnpm db:migrate` - Create and apply migrations
- `pnpm db:studio` - Open Prisma Studio for local database

### Production

- `pnpm db:push:prod` - Push schema to production database
- `pnpm db:migrate:prod` - Deploy migrations to production
- `pnpm db:studio:prod` - Open Prisma Studio for production

## Architecture

This database package uses Prisma 6.6.0 with the new `prisma-client` generator that supports ESM modules.

1. **Client Configuration**

   - The Prisma client is configured in `prisma/schema.prisma`
   - We use environment variables for database connection

2. **Type Usage**
   - Domain types: imported from `@numisma/types`
   - Database model types: generated in `src/generated/prisma`
   - Schema validation: exported from `./schema`
   - Type-safe conversion utilities: provided in `./utils`

## Overview

The database layer has been fully refactored to use type-safe mappers, providing better type safety when converting between Prisma models and domain models.

### Key Features

- Type-safe repositories with consistent error handling using OperationResult pattern
- Entity mappers for converting between Prisma database models and domain models
- Type guards and conversion utilities for enums and complex types
- Proper handling of DateOrGenesis for date fields
- Schema validation for all entities using Zod

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
