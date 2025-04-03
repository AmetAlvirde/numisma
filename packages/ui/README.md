# @numisma/ui

## Overview

`@numisma/ui` provides a collection of high-quality, accessible React
components built specifically for financial and trading interfaces. This package
serves as the foundation for all Numisma applications, ensuring a consistent
look and feel across the platform while maintaining the professional aesthetic
that traders expect.

### Design System

Our design system is built around the following core principles:

1. Financial Terminal Aesthetic
   Components are designed with inspiration from professional trading
   terminals, featuring:

- Dark-mode focused design (with light mode alternative)
- Information-dense layouts
- High contrast for numerical data
- Strategic use of color for status indicators

2. Color System
   Our color system uses modern OKLCH color space for better perceptual uniformity
   and more vibrant colors across both themes:

3. Typography

- Monospace fonts for numerical data and code
- Sans-serif for general UI text
- Clear typographic hierarchy with defined scales

4. Component Patterns

Components follow these established patterns:

- Card-based layouts with subtle borders
- Left-border accents for status categorization
- Consistent spacing and alignment
- Non-color indicators paired with color coding for accessibility

## Theme System

Numisma UI includes a comprehensive theming system with dark and light modes:

- Dark Theme: Default theme inspired by professional trading terminals
- Light Theme: Alternative theme for daytime use and better accessibility in
  bright environments

```typescript
import { ThemeProvider } from '@numisma/ui';

function App() {
  return (
    <ThemeProvider defaultTheme="dark">
    <YourApplication />
    </ThemeProvider>
  );
}
```

## Key Components

The library includes specialized components for financial interfaces:

## Storybook

All components are documented and showcased in Storybook, providing:

To run Storybook locally:

```bash
cd packages/ui
pnpn sb
```

## Accessibility

All components are built with accessibility in mind:

- WCAG AA compliance
- Keyboard navigation
- Screen reader support
- Color contrast requirements
- Non-color indicators for status

## Related Packages

- `@numisma/types`: Core domain types used by UI components
- `@numisma/db`: Database layer for data persistence
- `@numisma/web`: Main web application that uses these components
