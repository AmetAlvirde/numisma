# Active Focus

We are currently working on the [Home Page](epics/epic-02-home-page.md)

What we want is to connect the home page to the database. So we need the following
prisma schemas:

<prisma-schemas>
// Portfolio model - represents a collection of positions
model Portfolio {
  id          String   @id @default(cuid())
  name        String
  description String?
  dateCreated DateTime
  dateStatus  DateStatus @default(actual)
  status      String // "active" or "archived"
  userId      String
  tags        String[] // Array of tags for categorization
  notes       String?

// Display metadata
color String?
sortOrder Int?
isPinned Boolean? @default(false)

// Relations
portfolioPositions PortfolioPosition[]
valuations HistoricalValuation[]

createdAt DateTime @default(now())
updatedAt DateTime @updatedAt

@@map("portfolios")
}

// Junction table between Portfolio and Position with metadata
model PortfolioPosition {
id String @id @default(cuid())
portfolio Portfolio @relation(fields: [portfolioId], references: [id])
portfolioId String
position Position @relation(fields: [positionId], references: [id])
positionId String
addedAt DateTime
addedBy String // User ID who added this position
isHidden Boolean @default(false)
displayOrder Int

@@unique([portfolioId, positionId])
@@map("portfolio_positions")
}

// Historical valuation for portfolios
model HistoricalValuation {
id String @id @default(cuid())
portfolio Portfolio @relation(fields: [portfolioId], references: [id])
portfolioId String
timestamp DateTime
timestampStatus DateStatus @default(actual)

// Temporal metadata
year Int
month Int?
day Int?
periodKey String
periodName String
timeFrameUnit String
periodStart DateTime
periodStartStatus DateStatus @default(actual)
periodEnd DateTime
periodEndStatus DateStatus @default(actual)
isTimeframeBoundary Boolean

// Aggregation metadata
isAggregated Boolean @default(false)
aggregationMethod String
sourceGranularity String
targetGranularity String

// Valuation data
totalValue Float
valueCurrency String
initialInvestment Float
profitLoss Float
percentageReturn Float

// Position valuations as JSON
positionValuations Json

// Additional metadata
isRetroactive Boolean @default(false)

// Add key analytics fields
realizedProfitLoss Float?
unrealizedProfitLoss Float?

// Add fields for risk metrics
volatility Float?
maxDrawdown Float?

// Add fields for return metrics
dailyReturn Float?
weeklyReturn Float?
monthlyReturn Float?
quarterlyReturn Float?
yearlyReturn Float?
inceptionReturn Float?

// Position metrics
positionCount Int?

// Keep using JSON for complex nested structures
returnMetrics Json?
riskMetrics Json?
assetAllocation Json?

notes String?

createdAt DateTime @default(now())
updatedAt DateTime @updatedAt

@@index([portfolioId, timestamp])
@@index([periodKey, timeFrameUnit])
@@map("historical_valuations")
}

</prisma-schemas>

This portfolio should support positions such as:
<sample-position>

