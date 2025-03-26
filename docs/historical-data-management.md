# Numisma Historical Data Management

## Overview

Historical data management is a critical component of Numisma, enabling traders to track portfolio performance over time. The system supports both real-time and retroactive data entry, allowing users to reconstruct their trading history and analyze performance across different time periods.

## Historical Data Concepts

### 1. Historical Price Points

Historical price points represent the state of a portfolio at a specific point in time, including:

- Asset prices
- Position holdings
- Position changes (buys, sells, transfers)
- Market context (BTC price, ETH price, total market cap, etc.)

### 2. Portfolio Valuations

Portfolio valuations are generated from historical price points and include:

- Total portfolio value
- Position-specific values
- Performance metrics (profit/loss, percentage return)
- Reference comparisons (vs. previous periods)

### 3. Time Series Management

Time series relationships connect valuations across time, facilitating:

- Sequential analysis (period-to-period)
- Hierarchical analysis (daily → weekly → monthly → quarterly → yearly)
- Comparative analysis (year-over-year, month-over-month)

## Data Model

### Historical Price Point

```typescript
export interface HistoricalPricePoint {
  /** When the price point was recorded */
  timestamp: Date;
  
  /** Asset prices at this time */
  assetPrices: Record<string, number>; // ticker → price
  
  /** Changes to asset holdings during this period */
  assetHoldingChanges?: Record<string, AssetHoldingChange[]>; // ticker → changes
  
  /** Additional market context */
  marketContext?: {
    btcPrice?: number;
    ethPrice?: number;
    totalMarketCap?: number;
    fearGreedIndex?: number;
  };
}

export interface AssetHoldingChange {
  /** Type of change */
  type: 'buy' | 'sell' | 'transfer' | 'receive';
  
  /** Position affected by this change */
  positionId: string;
  
  /** Amount of the asset changed */
  quantity: number;
  
  /** Price at which the change occurred (for buys/sells) */
  price?: number;
  
  /** When the change occurred */
  timestamp: Date;
  
  /** Additional notes about the change */
  notes?: string;
}
```

### Temporal Metadata

```typescript
export interface TemporalMetadata {
  /** Year of the valuation (e.g., 2025) */
  year: number;
  
  /** Quarter of the year (1-4) */
  quarter?: number;
  
  /** Month of the year (1-12) */
  month?: number;
  
  /** Week of the year (1-53) */
  week?: number;
  
  /** Day of the month (1-31) */
  day?: number;
  
  /** Day of the year (1-366) */
  dayOfYear?: number;
  
  /** ISO week number */
  isoWeek?: number;
  
  /** ISO week year (may differ from calendar year at year boundaries) */
  isoWeekYear?: number;
  
  /** Formatted period identifier (e.g., "2024-W12", "2024-Q1", "2024-03-15") */
  periodKey: string;
  
  /** Human-readable period name (e.g., "March 2024", "Q1 2024", "Week 12, 2024") */
  periodName: string;
  
  /** Type of time frame this valuation represents */
  timeFrameUnit: TimeFrameUnit;
  
  /** Start date of this time period */
  periodStart: Date;
  
  /** End date of this time period */
  periodEnd: Date;
  
  /** Whether this marks the end of a specific timeframe (e.g., quarter-end) */
  isTimeframeBoundary: boolean;
}
```

### Time Series Metadata

```typescript
export interface TimeSeriesMetadata {
  /** ID for the time series this valuation belongs to */
  timeSeriesId: string;
  
  /** Human-readable name for the time series */
  timeSeriesName: string;
  
  /** Position in the sequence (e.g., week 3 of 52) */
  sequenceNumber: number;
  
  /** Total items in this series */
  totalInSeries: number;
  
  /** Whether this is the first item in the series */
  isFirst: boolean;
  
  /** Whether this is the last item in the series */
  isLast: boolean;
  
  /** ID of the previous valuation in this series */
  previousInSeriesId?: string;
  
  /** ID of the next valuation in this series */
  nextInSeriesId?: string;
  
  /** Parent time series ID (e.g., the quarterly series that contains this monthly series) */
  parentTimeSeriesId?: string;
  
  /** Child time series ID (e.g., the weekly series contained within this monthly valuation) */
  childTimeSeriesId?: string;
}
```

## Key Processes

### 1. Historical Data Input Process

The process for adding historical data points:

