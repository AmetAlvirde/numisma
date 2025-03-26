# Numisma Performance Reporting & Visualization

## Overview

Performance reporting and visualization are key features of Numisma, enabling traders to gain insights from their portfolio data. The system provides comprehensive analytics across different time frames, from daily valuations to yearly reports, with interactive visualizations that reveal patterns and trends.

## Report Types

Numisma supports 10 standard report types based on different combinations of time frames:

<div class="mermaid">
graph TD
    subgraph "Source Data"
        daily[Daily Valuations]
    end
    
    subgraph "Report Types"
        R1[Weekly Reports<br>from Daily Data]
        R2[Monthly Reports<br>from Daily Data]
        R3[Monthly Reports<br>from Weekly Data]
        R4[Quarterly Reports<br>from Daily Data]
        R5[Quarterly Reports<br>from Weekly Data]
        R6[Quarterly Reports<br>from Monthly Data]
        R7[Yearly Reports<br>from Quarterly Data]
        R8[Yearly Reports<br>from Monthly Data]
        R9[Yearly Reports<br>from Weekly Data]
        R10[Yearly Reports<br>from Daily Data]
    end
    
    daily --> R1
    daily --> R2
    daily --> R4
    daily --> R10
    
    R1 --> R3
    R1 --> R5
    R1 --> R9
    
    R2 --> R6
    R2 --> R8
    
    R4 --> R7
    
    style daily fill:#f9f,stroke:#333,stroke-width:4px
    style R1 fill:#bbf,stroke:#333,stroke-width:2px
    style R7 fill:#bfb,stroke:#333,stroke-width:2px
</div>

### 1. Weekly Reports

Weekly reports provide a view of portfolio performance over 7-day periods, typically from Sunday to Saturday.

**Use Cases:**
- Short-term performance tracking
- Weekly review sessions
- Identifying day-of-week patterns

**Source Options:**
- Daily close valuations aggregated to weekly

**Time Coverage:**
- Current week
- Previous N weeks
- Week-over-week comparison
- Same week last year

### 2. Monthly Reports

Monthly reports show portfolio performance over calendar months.

**Use Cases:**
- Medium-term performance tracking
- Monthly review sessions
- Seasonal pattern detection

**Source Options:**
- Daily close valuations aggregated to monthly
- Weekly close valuations aggregated to monthly

**Time Coverage:**
- Current month
- Previous N months
- Month-over-month comparison
- Same month last year

### 3. Quarterly Reports

Quarterly reports display portfolio performance over three-month periods (Q1-Q4).

**Use Cases:**
- Quarterly performance review
- Strategic adjustment periods
- Crypto market cycle analysis

**Source Options:**
- Daily close valuations aggregated to quarterly
- Weekly close valuations aggregated to quarterly
- Monthly close valuations aggregated to quarterly

**Time Coverage:**
- Current quarter
- Previous N quarters
- Quarter-over-quarter comparison
- Same quarter last year

### 4. Yearly Reports

Yearly reports provide a comprehensive view of portfolio performance over 12-month periods.

**Use Cases:**
- Annual performance review
- Tax preparation
- Long-term strategy evaluation

**Source Options:**
- Daily close valuations aggregated to yearly
- Weekly close valuations aggregated to yearly
- Monthly close valuations aggregated to yearly
- Quarterly close valuations aggregated to yearly

**Time Coverage:**
- Current year
- Previous N years
- Year-over-year comparison

## Report Components

### 1. Performance Summary

<div class="mermaid">
graph LR
    subgraph "Performance Summary"
        A[Start Value]
        B[End Value]
        C[Absolute Change]
        D[Percentage Change]
        E[Annualized Return]
        F[Maximum Drawdown]
        G[Sharpe Ratio]
        H[Volatility]
    end
    
    style A fill:#f9f,stroke:#333,stroke-width:2px
    style B fill:#bbf,stroke:#333,stroke-width:2px
    style C fill:#bfb,stroke:#333,stroke-width:2px
    style E fill:#bfb,stroke:#333,stroke-width:2px
</div>

The performance summary provides key metrics at a glance:

```typescript
/**
 * Standard performance summary metrics
 */
export interface PerformanceSummary {
  /** Starting portfolio value */
  startValue: number;
  
  /** Ending portfolio value */
  endValue: number;
  
  /** Absolute change in value */
  absoluteChange: number;
  
  /** Percentage change */
  percentageChange: number;
  
  /** Return expressed as annual percentage */
  annualizedReturn: number;
  
  /** Largest peak-to-trough decline */
  maxDrawdown: number;
  
  /** Risk-adjusted return */
  sharpeRatio: number;
  
  /** Standard deviation of returns */
  volatility: number;
  
  /** Highest value during period */
  highValue: number;
  
  /** Lowest value during period */
  lowValue: number;
  
  /** Total days in market */
  daysInMarket: number;
  
  /** Profitable vs. unprofitable days ratio */
  winRate: number;
}
```

### 2. Performance Charts

<div class="mermaid">
graph TD
    subgraph "Chart Types"
        A[Line Chart<br>Value Over Time]
        B[Area Chart<br>Value Growth]
        C[Bar Chart<br>Period Comparison]
        D[Candlestick Chart<br>OHLC Data]
        E[Pie Chart<br>Asset Allocation]
        F[Treemap<br>Position Breakdown]
    end
    
    style A fill:#f9f,stroke:#333,stroke-width:4px
    style E fill:#bbf,stroke:#333,stroke-width:4px
