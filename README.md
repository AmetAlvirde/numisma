# Numisma

Numisma is a comprehensive financial platform designed for independent
investors and traders who want to visualize their portfolio performance and
manage trading positions effectively. The application enables data-driven
decision making through advanced analytics, position tracking, and portfolio
management.

## Project Overview

Numisma helps traders and investors by providing:

- Portfolio performance tracking and visualization over time
- Position management with detailed entry/exit strategies
- Risk management tools including stop-loss and take-profit tracking
- Multiple timeframe analysis of trading performance
- Journal capabilities for capturing trading thesis and learnings

This project is built as a monorepo using Turborepo, allowing for modular
development while maintaining a consistent codebase across multiple applications
and packages.

## Project Status

This monorepo currently contains the foundational packages with plans to expand
into a complete ecosystem of applications:

- Foundation: Core types and database layers are implemented
- In Development: UI component library and applications

## Packages Overview

### @numisma/types

Core domain types that define the data model for the entire application. This
package contains TypeScript interfaces and type definitions for all domain
entities such as Portfolio, Position, and Asset.

### @numisma/db

Database layer that provides repository implementations and database access
utilities. This package uses Prisma ORM to interact with the PostgreSQL database
and implements the repository pattern for clean data access.

### @numisma/ui

UI component library ("Component Forest") that will provide reusable React
components for building consistent user interfaces. This package builds on
shadcn UI components and Tailwind CSS for styling.

## Applications

### Web Application (apps/web)

The main application that will deliver portfolio management, position
tracking, and performance analytics for traders and investors.

### Admin Application (apps/admin)

Back office application for data management and administrative tasks. This
application will provide CRUD operations for all entities and content management.

### Documentation (apps/docs)

Knowledge base and documentation site. This site will serve as a central hub
or developer resources, user guides, and API references.