1. **Select Time Point**: Choose the date for the historical data
2. **Enter Asset Prices**: Record market prices for all assets in the portfolio
3. **Record Position Changes**: Document any buys, sells, or transfers during the period
4. **Add Market Context**: Record broader market metrics for reference
5. **Validate & Save**: Validate the data and save it to the system
6. **Generate Valuation**: Create a portfolio valuation from the historical data

```typescript
/**
 * Add a historical price point to the system
 */
export async function addHistoricalPricePoint(
  portfolioId: string,
  pricePoint: HistoricalPricePoint
): Promise<PortfolioValuation> {
  // 1. Validate the price point data
  validateHistoricalPricePoint(portfolioId, pricePoint);
  
  // 2. Process any position changes
  if (pricePoint.assetHoldingChanges) {
    await processPositionChanges(portfolioId, pricePoint.assetHoldingChanges, pricePoint.timestamp);
  }
  
  // 3. Get portfolio and positions
  const portfolio = await getPortfolio(portfolioId);
  const positions = await getPortfolioPositions(portfolioId);
  
  // 4. Generate the portfolio valuation
  const valuation = generatePortfolioValuation(
    portfolio,
    positions,
    pricePoint
  );
  
  // 5. Save the valuation
  await savePortfolioValuation(valuation);
  
  // 6. Update time series metadata
  await updateTimeSeriesMetadata(valuation);
  
  // 7. Return the created valuation
  return valuation;
}
```

### 2. Valuation Generation Process

The process for generating a portfolio valuation from a historical price point:

1. **Calculate Position Values**: Compute value for each position using price and quantity
2. **Calculate Portfolio Totals**: Sum position values and calculate portfolio metrics
3. **Create Temporal Metadata**: Generate time period classification metadata
4. **Identify Reference Points**: Determine comparison points (previous, YoY, MoM, etc.)
5. **Build Comparison Metrics**: Calculate performance vs. reference points
6. **Create Time Series Links**: Connect the valuation to related time series

```typescript
/**
 * Generate a portfolio valuation from a historical price point
 */
export function generatePortfolioValuation(
  portfolio: Portfolio,
  positions: Position[],
  pricePoint: HistoricalPricePoint
): PortfolioValuation {
  // 1. Calculate position valuations
  const positionValuations = positions.map(position => {
    // Get price for this asset
    const price = pricePoint.assetPrices[position.asset.ticker];
    if (!price) {
      throw new Error(`Missing price for ${position.asset.ticker}`);
    }
    
    // Calculate position value
    return calculatePositionValuation(position, price, pricePoint.timestamp);
  });
  
  // 2. Calculate portfolio totals
  const totalValue = sum(positionValuations.map(pv => pv.value));
  const initialInvestment = sum(positionValuations.map(pv => pv.costBasis));
  const profitLoss = totalValue - initialInvestment;
  const percentageReturn = initialInvestment > 0
    ? (profitLoss / initialInvestment) * 100
    : 0;
  
  // 3. Create temporal metadata
  const temporalMetadata = createTemporalMetadata(pricePoint.timestamp);
  
  // 4. Create the portfolio valuation
  return {
    id: generateId(),
    portfolioId: portfolio.id,
    timestamp: pricePoint.timestamp,
    temporalMetadata,
    aggregationMetadata: {
      isAggregated: false,
      aggregationMethod: "close",
      sourceGranularity: "intraday",
      targetGranularity: timeFrameUnitToGranularity(temporalMetadata.timeFrameUnit)
    },
    totalValue,
    valueCurrency: "USD",
    initialInvestment,
    profitLoss,
    percentageReturn,
    positionValuations,
    isRetroactive: true,
    marketContext: pricePoint.marketContext
  };
}
```

### 3. Time Series Management Process

The process for managing time series relationships between valuations:

1. **Identify Related Valuations**: Find valuations in the same time series
2. **Determine Sequence**: Order valuations chronologically
3. **Assign Sequence Numbers**: Number valuations in sequence
4. **Link Valuations**: Create references to previous and next valuations
5. **Establish Hierarchy**: Connect to parent/child time series
6. **Update Metadata**: Save time series metadata to all related valuations