</div>

The system offers multiple chart types to visualize performance:

- **Line Chart**: Shows portfolio value trajectory over time
- **Area Chart**: Emphasizes cumulative growth
- **Bar Chart**: Compares discrete time periods
- **Candlestick Chart**: Shows open-high-low-close values
- **Pie Chart**: Displays asset allocation
- **Treemap**: Shows relative position sizes and performance

### 3. Position Performance Table

The position performance table shows the contribution of individual positions:

```typescript
/**
 * Position performance metrics for reporting
 */
export interface PositionPerformanceRow {
  /** Position ID */
  positionId: string;
  
  /** Position name */
  name: string;
  
  /** Asset being traded */
  asset: {
    name: string;
    ticker: string;
  };
  
  /** Initial value */
  initialValue: number;
  
  /** Current value */
  currentValue: number;
  
  /** Absolute change */
  absoluteChange: number;
  
  /** Percentage change */
  percentageChange: number;
  
  /** Contribution to overall portfolio return */
  contributionToReturn: number;
  
  /** Current allocation percentage */
  allocationPercentage: number;
  
  /** Capital tier */
  capitalTier: CapitalTier;
  
  /** Risk level */
  riskLevel: number;
}
```

### 4. Time Series Comparison

Time series comparison shows performance relative to key reference points:

```typescript
/**
 * Time series comparison for reports
 */
export interface TimeSeriesComparison {
  /** Labels for the time series */
  labels: string[];
  
  /** Current period values */
  currentValues: number[];
  
  /** Previous period values for comparison */
  previousValues: number[];
  
  /** Same period last year values */
  yearAgoValues: number[];
  
  /** Benchmark values (e.g., BTC, total market) */
  benchmarkValues: number[];
  
  /** Performance difference vs. benchmark */
  benchmarkDifference: number[];
}
```

### 5. Market Context

Market context provides broader industry data for perspective:

```typescript
/**
 * Market context for reports
 */
export interface MarketContext {
  /** Bitcoin price data */
  btcPrice: {
    start: number;
    end: number;
    percentageChange: number;
  };
  
  /** Ethereum price data */
  ethPrice: {
    start: number;
    end: number;
    percentageChange: number;
  };
  
  /** Total crypto market capitalization */
  totalMarketCap: {
    start: number;
    end: number;
    percentageChange: number;
  };
  
  /** Fear & Greed Index */
  fearGreedIndex: {
    start: number;
    end: number;
    change: number;
  };
  
  /** Top performing assets in time period */
  topPerformers: {
    ticker: string;
    percentageChange: number;
  }[];
  
  /** Industry segment performance */
  segmentPerformance: {
    segment: string;
    percentageChange: number;
  }[];
}
```

## Performance Report Generation

### 1. Report Generation Process

<div class="mermaid">
flowchart TD
    A[Select Report Type] --> B[Choose Portfolio]
    B --> C[Define Time Period]
    C --> D[Select Granularity]
    D --> E[Set Reference Points]
    
    E --> F[Fetch Source Valuations]
    F --> G{Aggregation Needed?}
    
    G -->|Yes| H[Aggregate Valuations]
    G -->|No| I[Use Raw Valuations]
    
    H --> J[Calculate Performance Metrics]
    I --> J
    
    J --> K[Generate Position Breakdown]
    K --> L[Calculate Market Context]
    L --> M[Build Comparison Data]
    M --> N[Create Charts & Tables]
    
    N --> O[Format Final Report]
    O --> P[Save & Present Report]
    
    style A fill:#f9f,stroke:#333,stroke-width:2px
    style J fill:#bbf,stroke:#333,stroke-width:2px
    style N fill:#bfb,stroke:#333,stroke-width:2px
</div>

The report generation process involves several steps:

```typescript
/**
 * Generate a performance report
 */
export async function generatePerformanceReport(
  portfolioId: string,
  options: {
    reportType: ReportType;
    sourceGranularity: ReportSourceGranularity;
    period: {
      startDate: Date;
      endDate: Date;
    };
    benchmark?: string;
  }
): Promise<PerformanceReport> {
  // 1. Fetch the portfolio
  const portfolio = await getPortfolio(portfolioId);
  if (!portfolio) {
    throw new Error(`Portfolio not found: ${portfolioId}`);
  }
  
  // 2. Fetch source valuations based on granularity
  const sourceValuations = await getPortfolioValuations(
    portfolioId,
    options.period.startDate,
    options.period.endDate,
    mapGranularityToTimeFrameUnit(options.sourceGranularity)
  );
  
  // 3. Aggregate valuations if needed
  const aggregatedValuations = await aggregateValuationsForReport(
    sourceValuations,
    options.reportType,
    options.sourceGranularity
  );
  
  // 4. Calculate summary metrics
  const summary = calculateReportSummary(aggregatedValuations);
  
  // 5. Generate position breakdown
  const positionBreakdown = calculatePositionBreakdown(
    aggregatedValuations,
    options.period.startDate,
    options.period.endDate
  );
  
  // 6. Get market context
  const marketContext = await getMarketContext(
    options.period.startDate,
    options.period.endDate
  );
  
  // 7. Get benchmark data if requested
  const benchmarkComparison = options.benchmark
    ? await getBenchmarkComparison(
        options.benchmark,
        aggregatedValuations,
        options.period.startDate,
        options.period.endDate
      )
    : undefined;
  
  // 8. Create time series data
  const timeSeriesData = createTimeSeriesData(aggregatedValuations);
  
  // 9. Create and return the report
  const report: PerformanceReport = {
    id: generateId(),
    portfolioId,
    reportType: options.reportType,
    sourceGranularity: options.sourceGranularity,
    period: {
      startDate: options.period.startDate,
      endDate: options.period.endDate,
      periodName: formatPeriodName(options.reportType, options.period)
    },
    generatedAt: new Date(),
    summary,
    valuations: aggregatedValuations,
    timeSeriesIds: [...new Set(aggregatedValuations.map(v => 
      v.timeSeriesMetadata?.timeSeriesId
    ).filter(Boolean) as string[])],
    benchmarkComparison,
    isScheduled: false,
    generatedBy: 'current-user'
  };
  
  // 10. Save the report
  await savePerformanceReport(report);
  
  return report;
}
```

