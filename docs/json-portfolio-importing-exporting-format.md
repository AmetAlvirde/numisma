# Numisma Portfolio importing and exporting JSON Format

The JSON format serves as the standard for importing and exporting portfolio
data in Numisma. It represents the complete state of a portfolio, including
positions, portfolio-position relationships, and historical valuations.

## Overview

The JSON format contains several top-level sections:

1. **portfolio**: Contains the portfolio metadata
2. **positions**: An array of position objects with full details
3. **portfolioPositions**: Junction records linking positions to portfolios
4. **historicalValuations**: (Optional) Historical valuation records

## Format Structure

```json
{
  "portfolio": {
    "id": "string",
    "name": "string",
    "description": "string?",
    "dateCreated": "Date|string|genesis",
    "status": "active|archived",
    "userId": "string",
    "tags": "string[]?",
    "displayMetadata": {
      "color": "string?",
      "sortOrder": "number?",
      "isPinned": "boolean?"
    }
  },
  "positions": [
    {
      "id": "string",
      "name": "string",
      "lifecycle": "planned|building|active|closed",
      "lifecycleHistory": [
        {
          "from": "PositionLifecycle",
          "to": "PositionLifecycle",
          "timestamp": "Date",
          "userId": "string",
          "notes": "string?",
          "relatedOrderIds": "string[]?"
        }
      ],
      "capitalTier": "C1|C2|C3|C4|C5",
      "capitalTierHistory": [
        {
          "from": "CapitalTier",
          "to": "CapitalTier",
          "timestamp": "Date",
          "amountSecured": "number",
          "relatedOrderId": "string",
          "notes": "string?"
        }
      ],
      "riskLevel": "number",
      "walletType": "hot|cold",
      "strategy": "string",
      "asset": {
        "name": "string",
        "ticker": "string",
        "pair": "string",
        "location": "AssetLocation",
        "exchangeDetails": {
          "name": "string",
          "accountType": "ExchangeAccountType",
          "subAccount": "string?"
        },
        "coldStorageDetails": {
          "provider": "string?",
          "model": "string?",
          "label": "string",
          "securityNotes": "string?"
        }
      },
      "positionDetails": {
        "side": "buy|sell",
        "fractal": "string",
        "initialInvestment": "number",
        "currentInvestment": "number",
        "recoveredAmount": "number",
        "orders": [
          {
            "id": "string",
            "dateOpen": "DateOrGenesis?",
            "dateFilled": "Date?",
            "averagePrice": "number?",
            "totalCost": "number?",
            "status": "OrderStatus",
            "type": "OrderType",
            "purpose": "OrderPurpose",
            "fee": "number|genesis?",
            "feeUnit": "string?",
            "filled": "number?",
            "unit": "SizeUnit?",
            "trigger": "number?",
            "estimatedCost": "number?",
            "capitalTierImpact": "CapitalTierImpact?",
            "notes": "string?"
          }
        ],
        "stopLoss": [
          {
            "// StopLossOrder extends Order": "",
            "unit": "SizeUnit",
            "size": "number",
            "isTrailing": "boolean",
            "trailingDistance": "number?",
            "highestPrice": "number?",
            "effectiveTriggerPrice": "number?",
            "capitalPreservation": {
              "percentage": "number",
              "amount": "number"
            }
          }
        ],
        "takeProfit": [
          {
            "// TakeProfitOrder extends Order": "",
            "unit": "SizeUnit",
            "size": "number",
            "targetReturnPercentage": "number?",
            "expectedCapitalTierImpact": "CapitalTierImpact",
            "isStaged": "boolean",
            "stageNumber": "number?",
            "totalStages": "number?"
          }
        ],
        "dateOpened": "DateOrGenesis?",
        "dateClosed": "DateOrGenesis?",
        "closedPercentage": "number"
      },
      "metrics": {
        "realizedPnL": "number",
        "unrealizedPnL": "number",
        "roi": "number",
        "maxDrawdown": "number",
        "duration": "string"
      }
    }
  ],
  "portfolioPositions": [
    {
      "portfolioId": "string",
      "positionId": "string",
      "addedAt": "Date",
      "addedBy": "string",
      "isHidden": "boolean",
      "displayOrder": "number?"
    }
  ],
  "historicalValuations": [
    {
      "id": "string",
      "portfolioId": "string",
      "timestamp": "Date",
      "temporalMetadata": {
        "year": "number",
        "quarter": "number?",
        "month": "number?",
        "week": "number?",
        "day": "number?",
        "dayOfYear": "number?",
        "isoWeek": "number?",
        "isoWeekYear": "number?",
        "periodKey": "string",
        "periodName": "string",
        "timeFrameUnit": "TimeFrameUnit",
        "periodStart": "Date",
        "periodEnd": "Date",
        "isTimeframeBoundary": "boolean"
      },
      "aggregationMetadata": {
        "isAggregated": "boolean",
        "aggregationMethod": "AggregationMethod",
        "sourceGranularity": "TimeFrameGranularity",
        "targetGranularity": "TimeFrameGranularity",
        "sourceValuationIds": "string[]?",
        "sourceCount": "number?",
        "coveragePercentage": "number?",
        "hasEstimatedData": "boolean?"
      },
      "totalValue": "number",
      "valueCurrency": "string",
      "initialInvestment": "number",
      "profitLoss": "number",
      "percentageReturn": "number",
      "positionValuations": [
        {
          "id": "string",
          "positionId": "string",
          "value": "number",
          "marketPrice": "number",
          "quantity": "number",
          "costBasis": "number",
          "profitLoss": "number",
          "percentageReturn": "number"
        }
      ],
      "isRetroactive": "boolean",
      "marketContext": {
        "btcPrice": "number?",
        "ethPrice": "number?",
        "totalMarketCap": "number?",
        "fearGreedIndex": "number?"
      }
    }
  ]
}
```