```typescript
/**
 * Update time series metadata for a new valuation
 */
export async function updateTimeSeriesMetadata(
  newValuation: PortfolioValuation
): Promise<void> {
  // 1. Get all portfolio valuations
  const allValuations = await getPortfolioValuations(newValuation.portfolioId);
  
  // 2. Create time series metadata for the new valuation
  const timeSeriesMetadata = createTimeSeriesMetadata(
    newValuation,
    allValuations
  );
  
  // 3. Update the new valuation with time series metadata
  await updatePortfolioValuationMetadata(
    newValuation.id,
    { timeSeriesMetadata }
  );
  
  // 4. Update references in related valuations
  if (timeSeriesMetadata.previousInSeriesId) {
    await updateNextInSeries(
      timeSeriesMetadata.previousInSeriesId,
      newValuation.id
    );
  }
  
  if (timeSeriesMetadata.nextInSeriesId) {
    await updatePreviousInSeries(
      timeSeriesMetadata.nextInSeriesId,
      newValuation.id
    );
  }
}

/**
 * Create time series metadata for a valuation
 */
export function createTimeSeriesMetadata(
  valuation: PortfolioValuation,
  allValuations: PortfolioValuation[]
): TimeSeriesMetadata {
  // 1. Filter valuations for same portfolio and time frame unit
  const sameSeriesValuations = allValuations.filter(v => 
    v.portfolioId === valuation.portfolioId &&
    v.temporalMetadata.timeFrameUnit === valuation.temporalMetadata.timeFrameUnit
  );
  
  // 2. Sort by timestamp
  const sortedValuations = [...sameSeriesValuations].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );
  
  // 3. Find position in sequence
  const index = sortedValuations.findIndex(v => v.id === valuation.id);
  
  // 4. Create time series ID based on time frame
  const { year, timeFrameUnit } = valuation.temporalMetadata;
  const timeSeriesId = `${valuation.portfolioId}-${timeFrameUnit}-${year}`;
  
  // 5. Create time series name
  const timeSeriesName = formatTimeSeriesName(timeFrameUnit, year);
  
  // 6. Find previous and next in series
  const previousInSeriesId = index > 0 ? sortedValuations[index - 1].id : undefined;
  const nextInSeriesId = index < sortedValuations.length - 1 ? sortedValuations[index + 1].id : undefined;
  
  // 7. Find parent time series
  const parentTimeSeriesId = findParentTimeSeries(valuation);
  
  // 8. Find child time series
  const childTimeSeriesId = findChildTimeSeries(valuation);
  
  // 9. Return time series metadata
  return {
    timeSeriesId,
    timeSeriesName,
    sequenceNumber: index + 1,
    totalInSeries: sortedValuations.length,
    isFirst: index === 0,
    isLast: index === sortedValuations.length - 1,
    previousInSeriesId,
    nextInSeriesId,
    parentTimeSeriesId,
    childTimeSeriesId
  };
}
```

## Historical Data Aggregation

### 1. Aggregation Process

The process for aggregating historical data into higher timeframes:

1. **Group by Time Period**: Group valuations by target timeframe
2. **Select Aggregation Method**: Choose method (close, open, high, low, average)
3. **Calculate Aggregated Values**: Apply method to source valuations
4. **Create Aggregated Valuation**: Generate new valuation with aggregation metadata
5. **Link to Source Valuations**: Maintain references to source data
6. **Create Time Series Relationships**: Connect to related aggregated valuations

```typescript
/**
 * Aggregate daily valuations to weekly valuations
 */
export function aggregateDailyToWeekly(
  dailyValuations: PortfolioValuation[]
): PortfolioValuation[] {
  // 1. Group valuations by week
  const weeklyGroups = groupValuationsByWeek(dailyValuations);
  
  // 2. For each week, create an aggregated valuation
  return Object.entries(weeklyGroups).map(([weekKey, valuations]) => {
    // 3. Sort valuations by date
    const sortedValuations = [...valuations].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    
    // 4. Get week start and end dates
    const startDate = sortedValuations[0].timestamp;
    const endDate = sortedValuations[sortedValuations.length - 1].timestamp;
    
    // 5. Get closing valuation (last day of week)
    const closingValuation = sortedValuations[sortedValuations.length - 1];
    
    // 6. Create temporal metadata for the week
    const temporalMetadata = createWeeklyTemporalMetadata(endDate);
    
    // 7. Create the aggregated valuation
    return {
      id: generateId(),
      portfolioId: closingValuation.portfolioId,
      timestamp: endDate,
      temporalMetadata,
      aggregationMetadata: {
        isAggregated: true,
        aggregationMethod: "close",
        sourceGranularity: "daily",
        targetGranularity: "weekly",
        sourceValuationIds: valuations.map(v => v.id),
        sourceCount: valuations.length,
        coveragePercentage: calculateCoveragePercentage(startDate, endDate, valuations)
      },
      totalValue: closingValuation.totalValue,
      valueCurrency: closingValuation.valueCurrency,
      initialInvestment: closingValuation.initialInvestment,
      profitLoss: closingValuation.profitLoss,
      percentageReturn: closingValuation.percentageReturn,
      positionValuations: closingValuation.positionValuations,
      isRetroactive: closingValuation.isRetroactive,
      marketContext: closingValuation.marketContext
    };
  });
}
```