### 2. Report Customization Options

```typescript
/**
 * Report customization options
 */
export interface ReportCustomizationOptions {
  /** Title of the report */
  title?: string;
  
  /** Description of the report */
  description?: string;
  
  /** Metrics to include in the report */
  metrics: {
    /** Include performance metrics */
    performance: boolean;
    
    /** Include risk metrics */
    risk: boolean;
    
    /** Include comparative metrics */
    comparison: boolean;
  };
  
  /** Chart settings */
  charts: {
    /** Type of main chart to display */
    mainChartType: 'line' | 'area' | 'bar' | 'candlestick';
    
    /** Whether to show asset allocation chart */
    showAllocationChart: boolean;
    
    /** Whether to show benchmark comparison chart */
    showBenchmarkChart: boolean;
  };
  
  /** Table settings */
  tables: {
    /** Whether to show position breakdown table */
    showPositionTable: boolean;
    
    /** Whether to show time series comparison table */
    showTimeSeriesTable: boolean;
    
    /** Position table sorting options */
    positionTableSort: {
      /** Field to sort by */
      field: keyof PositionPerformanceRow;
      
      /** Sort direction */
      direction: 'asc' | 'desc';
    };
  };
  
  /** Display currency */
  currency: string;
  
  /** Page size for export */
  pageSize: 'a4' | 'letter' | 'legal';
  
  /** Report theme */
  theme: 'light' | 'dark' | 'print';
}
```

### 3. Report Export Options

```typescript
/**
 * Report export options
 */
export interface ReportExportOptions {
  /** Format of the export */
  format: 'pdf' | 'csv' | 'xlsx' | 'json';
  
  /** Paper size for PDF export */
  paperSize?: 'a4' | 'letter' | 'legal';
  
  /** Orientation for PDF export */
  orientation?: 'portrait' | 'landscape';
  
  /** Sections to include in the export */
  sections: {
    /** Include summary section */
    summary: boolean;
    
    /** Include charts section */
    charts: boolean;
    
    /** Include position breakdown section */
    positions: boolean;
    
    /** Include time series section */
    timeSeries: boolean;
    
    /** Include market context section */
    marketContext: boolean;
  };
  
  /** Data compression options for large reports */
  compression?: {
    /** Whether to compress data */
    enabled: boolean;
    
    /** Data quality for compression */
    quality: 'high' | 'medium' | 'low';
  };
}
```

## Data Visualization Components

### 1. Portfolio Value Chart

```tsx
import React, { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { formatCurrency } from '@/lib/format';
import { Button } from '@/components/ui/button';

interface PortfolioValueChartProps {
  portfolioId: string;
  timeframe: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all';
  height?: number;
  showControls?: boolean;
}

export const PortfolioValueChart: React.FC<PortfolioValueChartProps> = ({
  portfolioId,
  timeframe: initialTimeframe,
  height = 300,
  showControls = true
}) => {
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [chartData, setChartData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Fetch chart data
  React.useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      
      try {
        const data = await getPortfolioChartData(portfolioId, timeframe);
        setChartData(data);
      } catch (error) {
        console.error('Error fetching chart data:', error);
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchData();
  }, [portfolioId, timeframe]);
  
  // Format the tooltip content
  const formatTooltip = (value: number, name: string, props: any) => {
    if (name === 'value') {
      return [formatCurrency(value), 'Portfolio Value'];
    }
    return [value, name];
  };
  
  return (
    <div className="space-y-4">
      {showControls && (
        <div className="flex space-x-2">
          <Button
            variant={timeframe === 'week' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeframe('week')}
          >
            Week
          </Button>
          <Button
            variant={timeframe === 'month' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeframe('month')}
          >
            Month
          </Button>
          <Button
            variant={timeframe === 'quarter' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeframe('quarter')}
          >
            Quarter
          </Button>
          <Button
            variant={timeframe === 'year' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeframe('year')}
          >
            Year
          </Button>
          <Button
            variant={timeframe === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTimeframe('all')}
          >
            All
          </Button>
        </div>
      )}
      
      <div style={{ height, width: '100%' }}>
        {isLoading ? (
          <div className="h-full w-full flex items-center justify-center">
            <p className="text-gray-500">Loading chart data...</p>
          </div>
        ) : chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8884d8" stopOpacity={0.8}/>
                  <stop offset="95%" stopColor="#8884d8" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f5f5f5" />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 12 }}
                tickFormatter={(tick) => formatChartDate(tick, timeframe)}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                tickFormatter={(tick) => formatShortCurrency(tick)}
                width={60}
              />
              <Tooltip
                formatter={formatTooltip}
                labelFormatter={(label) => formatChartDate(label, timeframe, true)}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#8884d8"
                fill="url(#colorValue)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full flex items-center justify-center">
            <p className="text-gray-500">No data available for this timeframe</p>
          </div>
        )}
      </div>
    </div>
  );
};
```

