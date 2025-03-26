# Data Import System Documentation

## Overview

The data import system provides a robust way to import portfolio data from JSON files or strings. It includes validation, data transformation, and error handling to ensure data integrity.

## Features

- JSON validation against TypeScript interfaces
- Data normalization for dates, numbers, and booleans
- Support for single and multiple portfolio imports
- Comprehensive error handling
- Type-safe API

## Installation

The import system is part of the core utilities and is automatically available in the project.

## Usage

### Basic Usage

```typescript
import {
  importFromJson,
  importFromFile,
} from "@/utilities/data-import/import-service";

// Import from JSON string
const result = await importFromJson(jsonString);

// Import from file
const fileResult = await importFromFile(fileObject);
```

### Import Options

You can customize the import behavior using the `ImportOptions` interface:

```typescript
interface ImportOptions {
  validate?: boolean; // Enable/disable validation
  normalizeDates?: boolean; // Normalize date strings to Date objects
  normalizeNumbers?: boolean; // Normalize numeric values
  normalizeBooleans?: boolean; // Normalize boolean values
  strict?: boolean; // Enable strict validation
}
```

Example with options:

```typescript
const result = await importFromJson(jsonString, {
  validate: true,
  normalizeDates: true,
  normalizeNumbers: true,
  normalizeBooleans: true,
  strict: false,
});
```

### Importing Multiple Portfolios

```typescript
import {
  importMultipleFromJson,
  importMultipleFromFile,
} from "@/utilities/data-import/import-service";

// Import multiple portfolios from JSON string
const results = await importMultipleFromJson(jsonString);

// Import multiple portfolios from file
const fileResults = await importMultipleFromFile(fileObject);
```

## API Reference

### Functions

#### `importFromJson(jsonString: string, options?: ImportOptions): Promise<ImportResult>`

Imports a single portfolio from a JSON string.

**Parameters:**

- `jsonString`: The JSON string containing portfolio data
- `options`: Optional import configuration

**Returns:**

```typescript
interface ImportResult {
  success: boolean;
  data?: Portfolio;
  error?: {
    message: string;
    details?: unknown;
  };
}
```

#### `importFromFile(file: File, options?: ImportOptions): Promise<ImportResult>`

Imports a single portfolio from a File object.

**Parameters:**

- `file`: The File object containing portfolio data
- `options`: Optional import configuration

**Returns:** Same as `importFromJson`

#### `importMultipleFromJson(jsonString: string, options?: ImportOptions): Promise<ImportResult[]>`

Imports multiple portfolios from a JSON string.

**Parameters:**

- `jsonString`: The JSON string containing an array of portfolio data
- `options`: Optional import configuration

**Returns:** Array of `ImportResult`

#### `importMultipleFromFile(file: File, options?: ImportOptions): Promise<ImportResult[]>`

Imports multiple portfolios from a File object.

**Parameters:**

- `file`: The File object containing an array of portfolio data
- `options`: Optional import configuration

**Returns:** Array of `ImportResult`

## Error Handling

The import system provides detailed error information through the `ImportResult` interface:

```typescript
// Example error handling
const result = await importFromJson(jsonString);

if (!result.success) {
  console.error("Import failed:", result.error?.message);
  if (result.error?.details) {
    console.error("Details:", result.error.details);
  }
} else {
  // Use the imported portfolio data
  const portfolio = result.data;
}
```

## Data Format

The import system expects portfolio data in the following format:

```typescript
interface Portfolio {
  id: string;
  name: string;
  description?: string;
  dateCreated: string | Date;
  currentValue: number;
  initialInvestment: number;
  profitLoss: number;
  returnPercentage: number;
  isPublic: boolean;
  positionIds: string[];
  tags: string[];
  targetAllocations?: {
    asset: string;
    percentage: number;
  }[];
  displayMetadata?: {
    sortOrder?: number;
    isPinned?: boolean;
  };
}
```

## Testing

The import system includes comprehensive tests. Run the tests using:

```bash
# Run tests in watch mode
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests with UI
pnpm test:ui
```

## Best Practices

1. Always validate imported data:

   ```typescript
   const result = await importFromJson(jsonString, { validate: true });
   ```

2. Handle errors appropriately:

   ```typescript
   if (!result.success) {
     // Log error and handle gracefully
     console.error(result.error?.message);
   }
   ```

3. Use type checking for imported data:

   ```typescript
   if (result.success && result.data) {
     const portfolio: Portfolio = result.data;
     // Use the portfolio data
   }
   ```

4. Consider using strict validation for production:
   ```typescript
   const result = await importFromJson(jsonString, {
     validate: true,
     strict: true,
   });
   ```

## Contributing

When adding new features or fixing bugs:

1. Add appropriate tests in `__tests__/import-service.test.ts`
2. Update this documentation
3. Ensure all tests pass
4. Follow the project's coding standards

## License

This is part of the Numisma project. See the main project license for details.