### 2. Aggregation Methods

Different methods for aggregating valuations:

| Method | Description | Use Case |
|--------|-------------|----------|
| Close | Use the last valuation in the period | Standard for financial reporting |
| Open | Use the first valuation in the period | Starting point analysis |
| High | Use the highest value in the period | Peak performance analysis |
| Low | Use the lowest value in the period | Risk analysis |
| Average | Use the average of all valuations | Smoothing volatility |
| Weighted | Use time-weighted average | Advanced performance metrics |

```typescript
/**
 * Aggregate valuations using specified method
 */
export function aggregateValuations(
  valuations: PortfolioValuation[],
  method: AggregationMethod
): PortfolioValuation {
  // Sort valuations by timestamp
  const sortedValuations = [...valuations].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );
  
  // Select a valuation based on the aggregation method
  let selectedValuation: PortfolioValuation;
  
  switch (method) {
    case 'open':
      selectedValuation = sortedValuations[0];
      break;
    
    case 'close':
      selectedValuation = sortedValuations[sortedValuations.length - 1];
      break;
    
    case 'high':
      selectedValuation = sortedValuations.reduce((highest, current) => 
        current.totalValue > highest.totalValue ? current : highest
      , sortedValuations[0]);
      break;
    
    case 'low':
      selectedValuation = sortedValuations.reduce((lowest, current) => 
        current.totalValue < lowest.totalValue ? current : lowest
      , sortedValuations[0]);
      break;
    
    case 'average':
      // For average, we need to create a new valuation with averaged values
      // This is a simplified example - a real implementation would average all values
      const avgValue = sortedValuations.reduce((sum, v) => sum + v.totalValue, 0) / sortedValuations.length;
      selectedValuation = {
        ...sortedValuations[sortedValuations.length - 1],
        totalValue: avgValue,
        // Other values would also need to be averaged
      };
      break;
    
    default:
      selectedValuation = sortedValuations[sortedValuations.length - 1];
  }
  
  // Create the aggregated valuation
  return {
    ...selectedValuation,
    id: generateId(),
    aggregationMetadata: {
      isAggregated: true,
      aggregationMethod: method,
      sourceValuationIds: sortedValuations.map(v => v.id),
      sourceCount: sortedValuations.length,
      sourceGranularity: sortedValuations[0].temporalMetadata.timeFrameUnit as TimeFrameGranularity,
      targetGranularity: getTargetGranularity(sortedValuations[0].temporalMetadata.timeFrameUnit)
    }
  };
}
```

## Implementation Guidelines

### 1. Data Storage Considerations

**Time Series Optimization**
- Store temporal metadata directly on valuations for efficient querying
- Index by time period identifiers (year, quarter, month, week)
- Use materialized views for common time-based queries

**Aggregation Strategy**
- Store both raw and aggregated data for different time frames
- Compute aggregations on-demand for less common time frames
- Cache frequently accessed time periods

### 2. Query Patterns

**Time Range Queries**
```typescript
/**
 * Get portfolio valuations within a time range
 */
export async function getValuationsInTimeRange(
  portfolioId: string,
  startDate: Date,
  endDate: Date,
  timeFrameUnit: TimeFrameUnit
): Promise<PortfolioValuation[]> {
  // Query valuations within the time range
  const valuations = await db.portfolioValuations.find({
    portfolioId,
    'temporalMetadata.timeFrameUnit': timeFrameUnit,
    timestamp: {
      $gte: startDate,
      $lte: endDate
    }
  }).sort({ timestamp: 1 });
  
  return valuations;
}
```

**Time Series Navigation**
```typescript
/**
 * Get the next valuation in a time series
 */
export async function getNextValuationInSeries(
  valuationId: string
): Promise<PortfolioValuation | null> {
  // Get the current valuation
  const valuation = await db.portfolioValuations.findOne({
    id: valuationId
  });
  
  if (!valuation?.timeSeriesMetadata?.nextInSeriesId) {
    return null;
  }
  
  // Get the next valuation
  return db.portfolioValuations.findOne({
    id: valuation.timeSeriesMetadata.nextInSeriesId
  });
}
```

