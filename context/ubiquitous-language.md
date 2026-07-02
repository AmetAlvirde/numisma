# Numisma Ubiquitous Language

> Canonical glossary for the Numisma context. Product pitch, goals, and
> constraints live in `context/product.md`.

## Capital Structure

| Term             | Definition                                                                                       | Aliases to avoid   |
| ---------------- | ------------------------------------------------------------------------------------------------ | ------------------ |
| **Fund**         | The top-level capital ownership and accountability entity that provides the official scoreboard. | account, portfolio |
| **Portfolio**    | A mandate and constraint container inside a Fund.                                                | tempo, bucket      |
| **Position**     | The operational market exposure unit managed by the trader.                                      | trade              |
| **Lot**          | An accounting lineage unit inside a Position or Reserve.                                         | fill, parcel       |
| **Capital Tier** | A capital provenance classification that tracks generated capital lineage.                       | tranche            |
| **Reserve**      | The Tempo for liquidity and opportunity readiness.                                               | cash bucket        |

## Operating Dimensions

| Term                  | Definition                                                                                                           | Aliases to avoid   |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Tempo**             | An execution rhythm and behavioral framework assigned immutably to a Position.                                       | timeframe, horizon |
| **Wealth**            | The Tempo for generational preservation and transfer.                                                                | long-term bucket   |
| **Capital**           | The Tempo for major directional trend capture.                                                                       | trend bucket       |
| **Liquid**            | The Tempo for swing-trade return generation.                                                                         | swing bucket       |
| **Pulse**             | The Tempo for short-horizon systematic execution.                                                                    | short-term bucket  |
| **Foresight**         | The Tempo for futures-oriented portfolio management.                                                                 | learning mode      |
| **Strategy**          | The concrete systematic or discretionary rule set used inside a Tempo.                                               | method, setup      |
| **Strategy Version**  | A versioned Strategy state required by every Position.                                                               | strategy id        |
| **Strategy Snapshot** | A frozen Strategy state used for back-tests and forward-tests.                                                       | frozen strategy    |
| **Execution Mode**    | The reporting and behavior mode that separates live, paper, back-test, and forward-test activity.                    | environment        |
| **Perspective**       | A saved analytical lens that filters, groups, formulas, sorts, tags, or lays out information without owning capital. | view, dashboard    |

## Market Objects

| Term           | Definition                                                       | Aliases to avoid |
| -------------- | ---------------------------------------------------------------- | ---------------- |
| **Asset**      | The economic thing that an Instrument references.                | symbol           |
| **Instrument** | A tradable or holdable vehicle that gives exposure to an Asset.  | ticker, symbol   |
| **Platform**   | The place where capital is held, traded, custodied, or deployed. | venue            |
| **Account**    | The user-specific container on a Platform.                       | wallet           |
| **Direction**  | The market exposure orientation of a Position.                   | side             |

## Valuation

| Term         | Definition                                                                                                  | Aliases to avoid |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ---------------- |
| **Currency** | The denomination used to record, hold, convert, or report a monetary value.                                 | money type       |
| **FX Rate**  | A conversion rate between two Currencies used to translate values for reporting at a specific review point. | forex price      |

## Risk, Reporting, and Records

| Term                        | Definition                                                                                                                                 | Aliases to avoid        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| **Risk Budget**             | The permitted risk allocation for a Position or scope under policy.                                                                        | stop size               |
| **Risk Dimension**          | A structured category used to describe and score risk.                                                                                     | risk type               |
| **Risk Reference Value**    | The valuation base used for risk sizing under policy.                                                                                      | NAV                     |
| **Close**                   | An immutable periodic snapshot used for review, valuation, risk reference, and performance.                                                | checkpoint              |
| **NAV**                     | The official net asset value used for valuation and reporting.                                                                             | equity                  |
| **Performance Layer**       | A named level of performance calculation such as Price P&L, Trading P&L, Economic P&L, or Net P&L.                                         | return type             |
| **Price P&L**               | The Performance Layer for instrument price movement only.                                                                                  | market P&L              |
| **Trading P&L**             | The Performance Layer for Price P&L minus fees and slippage.                                                                               | realized trading result |
| **Economic P&L**            | The Performance Layer for Trading P&L plus or minus funding, borrow, dividends, yield, and interest.                                       | total P&L               |
| **Net P&L**                 | The Performance Layer for Economic P&L after tracked taxes or manual adjustments.                                                          | final P&L               |
| **Exposure**                | A measurement of market participation or obligation such as market value, notional exposure, delta-adjusted exposure, or margin committed. | allocation              |
| **Policy**                  | A versioned rule set that governs allowed behavior, limits, and overrides.                                                                 | rule config             |
| **Policy Override**         | A permitted exception to a Policy rule with actor, timestamp, reason, and Policy reference.                                                | override                |
| **Audit Event**             | An immutable record of a material action.                                                                                                  | log entry               |
| **Journal Entry**           | A durable decision note recorded during review or execution.                                                                               | note                    |
| **Entry Thesis**            | The reason a Position is opened.                                                                                                           | rationale               |
| **Invalidation Condition**  | The condition that makes a Position's Entry Thesis no longer valid.                                                                        | stop                    |
| **Planned Holding Horizon** | The intended duration or review window for a Position.                                                                                     | timeframe               |
| **Transfer**                | A ledgered movement of capital between Accounts, Portfolios, or other supported scopes.                                                    | movement                |
| **Manual Adjustment**       | A user-entered correction or annotation that changes a recorded value outside a normal execution event.                                    | correction              |
| **Dashboard**               | A presentation surface for reviewing a focused set of Numisma records.                                                                     | perspective             |

