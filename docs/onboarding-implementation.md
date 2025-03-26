# Numisma Onboarding Implementation

## Onboarding Overview

User onboarding is a critical component of Numisma, designed to quickly get users set up with their portfolio data and historical performance metrics. The onboarding flow consists of three main phases:

1. **Portfolio Import**: Getting the user's existing portfolio data into the system
2. **Historical Data Setup**: Adding historical price points for performance tracking
3. **Dashboard Introduction**: Introducing users to their portfolio visualization

## 1. Portfolio Import Implementation

### Import Methods

We offer several methods for importing portfolio data:

#### JSON Import

```tsx
import React, { useState } from "react";
import { JsonImportPanel } from "@/components/import/JsonImportPanel";
import { validateEnhancedJson } from "@/lib/validation/json-validator";
import { importEnhancedJson } from "@/lib/import/json-importer";

export const EnhancedJsonImport: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleImport = async (jsonData: any) => {
    setImporting(true);
    setError(null);

    try {
      // Validate the JSON structure
      const validationResult = validateEnhancedJson(jsonData);

      if (!validationResult.valid) {
        setError(validationResult.error || "Invalid JSON format");
        setImporting(false);
        return;
      }

      // Process the import
      await importEnhancedJson(jsonData);

      // Set success state
      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-medium mb-4">Import Enhanced JSON</h2>

        <p className="text-gray-600 mb-6">
          Import your portfolio data in the Numisma enhanced JSON format.
        </p>

        {!success ? (
          <JsonImportPanel
            onImport={handleImport}
            error={error}
            isLoading={importing}
          />
        ) : (
          <div className="bg-green-50 text-green-800 p-4 rounded-md">
            <p className="font-medium">Import Successful!</p>
            <p className="mt-1">
              Your portfolio data has been imported successfully.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
```

### Import Validation Logic

```typescript
// src/lib/validation/json-validator.ts

import Ajv from "ajv";
import { enhancedJsonSchema } from "./schemas/enhanced-json-schema";
import { legacyJsonSchema } from "./schemas/legacy-json-schema";

const ajv = new Ajv({ allErrors: true });
const validateEnhancedJsonSchema = ajv.compile(enhancedJsonSchema);
const validateLegacyJsonSchema = ajv.compile(legacyJsonSchema);

/**
 * Validate JSON format
 */
export function validateEnhancedJson(json: any): {
  valid: boolean;
  error?: string;
} {
  try {
    const valid = validateEnhancedJsonSchema(json);

    if (!valid) {
      const errors = validateEnhancedJsonSchema.errors || [];
      return {
        valid: false,
        error: formatValidationErrors(errors),
      };
    }

    // Additional semantic validation
    const semanticErrors = validateEnhancedJsonSemantics(json);
    if (semanticErrors.length > 0) {
      return {
        valid: false,
        error: semanticErrors.join("\n"),
      };
    }

    return { valid: true };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Validation error",
    };
  }
}

/**
 * Format validation errors for user-friendly display
 */
function formatValidationErrors(errors: any[]): string {
  return errors
    .map(error => {
      const path = error.instancePath || "";
      const message = error.message || "Unknown error";
      return `${path}: ${message}`;
    })
    .join("\n");
}

/**
 * Perform semantic validation on JSON
 */
function validateEnhancedJsonSemantics(json: any): string[] {
  const errors: string[] = [];

  // Check portfolio references
  if (json.portfolioPositions) {
    for (const pp of json.portfolioPositions) {
      if (pp.portfolioId !== json.portfolio.id) {
        errors.push(
          `Portfolio position references unknown portfolio: ${pp.portfolioId}`
        );
      }

      const positionExists = json.positions.some(
        (p: any) => p.id === pp.positionId
      );
      if (!positionExists) {
        errors.push(
          `Portfolio position references unknown position: ${pp.positionId}`
        );
      }
    }
  }

  // Check historical valuations
  if (json.historicalValuations) {
    for (const hv of json.historicalValuations) {
      if (hv.portfolioId !== json.portfolio.id) {
        errors.push(
          `Historical valuation references unknown portfolio: ${hv.portfolioId}`
        );
      }

      for (const pv of hv.positionValuations) {
        const positionExists = json.positions.some(
          (p: any) => p.id === pv.positionId
        );
        if (!positionExists) {
          errors.push(
            `Position valuation references unknown position: ${pv.positionId}`
          );
        }
      }
    }
  }

  return errors;
}
```

