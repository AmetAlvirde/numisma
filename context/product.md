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

- The authoring surface is the local-first TUI. Every write — ingest, orders,
  fills, plans — happens on the operator's machine, against the durable log.
- A second, **read-only** surface has since shipped: a hosted, single-tenant,
  session-gated projection of the composition, fed by one-way local→cloud push
  (ADR-007, ADR-009, ADR-016). It is phone-checkable review, never an authoring
  surface: nothing it serves can be written back, and it holds a narrowed
  allow-listed shape of the fund, not the log.
- Further access surfaces (automation, additional clients) remain open.

## Work Boundaries

- MVP work centers on manual portfolio tracking, execution-integrated
  journaling, review dashboards, and close workflows.
- MVP work excludes broker or exchange integrations, automated execution, team
  workflows, second-party approvals, multi-tenant SaaS, and full back-test or
  forward-test engines.
- **The hosted projection is deployment, not SaaS (ADR-007/008/011/016).** The
  exclusion above was once written as "SaaS deployment" and is now narrower,
  because a single-tenant read-only projection shipped. What stays excluded is
  what made SaaS a boundary in the first place: more than one tenant, sign-up,
  team workflows, and any write path from the cloud back to the log. One seeded
  account, sign-up disabled, and a session verified before any fund value is
  read.
- **Automated market data works through the two-plane price model (ADR-005):** a
  disposable, re-fetchable price store beside the event log, and the sparse
  `PriceMarked` valuation mark on the existing validated inbox. Prices arrive
  automatically from free sources. Manual `PriceMarked` authoring remains the
  permanent fallback.
- **Resting Orders are tracked as availability, never automated execution
  (ADR-013/ADR-014).** A trader-exported <exchange> open-orders file is imported
  into a durable sidecar (`data/orders.jsonl`, outside the event log) so the
  Fund can show `available = value − committed` per Reserve. This is manual
  export-then-import, not a live broker connection or automated order
  placement — the MVP exclusion of broker/exchange integrations and automated
  execution above still holds; only the import step exists, and it is
  deliberately not (yet) automated or piped (ADR-014).
- **A plan is a declaration the Fund is measured against, never an instruction
  it executes.** A position's intended ladder or cadence is authored by hand in
  a durable sidecar (`data/plans.jsonl`, outside the event log), and supersession
  is by append so an as-of replay shows the plan that was in effect then.
  Nothing places an order from it. Its only enforcement is being *shown*: the
  desk report marks each active position against what actually filled, and
  `data/reconciliations.jsonl` records that the comparison was made and what it
  said. A gap is reported as unknown, never as clean.
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