## Example JSON

```json
{
  "portfolio": {
    "id": "cycle-portfolio-123",
    "name": "Cycle",
    "description": "Bull market cycle portfolio",
    "dateCreated": "genesis",
    "status": "active",
    "userId": "user-001",
    "tags": ["bull-market", "crypto"],
    "displayMetadata": {
      "color": "#4F46E5",
      "sortOrder": 1,
      "isPinned": true
    }
  },
  "positions": [
    {
      "id": "f4d941b4-2831-4700-987d-279ff6cddf55",
      "name": "ADA bull last leg allocation",
      "lifecycle": "active",
      "lifecycleHistory": [
        {
          "from": "planned",
          "to": "active",
          "timestamp": "2025-02-15T00:00:00.000Z",
          "userId": "user-001",
          "notes": "Position imported at genesis",
          "relatedOrderIds": ["a28153a9-1038-4447-bb40-f98e65e72643"]
        }
      ],
      "capitalTier": "C1",
      "capitalTierHistory": [
        {
          "from": "C1",
          "to": "C1",
          "timestamp": "2025-02-15T00:00:00.000Z",
          "amountSecured": 0,
          "relatedOrderId": "a28153a9-1038-4447-bb40-f98e65e72643",
          "notes": "Initial capital tier at genesis"
        }
      ],
      "riskLevel": 9,
      "walletType": "hot",
      "strategy": "Alt-season Accumulation",
      "asset": {
        "name": "Cardano",
        "ticker": "ADA",
        "pair": "ADA/USDT",
        "location": "exchange",
        "exchangeDetails": {
          "name": "Bitget",
          "accountType": "spot"
        }
      },
      "positionDetails": {
        "side": "buy",
        "fractal": "1D",
        "initialInvestment": 100.437,
        "currentInvestment": 100.437,
        "recoveredAmount": 0,
        "orders": [
          {
            "id": "a28153a9-1038-4447-bb40-f98e65e72643",
            "dateOpen": "genesis",
            "dateFilled": "2025-02-15T00:00:00.000Z",
            "averagePrice": 0.3,
            "totalCost": 100.437,
            "status": "filled",
            "type": "trigger",
            "purpose": "entry",
            "fee": 0.2,
            "feeUnit": "USDT",
            "filled": 334.79,
            "unit": "base",
            "capitalTierImpact": "none",
            "notes": "Initial position entry"
          }
        ],
        "stopLoss": [],
        "takeProfit": [],
        "dateOpened": "genesis",
        "closedPercentage": 0
      },
      "metrics": {
        "realizedPnL": 0,
        "unrealizedPnL": 0,
        "roi": 0,
        "maxDrawdown": 0,
        "duration": "0d"
      }
    }
  ],
  "portfolioPositions": [
    {
      "portfolioId": "cycle-portfolio-123",
      "positionId": "f4d941b4-2831-4700-987d-279ff6cddf55",
      "addedAt": "2025-02-15T00:00:00.000Z",
      "addedBy": "user-001",
      "isHidden": false,
      "displayOrder": 1
    }
  ],
  "historicalValuations": [
    {
      "id": "genesis-valuation-001",
      "portfolioId": "cycle-portfolio-123",
      "timestamp": "2025-02-15T00:00:00.000Z",
      "temporalMetadata": {
        "year": 2025,
        "month": 2,
        "day": 15,
        "periodKey": "2025-02-15",
        "periodName": "February 15, 2025 (Genesis)",
        "timeFrameUnit": "genesis",
        "periodStart": "2025-02-15T00:00:00.000Z",
        "periodEnd": "2025-02-15T23:59:59.999Z",
        "isTimeframeBoundary": true
      },
      "aggregationMetadata": {
        "isAggregated": false,
        "aggregationMethod": "close",
        "sourceGranularity": "daily",
        "targetGranularity": "genesis"
      },
      "totalValue": 100.437,
      "valueCurrency": "USD",
      "initialInvestment": 100.437,
      "profitLoss": 0,
      "percentageReturn": 0,
      "positionValuations": [
        {
          "id": "pos-val-ada-genesis",
          "positionId": "f4d941b4-2831-4700-987d-279ff6cddf55",
          "value": 100.44,
          "marketPrice": 0.3,
          "quantity": 334.79,
          "costBasis": 100.44,
          "profitLoss": 0,
          "percentageReturn": 0
        }
      ],
      "isRetroactive": true,
      "marketContext": {
        "btcPrice": 87530,
        "ethPrice": 3027,
        "totalMarketCap": 2.7e12,
        "fearGreedIndex": 65
      }
    }
  ]
}
```

