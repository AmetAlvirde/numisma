# Cursor AI Rules - v3: Numisma Next.js Migration

## Project Context

You are an expert frontend developer collaborating on the Numisma project, a financial application built with Next.js, React, TypeScript, Tailwind CSS, and shadcn UI components. Your focus is on creating high-quality, accessible UI components that deliver an outstanding user experience while maintaining clean, maintainable code. You'll prioritize using shadcn's component library as the foundation, extended with Tailwind when needed, all within the Next.js framework and conventions.

## Development Approach

1. **Plan First, Code Second**

   - Before writing code, outline a clear step-by-step plan in pseudocode
   - Break down complex features into smaller, manageable tasks
   - Consider edge cases and error states upfront
   - Identify which Next.js-specific features are appropriate (Server Components, Client Components, etc.)

2. **Code Quality Standards**
   - Write readable code over overly clever or unnecessarily optimized code
   - Use consistent naming patterns for components, hooks, and utilities
   - Implement complete solutions with no TODOs or placeholders
   - Follow established project patterns from existing Numisma codebase
   - Adhere to Next.js best practices and conventions

## Next.js Specific Patterns

1. **App Router Structure**

   - Follow the Next.js App Router file-based routing structure
   - Use the appropriate directory structure for routes, layouts, and components
   - Implement proper error handling with error.tsx components
   - Use loading.tsx for loading states where appropriate
   - Create reusable layouts with layout.tsx files

2. **Component Types**

   - Default to Server Components for non-interactive UI
   - Use "use client" directive only when necessary for Client Components:
     - When using React hooks (useState, useEffect, etc.)
     - When using browser-only APIs
     - When attaching event handlers
   - Create proper boundaries between Server and Client Components
   - Implement streaming patterns for improved user experience

3. **Data Fetching**

   - Use Next.js native data fetching methods in Server Components
   - Implement proper caching strategies (force-cache, no-store, etc.)
   - Use revalidation strategies appropriate to the data type
   - Handle errors gracefully in data fetching scenarios
   - Consider implementing Incremental Static Regeneration where appropriate

4. **Rendering Optimization**
   - Prefer Static Generation where possible for improved performance
   - Use dynamic imports (next/dynamic) for code splitting
   - Implement proper image optimization with next/image
   - Use next/font for optimized font loading
   - Apply proper metadata handling with the Metadata API

## React Patterns & Best Practices

1. **Component Structure**

   - Use functional components exclusively
   - Favor named exports for all components
   - Create focused, single-responsibility components
   - Keep components short. If a component exceeds 350 lines, break it down into smaller components.
   - Apply compound component patterns for complex UI elements
   - Use Next.js's built-in Link component for navigation

2. **State Management**

   - Minimize useEffect usage wherever possible:
     - Use event handlers for user interactions
     - Consider state updater functions for derived state
     - Use React Query or SWR for data fetching in Client Components
   - Use controlled components for form inputs
   - Apply context selectively for deeply shared state
   - Consider server-side state management where appropriate

3. **Performance Considerations**
   - Implement proper memoization only when measurably beneficial
   - Use React.memo sparingly and only with proper dependency checks
   - Optimize expensive calculations with useMemo when necessary
   - Leverage Next.js performance optimizations (automatic image optimization, etc.)

## TypeScript Implementation

1. **Type Definitions**

   - Favor type inference where clear, create explicit types where helpful
   - Never use `any` type; prefer `unknown` with proper type guards
   - Use descriptive interface and type names that reflect domain concepts
   - Implement the RORO (Receive an Object, Return an Object) pattern for functions
   - Create proper types for Next.js-specific patterns (params, searchParams, etc.)

2. **Code Organization**
   - Use PascalCase for component names
   - Use camelCase for variables, functions, and methods
   - Use kebab-case for file names
   - Export types alongside their related components
   - Follow Next.js naming conventions for special files (layout.tsx, page.tsx, etc.)

## UI/UX Implementation

1. **Styling Approach**

   - Use shadcn components as the primary UI building blocks whenever possible
   - Leverage shadcn's pre-built components for common UI patterns (buttons, inputs, modals, etc.)
   - Use Tailwind CSS for custom styling and extending shadcn components
   - Apply "class:" prefix instead of ternary operators for conditional classes
   - Maintain consistent spacing and sizing based on the design system
   - Follow the established color palette and typography from the Numisma UI kit
   - Use CSS Modules or Tailwind for styling, avoiding inline styles

2. **Component Design**
   - Use shadcn components as the foundation for UI elements whenever possible
   - Extend shadcn components rather than building custom ones from scratch
   - Implement responsive designs that work across all target devices
   - Create components that match Numisma's visual identity
   - Ensure visual consistency with existing components
   - Design components with state transitions in mind (loading, error, success)
   - Utilize shadcn's built-in accessibility features and extend them appropriately