### Import Implementation

```typescript
// src/lib/import/json-importer.ts

import {
  Portfolio,
  Position,
  PositionPortfolio,
  PortfolioValuation,
} from "@/types";
import {
  savePortfolio,
  savePosition,
  savePortfolioPosition,
  savePortfolioValuation,
} from "@/services/data-service";

/**
 * Import enhanced JSON format
 */
export async function importEnhancedJson(json: any): Promise<void> {
  // Import portfolio
  const portfolio: Portfolio = json.portfolio;
  await savePortfolio(portfolio);

  // Import positions
  for (const position of json.positions) {
    await savePosition(position);
  }

  // Import portfolio-position relationships
  for (const pp of json.portfolioPositions) {
    await savePortfolioPosition(pp);
  }

  // Import historical valuations if provided
  if (json.historicalValuations) {
    for (const valuation of json.historicalValuations) {
      await savePortfolioValuation(valuation);
    }
  }
}
```

## 2. Historical Data Setup Implementation

### Historical Data Input Component

```tsx
import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AssetPriceInput } from "./AssetPriceInput";
import { PositionChangeInput } from "./PositionChangeInput";
import { MarketContextInput } from "./MarketContextInput";
import { HistoricalPricePoint } from "@/types/historical";
import { format } from "date-fns";

interface HistoricalDataInputProps {
  date: Date;
  portfolioId: string;
  onSave: (data: HistoricalPricePoint) => Promise<void>;
  onCancel: () => void;
}

export const HistoricalDataInput: React.FC<HistoricalDataInputProps> = ({
  date,
  portfolioId,
  onSave,
  onCancel,
}) => {
  const [assetPrices, setAssetPrices] = useState<Record<string, number>>({});
  const [assetChanges, setAssetChanges] = useState<
    Record<string, AssetHoldingChange[]>
  >({});
  const [marketContext, setMarketContext] = useState({
    btcPrice: 0,
    ethPrice: 0,
    totalMarketCap: 0,
    fearGreedIndex: 50,
  });
  const [saving, setSaving] = useState(false);
  const [assets, setAssets] = useState<Asset[]>([]);

  // Load portfolio assets
  useEffect(() => {
    async function loadAssets() {
      const portfolioAssets = await getPortfolioAssets(portfolioId);
      setAssets(portfolioAssets);

      // Initialize asset prices with zeros
      const initialPrices: Record<string, number> = {};
      portfolioAssets.forEach(asset => {
        initialPrices[asset.ticker] = 0;
      });
      setAssetPrices(initialPrices);
    }

    loadAssets();
  }, [portfolioId]);

  const handleAssetPriceChange = (ticker: string, price: number) => {
    setAssetPrices(prev => ({
      ...prev,
      [ticker]: price,
    }));
  };

  const handleAssetChangesChange = (
    ticker: string,
    changes: AssetHoldingChange[]
  ) => {
    setAssetChanges(prev => ({
      ...prev,
      [ticker]: changes,
    }));
  };

  const handleMarketContextChange = (context: any) => {
    setMarketContext(context);
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      // Validate that all assets have prices
      const missingPrices = assets.some(asset => !assetPrices[asset.ticker]);
      if (missingPrices) {
        throw new Error("All assets must have prices");
      }

      // Create the historical price point
      const histPoint: HistoricalPricePoint = {
        timestamp: date,
        assetPrices,
        assetHoldingChanges: assetChanges,
        marketContext,
      };

      // Save the data
      await onSave(histPoint);
    } catch (error) {
      console.error("Error saving historical data:", error);
      // Handle error display
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-medium">
        Historical Data: {format(date, "MMMM d, yyyy")}
      </h2>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium mb-4">Asset Prices</h3>
        <AssetPriceInput
          assets={assets}
          prices={assetPrices}
          onChange={handleAssetPriceChange}
        />
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium mb-4">Position Changes</h3>
        <PositionChangeInput
          assets={assets}
          portfolioId={portfolioId}
          date={date}
          changes={assetChanges}
          onChange={handleAssetChangesChange}
        />
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium mb-4">Market Context</h3>
        <MarketContextInput
          context={marketContext}
          onChange={handleMarketContextChange}
        />
      </div>

      <div className="flex justify-end space-x-3">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving..." : "Save Data Point"}
        </Button>
      </div>
    </div>
  );
};
```

