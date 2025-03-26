# Numisma User Flows

## 1. User Onboarding Flow

### Goal

Enable users to import their existing portfolio data and set up historical
valuation points to begin tracking performance.

### Steps

1. **User Sign-Up**

   - Create account
   - Provide basic information
   - Confirm email

2. **Welcome & Orientation**

   - Introduction to Numisma
   - Overview of key features
   - Quick tour of the interface

3. **Portfolio Import**

   - Option 1: Manual entry of positions
   - Option 2: JSON file upload
   - Option 3: CSV file upload
   - Option 4: Exchange API connection

4. **Portfolio Validation**

   - Review imported positions
   - Confirm asset details
   - Verify order information
   - Correct any import errors

5. **Historical Data Setup**

   - Add February 2025 close prices
   - Add Week 09 data (March 2)
   - Add Week 10 data (March 9)
   - Add Week 11 data (March 16)
   - Add Week 12 data (March 23)

6. **Portfolio Dashboard Introduction**
   - View initial performance metrics
   - Understand the dashboard layout
   - Learn about available reports

### User Story

**As a** crypto trader with an existing portfolio,  
**I want to** quickly import my current positions and see their performance over time,  
**So that** I can make informed decisions about my investments without manual data entry.

### Key Implementation Notes

- Prioritize a smooth, intuitive onboarding process
- Provide clear feedback during import
- Support partial completion (save progress)
- Validate data appropriately without blocking progress

## 2. Position Lifecycle Management Flow

### Goal

Allow users to track and manage positions through their complete lifecycle.

### Steps

1. **Position Planning**

   - Create position in "planned" state
   - Define entry strategy and price targets
   - Set risk level and parameters
   - Document trading thesis

2. **Building Phase**

   - Execute initial order (transition to "building")
   - Track partial entries
   - Monitor entry progress
   - Decide when entry is complete

3. **Active Management**

   - Transition to "active" when entry complete
   - Set stop-loss levels
   - Define take-profit targets
   - Add journal entries for observations

4. **Partial Exits**

   - Execute partial take-profits
   - Track capital tier evolution (C1 → C2 → C3)
   - Adjust risk management based on capital tier
   - Update stop-loss levels as position matures

5. **Position Closure**
   - Execute final exit
   - Complete position closure
   - Transition to "closed" state
   - Review position performance

### User Story

**As a** disciplined trader,  
**I want to** track my positions from planning through closure,  
**So that** I can maintain consistent risk management and learn from each trade.

### Key Implementation Notes

- Design intuitive state transitions with clear visual indicators
- Build capital tier visualization to highlight risk reduction
- Create prompts for journaling at key points in the lifecycle
- Include performance summary when closing positions

## 3. Historical Data Input Flow

### Goal

Allow users to add historical price and holding data to build a complete performance record.

### Steps

1. **Select Time Point**

   - Choose date from timeline
   - Identify timeframe type (daily/weekly/monthly/quarterly)
   - See required vs. optional data points

2. **Asset Price Entry**

   - Enter price data for each asset
   - Options for bulk import of prices
   - Validate against reasonable ranges
   - Interpolate missing values (optional)

3. **Position Change Recording**

   - Document buys/sells during the period
   - Record transfers between wallets
   - Capture fee information
   - Note any significant events

4. **Market Context Addition**

   - Add broader market indices
   - Record BTC/ETH prices
   - Note market capitalization
   - Add Fear & Greed index

5. **Valuation Review**
   - See calculated portfolio value
   - Review performance metrics
   - Compare to previous periods
   - Identify strongest/weakest positions

### User Story

**As a** portfolio manager,  
**I want to** retroactively add historical data points,  
**So that** I can see how my portfolio has performed over time.

### Key Implementation Notes

- Design an intuitive interface for entering multiple price points
- Implement validation to prevent unrealistic values
- Support batch operations for efficiency
- Show immediate feedback as values are entered

## 4. Performance Analysis Flow

### Goal

Enable users to analyze portfolio performance across different time periods with various metrics.

### Steps

1. **Report Type Selection**

   - Choose report timeframe (daily/weekly/monthly/quarterly/yearly)
   - Select source data granularity
   - Set date range for analysis
   - Choose comparison reference points

2. **Performance Metric Selection**

   - Select primary metrics (absolute return, percentage, etc.)
   - Choose secondary metrics (volatility, Sharpe ratio, etc.)
   - Set benchmark for comparison
   - Configure display preferences

3. **Visualization Interaction**

   - View time series charts
   - Drill down into specific periods
   - Hover for detailed metrics
   - Toggle between different chart types

4. **Position-Level Analysis**

   - View top/bottom performers
   - See position contribution to overall return
   - Analyze correlation between positions
   - Examine risk-adjusted returns

5. **Report Export & Sharing**
   - Save report configuration
   - Export to PDF/CSV
   - Schedule recurring reports
   - Share with team members

### User Story

**As an** investor tracking multiple crypto assets,  
**I want to** analyze the performance of my portfolio across different timeframes,  
**So that** I can identify trends, strengths, and areas for improvement.

### Key Implementation Notes

- Focus on interactive, responsive visualizations
- Implement efficient calculation for real-time analysis
- Design clear comparative metrics
- Allow flexible report configuration

## 5. Portfolio Organization Flow

### Goal

Allow users to organize positions into meaningful portfolio groups for targeted analysis.

### Steps

1. **Portfolio Creation**

   - Name new portfolio
   - Add description and tags
   - Set display preferences
   - Define purpose (long-term, tactical, etc.)

2. **Position Assignment**

   - Add positions to portfolio
   - Set display order
   - Group related positions
   - Configure visibility settings

3. **Multi-Portfolio Management**

   - Assign positions to multiple portfolios
   - Set different display options in each context
   - Manage visibility settings
   - Track performance across portfolios

4. **Portfolio Comparison**

   - Compare performance metrics
   - Analyze risk profiles
   - View allocation differences
   - Track correlation between portfolios

5. **Portfolio Archiving**
   - Archive completed portfolios
   - Preserve historical performance
   - Document lessons learned
   - Set up successor portfolios

### User Story

**As a** crypto investor with diverse holdings,  
**I want to** organize my positions into logical portfolio groups,  
**So that** I can analyze performance based on different strategies or timeframes.

### Key Implementation Notes

- Design intuitive drag-and-drop interface for portfolio management
- Implement clear visual distinction between portfolios
- Create efficient filtering and sorting capabilities
- Build performance comparison visualizations