## Profit Split and Position Adjustment

| Term                    | Definition                                                                                                                                                                                                                             | Aliases to avoid      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| **Profit Split**        | The Fund's rule for setting aside a configured fraction of realized profit, split by ratio across Tempos (this Fund's default 60/40, routing 60 to the Wealth Tempo and 40 to the Reserve Tempo).                                      | profit share          |
| **Obligation**          | The descriptive amount the Profit Split owes, computed on the exact cumulative total realized under the configured Split Basis; derived at read time and never added to NAV.                                                           | liability, accrual    |
| **Split Basis**         | The configured loss-netting rule that determines how the Obligation accrues: `highWaterMark` (default — accrues only on new cumulative peaks, no clawback) or `perClose` (accrues on the sum of winning closes).                       | netting mode          |
| **Preferences Sidecar** | The append-only `data/preferences.jsonl` artifact holding time-stamped trader policy (the Profit Split ratio and Split Basis), decoupled from the event log and selected as-of by a pure selector so the log still folds standalone.   | config file, settings |
| **Position Trim**       | A partial reduction of an open Position that removes named quantities from named Capital Tiers, settling the removed quantity to cash and recording a partial realized result; the Position always survives (a full trim is rejected). | partial close         |
| **Position Add-To**     | An increase of an open Position that appends new capital as its own Lot, preserving that Lot's entry FX and Capital Tier rather than blending into the average, and books no realized P&L.                                             | scale-in, average-in  |
| **Reserve Target**      | The policy target that the Reserve Tempo hold 10% of total NAV; the dashboard measures the whole Reserve Tempo's share of total NAV against this 10% target, and the Profit Split's 40% share routes to the same Reserve Tempo.        | reserve floor         |

## Relationships

- A **Fund** contains one or more **Portfolios**.
- A **Portfolio** belongs to exactly one **Fund**.
- A **Position** belongs to exactly one **Fund**, one **Portfolio**, one
  **Tempo**, one **Execution Mode**, one **Strategy Version**, and one
  **Account**.
- A **Position** or **Reserve** contains zero or more **Lots**.
- A **Lot** preserves **Capital Tier** attribution.
- A **Tempo** is immutable for a **Position**.
- A **Strategy Version** belongs to a **Strategy**.
- A **Strategy Snapshot** freezes a **Strategy** for a back-test or
  forward-test.
- An **Instrument** references an **Asset**.
- An **Account** belongs to a **Platform**.
- A **Fund** has a base **Currency** for canonical reporting.
- An **FX Rate** translates non-base **Currency** values into the Fund base
  **Currency** for review and reporting.
- A **Perspective** never owns capital.
- A **Close** can exist at **Fund** level or **Portfolio** level.
- **Execution Mode** controls whether performance can contribute to canonical
  **Fund** reporting.
- A **Policy Override** belongs to a **Policy**.
- A **Journal Entry** can be associated with review or execution.

## Boundary Scenarios

- If a BTC long position changes from Liquid to Capital, the original
  **Position** must be closed and a new **Position** opened with lineage rather
  than mutating **Tempo**.
- If a report combines live and paper results, it is a research view and must
  not be labeled canonical **Fund** performance.
- If a saved high-risk crypto view shows multiple positions, it is a
  **Perspective** and cannot receive cash, own allocation, or report independent
  P&L.

## Example dialogue

> **Dev:** "Can I store the user's Coinbase account as a Platform?" **Domain
> expert:** "No. Coinbase is the Platform; the user's Coinbase main account is
> the Account."

> **Dev:** "Can Foresight mean learning mode?" **Domain expert:** "No. Foresight
> is futures-oriented portfolio management; learning and simulation belong to
> Execution Mode."

> **Dev:** "Can a Perspective have its own P&L?" **Domain expert:** "No. A
> Perspective can calculate filtered analysis, but it never owns capital."

> **Dev:** "Can paper trades affect Fund performance?" **Domain expert:** "No.
> Canonical Fund performance includes live activity only."

## Flagged Ambiguities

- None at project start.