const position018 = {
id: "numisma-global-position-018",
name: "BTC Trading Strategy",
market: {
id: "market_btcusdt",
baseAssetId: "asset_btc",
quoteAssetId: "asset_usdt",
marketSymbol: "BTCUSDT",
pairNotation: "BTC/USDT",
exchange: "BingX",
isTradable: true,
},
walletLocationId: "bingx-spot",
walletType: "hot",
lifecycle: "closed", // Updated from "active" to "closed"
capitalTier: "C1", // Remains C1 - position was funded with fresh capital
riskLevel: 5,
strategy: "swing",
positionDetails: {
id: "numisma-global-position-018-position-details",
side: "long",
status: "closed", // Updated from "active" to "closed"
timeFrame: "1D",
initialInvestment: 99.3,
currentInvestment: 0.0, // Updated - no current investment as position is closed
recoveredAmount: 118.26, // Net proceeds from stop profit sale
dateOpened: "2025-04-06T15:40:35Z",
dateOpenedStatus: "actual",
dateClosed: "2025-05-05T01:06:49Z", // Added close date
dateClosedStatus: "actual", // Added close date status
closedPercentage: 100.0, // Updated - position fully closed
averageEntryPrice: 79442.75,
averageExitPrice: 94700.0, // Added average exit price
totalSize: 0.00125, // Remains the same (total size ever held)
totalCost: 99.3,
isLeveraged: false,
realizedProfitLoss: 18.96, // Updated with calculated realized P&L
unrealizedProfitLoss: 0.0, // Reset to 0 as position is closed
currentReturn: 19.09, // Percentage return: (18.96 / 99.3) \* 100
// Capital breakdown upon closure:
capitalBreakdown: {
recoveredC1: 99.3, // Original C1 capital recovered
generatedC2: 18.96, // New C2 capital created from profits
totalRecovered: 118.26, // Total amount recovered (net of fees)
},
},
positionOrders: [
{
id: "numisma-global-position-018-order_btc_1",
positionDetailsId: "numisma-global-position-018-position-details",
dateOpen: "2025-04-06T15:40:35Z",
dateOpenStatus: "actual",
dateFilled: "2025-04-06T15:40:35Z",
dateFilledStatus: "actual",
averagePrice: 79442.75,
totalCost: 99.3,
status: "filled",
type: "market",
purpose: "entry",
direction: "entry",
filled: 0.00125,
unit: "base",
fee: 0.00000125,
feeUnit: "base",
},
{
id: "numisma-global-position-018-order_btc_2",
positionDetailsId: "numisma-global-position-018-position-details",
dateOpen: "2025-04-06T15:40:35Z",
dateOpenStatus: "actual",
dateFilled: null,
dateFilledStatus: "unknown",
averagePrice: 73500.0,
totalCost: 100.0,
status: "cancelled", // Updated from "submitted" to "cancelled" since position is closed
type: "limit",
purpose: "entry",
direction: "entry",
filled: null,
unit: "quote",
fee: null,
feeUnit: null,
},
// New stop profit order
{
id: "numisma-global-position-018-order_btc_3",
positionDetailsId: "numisma-global-position-018-position-details",
dateOpen: "2025-05-05T01:06:49Z",
dateOpenStatus: "actual",
dateFilled: "2025-05-05T01:06:49Z",
dateFilledStatus: "actual",
averagePrice: 94700.0,
totalCost: 118.375, // Gross proceeds before fee
status: "filled",
type: "market", // Assuming market order for stop profit trigger
purpose: "exit",
direction: "exit",
filled: 0.00125, // Full position size
unit: "base",
fee: 0.1188485,
feeUnit: "quote", // Fee in USDT
},
],
positionMetrics: {
id: "numisma-global-position-018-metrics",
positionId: "numisma-global-position-018",
realizedPnL: 18.96, // Updated with calculated realized P&L
unrealizedPnL: 0.0, // Reset to 0 as position is closed
roi: 19.09, // Return on investment percentage
maxDrawdown: 0.0, // Assuming no significant drawdown occurred
duration: "29d", // From 2025-04-06 to 2025-05-05
},
positionJournal: [
{
id: "numisma-global-position-018-journal_btc_1",
positionId: "numisma-global-position-018",
thought:
"Initiated BTC position with initial entry of 0.00125 BTC at 79,442.75 USDT. Additional limit order placed at 73,500 USDT for 100 USDT worth of BTC. Strategy aims to accumulate BTC at lower price points.",
attachments: [],
timestamp: "2025-04-06T15:40:35Z",
timestampStatus: "actual",
userId: "numisma-alpha-tester-global-portfolio",
tags: ["btc-trade", "accumulation", "limit-order"],
sentiment: "bullish",
isKeyLearning: true,
},
// New journal entry for position closure
{
id: "numisma-global-position-018-journal_btc_2",
positionId: "numisma-global-position-018",
thought:
"Position closed via stop profit order at 94,700 USDT. Sold entire 0.00125 BTC position for 118.26 USDT net proceeds (after 0.1188485 USDT fee). Realized profit of 18.96 USDT representing a 19.09% return over 29 days. Capital breakdown: 99.3 USDT recovered as C1 (original capital), 18.96 USDT generated as new C2 capital (realized profits). This position created new C2 tier capital while recovering the original C1 investment.",
attachments: [],
timestamp: "2025-05-05T01:06:49Z",
timestampStatus: "actual",
userId: "numisma-alpha-tester-global-portfolio",
tags: ["btc-trade", "position-closed", "profit-taking", "stop-profit"],
sentiment: "bullish",
isKeyLearning: true,
},
],
createdAt: "2025-03-03T00:00:00Z",
updatedAt: "2025-05-05T01:06:49Z", // Updated to match the stop profit execution time
};

</sample-position>

<sample-position-log>

## Summary of Changes

**Key Updates Made:**

1.  **Position Status**: Changed `lifecycle` and `status` from "active" to "closed"
2.  **Capital Tier**: Remains "C1" (position was funded with fresh capital)
3.  **Position Details**:

    - `currentInvestment`: 99.3 → 0.0 (no current investment)
    - `recoveredAmount`: 0.0 → 118.26 (net proceeds)
    - `dateClosed`: Added "2025-05-05T01:06:49Z"
    - `closedPercentage`: 0.0 → 100.0 (fully closed)
    - `averageExitPrice`: Added 94,700.0
    - `realizedProfitLoss`: 0.0 → 18.96
    - `unrealizedProfitLoss`: 0.0 (reset since closed)
    - `currentReturn`: Added 19.09%
    - `capitalBreakdown`: Added breakdown showing C1 recovery (99.3) and C2 generation (18.96)

4.  **Orders**:

    - Cancelled pending limit order (order_btc_2)
    - Added new stop profit order (order_btc_3)

5.  **Metrics**: Updated all P&L and ROI calculations

6.  **Journal**: Added new entry documenting the position closure

**Math Verification:**

- Entry cost: 99.3 USDT
- Exit proceeds: 118.26 USDT (net after fees)
- Realized P&L: 18.96 USDT
- ROI: 19.09%
- Duration: 29 days (excellent swing trade result)

The position now correctly reflects a successful closed trade that:

- **Recovers** 99.3 USDT of C1 capital (original fresh capital)
- **Generates** 18.96 USDT of new C2 capital (realized profits)
- **Maintains** proper capital tier tracking showing the position was C1-funded but created C2 capital

This approach properly separates the recovery of original capital from the generation of new profit-based capital, which is crucial for accurate capital tier progression tracking.

</sample-position-log>
