# Numisma Product

## Elevator Pitch

Numisma is a local-first trader operating system that helps an individual
multi-asset trader maintain one disciplined record of capital ownership, risk,
execution behavior, and decision history across Tempos.

## Intentions

- Turn scattered portfolio, exchange, spreadsheet, journal, and charting records
  into one coherent operating experience.
- Make Fund-level capital composition legible enough for weekly review without
  external spreadsheets.
- Preserve decision context at the moment Positions are opened, adjusted, or
  closed.
- Keep research, simulation, and live performance visibly separate.

## Goals

- Provide a single-user manual-entry product for Fund review, Position
  execution, periodic Close, and decision journaling.
- Support capital review across Portfolio, Tempo, Strategy, Capital Tier,
  Platform, Account, and Execution Mode.
- Make saved Perspectives part of the normal review workflow.
- Establish a product foundation that can support future access surfaces without
  changing the product identity.

## Access Surface

- Initial access surface: local-first TUI.
- Future access surfaces may include web SaaS, automation surfaces, or
  additional clients.

## Work Boundaries

- MVP work centers on manual portfolio tracking, execution-integrated
  journaling, review dashboards, and close workflows.
- MVP work excludes broker or exchange integrations, automated market data,
  automated execution, team workflows, second-party approvals, SaaS deployment,
  and full back-test or forward-test engines.
- Taxes may be annotated or exported later, but tax logic is not core decision
  logic for the MVP.

## Generative Core

The generative core is capital discipline across Fund ownership, Portfolio
mandate, Tempo-specific behavior, Strategy context, Position lineage, Close
snapshots, and durable audit history.

## Coherence Signals

- A user can answer "What is my Fund composed of right now?" from inside
  Numisma.
- A Position cannot be opened without Entry Thesis, Invalidation Condition, Risk
  Budget, Planned Holding Horizon, and Strategy context.
- Weekly review produces updated prices, current open Positions, Tempo
  allocation, Portfolio allocation, and journaled decisions.
- Live performance is never mixed silently with paper, back-test, or
  forward-test performance.
- Perspectives help analysis without becoming capital containers.

## Constraints

- v1 is local-first.
- v1 is single-user.
- v1 is manual-entry first.
- v1 reports USD values to cents precision.
- Domain language lives in `context/ubiquitous-language.md`, not in this product
  framing.