### Historical Data Processing

```typescript
// src/lib/historical/valuation-generator.ts

import { HistoricalPricePoint } from "@/types/historical";
import {
  Portfolio,
  Position,
  PortfolioValuation,
  PositionValuation,
} from "@/types";
import { calculatePositionValue, calculateCostBasis } from "@/lib/calculations";
import { createTemporalMetadata } from "@/lib/temporal-metadata";
import { generateId } from "@/lib/id-generator";

/**
 * Generate a portfolio valuation from historical price point
 */
export async function generateValuation(
  portfolio: Portfolio,
  positions: Position[],
  pricePoint: HistoricalPricePoint
): Promise<PortfolioValuation> {
  // Generate position valuations
  const positionValuations: PositionValuation[] = [];

  for (const position of positions) {
    // Get price for this asset
    const price = pricePoint.assetPrices[position.asset.ticker];
    if (!price) {
      throw new Error(`Missing price for ${position.asset.ticker}`);
    }

    // Calculate position value
    const quantity = calculateQuantity(position);
    const value = quantity * price;
    const costBasis = calculateCostBasis(position);
    const profitLoss = value - costBasis;
    const percentageReturn = costBasis > 0 ? (profitLoss / costBasis) * 100 : 0;

    // Create position valuation
    const positionValuation: PositionValuation = {
      id: generateId(),
      positionId: position.id,
      value,
      marketPrice: price,
      quantity,
      costBasis,
      profitLoss,
      percentageReturn,
    };

    positionValuations.push(positionValuation);
  }

  // Calculate portfolio totals
  const totalValue = positionValuations.reduce((sum, pv) => sum + pv.value, 0);
  const initialInvestment = positionValuations.reduce(
    (sum, pv) => sum + pv.costBasis,
    0
  );
  const profitLoss = totalValue - initialInvestment;
  const percentageReturn =
    initialInvestment > 0 ? (profitLoss / initialInvestment) * 100 : 0;

  // Create temporal metadata
  const temporalMetadata = createTemporalMetadata(pricePoint.timestamp);

  // Create portfolio valuation
  const portfolioValuation: PortfolioValuation = {
    id: generateId(),
    portfolioId: portfolio.id,
    timestamp: pricePoint.timestamp,
    temporalMetadata,
    aggregationMetadata: {
      isAggregated: false,
      aggregationMethod: "close",
      sourceGranularity: "daily",
      targetGranularity: timeFrameUnitToGranularity(
        temporalMetadata.timeFrameUnit
      ),
    },
    totalValue,
    valueCurrency: "USD",
    initialInvestment,
    profitLoss,
    percentageReturn,
    positionValuations,
    isRetroactive: true,
    marketContext: pricePoint.marketContext,
  };

  return portfolioValuation;
}

/**
 * Calculate quantity for a position
 */
function calculateQuantity(position: Position): number {
  // Get quantity from filled orders
  let quantity = position.positionDetails.orders.reduce((sum, order) => {
    if (order.status === "filled" && order.filled) {
      if (position.positionDetails.side === "buy") {
        return sum + order.filled;
      } else {
        return sum - order.filled;
      }
    }
    return sum;
  }, 0);

  return quantity;
}

/**
 * Map timeframe unit to granularity
 */
function timeFrameUnitToGranularity(
  timeFrameUnit: TimeFrameUnit
): TimeFrameGranularity {
  switch (timeFrameUnit) {
    case "day":
      return "daily";
    case "week":
      return "weekly";
    case "month":
      return "monthly";
    case "quarter":
      return "quarterly";
    case "year":
      return "yearly";
    case "genesis":
      return "genesis";
    default:
      return "daily";
  }
}
```