**Hierarchical Time Queries**
```typescript
/**
 * Get monthly valuations for a specific year
 */
export async function getMonthlyValuationsForYear(
  portfolioId: string,
  year: number
): Promise<PortfolioValuation[]> {
  // Query monthly valuations for the year
  return db.portfolioValuations.find({
    portfolioId,
    'temporalMetadata.timeFrameUnit': 'month',
    'temporalMetadata.year': year
  }).sort({ 'temporalMetadata.month': 1 });
}
```

### 3. Performance Optimization

**Batch Processing**
```typescript
/**
 * Generate multiple valuations in a batch
 */
export async function generateValuationBatch(
  portfolioId: string,
  pricePoints: HistoricalPricePoint[]
): Promise<PortfolioValuation[]> {
  // Get portfolio and positions once
  const portfolio = await getPortfolio(portfolioId);
  const positions = await getPortfolioPositions(portfolioId);
  
  // Generate valuations in parallel
  const valuations = await Promise.all(
    pricePoints.map(pricePoint => 
      generatePortfolioValuation(portfolio, positions, pricePoint)
    )
  );
  
  // Save all valuations
  await db.portfolioValuations.insertMany(valuations);
  
  // Update time series metadata as a batch
  await updateTimeSeriesMetadataBatch(valuations);
  
  return valuations;
}
```

**Incremental Updates**
```typescript
/**
 * Update existing valuation with new price data
 */
export async function updateValuationWithNewPrices(
  valuationId: string,
  assetPrices: Record<string, number>
): Promise<PortfolioValuation> {
  // Get the existing valuation
  const valuation = await db.portfolioValuations.findOne({
    id: valuationId
  });
  
  if (!valuation) {
    throw new Error(`Valuation not found: ${valuationId}`);
  }
  
  // Get the portfolio and positions
  const portfolio = await getPortfolio(valuation.portfolioId);
  const positions = await getPortfolioPositions(valuation.portfolioId);
  
  // Create a new price point with updated prices
  const pricePoint: HistoricalPricePoint = {
    timestamp: valuation.timestamp,
    assetPrices: {
      ...valuation.positionValuations.reduce((prices, pv) => {
        const position = positions.find(p => p.id === pv.positionId);
        if (position) {
          prices[position.asset.ticker] = pv.marketPrice;
        }
        return prices;
      }, {} as Record<string, number>),
      ...assetPrices
    },
    marketContext: valuation.marketContext
  };
  
  // Generate new valuation
  const updatedValuation = generatePortfolioValuation(
    portfolio,
    positions,
    pricePoint
  );
  
  // Preserve original metadata
  updatedValuation.id = valuation.id;
  updatedValuation.timeSeriesMetadata = valuation.timeSeriesMetadata;
  
  // Save the updated valuation
  await db.portfolioValuations.replaceOne(
    { id: valuationId },
    updatedValuation
  );
  
  return updatedValuation;
}
```

## Testing Guidelines

### 1. Unit Testing

```typescript
// Test the valuation generation
test('generatePortfolioValuation creates accurate valuation', () => {
  // Create test portfolio and positions
  const portfolio = createTestPortfolio();
  const positions = createTestPositions();
  
  // Create test price point
  const pricePoint: HistoricalPricePoint = {
    timestamp: new Date('2025-02-28'),
    assetPrices: {
      BTC: 92150,
      ETH: 3120,
      ADA: 0.32
    }
  };
  
  // Generate the valuation
  const valuation = generatePortfolioValuation(
    portfolio,
    positions,
    pricePoint
  );
  
  // Verify the valuation
  expect(valuation.portfolioId).toBe(portfolio.id);
  expect(valuation.timestamp).toEqual(pricePoint.timestamp);
  expect(valuation.temporalMetadata.timeFrameUnit).toBe('day');
  expect(valuation.temporalMetadata.year).toBe(2025);
  expect(valuation.temporalMetadata.month).toBe(2);
  expect(valuation.temporalMetadata.day).toBe(28);
  
  // Verify position valuations
  expect(valuation.positionValuations.length).toBe(positions.length);
  
  // Verify aggregated values
  const expectedTotal = calculateExpectedTotal(positions, pricePoint.assetPrices);
  expect(valuation.totalValue).toBeCloseTo(expectedTotal);
});

// Test the time series metadata creation
test('createTimeSeriesMetadata connects valuations correctly', () => {
  // Create test valuations
  const valuations = createTestValuations();
  const newValuation = valuations[2]; // Middle valuation
  
  // Create time series metadata
  const metadata = createTimeSeriesMetadata(newValuation, valuations);
  
  // Verify metadata
  expect(metadata.timeSeriesId).toBe(`${newValuation.portfolioId}-day-2025`);
  expect(metadata.sequenceNumber).toBe(3);
  expect(metadata.totalInSeries).toBe(5);
  expect(metadata.isFirst).toBe(false);
  expect(metadata.isLast).toBe(false);
  expect(metadata.previousInSeriesId).toBe(valuations[1].id);
  expect(metadata.nextInSeriesId).toBe(valuations[3].id);
});
```