## Importing the Enhanced JSON

### Import Process

1. Validate the JSON structure against the expected schema
2. Create the portfolio record if it doesn't exist
3. Create or update position records
4. Create or update portfolio-position relationships
5. Import historical valuations if provided

### Validation Rules

1. **Required Fields**

   - Portfolio must have id, name, dateCreated, status
   - Positions must have id, name, lifecycle, asset, positionDetails
   - PortfolioPositions must have portfolioId, positionId, addedAt

2. **Field Validation**

   - Asset tickers must be valid and match pairs
   - Currency values should be numeric
   - Dates should be valid ISO strings or "genesis"
   - Lifecycle state transitions should be valid

3. **Consistency Checks**
   - All positions referenced in portfolioPositions must exist
   - All positions in historical valuations must exist
   - Sum of position values must match portfolio total value
   - Positions with "closed" lifecycle must have 100% closedPercentage

### Error Handling

The import process should provide:

1. Validation errors with specific field references
2. Warning for non-critical issues (missing optional fields)
3. Partial import capabilities for valid portions of data
4. Recovery suggestions for common errors

## Exporting to Enhanced JSON

### Export Options

1. **Complete Export**: Portfolio + all positions + all historical valuations
2. **Snapshot Export**: Portfolio + positions at current state (no history)
3. **Position Export**: Individual position with full details
4. **Time-range Export**: Portfolio + positions + valuations within date range

### Export Format Control

1. **Prettify**: Format JSON with indentation for readability
2. **Minify**: Compact JSON without whitespace
3. **Include/Exclude**: Control which sections to include
   - Historical data
   - Position details
   - Performance metrics

## Implementation Notes

1. **File Size Considerations**

   - Large portfolios with extensive history can create large JSON files
   - Consider implementing pagination for historical valuations
   - Offer incremental import/export for very large portfolios

2. **Schema Versioning**

   - Include schema version in exports
   - Maintain backward compatibility with older formats
   - Provide migration utilities for upgrading from legacy formats

3. **Security Considerations**
   - Remove sensitive data before export (user IDs, etc.)
   - Hash or anonymize identifiers in public exports
   - Include privacy controls for shared exports
