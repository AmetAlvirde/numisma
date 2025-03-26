# Numisma Data Architecture

## Core Entities

### Position

The central entity representing a single investment (long or short) in a crypto asset.

```typescript
export interface Position {
  /** Unique identifier for the position */
  id: string;

  /** Human-readable name for the position */
  name: string;

  /** Current lifecycle stage of the position */
  lifecycle: PositionLifecycle;

  /** History of lifecycle transitions */
  lifecycleHistory: LifecycleTransition[];

  /** Current capital tier */
  capitalTier: CapitalTier;

  /** History of capital tier transitions */
  capitalTierHistory: CapitalTierTransition[];

  /** Risk level (1-10) */
  riskLevel: number;

  /** Hot or cold wallet storage */
  walletType: WalletType;

  /** Trading strategy classification */
  strategy: string;

  /** Detailed trading thesis (optional) */
  thesis?: Thesis;

  /** Trading journal entries (optional) */
  journal?: JournalEntry[];

  /** Asset being traded */
  asset: Asset;

  /** Core position execution details */
  positionDetails: PositionDetails;

  /** Performance metrics */
  metrics?: PositionMetrics;
}
```

### Portfolio

A collection of positions grouped for organizational or analysis purposes.

```typescript
export interface Portfolio {
  /** Unique identifier for the portfolio */
  id: string;

  /** Human-readable name for the portfolio */
  name: string;

  /** Optional description */
  description?: string;

  /** When the portfolio was created */
  dateCreated: DateOrGenesis;

  /** Status of the portfolio */
  status: "active" | "archived";

  /** User who owns this portfolio */
  userId: string;

  /** Optional tags for categorization */
  tags?: string[];

  /** Additional notes or context */
  notes?: string;

  /** Metadata for UI display purposes */
  displayMetadata?: {
    color?: string;
    sortOrder?: number;
    isPinned?: boolean;
  };
}
```

### PortfolioPosition

Junction entity enabling many-to-many relationship between portfolios and positions.

```typescript
export interface PositionPortfolio {
  /** Position reference */
  positionId: string;

  /** Portfolio reference */
  portfolioId: string;

  /** When the position was added to the portfolio */
  addedAt: Date;

  /** Who added the position */
  addedBy: string;

  /** Whether position is hidden in portfolio view */
  isHidden: boolean;

  /** Display order in the portfolio */
  displayOrder?: number;
}
```

### PortfolioValuation

Time-based record of a portfolio's state and performance.

```typescript
export interface PortfolioValuation {
  /** Unique identifier for the valuation record */
  id: string;

  /** Reference to the portfolio this valuation represents */
  portfolioId: string;

  /** When the valuation was taken/calculated */
  timestamp: Date;

  /** Comprehensive temporal classification */
  temporalMetadata: TemporalMetadata;

  /** Aggregation information */
  aggregationMetadata: AggregationMetadata;

  /** Time series grouping information */
  timeSeriesMetadata?: TimeSeriesMetadata;

  /** Total portfolio value at this time */
  totalValue: number;

  /** Currency of the total value */
  valueCurrency: string;

  /** Initial investment amount */
  initialInvestment: number;

  /** Absolute profit/loss at this time */
  profitLoss: number;

  /** Percentage return at this time */
  percentageReturn: number;

  /** Position valuations in the portfolio at this time */
  positionValuations: PositionValuation[];

  /** Standard reference point comparisons */
  referenceComparisons?: ReferenceComparisons;

  /** Whether this valuation was created retroactively */
  isRetroactive: boolean;

  /** Additional market context */
  marketContext?: {
    btcPrice?: number;
    ethPrice?: number;
    totalMarketCap?: number;
    fearGreedIndex?: number;
  };
}
```

## Key Types

### Position Lifecycle

```typescript
/** Position lifecycle states */
export type PositionLifecycle = "planned" | "building" | "active" | "closed";

/** Transition between lifecycle states */
export interface LifecycleTransition {
  from: PositionLifecycle;
  to: PositionLifecycle;
  timestamp: Date;
  userId: string;
  notes?: string;
  relatedOrderIds?: string[];
}
```

### Capital Tier

```typescript
/** Capital tier classification */
export type CapitalTier = "C1" | "C2" | "C3" | "C4" | "C5";

/** Capital tier transition */
export interface CapitalTierTransition {
  from: CapitalTier;
  to: CapitalTier;
  timestamp: Date;
  amountSecured: number;
  relatedOrderId: string;
  notes?: string;
}
```

### Asset Location

```typescript
/** Asset location classification */
export type AssetLocation =
  | "exchange"
  | "hardwareWallet"
  | "paperWallet"
  | "softwareWallet"
  | "custodial"
  | "other";

/** Exchange account types */
export type ExchangeAccountType =
  | "spot"
  | "margin"
  | "futures"
  | "earn"
  | "staking"
  | "savings"
  | "other";

/** Enhanced Asset interface */
export interface Asset {
  name: string;
  ticker: string;
  pair: string;
  location: AssetLocation;
  exchangeDetails?: {
    name: string;
    accountType: ExchangeAccountType;
    subAccount?: string;
  };
  coldStorageDetails?: {
    provider?: string;
    model?: string;
    label: string;
    securityNotes?: string;
  };
  customLocationDetails?: {
    description: string;
    identifier: string;
  };
}
```

### Currency Types

```typescript
/** Currency type classification */
export type CurrencyType = "cryptocurrency" | "stablecoin" | "fiat";

/** Stablecoin peg type */
export type StablecoinPegType = "USD" | "EUR" | "GOLD" | "BTC" | "OTHER";
```

### Time-Based Types

```typescript
/** Special date type supporting "genesis" */
export type DateOrGenesis = Date | string | "genesis";

/** Time frame unit for valuation periods */
export type TimeFrameUnit =
  | "day"
  | "week"
  | "month"
  | "quarter"
  | "year"
  | "genesis"
  | "custom";

/** Time frame granularity for source data */
export type TimeFrameGranularity =
  | "intraday"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "yearly"
  | "genesis";
```

## Entity Relationships

1. **User → Portfolio**:

   - One-to-many: A user can have multiple portfolios

2. **Portfolio ↔ Position**:

   - Many-to-many: Positions can be in multiple portfolios
   - Connected via PositionPortfolio junction entity

3. **Position → Asset**:

   - One-to-one: A position trades a single asset

4. **Position → PositionDetails**:

   - One-to-one: Position details contain orders, stop loss, take profit

5. **Position → LifecycleTransition**:

   - One-to-many: A position has a history of lifecycle transitions

6. **Position → CapitalTierTransition**:

   - One-to-many: A position has a history of capital tier transitions

7. **Portfolio → PortfolioValuation**:

   - One-to-many: A portfolio has valuations at different points in time

8. **PortfolioValuation → PositionValuation**:

   - One-to-many: A portfolio valuation contains valuations of all positions

9. **Position → PositionValuation**:
   - One-to-many: A position has valuations at different points in time

## Data Flow Patterns

1. **Position Creation Flow**:

   - Create Position → Add to Portfolio → Update PositionPortfolio

2. **Lifecycle Transition Flow**:

   - Update Position Lifecycle → Add LifecycleTransition → Update Metrics

3. **Capital Tier Evolution Flow**:

   - Execute Order → Calculate Capital Recovery → Update Capital Tier → Add CapitalTierTransition

4. **Valuation Creation Flow**:

   - Get Market Prices → Calculate Position Values → Create PositionValuations → Create PortfolioValuation

5. **Historical Data Flow**:
   - Input Price Points → Calculate Valuations → Create Time Series → Build Performance Metrics