### Historical Data Saving

```typescript
// src/lib/historical/data-manager.ts

import { HistoricalPricePoint } from "@/types/historical";
import {
  getPortfolio,
  getPortfolioPositions,
} from "@/services/portfolio-service";
import { generateValuation } from "./valuation-generator";
import { savePortfolioValuation } from "@/services/valuation-service";

/**
 * Save a historical data point and generate valuation
 */
export async function saveHistoricalData(
  portfolioId: string,
  pricePoint: HistoricalPricePoint
): Promise<void> {
  // Get portfolio
  const portfolio = await getPortfolio(portfolioId);
  if (!portfolio) {
    throw new Error(`Portfolio not found: ${portfolioId}`);
  }

  // Get positions
  const positions = await getPortfolioPositions(portfolioId);

  // Process position changes if any
  if (pricePoint.assetHoldingChanges) {
    await processPositionChanges(positions, pricePoint.assetHoldingChanges);
  }

  // Generate valuation
  const valuation = await generateValuation(portfolio, positions, pricePoint);

  // Save valuation
  await savePortfolioValuation(valuation);

  // Update time series metadata
  await updateTimeSeriesMetadata(valuation);
}

/**
 * Process position changes from historical data
 */
async function processPositionChanges(
  positions: Position[],
  changes: Record<string, AssetHoldingChange[]>
): Promise<void> {
  // Process each ticker's changes
  for (const [ticker, tickerChanges] of Object.entries(changes)) {
    // Find positions with this ticker
    const tickerPositions = positions.filter(p => p.asset.ticker === ticker);

    for (const change of tickerChanges) {
      // Find the specific position
      const position = tickerPositions.find(p => p.id === change.positionId);
      if (!position) {
        console.warn(`Position not found for change: ${change.positionId}`);
        continue;
      }

      // Process the change based on type
      switch (change.type) {
        case "buy":
          await processPositionBuy(position, change);
          break;
        case "sell":
          await processPositionSell(position, change);
          break;
        case "transfer":
          await processPositionTransfer(position, change);
          break;
        case "receive":
          await processPositionReceive(position, change);
          break;
      }
    }
  }
}

/**
 * Update time series metadata for a new valuation
 */
async function updateTimeSeriesMetadata(
  newValuation: PortfolioValuation
): Promise<void> {
  // Get all valuations for this portfolio
  const allValuations = await getPortfolioValuations(newValuation.portfolioId);

  // Create time series metadata
  const timeSeriesMetadata = createTimeSeriesMetadata(
    newValuation,
    allValuations
  );

  // Update the valuation with time series metadata
  const updatedValuation = {
    ...newValuation,
    timeSeriesMetadata,
  };

  // Save the updated valuation
  await updatePortfolioValuation(updatedValuation);
}
```

## 3. Dashboard Introduction Implementation

### Dashboard Onboarding Component

