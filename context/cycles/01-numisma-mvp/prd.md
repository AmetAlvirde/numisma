# Numisma MVP PRD

## Focus

Build the MVP cycle for Numisma as a local-first manual trader operating system
centered on Fund review, Portfolio mandate visibility, Tempo-aware Position
management, execution-integrated journaling, and immutable Close records.

## Intentions

- Help the user see current Fund composition without stitching together exchange
  balances, broker dashboards, spreadsheets, journals, and charting notes.
- Make the distinction between Portfolio mandate and Tempo behavior visible in
  normal review and execution workflows.
- Preserve Position lineage, Lot accounting, Strategy context, Risk Budget, and
  decision context by default.
- Keep live performance separate from paper, back-test, and forward-test
  activity.
- Make Perspectives useful for analysis without allowing them to become capital
  containers.

## Goals

- Create and review a Fund.
- Create and review Portfolios inside a Fund.
- Assign capital, Positions, and activity across Tempos.
- Manually open Positions with required metadata: Fund, Portfolio, Tempo,
  Execution Mode, Strategy Version, Instrument, Direction, Account, Entry
  Thesis, Invalidation Condition, Risk Budget, and Planned Holding Horizon.
- Manually close or partially close Positions while preserving Lot lineage and
  realized versus unrealized P&L separation.
- Manually enter prices, balances, valuations, and Close notes.
- Review open Positions, Fund composition, Portfolio composition, Tempo
  performance, and active risk.
- Create Perspectives as saved analytical lenses over existing capital records.
- Record Journal Entries by default during execution and review workflows.
- View Fund, Portfolio, Tempo, active Position, and Perspective dashboards.
- Preserve Audit Events for material actions including Position open, Position
  close, Policy change, Policy Override, Transfer, Manual Adjustment, Strategy
  change, and Close creation.

## Non-goals

- Do not integrate broker or exchange APIs in the MVP.
- Do not automate market data ingestion in the MVP.
- Do not automate execution in the MVP.
- Do not build team workflows or second-party approvals in the MVP.
- Do not make tax logic part of core decision logic in the MVP.
- Do not deploy a SaaS surface in the MVP.
- Do not build full back-test or forward-test engines in the MVP.
- Do not allow paper, back-test, or forward-test activity to contaminate
  canonical Fund performance.
- Do not let Perspectives own capital, balances, allocation, or independent P&L.

## User stories

- As an individual trader, I want to review my Fund so that I can understand
  total capital composition and official performance.
- As an individual trader, I want to review Portfolios so that I can understand
  the mandate, constraints, allowed Tempos, and risk limits for each Portfolio.
- As an individual trader, I want to assign each Position to one Tempo so that
  execution behavior and review cadence are explicit.
- As an individual trader, I want to open a Position with Strategy context,
  Entry Thesis, Invalidation Condition, Risk Budget, and Planned Holding Horizon
  so that each Exposure has accountable intent.
- As an individual trader, I want to close or partially close a Position using a
  known Lot selection method so that accounting lineage remains inspectable.
- As an individual trader, I want to enter prices and valuations manually so
  that I can run the product without broker, exchange, or market data
  integrations.
- As an individual trader, I want to create a Close so that weekly or periodic
  review produces an immutable snapshot.
- As an individual trader, I want to inspect Tempo performance so that different
  operating rhythms can be evaluated separately.
- As an individual trader, I want to save Perspectives so that recurring
  analytical lenses do not require rebuilding filters and groupings.
- As an individual trader, I want Journal Entries to be part of execution so
  that decisions are captured while context is fresh.

## Encounter statements

- When the user asks "What is my Fund composed of right now?", Numisma should
  answer from current manual records without external spreadsheets.
- When the user opens a Position, Numisma should force explicit Tempo, Strategy
  Version, Execution Mode, Account, Entry Thesis, Invalidation Condition, Risk
  Budget, and Planned Holding Horizon.
- When the user reviews performance, Numisma should clearly separate live
  canonical reporting from paper, back-test, forward-test, or mixed-mode
  research reports.
- When the user saves a Perspective, Numisma should treat it as an analytical
  lens over capital records, not a new owner of capital.
- When the user creates a Close, Numisma should capture valuation, balances,
  Positions, Performance Layers, Risk Reference Value, Policy versions, and
  notes.

## Constraints and assumptions

- v1 is local-first.
- v1 is single-user.
- v1 is manual-entry first.
- v1's first access surface is a TUI.
- v1 supports the full multi-asset domain model from the start.
- v1 labels back-test and forward-test as Execution Modes but does not implement
  full simulation engines.
- v1 supports Reserve liquidity, yield instruments, and reserve Positions.
- v1 user-facing reporting should satisfy USD cents precision.
- FIFO is the default Lot selection method.
- Opposite-direction Positions are allowed simultaneously when they belong to
  different Fund, Portfolio, Tempo, Execution Mode, Strategy Version, or Account
  assignments and are never auto-netted unless the user requests a net Exposure
  report.

## Success metrics

- The user completes at least one weekly Fund review with updated prices,
  current open Positions, Tempo allocation, Portfolio allocation, and journaled
  decisions for four consecutive weeks.
- At least 90% of open Positions have Entry Thesis, Invalidation Condition, Risk
  Budget, and Planned Holding Horizon recorded.
- At least 90% of Position open or close actions have an associated Journal
  Entry.
- The user completes weekly review without external spreadsheets.
- At least one active Position is analyzed through a Perspective.
- The user can answer "What is my Fund composed of right now?" from Numisma
  during review.

## Success signals

- Fund, Portfolio, Tempo, active Position, and Perspective dashboards provide
  distinct answers rather than duplicating the same list.
- Position workflows make missing Strategy Version, Execution Mode, Entry
  Thesis, Invalidation Condition, Risk Budget, or Planned Holding Horizon
  impossible to ignore.
- Close records are treated as immutable snapshots after creation.
- Live performance is labeled canonical only when it excludes paper, back-test,
  and forward-test activity.
- Journal Entries appear as a natural part of execution rather than an
  afterthought.

## Open questions

- RESOLVE THROUGH IMPLEMENTATION: What local persistence choice best supports a
  local-first TUI while preserving auditability?
- RESOLVE THROUGH IMPLEMENTATION: What TUI interaction model makes review,
  execution, and Close workflows fastest for the user?
- RESOLVE THROUGH IMPLEMENTATION: What internal numeric precision should be used
  beyond user-facing USD cents reporting?
- RESOLVE THROUGH IMPLEMENTATION: What default Policy rules and severities
  should ship in v1?
- RESOLVE THROUGH IMPLEMENTATION: What exact Risk Budget formulas and scoring
  should ship in v1?
- RESOLVE THROUGH IMPLEMENTATION: What fields define Strategy, Strategy Version,
  and Strategy Snapshot in v1?