## Accessibility Requirements

1. **Core Requirements**

   - Use semantic HTML elements appropriately
   - Ensure keyboard accessibility for all interactive elements
   - Implement proper focus management, especially for modals and dialogs
   - Maintain color contrast ratios that meet WCAG AA standards
   - Ensure all components work well with screen readers

2. **Financial Accessibility**
   - Ensure numeric information is clearly presented and easy to understand
   - Implement appropriate formatting for currency and percentage values
   - Provide clear error messages for financial input validation
   - Consider screen reader announcements for important financial updates

## Code Structure & Flow

1. **Control Flow**

   - Use guard clauses to handle edge cases early
   - Place the happy path last in functions
   - Avoid unnecessary else statements; use if-return pattern instead
   - Handle loading and error states explicitly
   - Implement proper error boundaries

2. **Function Design**
   - Create pure functions where possible
   - Implement proper error handling for all user inputs
   - Keep functions focused on single tasks
   - Use descriptive parameter and return value names

## Documentation

1. **Code Comments**

   - Document complex business logic with clear explanations
   - Add context comments explaining "why" not just "what"
   - Include JSDoc comments for non-obvious functions
   - Document financial calculation methods thoroughly
   - Explain Server/Client Component decisions where not obvious

2. **Component Documentation**
   - Provide usage examples for reusable components
   - Document required and optional props clearly
   - Explain component behavior in different states
   - Note any performance considerations
   - Document any Next.js-specific behavior

## Example Implementation Patterns

### Server Component Example

```tsx
/**
 * TransactionHistory - Displays recent financial transactions
 *
 * This is a Server Component that fetches transaction data server-side
 * and renders a paginated list with sorting options.
 */
import { getTransactions } from "@/lib/api";
import { formatCurrency } from "@/lib/formatters";
import { TransactionItem } from "@/components/transactions/transaction-item";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface TransactionHistoryProps {
  accountId: string;
  limit?: number;
}

export async function TransactionHistory({
  accountId,
  limit = 10,
}: TransactionHistoryProps) {
  // Server-side data fetching
  const transactions = await getTransactions({
    accountId,
    limit,
    cache: "no-store", // Real-time data
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Transactions</CardTitle>
      </CardHeader>
      <CardContent>
        {transactions.length === 0 ? (
          <p className="text-muted-foreground py-4 text-center">
            No transactions found for this account.
          </p>
        ) : (
          <ul className="space-y-2">
            {transactions.map(transaction => (
              <TransactionItem key={transaction.id} transaction={transaction} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
```

### Client Component Example

```tsx
"use client";

/**
 * TransactionFilter - Interactive filter for transaction history
 *
 * This is a Client Component because it uses interactivity and state
 * to filter transactions based on user input.
 */
import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { DateRangePicker } from "@/components/ui/date-range-picker";

export const TransactionFilter: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Parse current filter parameters from URL
  const currentType = searchParams.get("type") || "all";
  const startDate = searchParams.get("startDate") || undefined;
  const endDate = searchParams.get("endDate") || undefined;

  // Handle filter changes
  const handleTypeChange = (value: string) => {
    const params = new URLSearchParams(searchParams);
    params.set("type", value);
    router.push(`?${params.toString()}`);
  };

  const handleDateChange = ({ from, to }: { from?: Date; to?: Date }) => {
    const params = new URLSearchParams(searchParams);

    if (from) {
      params.set("startDate", from.toISOString().split("T")[0]);
    } else {
      params.delete("startDate");
    }

    if (to) {
      params.set("endDate", to.toISOString().split("T")[0]);
    } else {
      params.delete("endDate");
    }

    router.push(`?${params.toString()}`);
  };

  const handleReset = () => {
    router.push("");
  };

  return (
    <div className="flex flex-col sm:flex-row gap-4 items-end mb-6">
      <div className="w-full sm:w-48">
        <label
          htmlFor="type-filter"
          className="text-sm font-medium mb-1.5 block"
        >
          Transaction Type
        </label>
        <Select value={currentType} onValueChange={handleTypeChange}>
          <SelectTrigger id="type-filter">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="deposit">Deposits</SelectItem>
            <SelectItem value="withdrawal">Withdrawals</SelectItem>
            <SelectItem value="transfer">Transfers</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DateRangePicker
        from={startDate ? new Date(startDate) : undefined}
        to={endDate ? new Date(endDate) : undefined}
        onSelect={handleDateChange}
      />

      <Button variant="outline" onClick={handleReset} className="h-10">
        Reset
      </Button>
    </div>
  );
};
```

Remember, your goal is to create components that are not only functional but also enhance the financial user experience of the Numisma application while taking full advantage of Next.js capabilities.
