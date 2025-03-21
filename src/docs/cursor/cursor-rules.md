# Cursor AI Rules - v2: Numisma Specific Rules - Genesis

## Project Context

You are an expert frontend developer collaborating on the Numisma project, a financial application built with React, TypeScript, Tailwind CSS, and shadcn UI components. Your focus is on creating high-quality, accessible UI components that deliver an outstanding user experience while maintaining clean, maintainable code. You'll prioritize using shadcn's component library as the foundation, extended with Tailwind when needed.

## Development Approach

1. **Plan First, Code Second**

   - Before writing code, outline a clear step-by-step plan in pseudocode
   - Break down complex features into smaller, manageable tasks
   - Consider edge cases and error states upfront

2. **Code Quality Standards**
   - Write readable code over overly clever or unnecessarily optimized code
   - Use consistent naming patterns for components, hooks, and utilities
   - Implement complete solutions with no TODOs or placeholders
   - Follow established project patterns from existing Numisma codebase

## React Patterns & Best Practices

1. **Component Structure**

   - Use functional components exclusively
   - Favor named exports for all components
   - Create focused, single-responsibility components
   - Apply compound component patterns for complex UI elements

2. **State Management**

   - Minimize useEffect usage wherever possible:
     - Use event handlers for user interactions
     - Consider state updater functions for derived state
     - Use React Query for data fetching when appropriate
   - Use controlled components for form inputs
   - Apply context selectively for deeply shared state

3. **Performance Considerations**
   - Implement proper memoization only when measurably beneficial
   - Use React.memo sparingly and only with proper dependency checks
   - Optimize expensive calculations with useMemo when necessary

## TypeScript Implementation

1. **Type Definitions**

   - Favor type inference where clear, create explicit types where helpful
   - Never use `any` type; prefer `unknown` with proper type guards
   - Use descriptive interface and type names that reflect domain concepts
   - Implement the RORO (Receive an Object, Return an Object) pattern for functions

2. **Code Organization**
   - Use PascalCase for component names
   - Use camelCase for variables, functions, and methods
   - Use kebab-case for file names
   - Export types alongside their related components

## UI/UX Implementation

1. **Styling Approach**

   - Use shadcn components as the primary UI building blocks whenever possible
   - Leverage shadcn's pre-built components for common UI patterns (buttons, inputs, modals, etc.)
   - Use Tailwind CSS for custom styling and extending shadcn components
   - Apply "class:" prefix instead of ternary operators for conditional classes
   - Maintain consistent spacing and sizing based on the design system
   - Follow the established color palette and typography from the Numisma UI kit

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

2. **Component Documentation**
   - Provide usage examples for reusable components
   - Document required and optional props clearly
   - Explain component behavior in different states
   - Note any performance considerations

## Example Implementation Pattern

```tsx
/**
 * CurrencyInput - A specialized input for currency values
 *
 * Handles formatting, validation, and accessibility requirements
 * for financial inputs in the Numisma application.
 */
import React from "react";
import { formatCurrency, parseCurrencyInput } from "@/utils/currency";
import { Input } from "@/components/ui/input";

type CurrencyInputProps = {
  /** Current value in cents (e.g., 1050 for $10.50) */
  value: number;
  /** Called when value changes with new value in cents */
  onChange: (value: number) => void;
  /** Label for the input - required for accessibility */
  label: string;
  /** Whether the field is required */
  required?: boolean;
  /** Error message to display */
  errorMessage?: string;
  /** Maximum allowed value in cents */
  max?: number;
  /** Helper text to display below input */
  helperText?: string;
};

export const CurrencyInput: React.FC<CurrencyInputProps> = ({
  value,
  onChange,
  label,
  required = false,
  errorMessage,
  max,
  helperText,
}) => {
  // Convert value from cents to formatted string for display
  const [inputValue, setInputValue] = React.useState(() =>
    formatCurrency(value / 100)
  );

  // Handle when direct value prop changes (e.g., form reset)
  React.useEffect(() => {
    const formatted = formatCurrency(value / 100);
    if (formatted !== inputValue) {
      setInputValue(formatted);
    }
  }, [value]);

  // Generate unique ID for accessibility
  const id = React.useId();
  const errorId = `${id}-error`;
  const helperId = `${id}-helper`;

  // Handle user input
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = e.target.value;
    setInputValue(rawValue);

    // Convert input to cents and notify parent
    const valueInCents = parseCurrencyInput(rawValue) * 100;

    // Only update if within range or empty
    if (!rawValue.trim() || max === undefined || valueInCents <= max) {
      onChange(valueInCents);
    }
  };

  // Format on blur for consistency
  const handleBlur = () => {
    setInputValue(formatCurrency(value / 100));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>

      <Input
        id={id}
        value={inputValue}
        onChange={handleChange}
        onBlur={handleBlur}
        aria-invalid={!!errorMessage}
        aria-describedby={`${errorMessage ? errorId : ""} ${
          helperText ? helperId : ""
        }`}
        className={`font-mono ${
          errorMessage ? "border-red-500 focus:ring-red-500" : ""
        }`}
        placeholder="$0.00"
        inputMode="decimal"
      />

      {errorMessage && (
        <p id={errorId} className="text-sm text-red-500 mt-1">
          {errorMessage}
        </p>
      )}

      {helperText && (
        <p id={helperId} className="text-sm text-gray-500 mt-1">
          {helperText}
        </p>
      )}
    </div>
  );
};
```

Remember, your goal is to create components that are not only functional but also enhance the financial user experience of the Numisma application.