```tsx
import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PortfolioChart } from "@/components/dashboard/PortfolioChart";
import { PerformanceMetrics } from "@/components/dashboard/PerformanceMetrics";
import { PositionTable } from "@/components/dashboard/PositionTable";

interface DashboardOnboardingProps {
  portfolioId: string;
  onComplete: () => void;
}

export const DashboardOnboarding: React.FC<DashboardOnboardingProps> = ({
  portfolioId,
  onComplete,
}) => {
  const [currentStep, setCurrentStep] = useState(1);
  const totalSteps = 4;

  const nextStep = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1);
    } else {
      onComplete();
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <Card className="shadow-lg border-t-4 border-indigo-500">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl">
            Welcome to Your Portfolio Dashboard
          </CardTitle>
          <p className="text-gray-500 text-sm">
            Step {currentStep} of {totalSteps}
          </p>
        </CardHeader>

        <CardContent>
          {currentStep === 1 && (
            <div className="space-y-4">
              <h3 className="font-medium text-lg">Portfolio Overview</h3>
              <p className="text-gray-600">
                This is your portfolio overview. Here you can see your total
                portfolio value, performance metrics, and asset allocation at a
                glance.
              </p>
              <div className="bg-gray-50 rounded-lg p-4">
                <PerformanceMetrics portfolioId={portfolioId} timeframe="all" />
              </div>
            </div>
          )}

          {currentStep === 2 && (
            <div className="space-y-4">
              <h3 className="font-medium text-lg">Performance Chart</h3>
              <p className="text-gray-600">
                This chart shows your portfolio performance over time. You can
                adjust the timeframe to see different periods.
              </p>
              <div className="bg-gray-50 rounded-lg p-4 h-72">
                <PortfolioChart portfolioId={portfolioId} timeframe="all" />
              </div>
            </div>
          )}

          {currentStep === 3 && (
            <div className="space-y-4">
              <h3 className="font-medium text-lg">Positions Table</h3>
              <p className="text-gray-600">
                Here you can see all positions in your portfolio. Click on any
                position to see detailed information and manage it.
              </p>
              <div className="bg-gray-50 rounded-lg p-4">
                <PositionTable portfolioId={portfolioId} />
              </div>
            </div>
          )}

          {currentStep === 4 && (
            <div className="space-y-4">
              <h3 className="font-medium text-lg">Next Steps</h3>
              <p className="text-gray-600">
                Congratulations! Your portfolio is set up and ready to go. Here
                are some things you can do next:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-gray-600">
                <li>Add more historical data points for better tracking</li>
                <li>Create and manage positions through their lifecycle</li>
                <li>Generate reports to analyze your performance</li>
                <li>Set up additional portfolios for different strategies</li>
              </ul>
            </div>
          )}

          <div className="flex justify-between mt-6">
            <Button
              variant="outline"
              onClick={prevStep}
              disabled={currentStep === 1}
            >
              Previous
            </Button>
            <Button onClick={nextStep}>
              {currentStep < totalSteps ? "Next" : "Get Started"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
```

### Onboarding Progress Tracking

```typescript
// src/lib/onboarding/progress-tracker.ts

/**
 * Onboarding step enum
 */
export enum OnboardingStep {
  WELCOME = "welcome",
  IMPORT = "import",
  HISTORICAL_DATA = "historical_data",
  DASHBOARD_INTRO = "dashboard_intro",
  COMPLETED = "completed",
}

/**
 * Onboarding historical data point type
 */
export type OnboardingHistoricalPoint =
  | "genesis"
  | "february_close"
  | "week_09"
  | "week_10"
  | "week_11"
  | "week_12";

/**
 * Onboarding progress
 */
export interface OnboardingProgress {
  currentStep: OnboardingStep;
  portfolioId?: string;
  importCompleted: boolean;
  historicalDataPoints: Record<OnboardingHistoricalPoint, boolean>;
  dashboardIntroCompleted: boolean;
}

/**
 * Get initial onboarding progress
 */
export function getInitialProgress(): OnboardingProgress {
  return {
    currentStep: OnboardingStep.WELCOME,
    importCompleted: false,
    historicalDataPoints: {
      genesis: false,
      february_close: false,
      week_09: false,
      week_10: false,
      week_11: false,
      week_12: false,
    },
    dashboardIntroCompleted: false,
  };
}

/**
 * Save onboarding progress
 */
export async function saveOnboardingProgress(
  userId: string,
  progress: OnboardingProgress
): Promise<void> {
  try {
    await fetch("/api/onboarding/progress", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        userId,
        progress,
      }),
    });
  } catch (error) {
    console.error("Error saving onboarding progress:", error);
  }
}

/**
 * Get onboarding progress
 */
export async function getOnboardingProgress(
  userId: string
): Promise<OnboardingProgress> {
  try {
    const response = await fetch(`/api/onboarding/progress?userId=${userId}`);
    if (!response.ok) {
      throw new Error("Failed to fetch onboarding progress");
    }

    const data = await response.json();
    return data.progress;
  } catch (error) {
    console.error("Error fetching onboarding progress:", error);
    return getInitialProgress();
  }
}

/**
 * Check if onboarding is complete
 */
export function isOnboardingComplete(progress: OnboardingProgress): boolean {
  // Import must be completed
  if (!progress.importCompleted) return false;

  // Genesis and at least one historical point must be completed
  if (!progress.historicalDataPoints.genesis) return false;
  if (
    !progress.historicalDataPoints.february_close &&
    !progress.historicalDataPoints.week_09 &&
    !progress.historicalDataPoints.week_10 &&
    !progress.historicalDataPoints.week_11 &&
    !progress.historicalDataPoints.week_12
  ) {
    return false;
  }

  // Dashboard intro must be completed
  if (!progress.dashboardIntroCompleted) return false;

  return true;
}
```

