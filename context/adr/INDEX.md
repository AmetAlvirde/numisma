# ADR Index

| ADR | Title | Scope | Status | Summary |
| --- | ----- | ----- | ------ | ------- |
| [ADR-001](./ADR-001-package-boundary-and-runtime-split.md) | Package boundary and runtime split | product | Accepted | Split into `@numisma/engine` (Node domain) and `@numisma/tui` (Bun/openTUI runtime) so future access surfaces reuse the engine without terminal coupling. |
| [ADR-002](./ADR-002-lot-capital-tier-cost-model.md) | Lot- and Capital-Tier-attributed cost model | product | Accepted | Positions and Reserves carry Lots with Capital Tier instead of a flat amount; position cost basis at entry FX, market value at review FX, cash Lots FX-flat. P&L and seed-vs-house split attribute by tier; untiered remainder leaves the rollup honestly below 100%. |
| [ADR-003](./ADR-003-event-log-genesis-fold-persistence.md) | Append-only event log, immutable genesis seed, and fold to the review model | product | Accepted | Portfolio history is an append-only event log (`PositionOpened`/`PositionClosed`/`PriceMarked`) on an immutable genesis seed; current and as-of state are a pure fold into the existing `FundReviewData`. Trust moves to a validated ingest boundary (`parseEvent` + cross-reference to genesis ids + a `PriceMarked` magnitude guard); decision context is durably logged. Event-sourcing chosen over SQLite / mutable store / dated snapshots. |
