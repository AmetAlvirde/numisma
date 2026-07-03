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
- MVP work excludes broker or exchange integrations, automated execution, team
  workflows, second-party approvals, SaaS deployment, and full back-test or
  forward-test engines.
- **Automated market data is post-MVP and in progress.** Its MVP exclusion was a
  sequencing choice, not a permanent boundary. Prices now arrive automatically
  from free sources through the two-plane price model (ADR-005): a disposable,
  re-fetchable price store beside the event log, and the sparse `PriceMarked`
  valuation mark on the existing validated inbox. Manual `PriceMarked` authoring
  remains the permanent fallback.
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

## Profit-Split and Position-Adjustment Decisions

These user-ratified decisions govern how the Fund trims and scales Positions and
how it derives the profit-split obligation. They are the durable source of truth;
the engine honors them, never the reverse.

- **The split ratio is a configurable trader preference, never hardcoded.** This
  Fund's default is 60/40, routing 60 to the Wealth Tempo and 40 to the Reserve
  Tempo. The ratio is changed by appending to the preferences sidecar
  (`data/preferences.jsonl`), not by editing engine code — 60/40 is this Fund's
  default, not a constant.
- **The loss-netting basis is a configurable preference with a fixed vocabulary.**
  `highWaterMark` is the default: the obligation accrues only on new cumulative
  peaks, with no clawback, so a drawdown is recovered before any new obligation
  accrues. `perClose` is selectable: the obligation accrues on the sum of winning
  closes. Either basis computes the obligation on the **exact cumulative total
  realized**, never an approximate per-tier split.
- **The Reserve sink and the 10%-of-NAV target are one definition.** The 40% share
  routes to the **Reserve Tempo**, and the dashboard's percentage-versus-target
  line measures the whole **Reserve Tempo's share of total NAV** against a 10%
  target. One Reserve definition serves both the routing sink and the target, so
  they cannot drift apart.
- **The profit-split block is obligation-only and descriptive-only.** It shows the
  honestly computable obligation and the Reserve-versus-10% line, and nothing else
  — no "unallocated profit" line and no inferred routed-flow. The obligation is
  never re-added to NAV: blanking the block leaves the Fund value unchanged. The
  running "unallocated until routed" balance is a deliberate later increment, out
  of scope here.
- **A full-retirement trim is rejected; the Position always survives a trim.** A
  trim that would remove every lot fails loud at ingest and directs the trader to
  use `PositionClosed` instead. A trim takes partial profit off named Capital Tiers
  and leaves the Position open with reduced lots; a deliberate full exit is a
  distinct material action.
- **Trader policy is decoupled from the event log.** The split ratio and
  loss-netting basis live in the time-stamped, append-only preferences sidecar with
  a pure as-of selector, so the event log still folds standalone to the descriptive
  book and an as-of replay shows the policy that was in effect at that date.

## Constraints

- v1 is local-first.
- v1 is single-user.
- v1 is manual-entry first.
- v1 reports USD values to cents precision.
- Domain language lives in `context/ubiquitous-language.md`, not in this product
  framing.