### Onboarding Flow Controller

```tsx
import React, { useState, useEffect } from "react";
import { useRouter } from "next/router";
import { OnboardingWelcome } from "@/components/onboarding/OnboardingWelcome";
import { ImportOptions } from "@/components/onboarding/ImportOptions";
import { HistoricalDataSetup } from "@/components/onboarding/HistoricalDataSetup";
import { DashboardOnboarding } from "@/components/onboarding/DashboardOnboarding";
import {
  OnboardingStep,
  OnboardingProgress,
  getOnboardingProgress,
  saveOnboardingProgress,
  isOnboardingComplete,
} from "@/lib/onboarding/progress-tracker";

export const OnboardingFlow: React.FC = () => {
  const [progress, setProgress] = useState<OnboardingProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function loadProgress() {
      const userId = "current-user-id"; // This would come from auth
      const userProgress = await getOnboardingProgress(userId);
      setProgress(userProgress);
      setLoading(false);

      // If onboarding is already complete, redirect to dashboard
      if (isOnboardingComplete(userProgress)) {
        router.push("/dashboard");
      }
    }

    loadProgress();
  }, [router]);

  const updateProgress = async (
    updatedProgress: Partial<OnboardingProgress>
  ) => {
    if (!progress) return;

    const newProgress = {
      ...progress,
      ...updatedProgress,
    };

    setProgress(newProgress);
    await saveOnboardingProgress("current-user-id", newProgress);

    // If onboarding is now complete, redirect to dashboard
    if (isOnboardingComplete(newProgress)) {
      router.push("/dashboard");
    }
  };

  const handleImportComplete = (portfolioId: string) => {
    updateProgress({
      currentStep: OnboardingStep.HISTORICAL_DATA,
      portfolioId,
      importCompleted: true,
    });
  };

  const handleHistoricalDataComplete = () => {
    updateProgress({
      currentStep: OnboardingStep.DASHBOARD_INTRO,
    });
  };

  const handleDashboardIntroComplete = () => {
    updateProgress({
      currentStep: OnboardingStep.COMPLETED,
      dashboardIntroCompleted: true,
    });
  };

  if (loading || !progress) {
    return <div>Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      {progress.currentStep === OnboardingStep.WELCOME && (
        <OnboardingWelcome
          onContinue={() =>
            updateProgress({ currentStep: OnboardingStep.IMPORT })
          }
        />
      )}

      {progress.currentStep === OnboardingStep.IMPORT && (
        <ImportOptions onImportComplete={handleImportComplete} />
      )}

      {progress.currentStep === OnboardingStep.HISTORICAL_DATA &&
        progress.portfolioId && (
          <HistoricalDataSetup
            portfolioId={progress.portfolioId}
            progress={progress.historicalDataPoints}
            onUpdateProgress={histPoints => {
              updateProgress({
                historicalDataPoints: {
                  ...progress.historicalDataPoints,
                  ...histPoints,
                },
              });
            }}
            onComplete={handleHistoricalDataComplete}
          />
        )}

      {progress.currentStep === OnboardingStep.DASHBOARD_INTRO &&
        progress.portfolioId && (
          <DashboardOnboarding
            portfolioId={progress.portfolioId}
            onComplete={handleDashboardIntroComplete}
          />
        )}
    </div>
  );
};
```

## 4. Testing and Validation

### Unit Testing for Onboarding