### 2. Asset Allocation Chart

```tsx
import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { formatPercentage } from '@/lib/format';

interface AssetAllocationChartProps {
  portfolioId: string;
  height?: number;
  groupSmallAllocations?: boolean;
}

export const AssetAllocationChart: React.FC<AssetAllocationChartProps> = ({
  portfolioId,
  height = 300,
  groupSmallAllocations = true
}) => {
  const [allocationData, setAllocationData] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  
  // Color palette for the chart
  const COLORS = [
    '#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#0088fe',
    '#00c49f', '#ffbb28', '#ff8042', '#a4de6c', '#d0ed57'
  ];
  
  // Fetch allocation data
  React.useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      
      try {
        const data = await getPortfolioAllocation(portfolioId);
        
        // Optionally group small allocations
        if (groupSmallAllocations) {
          const smallThreshold = 0.03; // 3%
          const mainAllocations = data.filter(item => item.percentage >= smallThreshold);
          const smallAllocations = data.filter(item => item.percentage < smallThreshold);
          
          if (smallAllocations.length > 0) {
            const otherPercentage = smallAllocations.reduce((sum, item) => sum + item.percentage, 0);
            const otherItem = {
              name: 'Other',
              value: otherPercentage * 100,
              percentage: otherPercentage,
              count: smallAllocations.length
            };
            
            setAllocationData([...mainAllocations, otherItem]);
          } else {
            setAllocationData(data);
          }
        } else {
          setAllocationData(data);
        }
      } catch (error) {
        console.error('Error fetching allocation data:', error);
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchData();
  }, [portfolioId, groupSmallAllocations]);
  
  return (
    <div className="w-full" style={{ height }}>
      {isLoading ? (
        <div className="h-full w-full flex items-center justify-center">
          <p className="text-gray-500">Loading allocation data...</p>
        </div>
      ) : allocationData.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={allocationData}
              cx="50%"
              cy="50%"
              labelLine={false}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
              nameKey="name"
              label={({ name, percentage }) => `${name} (${formatPercentage(percentage)})`}
            >
              {allocationData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              formatter={(value, name, props) => [`${formatPercentage(value / 100)}`, name]}
            />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-full w-full flex items-center justify-center">
          <p className="text-gray-500">No allocation data available</p>
        </div>
      )}
    </div>
  );
};
```

### 3. Performance Metrics Display

