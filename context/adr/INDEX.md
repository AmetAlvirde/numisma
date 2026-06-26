# ADR Index

| ADR | Title | Scope | Status | Summary |
| --- | ----- | ----- | ------ | ------- |
| [ADR-001](./ADR-001-package-boundary-and-runtime-split.md) | Package boundary and runtime split | product | Accepted | Split into `@numisma/engine` (Node domain) and `@numisma/tui` (Bun/openTUI runtime) so future access surfaces reuse the engine without terminal coupling. |
| [ADR-002](./ADR-002-lot-capital-tier-cost-model.md) | Lot- and Capital-Tier-attributed cost model | product | Accepted | Positions and Reserves carry Lots with Capital Tier instead of a flat amount; position cost basis at entry FX, market value at review FX, cash Lots FX-flat. P&L and seed-vs-house split attribute by tier; untiered remainder leaves the rollup honestly below 100%. |