```typescript
// src/lib/onboarding/__tests__/progress-tracker.test.ts

import {
  OnboardingStep,
  OnboardingProgress,
  getInitialProgress,
  isOnboardingComplete,
} from "../progress-tracker";

describe("Onboarding Progress Tracker", () => {
  test("getInitialProgress returns correct structure", () => {
    const progress = getInitialProgress();

    expect(progress.currentStep).toBe(OnboardingStep.WELCOME);
    expect(progress.importCompleted).toBe(false);
    expect(progress.dashboardIntroCompleted).toBe(false);

    expect(progress.historicalDataPoints.genesis).toBe(false);
    expect(progress.historicalDataPoints.february_close).toBe(false);
    expect(progress.historicalDataPoints.week_09).toBe(false);
  });

  test("isOnboardingComplete returns false for initial progress", () => {
    const progress = getInitialProgress();
    expect(isOnboardingComplete(progress)).toBe(false);
  });

  test("isOnboardingComplete returns false when only import is complete", () => {
    const progress = {
      ...getInitialProgress(),
      importCompleted: true,
    };
    expect(isOnboardingComplete(progress)).toBe(false);
  });

  test("isOnboardingComplete returns false when import and genesis are complete", () => {
    const progress = {
      ...getInitialProgress(),
      importCompleted: true,
      historicalDataPoints: {
        ...getInitialProgress().historicalDataPoints,
        genesis: true,
      },
    };
    expect(isOnboardingComplete(progress)).toBe(false);
  });

  test("isOnboardingComplete returns false when missing dashboard intro", () => {
    const progress = {
      ...getInitialProgress(),
      importCompleted: true,
      historicalDataPoints: {
        ...getInitialProgress().historicalDataPoints,
        genesis: true,
        february_close: true,
      },
    };
    expect(isOnboardingComplete(progress)).toBe(false);
  });

  test("isOnboardingComplete returns true when all required steps are complete", () => {
    const progress = {
      ...getInitialProgress(),
      importCompleted: true,
      historicalDataPoints: {
        ...getInitialProgress().historicalDataPoints,
        genesis: true,
        february_close: true,
      },
      dashboardIntroCompleted: true,
    };
    expect(isOnboardingComplete(progress)).toBe(true);
  });
});
```

### End-to-End Testing

```typescript
// cypress/integration/onboarding.spec.ts

describe("Onboarding Flow", () => {
  beforeEach(() => {
    cy.clearLocalStorage();
    cy.clearCookies();

    // Log in test user
    cy.login();

    // Visit onboarding page
    cy.visit("/onboarding");
  });

  it("should complete the full onboarding process", () => {
    // Welcome Screen
    cy.contains("Welcome to Numisma");
    cy.contains("button", "Get Started").click();

    // Import Screen
    cy.contains("Import Your Portfolio");
    cy.contains("Enhanced JSON").click();

    // Import JSON
    cy.fixture("test-portfolio.json").then(portfolio => {
      cy.get("textarea").type(JSON.stringify(portfolio), { delay: 0 });
    });
    cy.contains("button", "Import Data").click();

    // Verify import success
    cy.contains("Import Successful!", { timeout: 10000 });
    cy.contains("button", "Continue").click();

    // Historical Data Screen
    cy.contains("Historical Data Setup");

    // Enter February close prices
    cy.contains("February 2025 Close").click();
    cy.get('input[name="BTC"]').type("92150");
    cy.get('input[name="ETH"]').type("3120");
    cy.contains("button", "Save Data Point").click();

    // Verify February data saved
    cy.contains("Week 09 (March 2, 2025)");

    // Continue to dashboard intro
    cy.contains("button", "Complete Setup").click();

    // Dashboard Introduction
    cy.contains("Welcome to Your Portfolio Dashboard");
    cy.contains("button", "Next").click();
    cy.contains("Performance Chart");
    cy.contains("button", "Next").click();
    cy.contains("Positions Table");
    cy.contains("button", "Next").click();
    cy.contains("Next Steps");
    cy.contains("button", "Get Started").click();

    // Should be redirected to dashboard
    cy.url().should("include", "/dashboard");
  });
});
```