```tsx
import React from 'react';
import { formatCurrency, formatPercentage } from '@/lib/format';
import { ArrowUp, ArrowDown } from 'lucide-react';

interface PerformanceMetricsProps {
  portfolioId: string;
  timeframe: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all';
  compact?: boolean;
}

export const PerformanceMetrics: React.FC<PerformanceMetricsProps> = ({
  portfolioId,
  timeframe,
  compact = false
}) => {
  const [metrics, setMetrics] = React.useState<any | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  
  // Fetch metrics data
  React.useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      
      try {
        const data = await getPortfolioMetrics(portfolioId, timeframe);
        setMetrics(data);
      } catch (error) {
        console.error('Error fetching metrics:', error);
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchData();
  }, [portfolioId, timeframe]);
  
  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <p className="text-gray-500">Loading metrics...</p>
      </div>
    );
  }
  
  if (!metrics) {
    return (
      <div className="flex justify-center p-4">
        <p className="text-gray-500">No metrics available</p>
      </div>
    );
  }
  
  // For compact display, show just the key metrics
  if (compact) {
    return (
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm text-gray-500">Current Value</h3>
          <p className="text-2xl font-bold">{formatCurrency(metrics.currentValue)}</p>
        </div>
        
        <div className="bg-white p-4 rounded-lg shadow">
          <h3 className="text-sm text-gray-500">Total Return</h3>
          <div className="flex items-center">
            <p className={`text-2xl font-bold ${metrics.percentageReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatPercentage(metrics.percentageReturn / 100)}
            </p>
            {metrics.percentageReturn >= 0 ? (
              <ArrowUp className="ml-1 text-green-600" />
            ) : (
              <ArrowDown className="ml-1 text-red-600" />
            )}
          </div>
        </div>
      </div>
    );
  }
  
  // Full metrics display
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-sm text-gray-500">Current Value</h3>
        <p className="text-2xl font-bold">{formatCurrency(metrics.currentValue)}</p>
        <p className="text-xs text-gray-400">
          Started at {formatCurrency(metrics.startValue)}
        </p>
      </div>
      
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-sm text-gray-500">Total Return</h3>
        <div className="flex items-center">
          <p className={`text-2xl font-bold ${metrics.percentageReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {formatPercentage(metrics.percentageReturn / 100)}
          </p>
          {metrics.percentageReturn >= 0 ? (
            <ArrowUp className="ml-1 text-green-600" />
          ) : (
            <ArrowDown className="ml-1 text-red-600" />
          )}
        </div>
        <p className="text-xs text-gray-400">
          {formatCurrency(metrics.absoluteChange)}
        </p>
      </div>
      
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-sm text-gray-500">Annualized Return</h3>
        <p className={`text-2xl font-bold ${metrics.annualizedReturn >= 0 ? 'text-green-600' : 'text-red-600'}`}>
          {formatPercentage(metrics.annualizedReturn / 100)}
        </p>
        <p className="text-xs text-gray-400">
          {metrics.daysInMarket} days in market
        </p>
      </div>
      
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-sm text-gray-500">Max Drawdown</h3>
        <p className="text-2xl font-bold text-red-600">
          {formatPercentage(metrics.maxDrawdown / 100)}
        </p>
        <p className="text-xs text-gray-400">
          From peak of {formatCurrency(metrics.highValue)}
        </p>
      </div>
      
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-sm text-gray-500">Sharpe Ratio</h3>
        <p className="text-2xl font-bold">
          {metrics.sharpeRatio.toFixed(2)}
        </p>
        <p className="text-xs text-gray-400">
          Risk-adjusted return
        </p>
      </div>
      
      <div className="bg-white p-4 rounded-lg shadow">
        <h3 className="text-sm text-gray-500">Volatility</h3>
        <p className="text-2xl font-bold">
          {formatPercentage(metrics.volatility / 100)}
        </p>
        <p className="text-xs text-gray-400">
          Standard deviation of returns
        </p>
      </div>
    </div>
  );
};
```

### 4. Position Performance Table

```tsx
import React, { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency, formatPercentage } from '@/lib/format';
import { CapitalTierIndicator } from '@/components/position/CapitalTierIndicator';
import { Button } from '@/components/ui/button';
import { ArrowUpDown, ChevronRight } from 'lucide-react';

interface PositionPerformanceTableProps {
  portfolioId: string;
  timeframe: 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all';
  limit?: number;
  onPositionClick?: (positionId: string) => void;
}

export const PositionPerformanceTable: React.FC<PositionPerformanceTableProps> = ({
  portfolioId,
  timeframe,
  limit,
  onPositionClick
}) => {
  const [positions, setPositions] = useState<PositionPerformanceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [sortField, setSortField] = useState<keyof PositionPerformanceRow>('percentageChange');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  
  // Fetch position performance data
  React.useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      
      try {
        const data = await getPositionPerformance(portfolioId, timeframe);
        setPositions(data);
      } catch (error) {
        console.error('Error fetching position performance:', error);
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchData();
  }, [portfolioId, timeframe]);
  
  // Handle sort change
  const handleSortChange = (field: keyof PositionPerformanceRow) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };
  
  // Sort positions
  const sortedPositions = [...positions].sort((a, b) => {
    const aValue = a[sortField];
    const bValue = b[sortField];
    
    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortDirection === 'asc' ? aValue - bValue : bValue - aValue;
    }
    
    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc' ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
    }
    
    return 0;
  });
  
  // Apply limit if specified
  const displayedPositions = limit ? sortedPositions.slice(0, limit) : sortedPositions;
  
  // Render sort indicator
  const renderSortIndicator = (field: keyof PositionPerformanceRow) => {
    if (field !== sortField) {
      return <ArrowUpDown size={14} />;
    }
    
    return sortDirection === 'asc' ? '↑' : '↓';
  };
  
  if (isLoading) {
    return (
      <div className="flex justify-center p-4">
        <p className="text-gray-500">Loading position data...</p>
      </div>
    );
  }
  
  if (positions.length === 0) {
    return (
      <div className="flex justify-center p-4">
        <p className="text-gray-500">No position data available</p>
      </div>
    );
  }
  
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[250px]">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSortChange('name')}
                className="font-medium"
              >
                Position {renderSortIndicator('name')}
              </Button>
            </TableHead>
            <TableHead>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSortChange('asset.ticker')}
                className="font-medium"
              >
                Asset {renderSortIndicator('asset.ticker')}
              </Button>
            </TableHead>
            <TableHead className="text-right">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSortChange('currentValue')}
                className="font-medium"
              >
                Value {renderSortIndicator('currentValue')}
              </Button>
            </TableHead>
            <TableHead className="text-right">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSortChange('percentageChange')}
                className="font-medium"
              >
                Return {renderSortIndicator('percentageChange')}
              </Button>
            </TableHead>
            <TableHead className="text-right">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSortChange('allocationPercentage')}
                className="font-medium"
              >
                Allocation {renderSortIndicator('allocationPercentage')}
              </Button>
            </TableHead>
            <TableHead className="text-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleSortChange('capitalTier')}
                className="font-medium"
              >
                Tier {renderSortIndicator('capitalTier')}
              </Button>
            </TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {displayedPositions.map((position) => (
            <TableRow
              key={position.positionId}
              className={onPositionClick ? 'cursor-pointer hover:bg-gray-50' : ''}
              onClick={() => onPositionClick?.(position.positionId)}
            >
              <TableCell className="font-medium">{position.name}</TableCell>
              <TableCell>
                <div className="flex items-center">
                  <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center mr-2 text-xs">
                    {position.asset.ticker.slice(0, 3)}
                  </div>
                  {position.asset.ticker}
                </div>
              </TableCell>
              <TableCell className="text-right">
                {formatCurrency(position.currentValue)}
              </TableCell>
              <TableCell className="text-right">
                <span className={position.percentageChange >= 0 ? 'text-green-600' : 'text-red-600'}>
                  {formatPercentage(position.percentageChange / 100)}
                </span>
              </TableCell>
              <TableCell className="text-right">
                {formatPercentage(position.allocationPercentage / 100)}
              </TableCell>
              <TableCell className="text-center">
                <div className="flex justify-center">
                  <CapitalTierIndicator tier={position.capitalTier} showLabel={false} size="sm" />
                </div>
              </TableCell>
              <TableCell>
                {onPositionClick && (
                  <ChevronRight size={16} className="text-gray-400" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};
```

## Report Templates

### 1. Weekly Performance Report Template

```tsx
import React from 'react';
import { PortfolioValueChart } from '@/components/charts/PortfolioValueChart';
import { PerformanceMetrics } from '@/components/dashboard/PerformanceMetrics';
import { PositionPerformanceTable } from '@/components/tables/PositionPerformanceTable';
import { AssetAllocationChart } from '@/components/charts/AssetAllocationChart';
import { formatDateRange } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';

interface WeeklyReportProps {
  reportId: string;
  onExport?: () => void;
}

export const WeeklyReport: React.FC<WeeklyReportProps> = ({
  reportId,
  onExport
}) => {
  const [report, setReport] = React.useState<any | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  
  // Fetch report data
  React.useEffect(() => {
    async function fetchData() {
      setIsLoading(true);
      
      try {
        const data = await getPerformanceReport(reportId);
        setReport(data);
      } catch (error) {
        console.error('Error fetching report:', error);
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchData();
  }, [reportId]);
  
  if (isLoading) {
    return (
      <div className="flex justify-center p-8">
        <p className="text-gray-500">Loading report...</p>
      </div>
    );
  }
  
  if (!report) {
    return (
      <div className="flex justify-center p-8">
        <p className="text-gray-500">Report not found</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-8 max-w-5xl mx-auto p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Weekly Performance Report</h1>
          <p className="text-gray-500">
            {formatDateRange(report.period.startDate, report.period.endDate)}
          </p>
        </div>
        
        {onExport && (
          <Button onClick={onExport} size="sm" className="flex items-center">
            <Download size={16} className="mr-2" />
            Export
          </Button>
        )}
      </div>
      
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-medium">Performance Summary</h2>
        </div>
        <div className="p-6">
          <PerformanceMetrics
            portfolioId={report.portfolioId}
            timeframe="week"
          />
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-medium">Portfolio Value</h2>
        </div>
        <div className="p-6">
          <PortfolioValueChart
            portfolioId={report.portfolioId}
            timeframe="week"
            height={300}
            showControls={false}
          />
        </div>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-medium">Asset Allocation</h2>
          </div>
          <div className="p-6">
            <AssetAllocationChart
              portfolioId={report.portfolioId}
              height={300}
            />
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-xl font-medium">Position Performance</h2>
          </div>
          <div className="p-6">
            <PositionPerformanceTable
              portfolioId={report.portfolioId}
              timeframe="week"
              limit={5}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
```

### 2. Performance Report Export

```typescript
/**
 * Generate a PDF export of a performance report
 */
export async function exportReportAsPdf(
  reportId: string,
  options: ReportExportOptions
): Promise<Blob> {
  // Fetch the report
  const report = await getPerformanceReport(reportId);
  if (!report) {
    throw new Error(`Report not found: ${reportId}`);
  }
  
  // Load the report components
  const components = await loadReportComponents(report, options);
  
  // Generate PDF
  const pdf = await generatePdf({
    title: `${report.reportType.charAt(0).toUpperCase() + report.reportType.slice(1)} Performance Report`,
    subtitle: formatDateRange(report.period.startDate, report.period.endDate),
    sections: components,
    paperSize: options.paperSize || 'a4',
    orientation: options.orientation || 'portrait'
  });
  
  // Return the PDF blob
  return pdf;
}

/**
 * Load components for report export
 */
async function loadReportComponents(
  report: PerformanceReport,
  options: ReportExportOptions
): Promise<any[]> {
  const components = [];
  
  // Add summary section
  if (options.sections.summary) {
    components.push({
      type: 'summary',
      data: report.summary
    });
  }
  
  // Add charts section
  if (options.sections.charts) {
    components.push({
      type: 'chart',
      subtype: 'portfolio-value',
      data: await getPortfolioChartData(report.portfolioId, mapReportTypeToTimeframe(report.reportType))
    });
    
    components.push({
      type: 'chart',
      subtype: 'asset-allocation',
      data: await getPortfolioAllocation(report.portfolioId)
    });
  }
  
  // Add position breakdown section
  if (options.sections.positions) {
    components.push({
      type: 'table',
      subtype: 'position-performance',
      data: await getPositionPerformance(report.portfolioId, mapReportTypeToTimeframe(report.reportType))
    });
  }
  
  // Add time series section
  if (options.sections.timeSeries) {
    components.push({
      type: 'table',
      subtype: 'time-series',
      data: createTimeSeriesData(report.valuations)
    });
  }
  
  // Add market context section
  if (options.sections.marketContext) {
    components.push({
      type: 'market-context',
      data: await getMarketContext(report.period.startDate, report.period.endDate)
    });
  }
  
  return components;
}
```

## Performance Analysis Tools

### 1. Benchmark Comparison

```typescript
/**
 * Get benchmark comparison data
 */
export async function getBenchmarkComparison(
  benchmarkType: string,
  portfolioValuations: PortfolioValuation[],
  startDate: Date,
  endDate: Date
): Promise<{
  benchmarkName: string;
  startValue: number;
  endValue: number;
  percentageChange: number;
  relativePerformance: number;
  timeSeriesData: {
    date: Date;
    portfolioValue: number;
    benchmarkValue: number;
    portfolioPercentage: number;
    benchmarkPercentage: number;
  }[];
}> {
  // Get benchmark prices
  const benchmarkPrices = await getBenchmarkPrices(benchmarkType, startDate, endDate);
  
  // Find matching dates for comparison
  const timeSeriesData = portfolioValuations.map(valuation => {
    const closestBenchmarkData = findClosestBenchmarkData(benchmarkPrices, valuation.timestamp);
    
    return {
      date: valuation.timestamp,
      portfolioValue: valuation.totalValue,
      benchmarkValue: closestBenchmarkData.price,
      portfolioPercentage: calculatePercentageChange(
        portfolioValuations[0].totalValue,
        valuation.totalValue
      ),
      benchmarkPercentage: calculatePercentageChange(
        benchmarkPrices[0].price,
        closestBenchmarkData.price
      )
    };
  });
  
  // Calculate overall changes
  const startPortfolioValue = portfolioValuations[0].totalValue;
  const endPortfolioValue = portfolioValuations[portfolioValuations.length - 1].totalValue;
  const portfolioPercentageChange = calculatePercentageChange(startPortfolioValue, endPortfolioValue);
  
  const startBenchmarkValue = benchmarkPrices[0].price;
  const endBenchmarkValue = benchmarkPrices[benchmarkPrices.length - 1].price;
  const benchmarkPercentageChange = calculatePercentageChange(startBenchmarkValue, endBenchmarkValue);
  
  return {
    benchmarkName: getBenchmarkName(benchmarkType),
    startValue: startBenchmarkValue,
    endValue: endBenchmarkValue,
    percentageChange: benchmarkPercentageChange,
    relativePerformance: portfolioPercentageChange - benchmarkPercentageChange,
    timeSeriesData
  };
}
```

### 2. Drawdown Analysis

```typescript
/**
 * Calculate drawdown analysis for a portfolio
 */
export function calculateDrawdownAnalysis(
  portfolioValuations: PortfolioValuation[]
): {
  maxDrawdown: number;
  maxDrawdownStartDate: Date;
  maxDrawdownEndDate: Date;
  currentDrawdown: number;
  drawdownPeriods: {
    startDate: Date;
    endDate: Date;
    startValue: number;
    endValue: number;
    drawdownPercentage: number;
    duration: number; // days
    recovered: boolean;
    recoveryDate?: Date;
  }[];
} {
  // Sort valuations by date
  const sortedValuations = [...portfolioValuations].sort(
    (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
  );
  
  let maxDrawdown = 0;
  let maxDrawdownStartDate = sortedValuations[0].timestamp;
  let maxDrawdownEndDate = sortedValuations[0].timestamp;
  
  let currentPeak = sortedValuations[0].totalValue;
  let currentPeakDate = sortedValuations[0].timestamp;
  
  let currentDrawdown = 0;
  
  const drawdownPeriods = [];
  let currentDrawdownPeriod = null;
  
  // Analyze each valuation
  for (let i = 1; i < sortedValuations.length; i++) {
    const valuation = sortedValuations[i];
    const value = valuation.totalValue;
    
    // New peak
    if (value > currentPeak) {
      // If we were in a drawdown, mark it as recovered
      if (currentDrawdownPeriod) {
        currentDrawdownPeriod.recovered = true;
        currentDrawdownPeriod.recoveryDate = valuation.timestamp;
        drawdownPeriods.push(currentDrawdownPeriod);
        currentDrawdownPeriod = null;
      }
      
      currentPeak = value;
      currentPeakDate = valuation.timestamp;
      currentDrawdown = 0;
    } else {
      // Calculate drawdown
      const drawdown = (currentPeak - value) / currentPeak * 100;
      
      // If this is a new drawdown period
      if (drawdown > 0 && !currentDrawdownPeriod) {
        currentDrawdownPeriod = {
          startDate: currentPeakDate,
          endDate: valuation.timestamp,
          startValue: currentPeak,
          endValue: value,
          drawdownPercentage: drawdown,
          duration: Math.floor((valuation.timestamp.getTime() - currentPeakDate.getTime()) / (24 * 60 * 60 * 1000)),
          recovered: false
        };
      } else if (currentDrawdownPeriod) {
        // Update existing drawdown period
        if (drawdown > currentDrawdownPeriod.drawdownPercentage) {
          currentDrawdownPeriod.endDate = valuation.timestamp;
          currentDrawdownPeriod.endValue = value;
          currentDrawdownPeriod.drawdownPercentage = drawdown;
          currentDrawdownPeriod.duration = Math.floor((valuation.timestamp.getTime() - currentPeakDate.getTime()) / (24 * 60 * 60 * 1000));
        }
      }
      
      currentDrawdown = drawdown;
      
      // Check if this is the max drawdown
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
        maxDrawdownStartDate = currentPeakDate;
        maxDrawdownEndDate = valuation.timestamp;
      }
    }
  }
  
  // Add the final drawdown period if it exists
  if (currentDrawdownPeriod) {
    drawdownPeriods.push(currentDrawdownPeriod);
  }
  
  return {
    maxDrawdown,
    maxDrawdownStartDate,
    maxDrawdownEndDate,
    currentDrawdown,
    drawdownPeriods
  };
}
```

### 3. Correlation Analysis

```typescript
/**
 * Calculate correlation matrix for portfolio assets
 */
export async function calculateAssetCorrelations(
  portfolioId: string,
  startDate: Date,
  endDate: Date
): Promise<{
  correlationMatrix: Record<string, Record<string, number>>;
  assets: { ticker: string; name: string }[];
}> {
  // Get positions for this portfolio
  const positions = await getPortfolioPositions(portfolioId);
  
  // Get unique assets
  const assets = positions.reduce((unique, position) => {
    if (!unique.some(a => a.ticker === position.asset.ticker)) {
      unique.push({
        ticker: position.asset.ticker,
        name: position.asset.name
      });
    }
    return unique;
  }, [] as { ticker: string; name: string }[]);
  
  // Get price data for each asset
  const priceData: Record<string, { date: Date; price: number }[]> = {};
  for (const asset of assets) {
    priceData[asset.ticker] = await getAssetPrices(asset.ticker, startDate, endDate);
  }
  
  // Align dates across all assets
  const alignedPrices = alignPriceDates(priceData);
  
  // Calculate returns for each asset
  const returns: Record<string, number[]> = {};
  for (const ticker of Object.keys(alignedPrices)) {
    const prices = alignedPrices[ticker].map(p => p.price);
    returns[ticker] = calculateReturns(prices);
  }
  
  // Calculate correlation matrix
  const correlationMatrix: Record<string, Record<string, number>> = {};
  for (const ticker1 of assets.map(a => a.ticker)) {
    correlationMatrix[ticker1] = {};
    for (const ticker2 of assets.map(a => a.ticker)) {
      correlationMatrix[ticker1][ticker2] = calculateCorrelation(
        returns[ticker1],
        returns[ticker2]
      );
    }
  }
  
  return {
    correlationMatrix,
    assets
  };
}

/**
 * Calculate Pearson correlation coefficient between two return series
 */
function calculateCorrelation(returns1: number[], returns2: number[]): number {
  if (returns1.length !== returns2.length) {
    throw new Error('Return series must have the same length');
  }
  
  const n = returns1.length;
  
  // Calculate means
  const mean1 = returns1.reduce((sum, val) => sum + val, 0) / n;
  const mean2 = returns2.reduce((sum, val) => sum + val, 0) / n;
  
  // Calculate covariance and standard deviations
  let covariance = 0;
  let variance1 = 0;
  let variance2 = 0;
  
  for (let i = 0; i < n; i++) {
    const diff1 = returns1[i] - mean1;
    const diff2 = returns2[i] - mean2;
    
    covariance += diff1 * diff2;
    variance1 += diff1 * diff1;
    variance2 += diff2 * diff2;
  }
  
  covariance /= n;
  variance1 /= n;
  variance2 /= n;
  
  const stdDev1 = Math.sqrt(variance1);
  const stdDev2 = Math.sqrt(variance2);
  
  if (stdDev1 === 0 || stdDev2 === 0) {
    return 0; // No correlation if either series has zero standard deviation
  }
  
  return covariance / (stdDev1 * stdDev2);
}
```

## Best Practices for Performance Reporting

### 1. Chart Design

✅ **Do:**
- Use appropriate chart types for different data
- Maintain consistent color schemes
- Include proper axes labels and legends
- Support interaction (tooltips, zooming)
- Show relevant time frames

❌ **Don't:**
- Overwhelm with too many data series
- Use misleading scales or baselines
- Omit important context
- Create cluttered visualizations

### 2. Performance Metrics

✅ **Do:**
- Clearly explain calculation methodologies
- Provide both absolute and percentage returns
- Include risk-adjusted metrics
- Show appropriate time frames
- Compare to relevant benchmarks

❌ **Don't:**
- Cherry-pick favorable periods
- Hide drawdowns or losses
- Use ambiguous terminology
- Confuse cumulative and period returns

### 3. Data Visualization

✅ **Do:**
- Make charts responsive for different screen sizes
- Use consistent date formatting
- Provide proper number formatting
- Make interactive elements obvious
- Support data exports

❌ **Don't:**
- Use tiny, unreadable text
- Create charts that work only on desktop
- Use ambiguous color schemes
- Forget accessibility considerations

### 4. Report Structure

✅ **Do:**
- Start with key summary metrics
- Group related information
- Show position-level breakdowns
- Include market context
- Maintain consistent layout

❌ **Don't:**
- Mix different time periods without clear labels
- Hide methodology details
- Overload with technical jargon
- Make reports too long or complex

## Summary

Performance reporting and visualization are critical components of Numisma, providing traders with the insights they need to evaluate their strategies and make informed decisions. The system offers:

1. **Comprehensive Reporting**: Multiple report types covering daily to yearly timeframes
2. **Interactive Visualization**: Engaging charts and graphics to reveal patterns
3. **Detailed Analytics**: Performance metrics at both portfolio and position levels
4. **Comparison Tools**: Benchmark analysis to provide market context
5. **Flexible Exports**: Share and analyze portfolio performance externally

By implementing these reporting capabilities, Numisma helps traders gain a deeper understanding of their performance, identify strengths and weaknesses, and optimize their strategies for better results.