### 2. Integration Testing

```typescript
test('addHistoricalPricePoint creates valuation and updates time series', async () => {
  // Create test portfolio and positions
  const { portfolio, positions } = await createTestPortfolioWithPositions();
  
  // Create test price point
  const pricePoint: HistoricalPricePoint = {
    timestamp: new Date('2025-02-28'),
    assetPrices: {
      BTC: 92150,
      ETH: 3120,
      ADA: 0.32
    }
  };
  
  // Add the price point
  const valuation = await addHistoricalPricePoint(
    portfolio.id,
    pricePoint
  );
  
  // Verify the valuation was created
  expect(valuation.id).toBeDefined();
  
  // Verify it was saved to the database
  const savedValuation = await db.portfolioValuations.findOne({
    id: valuation.id
  });
  expect(savedValuation).toBeDefined();
  
  // Add another price point
  const laterPricePoint: HistoricalPricePoint = {
    timestamp: new Date('2025-03-01'),
    assetPrices: {
      BTC: 93000,
      ETH: 3150,
      ADA: 0.33
    }
  };
  
  const laterValuation = await addHistoricalPricePoint(
    portfolio.id,
    laterPricePoint
  );
  
  // Verify time series links were created
  const updatedFirstValuation = await db.portfolioValuations.findOne({
    id: valuation.id
  });
  
  expect(updatedFirstValuation?.timeSeriesMetadata?.nextInSeriesId)
    .toBe(laterValuation.id);
  
  expect(laterValuation.timeSeriesMetadata?.previousInSeriesId)
    .toBe(valuation.id);
});
```

### 3. End-to-End Testing

```typescript
test('Historical data workflow end-to-end', async () => {
  // Create a test user and portfolio
  const user = await createTestUser();
  const portfolio = await createTestPortfolio(user.id);
  
  // Log in as the test user
  await page.login(user.email, user.password);
  
  // Go to the historical data page
  await page.goto(`/portfolio/${portfolio.id}/historical-data`);
  
  // Add February close data
  await page.click('button:text("Add February 2025 Close")');
  
  // Fill in the BTC price
  await page.fill('input[name="BTC"]', '92150');
  
  // Fill in the ETH price
  await page.fill('input[name="ETH"]', '3120');
  
  // Fill in the ADA price
  await page.fill('input[name="ADA"]', '0.32');
  
  // Save the data
  await page.click('button:text("Save Data Point")');
  
  // Verify success message
  await page.waitForSelector('text=Data point saved successfully');
  
  // Go to the portfolio dashboard
  await page.goto(`/portfolio/${portfolio.id}/dashboard`);
  
  // Verify the portfolio value is displayed
  await page.waitForSelector('text=$10,580.25');
  
  // Verify the performance chart has data
  const chartElement = await page.$('.performance-chart');
  expect(chartElement).toBeTruthy();
  
  // Go to the reports page
  await page.goto(`/portfolio/${portfolio.id}/reports`);
  
  // Create a monthly report
  await page.click('button:text("Create Monthly Report")');
  await page.click('button:text("Generate")');
  
  // Verify the report is created
  await page.waitForSelector('text=February 2025 Performance Report');
});
```

## Summary

Effective historical data management is essential for providing meaningful performance analysis in Numisma. The system supports:

1. **Flexible Data Input**: Both real-time and retroactive data entry
2. **Rich Temporal Classification**: Comprehensive time period metadata
3. **Multi-level Aggregation**: Support for all standard financial timeframes
4. **Time Series Relationships**: Connections between related time periods
5. **Performance Comparisons**: Standard reference points for analysis

This infrastructure enables traders to gain insights from historical performance and make informed decisions based on comprehensive time-based analytics.
